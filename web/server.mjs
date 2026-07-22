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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR || join(DIR, 'snapshots');

// live progress for the UI's triage bar
const progress = { active: false, stage: 'idle', done: 0, total: 0 };

const VOICE = `Write in my voice and make every reply land. I am a sharp, warm, high-agency founder. My texts are casual, mostly lowercase, short (usually one or two lines). Take a clear position, push the thing forward, and close the loop so the ball lands back in their court. Confident, never arrogant. Warm, never needy. Specific, never generic. When it helps, ask the single sharpest question that unblocks the next step. Cut every filler word: no "just checking in", no "hope you're well", no over-explaining, no hedging, no over-thanking. HARD RULES: never use em dashes (the "—" character) anywhere; use commas, periods, or line breaks instead. No emojis. Never sound like AI or a support bot.`;

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
  progress.stage = 'fetching chat list';
  const chats = await beeper(`/v1/chats/search?inbox=primary&limit=60`);
  const list = (chats.items || []).slice(0, 60);
  progress.stage = 'reading chats'; progress.total = list.length; progress.done = 0;
  const enriched = [];
  for (const c of list) {
    let messages = [];
    try { const m = await beeper(`/v1/chats/${c.id || c.chatID}/messages?limit=8`); messages = m.items || m || []; } catch {}
    enriched.push({ id: c.id || c.chatID, title: c.title || c.name, network: c.network || c.accountID, unread: c.unreadCount, messages });
    progress.done++;
  }
  return enriched;
}

async function transcriptFor(chatId, limit = 12) {
  const m = await beeper(`/v1/chats/${chatId}/messages?limit=${limit}`);
  const items = (m.items || m || []).slice().reverse();
  return items.map((x) => `${x.isSender ? 'Me' : (x.senderName || 'Them')}: ${x.text || '[media]'}`).join('\n');
}

// --- full thread history ---
// NOTE: Beeper's local API IGNORES ?limit and always returns 20 items per page.
// The only way to get real history is to walk `oldestCursor` with
// direction=before until hasMore is false. Do not "fix" this by raising limit.
const PAGE_CAP = 200;             // max pages to walk (~4000 messages)
const THREAD_TTL_MS = 5 * 60_000; // cache full transcripts briefly
const threadCache = new Map();    // chatId -> { at, data }

function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|ul|ol|div)>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis, (m, href, txt) =>
      href.startsWith('https://matrix.to') ? txt : (txt && txt !== href ? `${txt} (${href})` : href))
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const utcStamp = (iso) => {
  const d = new Date(iso), p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

async function fullTranscript(chatId, { maxMessages = 4000 } = {}) {
  const hit = threadCache.get(chatId);
  if (hit && Date.now() - hit.at < THREAD_TTL_MS) return hit.data;

  const byId = new Map();
  let cursor = null, pages = 0, truncated = false;
  while (pages < PAGE_CAP) {
    let path = `/v1/chats/${encodeURIComponent(chatId)}/messages?limit=100`;
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}&direction=before`;
    const j = await beeper(path);
    for (const m of j.items || []) byId.set(m.id, m);
    pages++;
    if (byId.size >= maxMessages) { truncated = true; break; }
    if (!j.hasMore || !j.oldestCursor || j.oldestCursor === cursor) break;
    cursor = j.oldestCursor;
  }

  const all = [...byId.values()].sort((a, b) => Number(a.sortKey) - Number(b.sortKey));
  const lines = [];
  let count = 0, first = null, last = null;
  for (const m of all) {
    if (m.type === 'REACTION' || m.isHidden) continue; // folded onto their target below
    const ts = m.timestamp;
    if (!first || ts < first) first = ts;
    if (!last || ts > last) last = ts;
    let body = m.isDeleted ? '[deleted message]' : stripHtml(m.text);
    const atts = m.attachments || [];
    if (atts.length) {
      const tags = atts.map((a) => `[${(a.type || m.type || 'file').toUpperCase()}${a.fileName ? ': ' + a.fileName : ''}]`).join(' ');
      body = body ? `${tags} ${body}` : tags;
    } else if (!body && m.type && m.type !== 'TEXT') body = `[${m.type}]`;
    if (!body) continue;
    if (m.reactions && m.reactions.length) {
      body += `  (reactions: ${m.reactions.map((r) => r.reactionKey || 'emoji').join(', ')})`;
    }
    lines.push(`[${utcStamp(ts)}] ${m.isSender ? 'Me' : (m.senderName || 'Them')}: ${body.replace(/\n/g, '\n    ')}`);
    count++;
  }
  const data = {
    transcript: lines.join('\n'),
    count,
    truncated,
    first: first ? utcStamp(first) : null,
    last: last ? utcStamp(last) : null,
    range: first && last ? `${utcStamp(first)} to ${utcStamp(last)} UTC` : '',
  };
  threadCache.set(chatId, { at: Date.now(), data });
  return data;
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

Rank my Beeper chats (JSON below) by score, descending. Return EXACTLY one object per input chat. Do not skip, merge, or drop any chat. For each return:
chatId, who, network, importance, urgency, score, type (REPLY | TASK | REPLY+TASK | NOISE),
whoseTurn ("me" if I still owe a reply, "them" if the ball is already in their court, "none" for noise),
summary (one line), nextStep (the concrete next action), draft (a reply in my voice, only if I owe a reply; else "").
For a chat where I already replied last or nothing is owed, still include it with a low score, type NOISE or a low-urgency REPLY, and an empty draft.
Respond with ONLY a JSON array, no prose.

CHATS:
${JSON.stringify(chats).slice(0, 90000)}`;
}
function parseItems(text) { return JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)); }

function snapshotMarkdown(items, now) {
  const stamp = now.toLocaleString();
  const replies = items.filter((i) => i.type !== 'NOISE');
  const noise = items.filter((i) => i.type === 'NOISE');
  const cnt = (re) => items.filter((i) => re.test(i.type)).length;
  let md = `# beeper.chat triage · ${stamp}\n\n`;
  md += `${items.length} chats · ${cnt(/REPLY/)} to reply · ${cnt(/TASK/)} tasks · ${noise.length} noise\n\n`;
  md += `## Tackle first (unreplied, ranked)\n\n`;
  replies.forEach((it, i) => {
    md += `${i + 1}. [${it.score}] ${it.who} (${it.network}) · ${it.type}\n`;
    md += `   ${it.summary || ''}\n`;
    if (it.nextStep) md += `   Next: ${it.nextStep}\n`;
    if (it.draft) md += `   Draft: ${it.draft}\n`;
    md += `\n`;
  });
  if (noise.length) {
    md += `## Noise (archive candidates)\n`;
    noise.forEach((it) => { md += `- ${it.who} (${it.network})\n`; });
  }
  return md;
}

function writeSnapshot(items) {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const now = new Date();
  const md = snapshotMarkdown(items, now);
  const file = `triage-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`;
  writeFileSync(join(SNAPSHOT_DIR, file), md);
  writeFileSync(join(SNAPSHOT_DIR, 'triage-latest.md'), md);
  return { dir: SNAPSHOT_DIR, file, when: now.toLocaleString() };
}

function trySnapshot(items) {
  try { return writeSnapshot(items); } catch (e) { return { error: String(e.message || e) }; }
}

async function getRankedInbox() {
  progress.active = true; progress.stage = 'starting'; progress.done = 0; progress.total = 0;
  try {
    if (DEMO) return { demo: true, items: SAMPLE, snapshot: trySnapshot(SAMPLE) };
    if (!BEEPER_TOKEN) throw new Error('Set BEEPER_ACCESS_TOKEN (or keep DEMO=1).');
    if (LLM === 'api' && !ANTHROPIC_KEY) throw new Error('LLM=api needs ANTHROPIC_API_KEY (or use LLM=cli for your subscription).');
    const chats = await fetchInbox();
    progress.stage = 'ranking with claude';
    const items = parseItems(await completeText(rankPrompt(chats), 4000));
    items.sort((a, b) => (b.score || 0) - (a.score || 0));
    progress.stage = 'saving snapshot';
    return { demo: false, llm: LLM, items, snapshot: trySnapshot(items) };
  } finally {
    progress.active = false; progress.stage = 'idle';
  }
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

// Thread analyst: same chat box, but grounded in the WHOLE transcript.
function analyzePrompt(messages, ctx) {
  const convo = messages.map((m) => `${m.role === 'user' ? 'Me' : 'You'}: ${m.content}`).join('\n');
  return `You are beeper.chat's thread analyst. You are looking at my conversation with ${ctx.who}${ctx.network ? ` (${ctx.network})` : ''}.

FULL TRANSCRIPT — ${ctx.count} messages${ctx.truncated ? ' (capped to the most recent)' : ' (complete, back to the first message)'}${ctx.range ? `, ${ctx.range}` : ''}. Oldest first:
---
${ctx.transcript || '(none loaded)'}
---

Answer my questions about this conversation. Ground every claim in the transcript and cite the date when you reference something specific. NEVER invent facts, quotes, dates, numbers, or commitments that are not above. If something is not in the transcript, say so plainly.
${VOICE}
Apply those voice rules ONLY when I explicitly ask you to draft or write a message. Otherwise just answer, concise and specific.

Conversation:
${convo}
You:`;
}

async function handleChat(body) {
  const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  const analyze = body.mode === 'analyze';
  let ctx = null;
  if (body.chat && body.chat.who) {
    ctx = { who: body.chat.who, network: body.chat.network || '', transcript: '' };
    if (body.chat.id && !DEMO && BEEPER_TOKEN) {
      try {
        if (analyze) Object.assign(ctx, await fullTranscript(body.chat.id));
        else ctx.transcript = await transcriptFor(body.chat.id);
      } catch (e) { ctx.transcript = ''; }
    }
  }
  const prompt = analyze && ctx ? analyzePrompt(messages, ctx) : chatPrompt(messages, ctx);
  const reply = (await completeText(prompt, analyze ? 4000 : 1500)).trim();
  return { reply };
}

// --- global ask: one question, searched across every chat on every network ---
// Beeper's local API exposes a message search endpoint. We turn the question
// into search terms, pull matching messages from ALL chats, and let the model
// answer strictly from them, with citations.
const STOPWORDS = new Set(['what','whats','when','where','who','whos','why','how','is','are','was','were','the','a','an','do','does','did','my','me','i','in','on','at','to','for','of','and','or','it','this','that','check','chat','from','with','about','tell','know','get','can','you','they','we','us','again','said','say','says']);
function keywordsFrom(q) {
  return [...new Set(
    q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  )].slice(0, 5);
}
function chatTitleMap(r) {
  const m = new Map();
  const cs = r.chats;
  if (Array.isArray(cs)) for (const c of cs) m.set(c.id || c.chatID, c.title || c.name || '');
  else if (cs && typeof cs === 'object') for (const [k, v] of Object.entries(cs)) m.set(k, (v && (v.title || v.name)) || '');
  return m;
}
async function searchMessages(term, limit = 20) {
  const r = await beeper(`/v1/messages/search?query=${encodeURIComponent(term)}&limit=${limit}`);
  const titles = chatTitleMap(r);
  return (r.items || []).map((m) => ({
    id: m.id, chatId: m.chatID,
    chat: titles.get(m.chatID) || '(unknown chat)',
    who: m.isSender ? 'Me' : (m.senderName || 'Them'),
    when: m.timestamp || '',
    text: stripHtml(m.text || ''),
  })).filter((m) => m.text);
}

function askPrompt(question, hits) {
  const ctx = hits.map((h) => `[${(h.when || '').slice(0, 16)}] (${h.chat}) ${h.who}: ${h.text}`).join('\n');
  return `You are beeper.chat's assistant. You can see my whole message history across every network.

My question: "${question}"

The most relevant messages found across all my chats:
---
${ctx}
---

Answer directly and concisely using ONLY the messages above. Cite inline like (chat name, sender, date). If messages conflict, trust the most recent and say so. If the answer is not there, say plainly that you could not find it and name what to search instead. Never invent times, names, numbers, or facts. No em dashes, no emojis.`;
}

async function handleAsk(body) {
  const question = String(body.question || '').trim();
  if (!question) return { error: 'Ask a question first.' };
  if (DEMO || !BEEPER_TOKEN) return { answer: 'Demo mode. Connect Beeper Desktop to search your real messages.', sources: [] };

  const terms = [question, ...keywordsFrom(question)].slice(0, 6);
  const seen = new Map();
  for (const t of terms) {
    try { for (const m of await searchMessages(t, 20)) if (!seen.has(m.id)) seen.set(m.id, m); } catch {}
  }
  const hits = [...seen.values()]
    .sort((a, b) => new Date(b.when) - new Date(a.when))
    .slice(0, 60);
  if (!hits.length) {
    return { answer: 'Nothing in your messages matched that. Try naming the person, group, or a distinctive word from the conversation.', sources: [], searched: terms };
  }
  const answer = (await completeText(askPrompt(question, hits), 1200)).trim();
  return {
    answer,
    searched: terms,
    scanned: hits.length,
    sources: hits.slice(0, 12).map((h) => ({ chat: h.chat, who: h.who, when: h.when, text: h.text.slice(0, 160) })),
  };
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
    if (req.method === 'GET' && url.pathname === '/api/progress') return send(res, 200, progress);
    if (req.method === 'GET' && url.pathname === '/api/snapshot') {
      const f = join(SNAPSHOT_DIR, 'triage-latest.md');
      if (!existsSync(f)) return send(res, 404, { error: 'no snapshot yet' });
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      return res.end(readFileSync(f, 'utf8'));
    }
    if (req.method === 'GET' && url.pathname === '/api/search') {
      if (DEMO || !BEEPER_TOKEN) return send(res, 200, { items: [] });
      return send(res, 200, { items: await searchChats(url.searchParams.get('q') || '') });
    }
    if (req.method === 'GET' && url.pathname === '/api/thread') {
      const id = url.searchParams.get('id') || '';
      if (!id) return send(res, 400, { error: 'missing id' });
      if (DEMO || !BEEPER_TOKEN) return send(res, 200, { transcript: '', count: 0, range: '', demo: true });
      return send(res, 200, await fullTranscript(id));
    }
    if (req.method === 'POST' && url.pathname === '/api/ask') return send(res, 200, await handleAsk(await readBody(req)));
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
