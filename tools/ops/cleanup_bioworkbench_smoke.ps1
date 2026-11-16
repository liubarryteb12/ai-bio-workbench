$items = @(
  'D:\00.AIagent\codespace\bioworkbench\.smoke.out.log',
  'D:\00.AIagent\codespace\bioworkbench\.smoke.err.log',
  'D:\00.AIagent\codespace\bioworkbench\.smoke-data',
  'D:\00.AIagent\codespace\bioworkbench\.smoke-userdata'
)
foreach ($item in $items) {
  if (Test-Path -LiteralPath $item) {
    Remove-Item -LiteralPath $item -Recurse -Force
    Write-Output "removed: $item"
  }
}
