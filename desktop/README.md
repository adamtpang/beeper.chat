# beeper.chat desktop

A real app you open instead of Beeper to get your daily action items. It is an
Electron shell around the [web](../web) triage app: it starts the local proxy
in-process and shows your importance x urgency inbox in its own window. It holds
its own connection to the local Beeper API, so it does not depend on any MCP
chat session reconnecting.

Ranking uses your **Claude subscription** by default (via the Claude Code CLI),
so it needs no Anthropic API credits. Requires Claude Code installed and logged
in on the machine.

## Run in dev

```
cd desktop
npm install
npm start
```

## Build a double-click installer

```
cd desktop
npm install
npm run dist
```

The Windows installer lands in `desktop/dist/` (e.g. `beeper.chat Setup 0.1.0.exe`).
Run it to install, then launch beeper.chat from the Start menu. It bundles the
`web/` app, so it runs standalone. Unsigned, so on first run Windows SmartScreen
may say "Windows protected your PC" -> "More info" -> "Run anyway".

## Live mode (your real inbox)

First launch shows demo data. To use your real inbox:

- **Dev:** create [../web/.env](../web) with `BEEPER_ACCESS_TOKEN` and `DEMO=0`.
- **Installed app:** create a `.env` at `%APPDATA%\beeper-chat-desktop\.env`
  with `BEEPER_ACCESS_TOKEN` and `DEMO=0`, then relaunch.

Get the Beeper token in Beeper Desktop: Settings -> Integrations -> Approved
connections -> + . No Anthropic API key is needed (ranking uses your Claude
subscription); to use a paid API key instead, set `LLM=api` and `ANTHROPIC_API_KEY`.

## Later

Swap to Tauri for a ~10 MB binary if you want to distribute widely, and add a
branded app icon (electron-builder uses the default Electron icon until then).
