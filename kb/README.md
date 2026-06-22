# Person knowledge base (`kb/`)

One Markdown file per contact, so replies are context-aware — the agent knows who
someone is, your history, and what you owe them before it drafts.

## How it works

- **Filename = slug:** lowercase-kebab of the person's name or handle, e.g.
  `jane-doe.md`, `sam-acme.md`.
- **The agent reads** the matching file (if any) before drafting a reply, and
  shows the key facts on the `KB:` line of the context bundle.
- **The agent writes** to it after each interaction — new commitments, what you
  replied, tone that worked, durable facts, and an updated "Last interaction"
  date. It keeps records tight and prunes closed loops.
- Start a new record from [`_template.md`](_template.md).

## Privacy

Real contact records are **private and gitignored** — only this README and
`_template.md` are tracked. Your KB never leaves your machine via git.

## Why Markdown (not a database)

Human-readable, diff-friendly, and writable with ordinary file tools. The KB is
small (one short file per person you actually talk to), so a DB would be
overkill. If it ever needs structured queries, it can graduate to SQLite later
without changing the triage flow.
