param(
  [string]$Installer = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'desktop\release\BioanalysWorkbench-Setup-0.1.0.exe'),
  [string]$InstallDir = '',
  [string]$LogFile = (Join-Path $env:TEMP 'bioworkbench-install-probe.log')
)

$ErrorActionPreference = 'Continue'

function Write-Log([string]$message) {
  Add-Content -LiteralPath $LogFile -Value "[$(Get-Date -Format HH:mm:ss)] $message"
}

$argList = if ($InstallDir) { "/S /D=$InstallDir" } else { '/S' }
$label = if ($InstallDir) { "targeted: $InstallDir" } else { 'default location' }
Set-Content -LiteralPath $LogFile -Value "[$(Get-Date -Format HH:mm:ss)] probe: $label"
Write-Log "installer: $Installer"
Write-Log "args: $argList"

$stdoutFile = Join-Path $env:TEMP 'bioworkbench-install-stdout.log'
$stderrFile = Join-Path $env:TEMP 'bioworkbench-install-stderr.log'
Remove-Item -LiteralPath $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue

$process = New-Object System.Diagnostics.Process
$process.StartInfo.FileName = $Installer
$process.StartInfo.Arguments = $argList
$process.StartInfo.UseShellExecute = $false
$process.StartInfo.RedirectStandardOutput = $true
$process.StartInfo.RedirectStandardError = $true
$process.StartInfo.CreateNoWindow = $true
$process.StartInfo.WorkingDirectory = (Split-Path $Installer -Parent)

$startAt = Get-Date
$null = $process.Start()
Write-Log "started pid=$($process.Id)"

$process.BeginOutputReadLine()
$process.BeginErrorReadLine()

$exited = $process.WaitForExit(120000)
$elapsed = [math]::Round(((Get-Date) - $startAt).TotalSeconds, 1)

if (-not $exited) {
  Write-Log "TIMEOUT after ${elapsed}s, killing pid=$($process.Id)"
  try { $process.Kill($true) } catch { try { $process.Kill() } catch {} }
  Write-Log 'RESULT: fail (timeout)'
  exit 1
}

Write-Log "exited after ${elapsed}s, exit code=$($process.ExitCode)"
Start-Sleep -Seconds 2

$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\BioanalysWorkbench\BioanalysWorkbench.exe')
)
if ($InstallDir) {
  $candidates = @((Join-Path $InstallDir 'BioanalysWorkbench.exe'))
}

$installed = $false
foreach ($exe in $candidates) {
  if (Test-Path -LiteralPath $exe) {
    Write-Log "INSTALLED: $exe"
    $installed = $true
  }
}

foreach ($file in @($stdoutFile, $stderrFile)) {
  if ((Test-Path -LiteralPath $file) -and ((Get-Item -LiteralPath $file).Length -gt 0)) {
    Write-Log "---- $(Split-Path $file -Leaf) ----"
    Get-Content -LiteralPath $file | Select-Object -First 40 | ForEach-Object { Write-Log $_ }
  }
}

if ($installed) {
  Write-Log 'RESULT: ok'
  exit 0
}
Write-Log 'RESULT: fail (no files installed)'
exit 1
