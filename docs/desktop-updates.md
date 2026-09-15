# Desktop app — how it works and how to ship updates

SoloDev Studio ships as a Windows Electron app (NSIS installer in `release/`).
There is **no auto-update mechanism**: no `electron-updater` dependency, no update
check in `desktop/main.cjs`, and no `publish` provider in the electron-builder
config. (`release/latest.yml` and `.blockmap` files are electron-builder
byproducts; nothing reads them at runtime.) Updates are manual: build a new
installer and have users run it.

## How the app works at runtime

- **Shell** (`desktop/main.cjs`): on launch it spawns the frozen Django backend
  (`resources/backend/solodev-backend.exe`) on a loopback port — an automatically
  picked free port, or the port saved in Settings — waits up to ~30s for
  `GET /api/health/`, then opens a 1440×960 `BrowserWindow` loading the UI from
  the custom `app://solodev/index.html` protocol served out of
  `resources/frontend-dist`. Backend output is piped to the Electron console;
  the backend process is killed when all windows close / before quit.
- **Bridge** (`desktop/preload.cjs`): exposes `window.solodevDesktop`
  (`isDesktop`, `apiBase`, `getSettings`, `setBackendPort`). The frontend uses it
  in `frontend/src/services/api.ts` (API base = the dynamic loopback URL, not
  `VITE_API_URL`) and shows a “Desktop app” section in Settings for the backend
  port (stored in `%AppData%/…/desktop-settings.json`, restart required).
- **Backend** (`server/desktop_backend.py`): threaded WSGI on `127.0.0.1`, runs
  migrations on every start, per-user SQLite DB at `<userData>/solodev.sqlite3`,
  `DEBUG=False`, CORS locked to `app://solodev`. Frozen with PyInstaller
  (`desktop/backend.spec`, which bundles the `winpty` DLLs needed for in-app
  terminals).
- **User data safety:** the database and settings live in the OS user-data
  directory, *not* the install directory — reinstalling never wipes them.

## Shipping a manual update

1. Bump `version` in the root `package.json` (currently `1.1.0`).
2. Build everything (frontend bundle → PyInstaller backend → NSIS installer):

   ```powershell
   npm run desktop:build
   ```

   Equivalent step-by-step:

   ```powershell
   npm run desktop:build:frontend   # vite build -> frontend/dist
   npm run desktop:build:backend    # PyInstaller -> backend-dist/solodev-backend.exe
   npx electron-builder --win       # NSIS installer -> release/
   ```

3. Take `release/SoloDev-Studio-Setup-<version>.exe` and distribute it; the user
   runs it (the installer allows changing the directory and creates Desktop /
   Start Menu shortcuts). The old version is replaced; DB and settings carry over.
4. Delete stale installers from `release/` when shipping (only the latest
   `Setup-<version>.exe` should remain).

## Dev loop (no installer)

```powershell
npm run desktop:dev   # builds both bundles, then runs `electron .`
```

This runs Electron unpackaged against local `frontend/dist` and `backend-dist`,
with the same spawn-backend-on-loopback behavior as the installed app.

## Caveats

- Each release is a full ~140MB download (it embeds Chromium, Python, and all
  dependencies).
- Users get no in-app notice of new versions; announce updates out-of-band.
- Unsigned builds trigger Windows SmartScreen warnings on install.
- If manual updates ever become painful, the upgrade path is `electron-updater`
  + a GitHub Releases `publish` config + `checkForUpdatesAndNotify()` in
  `desktop/main.cjs`.
