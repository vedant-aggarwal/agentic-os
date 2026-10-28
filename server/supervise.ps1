# Recover a missing phone server. A scheduled -Once check also rescues an exited supervisor.
param([string]$DataDir = "$env:USERPROFILE\agentic-os\data", [int]$Port = 0, [switch]$Once)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
# Resolve configuration again on each check; a port change must not leave recovery watching the old port.
$requestedPort = $Port
$Port = Resolve-PhonePort $requestedPort
$logs = Join-Path $DataDir 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$lock = New-Object System.Threading.Mutex($false, "Local\AgenticOSPhoneSupervisor-$Port")
$acquired = $false
try {
  try { $acquired = $lock.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $acquired = $true }
  if (-not $acquired) { exit 0 }
  do {
    try {
      $Port = Resolve-PhonePort $requestedPort
      $health = Test-PhoneHealth $Port
      $state = [ordered]@{ checkedAt = (Get-Date -Format o); port = $Port; healthy = $health; supervisorPid = $PID; action = 'none'; error = $null }
      if (-not $health) {
        $state.action = 'recover'
        $message = "$(Get-Date -Format o) Phone server is not answering; recovering on port $Port."
        $message | Add-Content -LiteralPath (Join-Path $logs 'phone-recovery.log')
        $message
        # Never block the watchdog for four hours waiting for a busy job. Try next check instead.
        # Run the restart in its own process so exit/exception handling cannot terminate this supervisor.
        $restart = Join-Path $PSScriptRoot 'restart.ps1'
        $out = Join-Path $logs 'phone-recovery.out.log'
        $err = Join-Path $logs 'phone-recovery.err.log'
        $worker = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $restart + '"'), '-DataDir', ('"' + $DataDir + '"'), '-Port', $Port, '-WaitMinutes', '0' -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
        if (-not $worker.WaitForExit(45000)) {
          # Only this restart worker, never the detached server or any job engine.
          Stop-Process -Id $worker.Id -Force -ErrorAction SilentlyContinue
          throw 'Restart worker exceeded 45 seconds; the next check will retry.'
        }
        $state.healthy = Test-PhoneHealth $Port
        if (-not $state.healthy) { $state.error = 'Recovery did not restore health; see phone-recovery logs.' }
      }
    } catch {
      $state = [ordered]@{ checkedAt = (Get-Date -Format o); port = $Port; healthy = $false; supervisorPid = $PID; action = 'failed'; error = $_.Exception.Message }
      "$(Get-Date -Format o) Recovery check failed: $($_.Exception.Message)" | Add-Content -LiteralPath (Join-Path $logs 'phone-recovery.log')
    }
    $state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logs 'phone-health.json') -Encoding UTF8
    if (-not $Once) { Start-Sleep -Seconds 15 }
  } while (-not $Once)
} finally {
  if ($acquired) { $lock.ReleaseMutex() }
  $lock.Dispose()
}
