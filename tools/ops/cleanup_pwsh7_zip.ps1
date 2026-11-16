$zip = 'D:\00.AIagent\codespace\PowerShell-7.7.0-win-x64.zip'
if (Test-Path -LiteralPath $zip) {
  Remove-Item -LiteralPath $zip -Force
  Write-Output 'zip cleaned'
} else {
  Write-Output 'zip already gone'
}
Write-Output ('pwsh7 exists: ' + (Test-Path -LiteralPath 'C:\Program Files\PowerShell\7\pwsh.exe'))
