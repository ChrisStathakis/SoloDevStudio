const { app, BrowserWindow, dialog, ipcMain, net, protocol } = require('electron');
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

function settingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function readSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return { backendPort: Number.isInteger(data.backendPort) ? data.backendPort : null };
  } catch {
    return { backendPort: null };
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
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
  const window = new BrowserWindow({
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
  window.loadURL(`${DESKTOP_ORIGIN}/index.html`);
  return window;
}

ipcMain.handle('desktop:get-settings', () => ({ ...readSettings(), apiBase: activeApiBase }));
ipcMain.on('desktop:get-api-base', (event) => {
  event.returnValue = activeApiBase;
});
ipcMain.handle('desktop:set-backend-port', (_event, value) => {
  const backendPort = validatePort(value);
  writeSettings({ backendPort });
  return { backendPort, restartRequired: true };
});

app.whenReady().then(async () => {
  registerAppProtocol();
  try {
    await startBackend();
    createWindow();
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
