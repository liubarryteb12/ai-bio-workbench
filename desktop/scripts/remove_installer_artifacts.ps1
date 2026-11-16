$targets = @(
  'release\BioanalysWorkbench-Setup-0.1.0.exe',
  'release\BioanalysWorkbench-Setup-0.1.0.exe.blockmap',
  'release\BioanalysWorkbench-0.1.0-portable.exe',
  'release\BioanalysWorkbench-Setup-0.1.0.exe.blockmap'
)

Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
foreach ($item in $targets) {
  if (Test-Path -LiteralPath $item) {
    Remove-Item -LiteralPath $item -Force
    Write-Output "removed: $item"
  }
}
Get-ChildItem release -File | ForEach-Object { Write-Output ('{0} ({1:N1} MB)' -f $_.Name, ($_.Length / 1MB)) }
