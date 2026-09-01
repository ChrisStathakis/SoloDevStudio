# Getting started

## Requirements

- Windows is required for the in-app CMD, script console, and Explorer folder actions.
- Python 3.11 or newer with Django dependencies available.
- Node.js 18 or newer and npm.
- The repository's Python and frontend dependencies installed.

The backend uses Django 5.2 or newer below 6.0, Django REST Framework, SimpleJWT, CORS headers, django-filter, python-decouple, and pywinpty on Windows. The frontend uses React, Vite, TypeScript, Axios, xterm, and Lucide icons.

## Install dependencies

From the repository root:

```powershell
npm run install:all
```

To install only the documentation toolchain:

```powershell
pip install -r requirements-docs.txt
```

## Configure local environment files

Copy the example files and adjust values for the local machine:

```powershell
Copy-Item server\.env.example server\.env
Copy-Item frontend\.env.example frontend\.env
```

The backend reads `SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, and `APP_URL`. The frontend reads `VITE_API_URL`; the checked-in example points to `http://localhost:8001/api`. The optional Gemini-powered research endpoints read `GEMINI_API_KEY` from the frontend server environment. Never place real credentials in documentation or source control.

## Start the application

The recommended Windows launcher starts both services, checks ports, and can install missing dependencies:

```powershell
.\start.ps1
```

This serves the frontend at `http://localhost:3000` and Django at `http://localhost:8001`.

Useful variants:

```powershell
.\start.ps1 -SkipInstall
.\start.ps1 -UseVite
.\start.ps1 -BackendPort 8001 -FrontendPort 3000
```

The `-UseVite` variant serves the standalone Vite frontend on port 5174. If you change the backend port, update `frontend/.env` so `VITE_API_URL` and the backend CORS setting agree.

The equivalent root npm commands are:

```powershell
npm run dev
npm run dev:vite
```

## Build the Windows desktop installer

For a self-contained native Windows app, install the desktop packaging dependency and JavaScript packages:

```powershell
py -3.11 -m pip install -r server\requirements-desktop.txt
npm install
npm install --prefix frontend
```

Then build the unsigned x64 NSIS installer:

```powershell
npm run desktop:build
```

The installer bundles the React interface and Python API, so end users do not need Node.js or Python. The desktop app stores its SQLite database under the Windows per-user app-data directory, runs migrations during startup, and keeps data across upgrades. It chooses an available loopback API port automatically. Settings → Desktop app lets a user save an optional API-port override; changes apply after restart. A native desktop window does not require a frontend port.

## First login

Open the frontend, register a user, and sign in. The API issues a short-lived access token and a refresh token; the frontend refreshes access automatically when an authenticated request expires. All application data is scoped to the signed-in owner.

## Verify the services

The Django health endpoint is unauthenticated:

```text
GET http://localhost:8001/api/health/
```

Run backend migrations before the first use:

```powershell
cd server
python manage.py migrate
```
