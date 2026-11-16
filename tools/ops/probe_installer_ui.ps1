param(
  [string]$Installer = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'desktop\release\BioanalysWorkbench-Setup-0.1.0.exe'),
  [string]$LogFile = (Join-Path $env:TEMP 'bioworkbench-installer-ui-probe.log')
)

Set-Content -LiteralPath $LogFile -Value "[$(Get-Date -Format HH:mm:ss)] starting UI probe"

$process = New-Object System.Diagnostics.Process
$process.StartInfo.FileName = $Installer
$process.StartInfo.UseShellExecute = $false
$process.StartInfo.CreateNoWindow = $true
$null = $process.Start()
Add-Content -LiteralPath $LogFile -Value "pid=$($process.Id)"

$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 800
  $process.Refresh()
  $title = $process.MainWindowTitle
  if ($title) {
    Add-Content -LiteralPath $LogFile -Value "window title: $title"
    break
  }
  if ($process.HasExited) {
    Add-Content -LiteralPath $LogFile -Value "exited early code=$($process.ExitCode)"
    break
  }
}

if (-not $process.HasExited) {
  Add-Content -LiteralPath $LogFile -Value 'still alive, killing UI probe'
  Get-Process -Id $process.Id -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

Add-Content -LiteralPath $LogFile -Value 'ui probe done'
Get-Content -LiteralPath $LogFile
