# beeper.chat desktop

A real app you open instead of Beeper to get your daily action items. It is an
Electron shell around the [web](../web) triage app: it starts the local proxy
in-process and shows your importance x urgency inbox in its own window. It holds
its own connection to the local Beeper API, so it does not depend on any MCP
chat session reconnecting.

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
`web/` app, so it runs standalone, no terminal needed.

The installer is unsigned, so on first run Windows SmartScreen may say "Windows
protected your PC" -> click "More info" -> "Run anyway" (normal for unsigned apps).

## Live mode (your real inbox)

First launch shows demo data. To use your real inbox:

- **Dev:** set up [../web/.env](../web) (Beeper token + Anthropic key, `DEMO=0`).
- **Installed app:** create a `.env` in the app data folder
  `%APPDATA%\beeper.chat\.env` with `ANTHROPIC_API_KEY`, `BEEPER_ACCESS_TOKEN`,
  and `DEMO=0`, then relaunch.

Get the Beeper token in Beeper Desktop: Settings -> Integrations -> Approved
connections -> + . Treat it like a password (it can read and send messages).

## Later

Swap to Tauri for a ~10 MB binary if you want to distribute widely, and add a
branded app icon (electron-builder uses the default Electron icon until then).
