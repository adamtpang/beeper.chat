// beeper.chat desktop — Electron shell.
// Runs the web/ proxy server IN this process (Electron's own Node) via dynamic
// import, then opens a window to it. Works both in dev (npm start) and when
// packaged by electron-builder.

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = process.env.PORT || 4317;
process.env.PORT = String(PORT);

// Packaged app: load keys from the user's app-data .env if present, so live mode
// can be configured without touching the install dir. (Dev reads web/.env.)
if (app.isPackaged) {
  process.env.SNAPSHOT_DIR = path.join(app.getPath('userData'), 'snapshots');
  const cfg = path.join(app.getPath('userData'), '.env');
  if (fs.existsSync(cfg)) {
    for (const line of fs.readFileSync(cfg, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

function serverPath() {
  // Dev: ../web/server.mjs. Packaged: resources/web/server.mjs (extraResources).
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
  return path.join(base, 'web', 'server.mjs');
}

async function startServer() {
  // server.mjs starts an HTTP server on import (it calls listen() at top level).
  await import(pathToFileURL(serverPath()).href);
}

function waitForServer(cb, tries = 0) {
  http
    .get(`http://localhost:${PORT}/`, (r) => { r.destroy(); cb(); })
    .on('error', () => {
      if (tries > 80) return cb();
      setTimeout(() => waitForServer(cb, tries + 1), 200);
    });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 880,
    height: 920,
    title: 'beeper.chat',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#F8F8F8',
  });
  win.loadURL(`http://localhost:${PORT}/`);
}

// Beeper Desktop serves the local API this app reads. If it is not running,
// start it in the background so beeper.chat works without you opening Beeper.
function apiUp() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:23373/v0/mcp', (r) => { r.destroy(); resolve(true); });
    req.on('error', () => resolve(false));
    req.setTimeout(2500, () => { req.destroy(); resolve(false); });
  });
}
function findBeeperExe() {
  const local = process.env.LOCALAPPDATA || '';
  const cands = [
    process.env.BEEPER_EXE,
    path.join(local, 'Programs', 'BeeperTexts', 'Beeper.exe'),
    path.join(local, 'Programs', 'Beeper', 'Beeper.exe'),
  ].filter(Boolean);
  return cands.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
}
async function ensureBeeper() {
  if (await apiUp()) return;
  const exe = findBeeperExe();
  if (!exe) return; // can't find it; the app will show the connect-Beeper message
  try { spawn(exe, [], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  for (let i = 0; i < 80; i++) { // wait up to ~40s for Beeper's API to come up
    await new Promise((r) => setTimeout(r, 500));
    if (await apiUp()) return;
  }
}

app.whenReady().then(async () => {
  await ensureBeeper();
  try { await startServer(); } catch (e) { console.error('server start error:', e); }
  waitForServer(createWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
