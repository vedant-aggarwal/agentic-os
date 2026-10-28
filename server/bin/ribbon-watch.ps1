# Starts the Reality ribbon watcher (server\bin\ribbon-watch.ts) for this checkout if it is not already running.
# At logon, from your startup script (e.g. ~/agentic-os-gateway/start.ps1), after the phone server line:
#   Start-Process -FilePath "powershell.exe" -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '"<checkout>\server\bin\ribbon-watch.ps1"' -WindowStyle Hidden
# Logs: data\logs\ribbon-watch.*.log (under DATA_DIR when set). AGENTIC_APP_PORT, DATA_DIR and RIBBON_* pass through, so a
# test server gets its own watcher: $env:AGENTIC_APP_PORT = "8106"; $env:DATA_DIR = "...\test\data"; .\ribbon-watch.ps1
param([string]$DataDir = $(if ($env:DATA_DIR) { $env:DATA_DIR } else { "$env:USERPROFILE\agentic-os\data" }))
$ErrorActionPreference = "Continue"
$env:DATA_DIR = [System.IO.Path]::GetFullPath($DataDir)
$env:Path = "$env:USERPROFILE\.bun\bin;$env:ProgramFiles\Git\cmd;$env:Path"
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$script = Join-Path $root "server\bin\ribbon-watch.ts"
$logs = if ($env:DATA_DIR) { Join-Path $env:DATA_DIR "logs" } else { Join-Path $root "data\logs" }
New-Item -ItemType Directory -Force $logs | Out-Null

$running = Get-CimInstance Win32_Process -Filter "Name = 'bun.exe'" | Where-Object { $_.CommandLine -like "*$script*" }
if ($running) { Write-Host "ribbon-watch is already running (pid $($running.ProcessId))"; exit 0 }

# The phone server writes the agent token the watcher signs with; wait a little for it at logon.
$dataDir = if ($env:DATA_DIR) { $env:DATA_DIR } else { Join-Path $root "data" }
$token = Join-Path $dataDir "agent.token"
for ($i = 0; $i -lt 30 -and -not (Test-Path $token); $i++) { Start-Sleep -Seconds 2 }
if (-not (Test-Path -LiteralPath $token)) { throw "The phone server's agent token is missing from DATA_DIR. Start the phone server first." }

Start-Process -FilePath "$env:USERPROFILE\.bun\bin\bun.exe" -ArgumentList "`"$script`"" -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput "$logs\ribbon-watch.out.log" -RedirectStandardError "$logs\ribbon-watch.err.log"
Write-Host "ribbon-watch started (logs in $logs)"
