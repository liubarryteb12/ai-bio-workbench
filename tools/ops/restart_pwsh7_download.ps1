$zip = 'D:\00.AIagent\codespace\PowerShell-7.7.0-win-x64.zip'
Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'D:\00.AIagent\codespace\.pwsh7-status.log' -Force -ErrorAction SilentlyContinue
pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'launch_pwsh7_download.ps1')
