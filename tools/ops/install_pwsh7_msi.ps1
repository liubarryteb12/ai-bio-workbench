$ErrorActionPreference = 'Stop'

$proxy = 'http://127.0.0.1:7890'
$apiUrl = 'https://api.github.com/repos/PowerShell/PowerShell/releases/latest'

Write-Output "querying latest release: $apiUrl"
$release = Invoke-RestMethod -Uri $apiUrl -Proxy $proxy -TimeoutSec 60
$tag = $release.tag_name
Write-Output "latest tag: $tag"

$asset = $release.assets | Where-Object { $_.name -match '^PowerShell-.*-win-x64\.msi$' } | Select-Object -First 1
if (-not $asset) {
  Write-Output 'available assets:'
  $release.assets | ForEach-Object { Write-Output "  $($_.name)" }
}
if (-not $asset) {
  Write-Error "MSI asset not found in release $tag"
}

$msiPath = 'D:\00.AIagent\codespace\PowerShell-win-x64.msi'
Write-Output "downloading $($asset.browser_download_url)"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $msiPath -Proxy $proxy -TimeoutSec 600
$size = (Get-Item -LiteralPath $msiPath).Length
Write-Output ('downloaded: {0} ({1:N1} MB)' -f $msiPath, ($size / 1MB))

if ($size -lt 50MB) {
  Write-Error 'downloaded file looks too small, aborting'
}

Write-Output 'launching elevated msiexec (machine-wide, silent): approve the UAC prompt'
$msiArgs = "/i `"$msiPath`" /qn /norestart ADD_EXPLORER_CONTEXT_MENU_OPENPOWERSHELL=1 ENABLE_PS1_FILE_ASSOCIATION=1"
$proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList $msiArgs -Verb RunAs -PassThru -Wait
Write-Output "msiexec exit code: $($proc.ExitCode)"

$pwsh7 = 'C:\Program Files\PowerShell\7\pwsh.exe'
if (Test-Path -LiteralPath $pwsh7) {
  $version = & $pwsh7 -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
  Write-Output "installed: $pwsh7 ($version)"
  exit 0
}

Write-Output 'pwsh7 not found after install'
exit 1
