param(
  [string]$Installer = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'desktop\release\BioanalysWorkbench-Setup-0.1.0.exe'),
  [string]$InstallDir = 'D:\00.AIagent\codespace\bioworkbench'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Installer)) {
  Write-Error "Installer not found: $Installer"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Write-Output "installer: $Installer"
Write-Output "target:    $InstallDir"

$proc = Start-Process -FilePath $Installer -ArgumentList '/S', "/D=$InstallDir" -PassThru
Write-Output "installer pid: $($proc.Id)"

$deadline = (Get-Date).AddSeconds(180)
while (-not $proc.HasExited -and (Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
}

if (-not $proc.HasExited) {
  Write-Output 'installer still running after 180s, killing it'
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  exit 1
}

Write-Output "installer exit code: $($proc.ExitCode)"

$exe = Join-Path $InstallDir 'BioanalysWorkbench.exe'
if (Test-Path -LiteralPath $exe) {
  Write-Output "installed exe: $exe ($([math]::Round((Get-Item -LiteralPath $exe).Length / 1MB, 1)) MB)"
  $runtime = Join-Path $InstallDir 'resources\runtime\BioanalysDesktop\server\index.js'
  Write-Output "backend bundled: $(Test-Path -LiteralPath $runtime)"
  exit 0
}

Write-Output 'install verification FAILED: exe missing at target'
exit 1
