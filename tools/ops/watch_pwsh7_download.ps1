$statusLog = 'D:\00.AIagent\codespace\.pwsh7-status.log'
$zipPath = 'D:\00.AIagent\codespace\PowerShell-7.7.0-win-x64.zip'
param(
  [int]$LoopPid = 8252
)

while ($true) {
  $last = Get-Content -LiteralPath $statusLog -Tail 1
  $zip = Get-Item -LiteralPath $zipPath -ErrorAction SilentlyContinue
  $mb = if ($zip) { [math]::Round($zip.Length / 1MB, 1) } else { 0 }
  Write-Output ('{0} zip={1}MB last={2}' -f (Get-Date -Format HH:mm:ss), $mb, $last)
  if ($last -match 'INSTALLED|FAILED') { break }
  $loopAlive = Get-Process pwsh -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq $loopPid }
  if (-not $loopAlive) {
    Write-Output "loop process $loopPid gone"
    break
  }
  Start-Sleep -Seconds 90
}
