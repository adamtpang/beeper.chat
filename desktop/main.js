// beeper.chat desktop — a thin Electron wrapper around the local web app.
// It starts the web/ proxy server, then opens its own window to it. Reuses
// web/server.mjs and web/.env, so demo mode works out of the box and live mode
// turns on once web/.env has your keys.

const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const PORT = process.env.PORT || 4317;
const SERVER = path.join(__dirname, '..', 'web', 'server.mjs');
let server = null;

function startServer() {
  // Run the web proxy with system Node (server.mjs is ESM).
  server = spawn('node', [SERVER], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit',
  });
  server.on('error', (e) => console.error('server spawn error:', e.message));
}

function waitForServer(cb, tries = 0) {
  http
    .get(`http://localhost:${PORT}/`, () => cb())
    .on('error', () => {
      if (tries > 60) return cb(); // give up waiting, load anyway
      setTimeout(() => waitForServer(cb, tries + 1), 250);
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

app.whenReady().then(() => {
  startServer();
  waitForServer(createWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function stopServer() {
  if (server) { try { server.kill(); } catch {} server = null; }
}
app.on('window-all-closed', () => { stopServer(); if (process.platform !== 'darwin') app.quit(); });
app.on('quit', stopServer);
