@echo off
setlocal EnableDelayedExpansion
REM SoloDev Studio — launches both servers in one Windows Terminal window with two tabs.
REM Usage: start.bat                         :: backend 8001 + frontend 3000 (Express wrapper)
REM        start.bat -UseVite                 :: backend 8001 + Vite 5174
REM        start.bat -BackendPort 8001 -FrontendPort 3000
REM Each tab stays open on error (cmd /k + pause in sub-scripts).
REM Also provides: start-backend.bat and start-frontend.bat for running one at a time.

set "ARGS=%*"
set "ROOT=%~dp0"
if "!ROOT:~-1!"=="\" set "ROOT=!ROOT:~0,-1!"
echo.
echo === SoloDev Studio — launching servers ===
echo [start] Args: %ARGS%
echo.

REM Parse ports for tab titles (best effort)
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

where wt.exe >nul 2>&1
if !ERRORLEVEL! equ 0 (
  echo [start] Opening one Windows Terminal window with Backend and Frontend tabs...
  if "!USEVITE!"=="1" (
    wt.exe -w new new-tab --title "SoloDev Backend (!BP!)" --startingDirectory "!ROOT!" -- cmd.exe /k call "!ROOT!\start-backend.bat" !BP! ; new-tab --title "SoloDev Frontend Vite (!FP!)" --startingDirectory "!ROOT!" -- cmd.exe /k call "!ROOT!\start-frontend.bat" -UseVite !FP!
  ) else (
    wt.exe -w new new-tab --title "SoloDev Backend (!BP!)" --startingDirectory "!ROOT!" -- cmd.exe /k call "!ROOT!\start-backend.bat" !BP! ; new-tab --title "SoloDev Frontend (!FP!)" --startingDirectory "!ROOT!" -- cmd.exe /k call "!ROOT!\start-frontend.bat" !FP!
  )
  echo [start] Backend:  http://localhost:!BP!
  echo [start] Frontend: http://localhost:!FP!
  echo [start] Close either tab to stop that server.
) else (
  echo [start] Windows Terminal was not found; opening separate Command Prompt windows instead.
  start "SoloDev Backend (!BP!)" cmd /k call "%~dp0start-backend.bat" !BP!
  if "!USEVITE!"=="1" (
    start "SoloDev Frontend Vite (!FP!)" cmd /k call "%~dp0start-frontend.bat" -UseVite !FP!
  ) else (
    start "SoloDev Frontend (!FP!)" cmd /k call "%~dp0start-frontend.bat" !FP!
  )
)
echo.
endlocal
exit /b 0
