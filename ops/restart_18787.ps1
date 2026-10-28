<#
.SYNOPSIS
  Restart the BioanalysDesktop 18787 server with the current code.
.DESCRIPTION
  Kills any process holding 18787, then starts server/index.js from
  BioanalysDesktop as a hidden background node process and waits for health.
#>
[CmdletBinding()]
param(
    [int]$Port = 18787
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$serverDir = Join-Path $repoRoot 'BioanalysDesktop'

$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
foreach ($conn in $listener) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
}
if ($listener) { Start-Sleep -Seconds 2 }

$env:BAD_PORT = [string]$Port
$proc = Start-Process -FilePath 'node' -ArgumentList 'server/index.js' `
    -WorkingDirectory $serverDir -WindowStyle Hidden -PassThru
Write-Output "STARTED pid=$($proc.Id) port=$Port"

$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 4
        Write-Output "HEALTH_OK service=$($health.service) port=$($health.port)"
        exit 0
    } catch { }
}
Write-Error 'server did not become healthy within 20 seconds'
exit 1
