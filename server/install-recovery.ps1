# Install from the live checkout. A one-minute task survives a stopped supervisor and runs again at logon.
param([string]$DataDir = "$env:USERPROFILE\agentic-os\data", [string]$TaskName = 'Agentic OS Phone Recovery')
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'supervise.ps1'
$arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script + '" -DataDir "' + $DataDir + '" -Once'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User $user),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1))
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Check the Agentic OS phone server and recover it safely; preserves active jobs.' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
