// beeper.chat desktop — Electron shell.
// Runs the web/ proxy server IN this process (Electron's own Node) via dynamic
// import, then opens a window to it. Works both in dev (npm start) and when
// packaged by electron-builder.

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const http = require('node:http');

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
    autoHideMenuBar: true,
    backgroundColor: '#F8F8F8',
  });
  win.loadURL(`http://localhost:${PORT}/`);
}

app.whenReady().then(async () => {
  try { await startServer(); } catch (e) { console.error('server start error:', e); }
  waitForServer(createWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
