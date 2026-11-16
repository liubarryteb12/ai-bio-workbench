$path = Join-Path $PSScriptRoot 'adb_exec.ps1'
$text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
$utf8Bom = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText($path, $text, $utf8Bom)
$bytes = [System.IO.File]::ReadAllBytes($path)
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
  Write-Output 'BOM written: adb_exec.ps1 is now UTF-8 with BOM'
} else {
  Write-Output 'FAILED to write BOM'
  exit 1
}
