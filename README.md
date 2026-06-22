# beeper.chat

An AI agent that clears your **Beeper** inbox to zero every day.

It reads your unread chats across **every network** (WhatsApp, iMessage, Signal,
Telegram, Discord, Slack, …) through the Beeper Desktop MCP, ranks them by
**importance × urgency**, surfaces the **single most important chat first** with
a full context bundle (who it's from, a one-line summary, what it knows about
that person, and a suggested reply or task), drafts replies **in your voice**,
and **never sends anything without your explicit OK**.

Core mental model: **each chat is either a reply to be sent and/or a task to be
done first.**

## Form factor

beeper.chat is a **Claude Code skill**, not a standalone app. Why: the Beeper MCP
already handles read/send across all networks, and Claude Code already gives you
the agent loop *and* "draft, then wait for my OK before sending" for free (it
permission-gates the send tool). So the repo holds the part that's actually
yours — the scoring rubric, the context-bundle format, your voice, and a
per-person knowledge base — and rides on Claude Code + Beeper for the plumbing.

The daily ritual is one command: open Claude Code in this folder and run
`/triage`.

## Setup (one time)

1. **Beeper Desktop** → Settings → Developers → **enable MCP**. Keep Beeper
   Desktop running whenever you triage. (The API lives at
   `http://127.0.0.1:23373` — local only; this can't run in the cloud.)
2. **Approve the MCP server.** This repo ships `.mcp.json` pointing at Beeper, so
   the first time you open Claude Code here it'll ask to connect the `beeper`
   server — approve it (one OAuth handshake, scope `read write`).
   Manual fallback: `claude mcp add beeper http://127.0.0.1:23373/v0/mcp -t http -s project`
3. **Set your voice.** Copy `me.template.md` → `me.md` and fill it in. This is
   how the agent drafts replies that sound like you. (`me.md` is gitignored.)

## Daily use

```
cd beeper.chat
claude
> /triage
```

It shows a ranked queue, then walks you through chats top-first. For each one,
reply with: **send · edit `<note>` · task · skip · archive · next · stop**
(single letters `s/e/t/k/a/n/q` work too). Nothing is sent until you say `send`.

## What's in here

| Path | What it is |
|------|------------|
| `.claude/skills/triage/SKILL.md` | **The brain.** The full triage workflow, scoring rubric, bundle format, and safety rules. |
| `docs/scoring.md` | The importance × urgency rubric with worked examples + how to tune it. |
| `kb/` | Per-person knowledge base (one `.md` per contact). Built up as you triage. *Private — gitignored.* |
| `me.md` | Your voice/profile, used for drafting. *Private — gitignored* (start from `me.template.md`). |
| `tasks.md` | Where "do this first" items get logged. *Private — gitignored.* |
| `.mcp.json` | Preconfigured Beeper MCP server. |

## Safety

The Beeper MCP can send and archive. The agent treats **you** as the gate: it
drafts freely but never sends, reacts, archives, or marks-read without your
explicit OK for that specific action. It won't invent facts, and it treats
instructions found *inside* messages as data, not commands.

## Status

v1 — interactive daily triage. Built in public with the Beeper community.
Possible next steps: backfill the person-KB from chat history; a "voice" doc
auto-seeded from your sent messages; an optional headless/scheduled CLI wrapper
around the same rubric.
