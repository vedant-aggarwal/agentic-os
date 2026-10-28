# Start the configured phone server once, using the same health and job-safety checks as recovery.
param([string]$DataDir = "$env:USERPROFILE\agentic-os\data", [int]$Port = 0)
& (Join-Path $PSScriptRoot 'supervise.ps1') -DataDir $DataDir -Port $Port -Once
