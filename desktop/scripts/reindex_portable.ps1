param(
  [string]$Target = 'D:\00.AIagent\codespace\bioworkbench'
)

$indexPath = Join-Path $Target 'index.json'
if (Test-Path -LiteralPath $indexPath) {
  Remove-Item -LiteralPath $indexPath -Force
}
node (Join-Path $PSScriptRoot 'write-index.mjs') $Target
