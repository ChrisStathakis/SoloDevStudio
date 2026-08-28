<#
.SYNOPSIS
  Starts both SoloDev Studio servers (Django backend + Frontend) concurrently.

.DESCRIPTION
  - Backend: Django at server/manage.py -> http://localhost:8001
  - Frontend: Express+Vite wrapper at frontend/server.ts (tsx server.ts) -> http://localhost:3000
    or pure Vite on 5174 with -UseVite
  Handles Ctrl+C cleanup, port checks, and optional auto-install.

.PARAMETER BackendPort
  Django port (default 8001). Matches frontend/.env VITE_API_URL and server/.env CORS.

.PARAMETER FrontendPort
  Frontend port (default 3000 for server.ts, 5174 when -UseVite).

.PARAMETER UseVite
  Switch frontend to `npx vite --port <FrontendPort>` instead of `npm run dev` (tsx server.ts).

.PARAMETER SkipInstall
  Skip pip/npm install checks.

.PARAMETER Install
  Force pip install -r server/requirements.txt and npm install --prefix frontend.

.EXAMPLE
  .\start.ps1
  .\start.ps1 -UseVite
  .\start.ps1 -BackendPort 8001 -FrontendPort 3000
  .\start.ps1 -SkipInstall
#>
param(
  [int]$BackendPort = 8001,
  [int]$FrontendPort = 0,
  [switch]$UseVite,
  [switch]$SkipInstall,
  [switch]$Install
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
if (-not $Root) { $Root = (Get-Location).Path }
if ($FrontendPort -eq 0) {
  $FrontendPort = if ($UseVite) { 5174 } else { 3000 }
}

function Write-Info($m) { Write-Host ('[start] ' + $m) -ForegroundColor Cyan }
function Write-Warn($m) { Write-Host ('[start] WARN: ' + $m) -ForegroundColor Yellow }
function Write-Err($m)  { Write-Host ('[start] ERROR: ' + $m) -ForegroundColor Red }

function Test-PortFree($Port) {
  try {
    $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $l.Start(); $l.Stop()
    return $true
  } catch { return $false }
}

function Invoke-PyOut($file, $extra, $script) {
  # Runs `python -c <script>`, returns trimmed stdout or $null.
  # Uses redirected stdout to a pipe but reads only after the process has
  # exited, so there is no deadlock risk.
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $file
    $psi.Arguments = @($extra) + @('-c', $script)
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WindowStyle = 'Hidden'
    $p = [System.Diagnostics.Process]::Start($psi)
    if ($p -and $p.WaitForExit(8000) -and $p.ExitCode -eq 0) {
      return $p.StandardOutput.ReadToEnd().Trim()
    }
  } catch {}
  return $null
}

function Find-Python {
  # Prefer a Python that imports winpty (ConPTY backend) and PREFER pywinpty 2.x,
  # which delivers interactive input reliably. Python 3.14 only ships pywinpty
  # 3.x whose single-shot writes are unreliable, so a 3.10-3.12 install wins.
  # Returns the resolved absolute executable path (single token).
  $cands = [System.Collections.Generic.List[string]]::new()
  $scanRoots = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Python'),
    'C:\Python*',
    'C:\Program Files\Python*'
  )
  foreach ($root in $scanRoots) {
    try {
      Get-ChildItem -Path $root -ErrorAction SilentlyContinue `
        | Where-Object { $_.PSIsContainer } `
        | ForEach-Object {
            $e = Join-Path $_.FullName 'python.exe'
            if (Test-Path $e) { $cands.Add($e) }
          }
    } catch {}
  }
  $cands.Add('py -3.10'); $cands.Add('python3.10'); $cands.Add('py'); $cands.Add('python')

  $fallback = $null
  foreach ($exe in $cands) {
    $parts = $exe -split ' '
    $file = $parts[0]
    $extra = if ($parts.Length -gt 1) { $parts[1..($parts.Length - 1)] } else { @() }
    $ver = Invoke-PyOut $file $extra 'import winpty as w; print(getattr(w, "__version__", "2"))'
    if ($null -ne $ver) {
      Write-Info ('Candidate ' + $exe + ' -> pywinpty ' + $ver)
      if ($ver -like '2.*') {
        $path = Invoke-PyOut $file $extra 'import sys; print(sys.executable)'
        if ($path) { Write-Info ('Using ' + $exe + ' (pywinpty ' + $ver + ') -> ' + $path); return $path }
        return $exe
      }
      if (-not $fallback) { $fallback = $exe }
    }
  }
  if ($fallback) {
    Write-Warn ('No pywinpty 2.x found; using ' + $fallback + ' (pywinpty 3.x). In-app terminal INPUT may be unreliable - install pywinpty 2.x on a 3.10-3.12 Python.')
    return $fallback
  }
  return $null
}

# --- Prerequisite checks ---
Write-Host ''
Write-Host '=== SoloDev Studio -- starting both servers ===' -ForegroundColor White
Write-Host ('Root: ' + $Root) -ForegroundColor DarkGray
Write-Host ('Backend: http://localhost:' + $BackendPort + '  (Django server/manage.py)') -ForegroundColor DarkGray
if ($UseVite) {
  Write-Host ('Frontend: http://localhost:' + $FrontendPort + ' (vite standalone)') -ForegroundColor DarkGray
} else {
  Write-Host ('Frontend: http://localhost:' + $FrontendPort + ' (frontend/server.ts Express+Vite, npm run dev)') -ForegroundColor DarkGray
}
Write-Host ''

$py = Find-Python
if (-not $py) { Write-Err 'Python not found. Install Python 3.11+ and ensure python or py is on PATH.'; exit 1 }

try { $nodeVer = node --version; Write-Info ('Found node ' + $nodeVer) } catch { Write-Err 'Node.js not found. Install Node 18+.'; exit 1 }
try { $npmVer = npm --version; Write-Info ('Found npm ' + $npmVer) } catch { Write-Err 'npm not found.'; exit 1 }

if (-not (Test-PortFree $BackendPort)) { Write-Warn ('Port ' + $BackendPort + ' is already in use. Backend may fail to start.') }
if (-not (Test-PortFree $FrontendPort)) { Write-Warn ('Port ' + $FrontendPort + ' is already in use. Frontend may fail to start.') }

$serverDir = Join-Path $Root 'server'
$frontendDir = Join-Path $Root 'frontend'
if (-not (Test-Path (Join-Path $serverDir 'manage.py'))) { Write-Err ('Not found: ' + $serverDir + '\manage.py'); exit 1 }
if (-not (Test-Path (Join-Path $frontendDir 'package.json'))) { Write-Err ('Not found: ' + $frontendDir + '\package.json'); exit 1 }

# --- Auto-install ---
if (-not $SkipInstall) {
  $needsPip = $Install
  if (-not $needsPip) {
    $djangoOut = Invoke-PyOut $py @() 'import django'
    if ($null -eq $djangoOut) { $needsPip = $true }
  }
  if ($needsPip) {
    Write-Info 'Installing Python deps: pip install -r server/requirements.txt ...'
    & $py -m pip install -r (Join-Path $serverDir 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { Write-Warn ('pip install failed -- continuing anyway. Run manually: ' + $py + ' -m pip install -r server/requirements.txt') }
  } else { Write-Info 'Python deps OK (Django importable), skipping pip install. Use -Install to force.' }

  $needsNpm = $Install -or (-not (Test-Path (Join-Path $frontendDir 'node_modules')))
  if ($needsNpm) {
    Write-Info 'Installing frontend deps: npm install --prefix frontend ...'
    & npm install --prefix $frontendDir
    if ($LASTEXITCODE -ne 0) { Write-Warn 'npm install failed -- try running manually: npm install --prefix frontend' }
  } else { Write-Info 'Frontend node_modules exists, skipping npm install. Use -Install to force.' }
}

# Hint about VITE_API_URL mismatch
$feEnv = Join-Path $frontendDir '.env'
if (Test-Path $feEnv) {
  $feText = Get-Content $feEnv -Raw
  if ($feText -notmatch ('localhost:' + $BackendPort)) {
    Write-Warn ('frontend/.env VITE_API_URL does not point to localhost:' + $BackendPort + '. Update it to http://localhost:' + $BackendPort + '/api if backend port changed.')
  }
}

# --- Build commands ---
$pyQuoted = '"{0}"' -f $py
$backendCmd = ($pyQuoted + ' manage.py runserver 0.0.0.0:' + $BackendPort)
$frontendCmd = if ($UseVite) {
  'npx vite --port ' + $FrontendPort + ' --host 0.0.0.0 --strictPort'
} else {
  'npm run dev'
}
$frontendCwd = $frontendDir

Write-Host ''
Write-Info ('Launching backend : ' + $backendCmd + ' (cwd: ' + $serverDir + ')')
Write-Info ('Launching frontend: ' + $frontendCmd + ' (cwd: ' + $frontendCwd + ')')
Write-Host 'Press Ctrl+C to stop both servers.' -ForegroundColor White
Write-Host ''

# Prefer `concurrently` if available for nicer prefixed logs; fallback to separate windows
$hasConcurrently = $false
try {
  $null = Get-Command npx -ErrorAction SilentlyContinue
  if ((Test-Path (Join-Path $Root 'node_modules\concurrently')) -or (Test-Path (Join-Path $frontendDir 'node_modules\concurrently'))) {
    $oldPref = $ErrorActionPreference; $ErrorActionPreference = 'SilentlyContinue'
    $cv = & npx --yes concurrently --version 2>&1 | Select-Object -First 1
    $ErrorActionPreference = $oldPref
    if ($LASTEXITCODE -eq 0 -and $cv) { $hasConcurrently = $true; Write-Info ('Using concurrently ' + $cv + ' for merged logs.') }
  } else {
    Write-Info 'concurrently not found in node_modules -- will launch in separate windows (split mode).'
  }
} catch { $hasConcurrently = $false }

if ($hasConcurrently) {
  $backendFull = ($pyQuoted + ' server/manage.py runserver 0.0.0.0:' + $BackendPort)
  $frontendFull = if ($UseVite) {
    'npx vite --port ' + $FrontendPort + ' --host 0.0.0.0 --strictPort'
  } else {
    'npm run dev --prefix frontend'
  }
  if ($UseVite) {
    $frontendFull = 'npm --prefix frontend exec vite -- --port ' + $FrontendPort + ' --host 0.0.0.0 --strictPort'
  }
  Write-Info ('Running: npx concurrently --names backend,frontend --prefix-colors cyan,magenta ' + $backendFull + ' ' + $frontendFull)
  & npx --yes concurrently --names 'backend,frontend' --prefix-colors 'cyan,magenta' $backendFull $frontendFull
  exit $LASTEXITCODE
}

# Fallback: open SEPARATE windows that stay open on error (split mode)
Write-Info 'Launching in split-window mode (each server in its own window, stays open on error)...'
$backendBat = Join-Path $Root 'start-backend.bat'
$frontendBat = Join-Path $Root 'start-frontend.bat'
if ((Test-Path $backendBat) -and (Test-Path $frontendBat)) {
  Write-Info 'Using start-backend.bat / start-frontend.bat via cmd /k (windows stay open)...'
  $bArgs = '/k call "' + $backendBat + '" ' + $BackendPort
  $fArgs = if ($UseVite) { '/k call "' + $frontendBat + '" -UseVite ' + $FrontendPort } else { '/k call "' + $frontendBat + '" ' + $FrontendPort }
  $bProc = Start-Process -FilePath 'cmd' -ArgumentList $bArgs -WorkingDirectory $Root -PassThru
  Start-Sleep -Milliseconds 300
  $fProc = Start-Process -FilePath 'cmd' -ArgumentList $fArgs -WorkingDirectory $Root -PassThru
  Write-Info ('Backend window PID ' + $bProc.Id + ' -- http://localhost:' + $BackendPort)
  Write-Info ('Frontend window PID ' + $fProc.Id + ' -- http://localhost:' + $FrontendPort)
  Write-Host ''
  Write-Host 'Both servers running in separate windows. Close each window to stop that server.' -ForegroundColor Green
  Write-Host 'This launcher will now exit (servers keep running).' -ForegroundColor Green
  exit 0
}
# Very old fallback if split bats missing: still use separate windows with direct commands and /k
Write-Warn 'Split .bat files not found -- falling back to direct cmd /k launches...'
$env:PORT = [string]$FrontendPort
$backendCmdLine = '/k title SoloDev Backend (' + $BackendPort + ') && cd /d "' + $serverDir + '" && ' + $py + ' manage.py runserver 0.0.0.0:' + $BackendPort
if ($UseVite) {
  $frontendCmdLine = '/k title SoloDev Frontend Vite (' + $FrontendPort + ') && cd /d "' + $frontendDir + '" && npx vite --port ' + $FrontendPort + ' --host 0.0.0.0 --strictPort'
} else {
  $frontendCmdLine = '/k title SoloDev Frontend (' + $FrontendPort + ') && cd /d "' + $frontendDir + '" && set PORT=' + $FrontendPort + ' && npm run dev'
}
$bProc = Start-Process -FilePath 'cmd' -ArgumentList $backendCmdLine -PassThru
$fProc = Start-Process -FilePath 'cmd' -ArgumentList $frontendCmdLine -PassThru
Write-Info ('Backend window PID ' + $bProc.Id)
Write-Info ('Frontend window PID ' + $fProc.Id)
Write-Host 'Both servers running in separate windows. This launcher will exit.' -ForegroundColor Green
exit 0
