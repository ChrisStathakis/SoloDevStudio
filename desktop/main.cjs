const { app, BrowserWindow, dialog, ipcMain, net, protocol, screen } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const netModule = require('net');
const path = require('path');
const { pathToFileURL } = require('url');

const APP_SCHEME = 'app';
const APP_HOST = 'solodev';
const DESKTOP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const MIN_PORT = 1;
const MAX_PORT = 65535;

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let backendProcess = null;
let activeApiBase = '';
let mainWindow = null;
let companionWindow = null;
let companionDismissed = false;
let companionState = null;

function settingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function normalizeCloudApiUrl(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw.length > 500) throw new Error('Server URL is too long (max 500 characters).');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Enter a full server URL, e.g. https://username.pythonanywhere.com');
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('Server URL must use https:// (http is only allowed for localhost).');
  }
  parsed.hash = '';
  let pathname = parsed.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') pathname = '/api';
  else if (!pathname.endsWith('/api')) pathname += '/api';
  parsed.pathname = pathname;
  return parsed.toString().replace(/\/+$/, '');
}

function readSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    let cloudApiUrl = null;
    try {
      cloudApiUrl = normalizeCloudApiUrl(data.cloudApiUrl || null);
    } catch {
      cloudApiUrl = null;
    }
    return {
      backendPort: Number.isInteger(data.backendPort) ? data.backendPort : null,
      companionEnabled: data.companionEnabled !== false,
      companionPinned: data.companionPinned === true,
      companionPosition: data.companionPosition && Number.isFinite(data.companionPosition.x) && Number.isFinite(data.companionPosition.y) ? data.companionPosition : null,
      cloudApiUrl,
    };
  } catch {
    return { backendPort: null, companionEnabled: true, companionPinned: false, companionPosition: null, cloudApiUrl: null };
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify({ ...readSettings(), ...settings }, null, 2), 'utf8');
}

function validatePort(value) {
  if (value === null || value === undefined || value === '' || value === 0) return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`Choose a port between ${MIN_PORT} and ${MAX_PORT}, or leave it blank for automatic selection.`);
  }
  return port;
}

function canListen(port) {
  return new Promise((resolve, reject) => {
    const probe = netModule.createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function choosePort(requested) {
  if (requested !== null) {
    try {
      await canListen(requested);
      return requested;
    } catch {
      throw new Error(`The configured API port ${requested} is already in use. Choose another port in Settings and restart.`);
    }
  }
  return new Promise((resolve, reject) => {
    const probe = netModule.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function backendExecutable() {
  if (process.env.SOLODEV_BACKEND_EXECUTABLE) return process.env.SOLODEV_BACKEND_EXECUTABLE;
  if (app.isPackaged) return path.join(process.resourcesPath, 'backend', 'solodev-backend.exe');
  return path.join(__dirname, '..', 'backend-dist', 'solodev-backend.exe');
}

function frontendDist() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'frontend-dist')
    : path.join(__dirname, '..', 'frontend', 'dist');
}

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== APP_HOST) return new Response('Not found', { status: 404 });
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    const root = path.resolve(frontendDist());
    let file = path.resolve(root, relative);
    if (!file.startsWith(`${root}${path.sep}`) && file !== root) return new Response('Not found', { status: 404 });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html');
    return net.fetch(pathToFileURL(file).toString());
  });
}

async function waitForBackend(port) {
  const health = `http://127.0.0.1:${port}/api/health/`;
  // A one-file PyInstaller executable may need a few seconds to extract on
  // first launch before Django can run migrations.
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const response = await fetch(health);
      if (response.ok) return;
    } catch {
      // The backend may still be importing Django and running migrations.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The local API did not become ready. Check the backend log and try again.');
}

async function startBackend() {
  const settings = readSettings();
  const requested = validatePort(settings.backendPort);
  const port = await choosePort(requested);
  const executable = backendExecutable();
  if (!fs.existsSync(executable)) throw new Error(`Packaged backend was not found at ${executable}.`);
  const dbPath = path.join(app.getPath('userData'), 'solodev.sqlite3');
  backendProcess = spawn(executable, ['--port', String(port), '--db-path', dbPath, '--origin', DESKTOP_ORIGIN], {
    cwd: path.dirname(executable),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backendProcess.stdout.on('data', (data) => console.log(`[backend] ${data}`));
  backendProcess.stderr.on('data', (data) => console.error(`[backend] ${data}`));
  backendProcess.once('exit', (code) => {
    if (code && app.isReady()) console.error(`Desktop backend exited with code ${code}`);
  });
  await waitForBackend(port);
  activeApiBase = `http://127.0.0.1:${port}/api`;
  return port;
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) backendProcess.kill();
  backendProcess = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0f172a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.loadURL(`${DESKTOP_ORIGIN}/index.html`);
  mainWindow.on('minimize', () => { companionDismissed = false; showCompanion(); });
  // A pinned companion stays visible even with the main window open; only an
  // unpinned one hides on restore.
  mainWindow.on('restore', () => { if (readSettings().companionPinned !== true) hideCompanion(); });
  mainWindow.on('closed', () => { if (companionWindow && !companionWindow.isDestroyed()) companionWindow.close(); mainWindow = null; });
  return mainWindow;
}

function clampCompanionPosition(x, y) {
  const display = screen.getDisplayNearestPoint({ x, y });
  const area = display.workArea;
  const width = 330; const height = 380;
  return { x: Math.max(area.x, Math.min(Math.round(x), area.x + area.width - width)), y: Math.max(area.y, Math.min(Math.round(y), area.y + area.height - height)) };
}

function applyCompanionLevel() {
  if (!companionWindow || companionWindow.isDestroyed()) return;
  const pinned = readSettings().companionPinned === true;
  try {
    if (pinned) {
      // 'screen-saver' floats above borderless/windowed fullscreen games.
      // (Nothing can overlay DirectX exclusive-fullscreen mode.)
      companionWindow.setAlwaysOnTop(true, 'screen-saver');
      companionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } else {
      companionWindow.setAlwaysOnTop(true, 'floating');
      companionWindow.setVisibleOnAllWorkspaces(true);
    }
  } catch {
    /* level unsupported on this platform: keep the default always-on-top */
  }
}

function sendCompanionPin() {
  if (!companionWindow || companionWindow.isDestroyed()) return;
  companionWindow.webContents.send('companion:pin', readSettings().companionPinned === true);
}

function showCompanion() {
  const settings = readSettings();
  if (!settings.companionEnabled || companionDismissed || !mainWindow) return;
  if (!companionWindow) {
    companionWindow = new BrowserWindow({ width: 330, height: 380, frame: false, transparent: true, resizable: false, alwaysOnTop: true, fullscreenable: false, skipTaskbar: true, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'companion-preload.cjs') } });
    companionWindow.loadFile(path.join(__dirname, 'companion.html'));
    companionWindow.webContents.on('did-finish-load', () => { if (companionWindow && !companionWindow.isDestroyed()) { applyCompanionLevel(); sendCompanionPin(); if (companionState) companionWindow.webContents.send('companion:state', companionState); } });
    companionWindow.on('closed', () => { companionWindow = null; });
  }
  applyCompanionLevel();
  const display = screen.getDisplayMatching(mainWindow.getBounds());
  const saved = settings.companionPosition || { x: display.workArea.x + display.workArea.width - 350, y: display.workArea.y + display.workArea.height - 400 };
  const position = clampCompanionPosition(saved.x, saved.y);
  companionWindow.setPosition(position.x, position.y);
  companionWindow.showInactive();
  sendCompanionPin();
  if (companionState) companionWindow.webContents.send('companion:state', companionState);
}
function hideCompanion() { if (companionWindow && !companionWindow.isDestroyed()) companionWindow.hide(); }

ipcMain.handle('desktop:get-settings', () => ({ ...readSettings(), apiBase: activeApiBase }));
ipcMain.on('desktop:get-api-base', (event) => {
  event.returnValue = activeApiBase;
});
ipcMain.handle('desktop:set-backend-port', (_event, value) => {
  const backendPort = validatePort(value);
  writeSettings({ backendPort });
  return { backendPort, restartRequired: true };
});
ipcMain.handle('desktop:set-cloud-url', (_event, value) => {
  const cloudApiUrl = normalizeCloudApiUrl(value);
  writeSettings({ cloudApiUrl });
  return { cloudApiUrl };
});
ipcMain.handle('desktop:set-companion-enabled', (_event, value) => { const companionEnabled = Boolean(value); writeSettings({ companionEnabled }); if (!companionEnabled) hideCompanion(); else if (readSettings().companionPinned === true) { companionDismissed = false; showCompanion(); } return { companionEnabled }; });
ipcMain.handle('desktop:set-companion-pinned', (_event, value) => {
  const companionPinned = Boolean(value);
  writeSettings({ companionPinned });
  applyCompanionLevel();
  sendCompanionPin();
  if (companionPinned) {
    companionDismissed = false;
    showCompanion();
  } else if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
    // Back to minimize-only behavior: hide while the main window is open.
    hideCompanion();
  }
  return { companionPinned };
});
ipcMain.on('desktop:update-companion-state', (_event, state) => { companionState = state && typeof state === 'object' ? state : null; if (companionWindow && !companionWindow.isDestroyed()) companionWindow.webContents.send('companion:state', companionState); });
function sanitizeSessionId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return trimmed;
}

ipcMain.on('desktop:companion-command', (_event, command) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (typeof command === 'string') {
    const allowed = new Set(['restore', 'pause', 'resume', 'start-focus', 'restore-task']);
    if (!allowed.has(command)) return;
    if (command === 'restore') { mainWindow.restore(); mainWindow.focus(); if (readSettings().companionPinned !== true) hideCompanion(); }
    else mainWindow.webContents.send('desktop:companion-command', command);
    return;
  }
  if (!command || typeof command !== 'object') return;
  // Pet-originated terminal commands: validated here, executed in the main
  // window (which owns auth) via the same channel.
  if (command.type === 'set-watched') {
    const sessionId = command.sessionId == null ? null : sanitizeSessionId(command.sessionId);
    if (command.sessionId != null && sessionId === null) return;
    mainWindow.webContents.send('desktop:companion-command', { type: 'set-watched', sessionId });
    return;
  }
  if (command.type === 'pet-interrupt') {
    const sessionId = sanitizeSessionId(command.sessionId);
    if (!sessionId) return;
    mainWindow.webContents.send('desktop:companion-command', { type: 'pet-interrupt', sessionId });
    return;
  }
  if (command.type === 'pet-input') {
    const sessionId = sanitizeSessionId(command.sessionId);
    if (!sessionId || typeof command.text !== 'string') return;
    const text = command.text.slice(0, 4000);
    if (!text.trim()) return;
    mainWindow.webContents.send('desktop:companion-command', { type: 'pet-input', sessionId, text });
  }
});
ipcMain.on('desktop:companion-dismiss', () => { companionDismissed = true; hideCompanion(); });
ipcMain.on('desktop:companion-position', (_event, position) => { if (!companionWindow || !position) return; const x = Number(position.x); const y = Number(position.y); if (!Number.isFinite(x) || !Number.isFinite(y)) return; const next = clampCompanionPosition(x, y); companionWindow.setPosition(next.x, next.y); writeSettings({ companionPosition: next }); });

app.whenReady().then(async () => {
  registerAppProtocol();
  try {
    await startBackend();
    createWindow();
    // A pinned companion is always visible, including right after launch.
    if (readSettings().companionPinned === true) showCompanion();
  } catch (error) {
    dialog.showErrorBox('SoloDev Studio could not start', error.message || String(error));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  stopBackend();
  app.quit();
});
app.on('before-quit', stopBackend);
