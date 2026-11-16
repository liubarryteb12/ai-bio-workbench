param(
  [string]$Source = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'desktop\release\win-unpacked'),
  [string]$Target = 'D:\00.AIagent\codespace\bioworkbench',
  [switch]$NoShortcut
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath (Join-Path $Source 'BioanalysWorkbench.exe'))) {
  throw "source build missing: $Source"
}

New-Item -ItemType Directory -Force -Path $Target | Out-Null
$resolvedTarget = (Resolve-Path -LiteralPath $Target).Path
if ($resolvedTarget -ne 'D:\00.AIagent\codespace\bioworkbench') {
  throw "refusing unexpected target: $resolvedTarget"
}

Write-Output "deploying: $Source -> $resolvedTarget"
Copy-Item -Path (Join-Path $Source '*') -Destination $resolvedTarget -Recurse -Force

$exe = Join-Path $resolvedTarget 'BioanalysWorkbench.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  throw 'deploy verification failed: exe missing'
}
Write-Output ('deployed exe: {0} ({1:N1} MB)' -f $exe, ((Get-Item -LiteralPath $exe).Length / 1MB))

$venvPython = Join-Path $resolvedTarget 'venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
  throw 'deploy verification failed: venv python missing at portable root'
}
Write-Output "deployed venv python: $venvPython"

New-Item -ItemType Directory -Force -Path (Join-Path $resolvedTarget 'data\raw_data') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $resolvedTarget 'data\logs') | Out-Null

Write-Output 'generating portable index (references + sha256)'
Push-Location (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'desktop')
try {
  node scripts\write-index.mjs $resolvedTarget | ForEach-Object { Write-Output $_ }
} finally {
  Pop-Location
}

if ($NoShortcut) { return }

$shell = New-Object -ComObject WScript.Shell
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Bioanalys 工作台.lnk'
$shortcut = $shell.CreateShortcut($desktopLnk)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = $resolvedTarget
$shortcut.Description = 'Bioanalys 生信分析工作台'
$shortcut.Save()
Write-Output "desktop shortcut: $desktopLnk"

$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Bioanalys 工作台'
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
$menuLnk = Join-Path $startMenu 'Bioanalys 工作台.lnk'
$shortcut = $shell.CreateShortcut($menuLnk)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = $resolvedTarget
$shortcut.Description = 'Bioanalys 生信分析工作台'
$shortcut.Save()
Write-Output "start menu shortcut: $menuLnk"
