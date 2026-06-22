# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

beeper.chat is a **Claude Code skill** that clears the user's Beeper inbox to
zero each day. There is no build step, no server, no test runner — the
deliverable is the skill plus its supporting docs and data templates.

The brain is **`.claude/skills/beeper/SKILL.md`**. Read it before changing
behavior. Run it with `/beeper`.

## The one rule

The Beeper MCP token has **write** scope. **Never** send, reply, react, archive,
or mark-read on Beeper without the user's explicit per-action OK. Drafting is
fine; mutating is not. This rule lives in SKILL.md "Rule 0" and must survive any
edit.

## How it works (data flow)

1. `beeper` MCP (local, `http://127.0.0.1:23373`) → unread chats across all
   networks.
2. Score each by **importance × urgency** (rubric in SKILL.md, examples in
   `docs/scoring.md`), classify as REPLY / TASK / NOISE.
3. Present top chat first as a context bundle, pulling facts from `kb/<slug>.md`
   and voice from `me.md`.
4. Act only on the user's OK; send via the Beeper send tool.
5. Update `kb/<slug>.md`; log tasks to `tasks.md`.

## Conventions

- **Person-KB is plain Markdown**, one file per contact, slug filename
  (lowercase-kebab). Chosen over JSON/SQLite so it's human-readable,
  diff-friendly, and writable with normal file tools. Template: `kb/_template.md`.
- **Private data stays out of git**: `kb/*` (except README + template), `me.md`,
  `tasks.md` are gitignored. The shareable scaffold (skill, docs, templates) is
  what gets committed — this is built in public.
- Don't hardcode Beeper MCP tool names; discover them at runtime (they vary by
  version) and prefer read/list/search tools.
- Beeper MCP is **local only** — features here cannot run in a cloud/remote
  session; they need Beeper Desktop running on the user's machine.

## Related

Sibling product `../sprite.email` is a separate Next.js web app for Gmail
triage (no shared code today). beeper.chat and sprite.email share only the
*concept* of importance/urgency triage, not a library.
