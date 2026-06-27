// beeper.chat — local triage web app (MVP, zero dependencies)
//
// Run:  node server.mjs   then open  http://localhost:4317
//
// A thin local proxy: the browser never sees your keys. It reads your Beeper
// inbox from the local Desktop API, ranks it importance x urgency, and runs a
// draft assistant. Ranking + drafting use your Claude SUBSCRIPTION by default
// (LLM=cli, via the Claude Code CLI) so no Anthropic API credits are needed.
// Set LLM=api to use a pay-as-you-go ANTHROPIC_API_KEY instead.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
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
const LLM = (process.env.LLM || 'cli').toLowerCase();
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const API_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const CLI_MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

const VOICE = `Write in my voice: casual, mostly lowercase, short. NEVER use em dashes (the "—" character) anywhere; use commas, periods, or separate lines instead. No emojis. Not needy or AI-sounding: say the thing, ask plainly, give the other person an easy out.`;

const RUBRIC = `Score every chat with importance x urgency.
importance 1-5: 5 = inner circle / money / health / legal / a promise you made; 1 = newsletters, bots, promos, noise.
urgency 1-5: 5 = someone waiting now / deadline today / you are blocking others; 1 = pure FYI.
score = importance * urgency (1-25). classify each as REPLY (say something), TASK (do something first), or NOISE (archive candidate).`;

const SAMPLE = [
  { chatId: 'demo-otavio', who: 'Otavio', network: 'WhatsApp', importance: 5, urgency: 5, score: 25, type: 'REPLY+TASK',
    summary: 'Needs your refreshed bank statements + last 3 months invoices to push the visa through. Your visa expires this month.',
    nextStep: 'Send the docs, then confirm.',
    draft: 'yo otavio, getting the refreshed bank statements + last 3 months invoices together, will send asap. lmk if you need anything else' },
  { chatId: 'demo-chance', who: 'Chance Ns', network: 'WhatsApp', importance: 5, urgency: 4, score: 20, type: 'REPLY',
    summary: 'Answered your startup-society question. Renewal decision is due around end of month.',
    nextStep: 'Decide on renewal, reply with timing.',
    draft: 'appreciate this chance, super helpful. still chewing on the decision but i will get back to you before end of month.' },
  { chatId: 'demo-joey', who: 'Joey', network: 'WhatsApp', importance: 4, urgency: 3, score: 12, type: 'REPLY',
    summary: 'Asked if you can cover the apartment slot. Waiting on a yes or no.',
    nextStep: 'Tell him whether you are in.', draft: 'hey joey, checking on it now, will confirm tonight' },
  { chatId: 'demo-spoil', who: 'Spoil Me Club', network: 'X', importance: 1, urgency: 1, score: 1, type: 'NOISE',
    summary: 'Spam group invite.', nextStep: 'Archive.', draft: '' },
];

// --- Beeper local API ---
async function beeper(path, opts = {}) {
  const r = await fetch(`${BEEPER_BASE}${path}`, {
    ...opts,
    headers: { 'Authorization': `Bearer ${BEEPER_TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`Beeper ${path} -> ${r.status} ${await r.text().catch(() => '')}`);
  return r.status === 204 ? null : r.json();
}

async function fetchInbox() {
  const chats = await beeper(`/v1/chats/search?inbox=primary&limit=40`);
  const list = chats.items || [];
  const enriched = [];
  for (const c of list.slice(0, 40)) {
    let messages = [];
    try { const m = await beeper(`/v1/chats/${c.id || c.chatID}/messages?limit=8`); messages = m.items || m || []; } catch {}
    enriched.push({ id: c.id || c.chatID, title: c.title || c.name, network: c.network || c.accountID, unread: c.unreadCount, messages });
  }
  return enriched;
}

async function transcriptFor(chatId, limit = 12) {
  const m = await beeper(`/v1/chats/${chatId}/messages?limit=${limit}`);
  const items = (m.items || m || []).slice().reverse();
  return items.map((x) => `${x.isSender ? 'Me' : (x.senderName || 'Them')}: ${x.text || '[media]'}`).join('\n');
}

async function searchChats(q) {
  const r = await beeper(`/v1/chats/search?query=${encodeURIComponent(q)}&type=single&limit=6`);
  return (r.items || []).map((c) => ({ id: c.id || c.chatID, who: c.title || c.name, network: c.network || c.accountID }));
}

// --- Claude (subscription by default) ---
function runClaudeCli(prompt) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // force subscription auth, not the API
    const child = spawn(CLAUDE_BIN, ['-p', '--output-format', 'json', '--model', CLI_MODEL], { env, cwd: tmpdir(), shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => reject(new Error(`Could not run "${CLAUDE_BIN}". Is Claude Code installed and logged in? ${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 400)}`));
      try { resolve(JSON.parse(out).result ?? ''); } catch { reject(new Error(`Unexpected claude output: ${out.slice(0, 300)}`)); }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function completeText(prompt, maxTokens = 2000) {
  if (LLM === 'api') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: API_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) throw new Error(`Anthropic -> ${r.status} ${await r.text().catch(() => '')}`);
    const data = await r.json();
    return (data.content || []).map((b) => b.text || '').join('');
  }
  return runClaudeCli(prompt);
}

// --- ranking ---
function rankPrompt(chats) {
  return `${RUBRIC}

${VOICE}

Rank my Beeper chats (JSON below) by score, descending. For each return:
chatId, who, network, importance, urgency, score, type (REPLY | TASK | REPLY+TASK | NOISE),
summary (one line), nextStep (the concrete next action), draft (a reply in my voice, only if type includes REPLY; else "").
Respond with ONLY a JSON array, no prose.

CHATS:
${JSON.stringify(chats).slice(0, 90000)}`;
}
function parseItems(text) { return JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)); }

async function getRankedInbox() {
  if (DEMO) return { demo: true, items: SAMPLE };
  if (!BEEPER_TOKEN) throw new Error('Set BEEPER_ACCESS_TOKEN (or keep DEMO=1).');
  if (LLM === 'api' && !ANTHROPIC_KEY) throw new Error('LLM=api needs ANTHROPIC_API_KEY (or use LLM=cli for your subscription).');
  const items = parseItems(await completeText(rankPrompt(await fetchInbox()), 4000));
  items.sort((a, b) => (b.score || 0) - (a.score || 0));
  return { demo: false, llm: LLM, items };
}

// --- draft assistant ---
function chatPrompt(messages, ctx) {
  const convo = messages.map((m) => `${m.role === 'user' ? 'Me' : 'You'}: ${m.content}`).join('\n');
  const context = ctx
    ? `\nYou are helping me reply to my chat with ${ctx.who}${ctx.network ? ` (${ctx.network})` : ''}.\nRecent messages, newest last:\n${ctx.transcript || '(none loaded)'}\n`
    : '';
  return `You are beeper.chat's draft assistant. You help me reply to people on my messaging apps.
${VOICE}
When I ask for a reply or a draft, output ONLY the message text I should send, ready to paste, in my voice. No quotes around it, no labels, no preamble. If I am just chatting or asking a question, answer briefly. Keep replies short.
${context}
Conversation:
${convo}
You:`;
}

async function handleChat(body) {
  const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  let ctx = null;
  if (body.chat && body.chat.who) {
    ctx = { who: body.chat.who, network: body.chat.network || '', transcript: '' };
    if (body.chat.id && !DEMO && BEEPER_TOKEN) {
      try { ctx.transcript = await transcriptFor(body.chat.id); } catch {}
    }
  }
  const reply = (await completeText(chatPrompt(messages, ctx), 1500)).trim();
  return { reply };
}

// --- write actions (Rule 0: only on an explicit user click) ---
async function act(action, chatId) {
  if (DEMO) return { ok: true, demo: true };
  const map = { archive: { isArchived: true }, pin: { isPinned: true }, lowpriority: { isLowPriority: true } };
  if (!map[action]) return { ok: false, error: `unknown action ${action}` };
  await beeper(`/v1/chats/${chatId}`, { method: 'PATCH', body: JSON.stringify(map[action]) });
  return { ok: true };
}

async function sendMessage(chatId, text) {
  if (DEMO) return { ok: true, demo: true };
  if (!chatId || !text) return { ok: false, error: 'missing chatId or text' };
  await beeper(`/v1/chats/${chatId}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
  return { ok: true };
}

// --- HTTP ---
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
async function readBody(req) { let b = ''; for await (const c of req) b += c; return JSON.parse(b || '{}'); }

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, await readFile(join(DIR, 'public', 'index.html'), 'utf8'), 'text/html');
    }
    if (req.method === 'GET' && url.pathname === '/api/inbox') return send(res, 200, await getRankedInbox());
    if (req.method === 'GET' && url.pathname === '/api/search') {
      if (DEMO || !BEEPER_TOKEN) return send(res, 200, { items: [] });
      return send(res, 200, { items: await searchChats(url.searchParams.get('q') || '') });
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') return send(res, 200, await handleChat(await readBody(req)));
    if (req.method === 'POST' && url.pathname === '/api/act') { const b = await readBody(req); return send(res, 200, await act(b.action, b.chatId)); }
    if (req.method === 'POST' && url.pathname === '/api/send') { const b = await readBody(req); return send(res, 200, await sendMessage(b.chatId, b.text)); }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  const mode = DEMO ? 'DEMO data' : `LIVE: Beeper + Claude (${LLM === 'api' ? 'API key' : 'subscription'})`;
  console.log(`beeper.chat web  ->  http://localhost:${PORT}   [${mode}]`);
});
