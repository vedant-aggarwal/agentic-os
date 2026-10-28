# Integration test with empty, isolated data; never uses the live database or production port.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('aos-recovery-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
$reservation = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$reservation.Start()
$testPort = $reservation.LocalEndpoint.Port
$reservation.Stop()
$env:OWNER_DB = Join-Path $scratch 'owner.db'
$env:OWNER_EVENTS = Join-Path $scratch 'events.json'
$env:MOD_SCHEDULER = 'off'
$env:AI_PREFETCH = 'off'
$data = Join-Path $scratch 'data'
$supervisor = Join-Path $PSScriptRoot 'supervise.ps1'
$owned = @()
function Check([bool]$ok, [string]$message) { if (-not $ok) { throw $message }; "PASS $message" }
try {
  & $supervisor -DataDir $data -Port $testPort -Once
  Check (Test-PhoneHealth $testPort) 'a missing server is recovered'
  $first = [int](Get-PhoneListener $testPort).OwningProcess
  $owned += $first
  & $supervisor -DataDir $data -Port $testPort -Once
  Check ([int](Get-PhoneListener $testPort).OwningProcess -eq $first) 'a healthy server is left running'
  Stop-Process -Id $first -Force
  Start-Sleep -Milliseconds 800
  & $supervisor -DataDir $data -Port $testPort -Once
  Check (Test-PhoneHealth $testPort) 'a crashed test server is recovered'
  $second = [int](Get-PhoneListener $testPort).OwningProcess
  $owned += $second
  Check ($second -ne $first) 'recovery created a new server process'
  $state = Get-Content -LiteralPath (Join-Path $data 'logs\phone-health.json') -Raw | ConvertFrom-Json
  Check ($state.healthy -eq $true -and $state.port -eq $testPort) 'health evidence records the tested port and recovery result'
} finally {
  foreach ($process in $owned) { Stop-Process -Id $process -Force -ErrorAction SilentlyContinue }
}
"Evidence: $scratch"
