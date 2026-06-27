# beeper.chat desktop

A real app you open instead of Beeper to get your daily action items. It is a
thin Electron shell around the [web](../web) triage app: it starts the local
proxy and shows your importance x urgency inbox in its own window. It holds its
own connection to the local Beeper API, so it does not depend on any MCP chat
session reconnecting.

## Run

```
cd desktop
pnpm install        # first time only (downloads Electron)
pnpm start
```

First launch shows demo data. For your real inbox, set up [../web/.env](../web)
(Beeper token + Anthropic key, `DEMO=0`) as described in
[../web/README.md](../web/README.md).

## Why Electron (for now)

Electron gets you a working desktop app today with the Node toolchain you
already have. Later we can swap to Tauri for a much smaller binary (~10 MB) if
you want to distribute it; the UI and proxy stay the same.
