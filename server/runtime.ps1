# Shared by startup and restart so a configured port change survives logon and worker restarts.
function Resolve-PhonePort([int]$Port) {
  if ($Port -eq 0) {
    $configPath = Join-Path $PSScriptRoot 'config.json'
    $Port = if (Test-Path -LiteralPath $configPath) { [int](Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).PORT } else { 0 }
    if ($Port -eq 0) { $Port = 8090 }
  }
  if ($Port -lt 1 -or $Port -gt 65535) { throw 'Invalid phone server port.' }
  return $Port
}

function Get-PhoneListener([int]$Port) {
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    return Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  }
  # PowerShell 7 on this host does not have the NetTCPIP module.
  foreach ($line in (& netstat.exe -ano -p tcp)) {
    if ($line -match '^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$' -and [int]$Matches[1] -eq $Port) {
      return [pscustomobject]@{ OwningProcess = [int]$Matches[2] }
    }
  }
  return $null
}

function Test-PhoneHealth([int]$Port) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 5
    return $response.StatusCode -eq 200 -and ($response.Content | ConvertFrom-Json).ok -eq $true
  } catch { return $false }
}
