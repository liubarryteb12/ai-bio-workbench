param(
  [string]$ZipPath = 'D:\00.AIagent\codespace\PowerShell-7.7.0-win-x64.zip'
)

$expected = 115330228
$zip = Get-Item -LiteralPath $ZipPath -ErrorAction SilentlyContinue
if (-not $zip) {
  Write-Output 'zip not found'
  exit 1
}
Write-Output ('zip size: {0:N1} MB / expected {1:N1} MB' -f ($zip.Length / 1MB), ($expected / 1MB))
if ($zip.Length -lt $expected) {
  Write-Output 'download incomplete, keep waiting'
  exit 2
}

Write-Output 'size complete, launching elevated install step (approve UAC)'
$stepScript = Join-Path $PSScriptRoot 'pwsh7_system_step.ps1'
$proc = Start-Process -FilePath 'pwsh' -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $stepScript, '-ZipPath', $ZipPath
) -Verb RunAs -PassThru -Wait
Write-Output "elevated step exit code: $($proc.ExitCode)"

$pwsh7 = 'C:\Program Files\PowerShell\7\pwsh.exe'
if (Test-Path -LiteralPath $pwsh7) {
  $version = & $pwsh7 -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
  Write-Output "verified: $pwsh7 ($version)"
  exit 0
}

Write-Output 'pwsh7 missing after install'
exit 1
