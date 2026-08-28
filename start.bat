@echo off
setlocal EnableDelayedExpansion
REM SoloDev Studio — launches BOTH servers in SEPARATE windows (so you can see each log)
REM Usage: start.bat                         :: backend 8001 + frontend 3000 (Express wrapper)
REM        start.bat -UseVite                 :: backend 8001 + Vite 5174
REM        start.bat -BackendPort 8001 -FrontendPort 3000
REM Each window stays open on error (cmd /k + pause in sub-scripts).
REM Also provides: start-backend.bat and start-frontend.bat for running one at a time.

set "ARGS=%*"
echo.
echo === SoloDev Studio — launching 2 windows ===
echo [start] Args: %ARGS%
echo.

REM If no args, just open the two dedicated bats (simplest split)
if "%~1"=="" (
  echo [start] Opening backend window...
  start "SoloDev Backend (8001)" cmd /k call "%~dp0start-backend.bat" 8001
  echo [start] Opening frontend window...
  start "SoloDev Frontend (3000)" cmd /k call "%~dp0start-frontend.bat" 3000
  echo.
  echo [start] Both windows launched.
  echo [start] Backend:  http://localhost:8001
  echo [start] Frontend: http://localhost:3000
  echo [start] Close each window to stop that server. This launcher will now exit.
  timeout /t 2 >nul
  endlocal
  exit /b 0
)

REM With args: parse ports for window titles (best effort)
set "BP=8001"
set "FP=3000"
set "USEVITE=0"
for %%A in (%*) do (
  if /i "%%A"=="-UseVite" set "USEVITE=1"
  if /i "%%A"=="--UseVite" set "USEVITE=1"
)
set "PREV="
for %%A in (%*) do (
  if /i "!PREV!"=="-BackendPort" set "BP=%%A"
  if /i "!PREV!"=="-FrontendPort" set "FP=%%A"
  set "PREV=%%A"
)
if "!USEVITE!"=="1" (
  echo %ARGS% | findstr /C:"-FrontendPort" >nul
  if !ERRORLEVEL! neq 0 set "FP=5174"
)

echo [start] Opening backend window on !BP! ...
start "SoloDev Backend (!BP!)" cmd /k call "%~dp0start-backend.bat" !BP!

if "!USEVITE!"=="1" (
  echo [start] Opening frontend window (Vite) on !FP! ...
  start "SoloDev Frontend Vite (!FP!)" cmd /k call "%~dp0start-frontend.bat" -UseVite !FP!
) else (
  echo [start] Opening frontend window (Express) on !FP! ...
  start "SoloDev Frontend (!FP!)" cmd /k call "%~dp0start-frontend.bat" !FP!
)

echo.
echo [start] Both windows launched via start-backend.bat / start-frontend.bat
echo [start] Alternatively, for merged logs in ONE window: powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
echo.
endlocal
exit /b 0
