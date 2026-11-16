param(
  [string]$ZipPath = 'D:\00.AIagent\codespace\PowerShell-7.7.0-win-x64.zip'
)

$url = 'https://github.com/PowerShell/PowerShell/releases/download/v7.7.0/PowerShell-7.7.0-win-x64.zip'
$log = 'D:\00.AIagent\codespace\.pwsh7-curl.log'
$errLog = 'D:\00.AIagent\codespace\.pwsh7-curl.err.log'

Get-Process curl -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1
Remove-Item "$env:TEMP\pwsh7-segments" -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "starting background resume download to $ZipPath"
$proc = Start-Process -FilePath 'curl.exe' -ArgumentList @(
  '-L', '--proxy', 'http://127.0.0.1:7890',
  '--retry', '20', '--retry-delay', '3',
  '--speed-limit', '10240', '--speed-time', '60',
  '-C', '-', '-o', $ZipPath, $url
) -RedirectStandardOutput $log -RedirectStandardError $errLog -PassThru -WindowStyle Hidden

Write-Output "curl pid: $($proc.Id), log: $errLog"
Write-Output 'poll with: Get-Item D:\00.AIagent\codespace\PowerShell-7.7.0-win-x64.zip | Select Length'
