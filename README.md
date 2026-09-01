# SoloDev Studio

SoloDev Studio is a local-first workspace for turning ideas into shipped software. It brings projects, Sparks, tasks, milestones, Skills, documentation, time tracking, deadlines, and local development terminals into one authenticated workspace.

The application is designed primarily for local Windows development. A React frontend communicates with a Django REST API backed by SQLite, while the in-app terminal uses Windows pseudo-console support.

## Highlights

- Turn validated Sparks into projects with a structured MVP brief.
- Organize work with lifecycle stages, tasks, subtasks, milestones, priorities, and deadlines.
- Link reusable Skills and compose initialization prompts for OpenCode or Codex.
- Configure model presets, project folders, scripts, virtual environments, and CMD directories.
- Open project CMD consoles and server scripts inside the app on Windows.
- Track Pomodoro, stopwatch, and manual time sessions.
- Link project documentation and export or import workspace data.

## Technology

- Frontend: React, TypeScript, Vite, Axios, Tailwind CSS, and xterm.js
- Backend: Django, Django REST Framework, SimpleJWT, django-filter, and SQLite
- Windows terminal support: `pywinpty`

## Requirements

- Windows for in-app terminals, script consoles, and Explorer actions
- Node.js 18 or newer with npm
- Python 3.11 or newer
- Git (recommended)

## Quick start

From the repository root, install the backend and frontend dependencies:

```powershell
python -m pip install -r server\requirements.txt
npm install --prefix frontend
```

If your Windows setup uses the Python Launcher instead, replace `python` with `py`. The same two installs can also be run with `npm run install:all`.

Create local environment files from the provided examples:

```powershell
Copy-Item server\.env.example server\.env
Copy-Item frontend\.env.example frontend\.env
```

Run the initial database migrations:

```powershell
python server\manage.py migrate
```

Start both services with the recommended Windows launcher:

```powershell
.\start.bat
```

The launcher opens one Windows Terminal window with separate backend and frontend tabs. The default addresses are:

- Frontend: <http://localhost:3000/>
- Backend API: <http://localhost:8001/api/>
- Health check: <http://localhost:8001/api/health/>

You can also use the PowerShell launcher:

```powershell
.\start.ps1
```

For a standalone Vite frontend on port 5174:

```powershell
.\start.bat -UseVite
# or
.\start.ps1 -UseVite
```

The equivalent npm commands are `npm run dev` and `npm run dev:vite`.

## Build the Windows desktop installer

The desktop build bundles the React interface, a Python-backed Django API, and their runtimes into a native Windows installer. Install the desktop build dependency once:

```powershell
py -m pip install -r server\requirements-desktop.txt
npm install
npm install --prefix frontend
```

Build the unsigned x64 installer with:

```powershell
npm run desktop:build
```

The installer is written to `release\SoloDev-Studio-Setup-1.0.0.exe` (the version follows `package.json`). The installed app stores its SQLite database and desktop preferences in the Windows per-user app-data directory. It selects a free local API port automatically; Settings → Desktop app contains an optional API-port override. The bundled desktop window has no frontend port.

## First login

Open the frontend, register a local user, and sign in. Application data is scoped to the authenticated user. The frontend refreshes expired API access tokens automatically while the refresh token remains valid.

## OpenCode and Codex initialization

Projects can save an Initial Prompt and active Skills, then compose a full project or task-specific prompt for preparation in OpenCode or Codex. Configure model presets in Settings before selecting a project default. Authentication and provider setup are handled by the selected CLI; the generated prompt is also copied as a fallback and is never submitted without your confirmation.

## Windows terminal notes

In-app CMD and script consoles are Windows-only and require a supported Python installation with `pywinpty`. Use `start.bat` or `start.ps1` to launch the Windows backend and frontend. The terminal uses the project CMD directory or project folder when available. Paths are validated when a console or script is opened, and paths containing spaces are supported.

## Documentation

- [Getting started](docs/getting-started.md)
- [User guide](docs/user-guide.md)
- [Architecture](docs/architecture.md)
- [API reference](docs/api-reference.md)
- [Operations](docs/operations.md)

## Security

Keep local environment files and credentials private. Do not commit `server/.env`, `frontend/.env`, API keys, access tokens, or other secrets to Git.
