$ErrorActionPreference = 'Stop'

$proxy = 'http://127.0.0.1:7890'
$apiUrl = 'https://api.github.com/repos/PowerShell/PowerShell/releases/latest'

Write-Output "querying latest release"
$release = Invoke-RestMethod -Uri $apiUrl -Proxy $proxy -TimeoutSec 60
$tag = $release.tag_name
Write-Output "latest tag: $tag"

$asset = $release.assets | Where-Object { $_.name -match '^PowerShell-.*-win-x64\.zip$' } | Select-Object -First 1
if (-not $asset) {
  Write-Error 'win-x64 zip asset not found'
}

$zipPath = "D:\00.AIagent\codespace\$($asset.name)"
$downloaded = $false
foreach ($url in @(
  "https://mirrors.huaweicloud.com/powershell/$tag/$($asset.name)",
  $asset.browser_download_url
)) {
  Write-Output "downloading from: $url"
  try {
    Invoke-WebRequest -Uri $url -OutFile $zipPath -TimeoutSec 600 -ErrorAction Stop
    $downloaded = $true
    break
  } catch {
    Write-Output "download failed: $($_.Exception.Message)"
  }
}
if (-not $downloaded) {
  Write-Output 'falling back to GitHub with proxy'
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -Proxy $proxy -TimeoutSec 600
}
$size = (Get-Item -LiteralPath $zipPath).Length
Write-Output ('downloaded: {0} ({1:N1} MB)' -f $zipPath, ($size / 1MB))

if ($size -lt 50MB) {
  Write-Error 'downloaded file looks too small, aborting'
}

Write-Output 'launching elevated installer step: approve the UAC prompt'
$stepScript = Join-Path $PSScriptRoot 'pwsh7_system_step.ps1'
$proc = Start-Process -FilePath 'pwsh' -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $stepScript, '-ZipPath', $zipPath
) -Verb RunAs -PassThru -Wait
Write-Output "elevated step exit code: $($proc.ExitCode)"

$pwsh7 = 'C:\Program Files\PowerShell\7\pwsh.exe'
if (Test-Path -LiteralPath $pwsh7) {
  $version = & $pwsh7 -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
  Write-Output "verified: $pwsh7 ($version)"
  exit 0
}

Write-Output 'pwsh7 not found after install'
exit 1
