// beeper.chat desktop — Electron shell.
// Runs the web/ proxy server IN this process (Electron's own Node) via dynamic
// import, then opens a window to it. No external `node` needed, so it works the
// same on every machine. Reuses web/server.mjs and web/.env.

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const http = require('node:http');

const PORT = process.env.PORT || 4317;
process.env.PORT = String(PORT);

async function startServer() {
  // server.mjs starts an HTTP server on import (it calls listen() at top level).
  const url = pathToFileURL(path.join(__dirname, '..', 'web', 'server.mjs')).href;
  await import(url);
}

function waitForServer(cb, tries = 0) {
  http
    .get(`http://localhost:${PORT}/`, (r) => { r.destroy(); cb(); })
    .on('error', () => {
      if (tries > 80) return cb(); // load anyway after ~16s
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
