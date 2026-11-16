$argList = @(
  'install', '--id', 'Microsoft.PowerShell',
  '--source', 'winget', '--scope', 'machine',
  '--accept-source-agreements', '--accept-package-agreements', '--silent'
)

$argLine = $argList -join ' '
Write-Output "launching elevated winget: $argLine"

$proc = Start-Process -FilePath 'winget' -ArgumentList $argLine -Verb RunAs -PassThru -Wait
Write-Output "winget exit code: $($proc.ExitCode)"

$pwsh7 = 'C:\Program Files\PowerShell\7\pwsh.exe'
if (Test-Path -LiteralPath $pwsh7) {
  $version = & $pwsh7 -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
  Write-Output "installed: $pwsh7 ($version)"
  exit 0
}

Write-Output 'pwsh7 not found after install'
exit 1
