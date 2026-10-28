#Requires -Version 7
# Connects Wyn (Agentic OS) to WhatsApp through the control bridge that already owns the Wyn number.
#   pwsh -File scripts\whatsapp\install-bridge.ps1
# 1. Replaces ~\control-bridge\bridge.mjs (-Bridge) with scripts\whatsapp\bridge.mjs (backup kept), if the
#    live file is the 2026-10-16 version this patch was made from.
# 2. Adds wynUrl and a new wynSecret to the bridge's config.json.
# 3. Adds WA_TRANSPORT, WA_OWNER, WA_SECRET and WA_BRIDGE_URL to the Agentic OS server's config.json.
# 4. Restarts the bridge and checks it. Restart the app server yourself afterwards (server\restart.ps1).
# No secret is printed. WA_OWNER is read from the bridge's owner list (Hermes's .env), not typed here.
param(
  [string]$Bridge = "$env:USERPROFILE\control-bridge",
  [string]$AppConfig = "$env:USERPROFILE\agentic-os\server\config.json",
  [int]$AppPort = 8090
)
$ErrorActionPreference = 'Stop'
$ORIGINAL = '2DA48C547497502977E86850036C5919AF1A4E31CF82C1E3AE362C7C42EEC837'
$new = Join-Path $PSScriptRoot 'bridge.mjs'
$live = Join-Path $Bridge 'bridge.mjs'

# 1. The bridge code
$liveHash = (Get-FileHash $live -Algorithm SHA256).Hash
$newHash = (Get-FileHash $new -Algorithm SHA256).Hash
if ($liveHash -eq $newHash) { Write-Host 'Bridge code is already the Wyn version.' }
elseif ($liveHash -ne $ORIGINAL) { throw "The live bridge.mjs changed since this patch was made (hash $liveHash). Merge scripts\whatsapp\bridge.mjs into it by hand." }
else {
  Copy-Item $live "$live.bak-wyn-$(Get-Date -Format yyyyMMdd-HHmm)"
  Copy-Item $new $live -Force
  Write-Host 'Bridge code replaced (backup next to it).'
}

# 2. The bridge's config
$cfgPath = Join-Path $Bridge 'config.json'
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
if (-not $cfg.wynSecret -or $cfg.wynSecret.Length -lt 32) {
  $bytes = [byte[]]::new(32); [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $cfg | Add-Member -Force wynSecret (-join ($bytes | ForEach-Object { $_.ToString('x2') }))
}
$cfg | Add-Member -Force wynUrl "http://127.0.0.1:$AppPort/api/v1/whatsapp/inbound"
Copy-Item $cfgPath "$cfgPath.bak-wyn-$(Get-Date -Format yyyyMMdd-HHmm)"
$cfg | ConvertTo-Json -Depth 5 | Set-Content $cfgPath -Encoding utf8
Write-Host 'Bridge config: wynUrl and wynSecret set.'

# 3. The app server's config
$envFile = $cfg.hermesEnv
$owner = ((Get-Content $envFile | Where-Object { $_ -match '^WHATSAPP_CLOUD_ALLOWED_USERS=' }) -replace '^[^=]+=', '' -split ',')[0] -replace '\D', ''
if (-not $owner) { throw "No owner number in $envFile (WHATSAPP_CLOUD_ALLOWED_USERS)." }
$app = if (Test-Path $AppConfig) { Get-Content $AppConfig -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
if (Test-Path $AppConfig) { Copy-Item $AppConfig "$AppConfig.bak-wyn-$(Get-Date -Format yyyyMMdd-HHmm)" }
$app | Add-Member -Force WA_TRANSPORT 'bridge'
$app | Add-Member -Force WA_OWNER $owner
$app | Add-Member -Force WA_SECRET $cfg.wynSecret
$app | Add-Member -Force WA_BRIDGE_URL "http://127.0.0.1:$($cfg.port ?? 8090)"
$app | ConvertTo-Json -Depth 5 | Set-Content $AppConfig -Encoding utf8
Write-Host "App config: WhatsApp on through the bridge, for …$($owner.Substring($owner.Length - 4))."

# 4. Restart the bridge
$port = $cfg.port ?? 8090
$pids = netstat -ano | Select-String "127\.0\.0\.1:$port\s+\S+\s+LISTENING\s+(\d+)" | ForEach-Object { $_.Matches[0].Groups[1].Value } | Sort-Object -Unique
foreach ($p in $pids) { if ((Get-Process -Id $p).ProcessName -eq 'node') { Stop-Process -Id $p -Force } }
Start-Sleep -Milliseconds 800
Start-Process wscript.exe -ArgumentList "`"$Bridge\start-bridge.vbs`""
Start-Sleep -Seconds 3
$health = try { Invoke-RestMethod "http://127.0.0.1:$port/pulse/health" } catch { 'down' }
Write-Host "Bridge health: $health"
Get-Content (Join-Path $Bridge 'bridge.log') -Tail 1
Write-Host 'Next: restart the app server on the merged code (server\restart.ps1), then message the Wyn number from WhatsApp.'
