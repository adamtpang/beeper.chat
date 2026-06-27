# beeper.chat web (MVP)

Open this each morning instead of digging through Beeper: it reads your inbox,
ranks every chat by **importance × urgency**, and shows your daily action items
with replies drafted in your voice. Nothing sends on its own.

This is the web MVP of the [beeper.chat](../) idea (the `/beeper` Claude Code
skill is the same brain, this is a persistent UI). Built to graduate into a
Tauri desktop app later.

## Run it (demo, zero setup)

No dependencies, no build step:

```
cd web
node server.mjs
```

Open http://localhost:4317 and click **Run triage**. It loads sample data so you
can see the UX immediately.

## Go live (your real inbox)

1. Make sure **Beeper Desktop** is running (it serves the local API on
   `127.0.0.1:23373`).
2. `cp .env.example .env`
3. Set `ANTHROPIC_API_KEY`. Get `BEEPER_ACCESS_TOKEN` in Beeper Desktop:
   Settings -> Integrations -> Approved connections -> + (create a token), then
   paste it in. Set `DEMO=0`.
4. `node server.mjs` and click **Run triage**.

## How it works

```
browser UI  ->  local Node proxy (holds your keys)  ->  Beeper local API (read + act)
                                                     ->  Claude API (rank + draft)
```

- The proxy keeps your keys off the browser. No data leaves your machine except
  the chat text sent to the Claude API for ranking.
- Because Beeper has no native reorder, the ranked order lives here; the
  per-card actions (archive, etc.) use Beeper's real write endpoints.

## Status

Demo mode works now. Live mode uses the confirmed Beeper REST endpoints
(`GET /v1/chats/search?inbox=primary`, `GET /v1/chats/{id}/messages`,
`PATCH /v1/chats/{id}` for archive/pin/low-priority) with a Bearer token. A
desktop wrapper lives in `../desktop` (Electron) so it opens as a real app.
