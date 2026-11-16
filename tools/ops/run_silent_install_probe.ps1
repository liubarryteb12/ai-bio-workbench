param(
  [string]$InstallDir = ''
)

$log = Join-Path $env:TEMP 'bioworkbench-install-probe.log'
Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue

$probe = Join-Path $PSScriptRoot 'silent_install_probe.ps1'
if ($InstallDir) {
  Start-Process pwsh -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $probe, '-InstallDir', $InstallDir -WindowStyle Hidden -Wait
} else {
  Start-Process pwsh -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $probe -WindowStyle Hidden -Wait
}

if (Test-Path -LiteralPath $log) {
  Get-Content -LiteralPath $log
} else {
  Write-Output 'probe log missing'
}
