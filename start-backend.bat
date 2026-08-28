@echo off
REM SoloDev Studio — Backend only (Django 8001)
REM Double-click to run backend in its own window. Window stays open on error (pause / cmd /k).

setlocal EnableDelayedExpansion
title SoloDev Backend — Django 8001

REM Resolve project root as folder containing this .bat
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "PORT=8001"
if not "%~1"=="" set "PORT=%~1"

REM Find a Python that can import winpty (required for in-app terminals).
REM PREFER a scanned Python 3.10/3.11/3.12 install, which has the reliable
REM pywinpty 2.x. The default `python` is often 3.14 whose only pywinpty wheel
REM (3.x) does not deliver interactive input reliably.
set "PY="
REM 1) Scan common install locations for a Python 3.10-3.12 with winpty.
for /d %%R in ("%LOCALAPPDATA%\Programs\Python\Python31*") do (
  if not defined PY if exist "%%R\python.exe" (
    "%%R\python.exe" -c "import winpty" >nul 2>&1
    if !ERRORLEVEL! == 0 set "PY=%%R\python.exe"
  )
)
for /d %%R in ("C:\Python31*") do (
  if not defined PY if exist "%%R\python.exe" (
    "%%R\python.exe" -c "import winpty" >nul 2>&1
    if !ERRORLEVEL! == 0 set "PY=%%R\python.exe"
  )
)
REM 2) Fallback to launcher / named commands (may be pywinpty 3.x — input flaky).
if not defined PY (
  for %%C in ("py -3.10" "python3.10" "py" "python") do (
    if not defined PY (
      %%C -c "import winpty" >nul 2>&1
      if !ERRORLEVEL! == 0 set "PY=%%C"
    )
  )
)
if not defined PY (
  echo [backend] ERROR: No Python with pywinpty installed.
  echo [backend] In-app terminals need Python 3.10/3.11/3.12 + pywinpty 2.x.
  echo [backend] Install it with:  python -m pip install "pywinpty>=2.0.13,<3"
  echo.
  echo Press any key to close...
  pause >nul
  exit /b 1
)

if not exist "%ROOT%\server\manage.py" (
  echo [backend] ERROR: Not found: %ROOT%\server\manage.py
  echo.
  echo Press any key to close...
  pause >nul
  exit /b 1
)

echo [backend] Starting Django on http://localhost:%PORT% ...
echo [backend] Command: %PY% manage.py runserver 0.0.0.0:%PORT%
echo [backend] Working dir: %ROOT%\server
echo.

cd /d "%ROOT%\server"
%PY% manage.py runserver 0.0.0.0:%PORT%

set "EXITCODE=%ERRORLEVEL%"
echo.
echo [backend] Exited with code %EXITCODE%.
echo [backend] Window stays open — check the error above, then press any key to close or just close the window.
pause >nul
endlocal
