# Restarts the phone app server (127.0.0.1:8090 or PORT in server/config.json, public at https://your-server.example) on this checkout's code.
# Accounts and logs stay in the main checkout's data folder, so nobody has to sign in again.
# A restart kills every job's engine, so this waits until no job is starting, running (a job with background agents
# still counts as running) or waiting for the user. -Force restarts at once; -Except j6 ignores the named jobs.
# A job that wants its own code loaded starts this detached, so it restarts once that job's turn has ended too:
#   Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','<this file>'
param([string]$DataDir = "$env:USERPROFILE\agentic-os\data", [switch]$Force, [int]$WaitMinutes = 240, [string[]]$Except = @(), [int]$Port = 0)
. (Join-Path $PSScriptRoot 'runtime.ps1')
$Port = Resolve-PhonePort $Port
$restartLock = New-Object System.Threading.Mutex($false, "Local\AgenticOSPhoneRestart-$Port")
$acquired = $false
try {
  try { $acquired = $restartLock.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $acquired = $true }
  if (-not $acquired) { 'Another phone-server restart is already in progress.'; exit 0 }
$env:Path = "$env:USERPROFILE\.bun\bin;$env:USERPROFILE\.local\bin;$env:Path"
# Claude must run on your own login, not as a child of a Claude Code session.
Get-ChildItem env: | Where-Object { $_.Name -like 'CLAUDECODE*' -or $_.Name -like 'CLAUDE_CODE_*' } | ForEach-Object { Remove-Item "env:$($_.Name)" }
$env:DATA_DIR = $DataDir
$env:PORT = "$Port"
$logs = Join-Path $DataDir "logs"
New-Item -ItemType Directory -Force $logs | Out-Null

# Jobs that a restart would cut off, as "j1 (running)". $null when the server can't be asked.
function Busy-Jobs {
  try {
    $token = (Get-Content (Join-Path $DataDir "agent.token") -Raw).Trim()
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/jobs" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 15
    # The comma keeps an empty list a list; PowerShell would hand back $null for it ("couldn't ask").
    return , @($r.jobs | Where-Object { $_.status -in @("starting", "running", "needs_input") -and $_.id -notin $Except } |
      ForEach-Object { "$($_.id) ($($_.status))" })
  } catch { return $null }
}

$up = Get-PhoneListener $Port
if ($up -and -not $Force) {
  $deadline = (Get-Date).AddMinutes($WaitMinutes)
  $said = ""
  while ($true) {
    $busy = Busy-Jobs
    if ($null -eq $busy) { "Couldn't read the job list, so I won't restart blind. Run again with -Force to restart anyway."; exit 1 }
    if ($busy.Count -eq 0) { break }
    $now = "Waiting for: $($busy -join ', ')"
    if ($now -ne $said) { "$(Get-Date -Format HH:mm:ss) $now"; $said = $now }
    if ((Get-Date) -gt $deadline) { "Gave up after $WaitMinutes minutes; nothing was restarted. -Force restarts anyway."; exit 1 }
    Start-Sleep -Seconds 20
  }
}

$old = (Get-PhoneListener $Port).OwningProcess
if ($old -and -not (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
  throw "Port $Port is held by an exited process ($old). Choose a free port in server/config.json and update this app's tunnel route before restarting."
}
if ($old) { Stop-Process -Id $old -Force; Start-Sleep -Milliseconds 800 }
# An earlier run without PORT came up on 8090; when this restarts the configured (live) server, clear it if it's this app's bun.
$stray = if ($Port -ne 8090 -and $Port -eq (Resolve-PhonePort 0)) { (Get-PhoneListener 8090).OwningProcess }
if ($stray -and (Get-Process -Id $stray).ProcessName -eq "bun") { Stop-Process -Id $stray -Force }
# Through WMI, not Start-Process: the server then inherits no handles (a caller reading this script's output would
# otherwise hang until the server exits) and isn't in the process tree of whatever job ran this script.
# WMI starts it with the user's stock environment, so the settings go in on the command line.
$set = @{ DATA_DIR = $DataDir; PORT = "$Port" }
foreach ($k in "OWNER_DB", "OWNER_EVENTS", "MOD_SCHEDULER", "CLAUDE_BIN") { $v = [Environment]::GetEnvironmentVariable($k); if ($v) { $set[$k] = $v } }
# The native claude.exe, not a claude.bat or .cmd shim found first on PATH: a shim re-quotes the arguments and breaks
# --json-schema (a schema with spaces).
$exe = "$env:USERPROFILE\.local\bin\claude.exe"
if (-not $set.CLAUDE_BIN -and (Test-Path $exe)) { $set.CLAUDE_BIN = $exe }
$vars = ($set.GetEnumerator() | ForEach-Object { "set `"$($_.Key)=$($_.Value)`"&&" }) -join " "
$line = "cmd.exe /d /c $vars `"$env:USERPROFILE\.bun\bin\bun.exe`" server\index.ts > `"$logs\server.out.log`" 2> `"$logs\server.err.log`""
$null = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $line; CurrentDirectory = (Resolve-Path "$PSScriptRoot\..").Path }
Start-Sleep -Seconds 3
if (-not (Test-PhoneHealth $Port)) { throw "Server didn't answer on port $Port. Check $logs\server.err.log" }
"Server is answering on port $Port."
} finally {
  if ($acquired) { $restartLock.ReleaseMutex() }
  $restartLock.Dispose()
}
