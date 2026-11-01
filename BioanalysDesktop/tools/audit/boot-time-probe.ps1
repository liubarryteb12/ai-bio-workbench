#!/usr/bin/env pwsh
# Measure server cold boot: process start until the workbench port accepts a connection.
# 08-book item 7 requires < 500ms, so the answer must be a measured number.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
Set-Location $root
$port = 18991
$env:BAD_PORT = "$port"
$env:BIO_ALLOW_DEV_NOAUTH = '1'
$env:NO_PROXY = 'localhost,127.0.0.1'

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = (Get-Command node.exe).Source
$psi.Arguments = "server/index.js"
$psi.WorkingDirectory = $root
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$p = [System.Diagnostics.Process]::Start($psi)

$readyMs = -1
try {
  while ($sw.ElapsedMilliseconds -lt 15000) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $ok = $client.ConnectAsync('127.0.0.1', $port).Wait(200)
      if ($ok -and $client.Connected) {
        $readyMs = $sw.ElapsedMilliseconds
        break
      }
    } catch {
    } finally {
      $client.Dispose()
    }
    Start-Sleep -Milliseconds 5
  }
} finally {
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
}

Write-Output "cold_boot_ms=$readyMs"
Write-Output "verdict=$(if ($readyMs -ge 0 -and $readyMs -lt 500) { 'UNDER_500MS' } else { 'NOT_UNDER_500MS' })"
if ($readyMs -lt 0) {
  Write-Output '--- stderr tail ---'
  ($stderr -split "`r?`n" | Select-Object -Last 20) -join "`n" | Write-Output
}
