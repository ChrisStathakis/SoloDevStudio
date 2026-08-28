@echo off
REM SoloDev Studio — Frontend only (Express+Vite 3000, or Vite 5174 with -UseVite)
REM Usage: start-frontend.bat           :: Express wrapper on 3000 (npm run dev)
REM        start-frontend.bat 5174      :: Express on custom port
REM        start-frontend.bat -UseVite  :: pure Vite on 5174 (no Express server.ts)
REM        start-frontend.bat -UseVite 5174
REM Window stays open on error (pause). Double-click friendly.

setlocal
title SoloDev Frontend — React 3000

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "USE_VITE=0"
set "PORT=3000"

REM Parse args: allow -UseVite and numeric port in any order
for %%A in (%*) do (
  if /i "%%A"=="-UseVite" set "USE_VITE=1"
  if /i "%%A"=="--use-vite" set "USE_VITE=1"
  if /i "%%A"=="-Vite" set "USE_VITE=1"
  echo %%A | findstr /R "^[0-9][0-9]*$" >nul && set "PORT=%%A"
)
REM If UseVite but port still default 3000, switch default to 5174 (unless user gave explicit port)
if "%USE_VITE%"=="1" (
  set "HAS_EXPLICIT_PORT=0"
  for %%A in (%*) do echo %%A | findstr /R "^[0-9][0-9]*$" >nul && set "HAS_EXPLICIT_PORT=1"
  if "%HAS_EXPLICIT_PORT%"=="0" set "PORT=5174"
)

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo [frontend] ERROR: Node.js not found. Install Node 18+ and ensure 'node' is on PATH.
  echo.
  echo Press any key to close...
  pause >nul
  exit /b 1
)

if not exist "%ROOT%\frontend\package.json" (
  echo [frontend] ERROR: Not found: %ROOT%\frontend\package.json
  echo.
  echo Press any key to close...
  pause >nul
  exit /b 1
)

if not exist "%ROOT%\frontend\node_modules" (
  echo [frontend] Installing deps: npm install --prefix frontend ...
  call npm install --prefix "%ROOT%\frontend"
  if %ERRORLEVEL% neq 0 (
    echo [frontend] WARN: npm install failed — try running manually: npm install --prefix frontend
  )
)

echo [frontend] Starting frontend on http://localhost:%PORT% ...
if "%USE_VITE%"=="1" (
  echo [frontend] Mode: Vite standalone (no Express server.ts)
  echo [frontend] Command: npm --prefix frontend exec vite -- --port %PORT% --host 0.0.0.0 --strictPort
  echo.
  cd /d "%ROOT%\frontend"
  set "PORT=%PORT%"
  call npm --prefix "%ROOT%\frontend" exec vite -- --port %PORT% --host 0.0.0.0 --strictPort
) else (
  echo [frontend] Mode: Express+Vite wrapper (frontend/server.ts via npm run dev)
  echo [frontend] Command: PORT=%PORT% npm run dev --prefix frontend
  echo.
  cd /d "%ROOT%\frontend"
  set "PORT=%PORT%"
  REM Use call so batch continues after npm, and PORT env is respected by server.ts
  call npm run dev --prefix "%ROOT%\frontend"
)

set "EXITCODE=%ERRORLEVEL%"
echo.
echo [frontend] Exited with code %EXITCODE%.
echo [frontend] Window stays open — check the error above, then press any key to close or just close the window.
pause >nul
endlocal
