// beeper.chat — local triage web app (MVP, zero dependencies)
//
// Run:  node server.mjs   then open  http://localhost:4317
//
// A thin local proxy: the browser never sees your keys. The server reads your
// Beeper inbox from the local Desktop API and asks Claude to rank it by
// importance x urgency, returning a daily action-item list.
//
// Defaults to DEMO mode (sample data) so the UI works with no setup. To go live,
// copy .env.example -> .env, set ANTHROPIC_API_KEY + BEEPER_ACCESS_TOKEN, and
// set DEMO=0.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

// --- tiny .env loader (no dependency) ---
(() => {
  const f = join(DIR, '.env');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const PORT = Number(process.env.PORT || 4317);
const DEMO = process.env.DEMO !== '0';
const BEEPER_BASE = process.env.BEEPER_API_BASE || 'http://127.0.0.1:23373';
const BEEPER_TOKEN = process.env.BEEPER_ACCESS_TOKEN || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

// Scoring rubric + voice, kept in sync with .claude/skills/beeper/SKILL.md
const RUBRIC = `Score every chat with importance x urgency.
importance 1-5: 5 = inner circle / money / health / legal / a promise you made; 1 = newsletters, bots, promos, noise.
urgency 1-5: 5 = someone waiting now / deadline today / you are blocking others; 1 = pure FYI.
score = importance * urgency (1-25). classify each as REPLY (say something), TASK (do something first), or NOISE (archive candidate).
Drafts must sound human, not AI: no em dashes, no emojis, never needy. Be direct: say the thing, ask plainly, give an easy out.`;

const SAMPLE = [
  { chatId: 'demo-otavio', who: 'Otavio', network: 'WhatsApp', importance: 5, urgency: 5, score: 25, type: 'REPLY+TASK',
    summary: 'Needs your refreshed bank statements + last 3 months invoices to push the visa through. Your visa expires this month.',
    nextStep: 'Send the docs, then confirm.',
    draft: 'yo otavio, getting the refreshed bank statements + last 3 months invoices together, will send asap. lmk if you need anything else' },
  { chatId: 'demo-chance', who: 'Chance Ns', network: 'WhatsApp', importance: 5, urgency: 4, score: 20, type: 'REPLY',
    summary: 'Answered your startup-society question. Renewal decision is due around end of month.',
    nextStep: 'Decide on renewal, reply with timing.',
    draft: 'appreciate this chance, super helpful. still chewing on the decision but i will get back to you before end of month.' },
  { chatId: 'demo-jangle', who: 'Jangle', network: 'WhatsApp', importance: 4, urgency: 1, score: 4, type: 'REPLY',
    summary: 'Shared a song. Nothing owed.', nextStep: 'Optional ack.', draft: 'saved, giving it a listen' },
  { chatId: 'demo-spoil', who: 'Spoil Me Club', network: 'X', importance: 1, urgency: 1, score: 1, type: 'NOISE',
    summary: 'Spam group invite.', nextStep: 'Archive.', draft: '' },
  { chatId: 'demo-airdrop', who: 'Airdrop Bot', network: 'X', importance: 1, urgency: 1, score: 1, type: 'NOISE',
    summary: 'Crypto airdrop spam.', nextStep: 'Archive.', draft: '' },
];

// --- Beeper local API (live mode) ---
// NOTE: confirm exact paths/params against https://developers.beeper.com/desktop-api-reference
async function beeper(path, opts = {}) {
  const r = await fetch(`${BEEPER_BASE}${path}`, {
    ...opts,
    headers: { 'Authorization': `Bearer ${BEEPER_TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`Beeper ${path} -> ${r.status} ${await r.text().catch(() => '')}`);
  return r.status === 204 ? null : r.json();
}

async function fetchInbox() {
  // Pull non-archived chats and a little recent context for each.
  const chats = await beeper(`/v1/chats?limit=60`);
  const list = Array.isArray(chats) ? chats : (chats.items || chats.chats || []);
  const enriched = [];
  for (const c of list.slice(0, 40)) {
    let messages = [];
    try { const m = await beeper(`/v1/chats/${c.id || c.chatID}/messages?limit=8`); messages = m.items || m || []; } catch {}
    enriched.push({ id: c.id || c.chatID, title: c.title || c.name, network: c.network || c.accountID, unread: c.unreadCount, messages });
  }
  return enriched;
}

// --- Claude ranking ---
async function rankWithClaude(chats) {
  const prompt = `${RUBRIC}

Here are my Beeper chats as JSON. Rank them by score (desc). For each, return:
chatId, who, network, importance, urgency, score, type (REPLY | TASK | REPLY+TASK | NOISE),
summary (one line), nextStep (the concrete next action), draft (a reply in my voice, only if type includes REPLY; else "").

Respond with ONLY a JSON array, no prose.

CHATS:
${JSON.stringify(chats).slice(0, 90000)}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Anthropic -> ${r.status} ${await r.text().catch(() => '')}`);
  const data = await r.json();
  const text = (data.content || []).map((b) => b.text || '').join('');
  const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  return JSON.parse(json);
}

async function getRankedInbox() {
  if (DEMO) return { demo: true, items: SAMPLE };
  if (!ANTHROPIC_KEY) throw new Error('Set ANTHROPIC_API_KEY (or keep DEMO=1).');
  if (!BEEPER_TOKEN) throw new Error('Set BEEPER_ACCESS_TOKEN (or keep DEMO=1).');
  const chats = await fetchInbox();
  const items = await rankWithClaude(chats);
  items.sort((a, b) => (b.score || 0) - (a.score || 0));
  return { demo: false, items };
}

async function act(action, chatId) {
  if (DEMO) return { ok: true, demo: true };
  if (action === 'archive') { await beeper(`/v1/chats/${chatId}`, { method: 'PATCH', body: JSON.stringify({ isArchived: true }) }); return { ok: true }; }
  if (action === 'pin') { await beeper(`/v1/chats/${chatId}`, { method: 'PATCH', body: JSON.stringify({ isPinned: true }) }); return { ok: true }; }
  if (action === 'lowpriority') { await beeper(`/v1/chats/${chatId}`, { method: 'PATCH', body: JSON.stringify({ isLowPriority: true }) }); return { ok: true }; }
  return { ok: false, error: `unknown action ${action}` };
}

// --- HTTP ---
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      return send(res, 200, await readFile(join(DIR, 'public', 'index.html'), 'utf8'), 'text/html');
    }
    if (req.method === 'GET' && req.url === '/api/inbox') {
      return send(res, 200, await getRankedInbox());
    }
    if (req.method === 'POST' && req.url === '/api/act') {
      let body = ''; for await (const c of req) body += c;
      const { action, chatId } = JSON.parse(body || '{}');
      return send(res, 200, await act(action, chatId));
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`beeper.chat web  ->  http://localhost:${PORT}   [${DEMO ? 'DEMO data' : 'LIVE: Beeper + Claude'}]`);
  if (DEMO) console.log('Demo mode. Copy .env.example -> .env, add keys, set DEMO=0 to go live.');
});
