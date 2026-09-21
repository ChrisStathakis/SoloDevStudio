const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const buildId = `${version}-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(4).toString('hex')}`;
const identity = { version, buildId };
const jsonPath = path.join(__dirname, 'build-identity.json');
const modulePath = path.join(__dirname, 'build-identity.cjs');

fs.writeFileSync(jsonPath, `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
fs.writeFileSync(modulePath, `module.exports = ${JSON.stringify(identity)};\n`, 'utf8');

function run(command, args, { shell = process.platform === 'win32' } = {}) {
  // npm/npx are .cmd launchers on Windows and require a shell to execute.
  // The command/arguments are fixed by this release script, never user input.
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_SOLODEV_BUILD_ID: buildId },
    shell,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
}

function resolvePython() {
  const candidates = [
    process.env.SOLODEV_PYTHON,
    process.env.PYTHON,
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python311', 'python.exe')
      : null,
    process.platform === 'win32' && process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe')
      : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function runBackendBuild() {
  const python = resolvePython();
  run(python, [
    '-m', 'PyInstaller', '--noconfirm', '--clean', 'desktop/backend.spec',
    '--distpath', 'backend-dist', '--workpath', '.desktop-build',
  ], { shell: false });
  run(path.join(root, 'backend-dist', process.platform === 'win32' ? 'solodev-backend.exe' : 'solodev-backend'), ['--terminal-self-test'], { shell: false });
}

try {
  run('npm', ['run', 'desktop:build:frontend']);
  runBackendBuild();
  run('npx', ['electron-builder', '--win']);
} finally {
  // The identity is embedded in the frontend bundle, backend executable, and
  // Electron asar. Keep generated source files out of the user's worktree.
  for (const file of [jsonPath, modulePath]) {
    try { fs.unlinkSync(file); } catch { /* best effort cleanup */ }
  }
}
