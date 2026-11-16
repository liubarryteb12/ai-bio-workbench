$logOut = 'D:\00.AIagent\codespace\.pwsh7-loop.out.log'
$logErr = 'D:\00.AIagent\codespace\.pwsh7-loop.err.log'
$script = Join-Path $PSScriptRoot 'download_pwsh7_loop.ps1'

$proc = Start-Process -FilePath 'pwsh' -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script
) -RedirectStandardOutput $logOut -RedirectStandardError $logErr -PassThru -WindowStyle Hidden

Write-Output "loop pid: $($proc.Id)"
Write-Output 'status log: D:\00.AIagent\codespace\.pwsh7-status.log'
