param(
  [string]$OutFile = 'D:\00.AIagent\codespace\PowerShell-7.7.0-win-x64.zip',
  [int]$Segments = 8
)

$ErrorActionPreference = 'Stop'

$url = 'https://github.com/PowerShell/PowerShell/releases/download/v7.7.0/PowerShell-7.7.0-win-x64.zip'
$proxy = 'http://127.0.0.1:7890'

Write-Output "resolving content length via range probe"
$probeHeaders = Join-Path $env:TEMP 'pwsh7-probe-headers.txt'
$probeBody = Join-Path $env:TEMP 'pwsh7-probe-body.bin'
$null = & curl.exe -sL --proxy $proxy --range 0-0 -D $probeHeaders -o $probeBody $url 2>$null
$headerText = Get-Content -LiteralPath $probeHeaders -Raw -ErrorAction SilentlyContinue
$lengthMatch = [regex]::Match($headerText, '(?im)^content-range:\s*bytes\s+0-0/(\d+)\s*$')
if (-not $lengthMatch.Success) {
  Write-Error "cannot resolve content length from content-range. headers: $($headerText.Substring(0, [math]::Min(500, $headerText.Length)))"
}
$total = [long]$lengthMatch.Groups[1].Value
Write-Output "total bytes: $total"

$workDir = Join-Path $env:TEMP 'pwsh7-segments'
Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $workDir | Out-Null

$segmentSize = [math]::Ceiling($total / $Segments)
$processes = @()
for ($index = 0; $index -lt $Segments; $index++) {
  $startByte = $index * $segmentSize
  $endByte = [math]::Min($startByte + $segmentSize - 1, $total - 1)
  if ($startByte -gt $endByte) { break }
  $partFile = Join-Path $workDir "part-$index"
  $args = @(
    '-sL', '--proxy', $proxy, '--retry', '8', '--retry-delay', '2',
    '--range', "$startByte-$endByte",
    '-o', $partFile, $url
  )
  $processes += Start-Process -FilePath 'curl.exe' -ArgumentList $args -PassThru -WindowStyle Hidden
  Write-Output "segment ${index}: ${startByte}-${endByte} -> $partFile (pid $($processes[-1].Id))"
}

$deadline = (Get-Date).AddMinutes(25)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 10
  $running = @($processes | Where-Object { -not $_.HasExited })
  $downloadedBytes = 0
  Get-ChildItem $workDir -Filter 'part-*' -ErrorAction SilentlyContinue | ForEach-Object { $downloadedBytes += $_.Length }
  $pct = [math]::Round(100 * $downloadedBytes / $total, 1)
  Write-Output ("progress: {0:P1} ({1:N1} MB / {2:N1} MB), running segments: {3}" -f ($downloadedBytes / $total), ($downloadedBytes / 1MB), ($total / 1MB), $running.Count)
  if ($running.Count -eq 0) { break }
}

$stillRunning = @($processes | Where-Object { -not $_.HasExited })
if ($stillRunning.Count -gt 0) {
  Write-Output 'timeout, killing remaining segments'
  $stillRunning | Stop-Process -Force -ErrorAction SilentlyContinue
  exit 1
}

$failed = @($processes | Where-Object { $_.ExitCode -ne 0 })
if ($failed.Count -gt 0) {
  Write-Output "segments failed: $($failed.Count)"
  exit 1
}

Write-Output 'merging segments'
$parts = Get-ChildItem $workDir -Filter 'part-*' | Sort-Object { [int]($_.Name -replace 'part-', '') }
Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
$concatList = Join-Path $workDir 'concat.txt'
$parts | ForEach-Object { "`"$($_.FullName)`"" } | Set-Content -LiteralPath $concatList -Encoding ascii
cmd /c copy /b (Get-Content -LiteralPath $concatList | ForEach-Object { $_ }) "$OutFile" 2>$null
if (-not (Test-Path -LiteralPath $OutFile) -or (Get-Item -LiteralPath $OutFile).Length -ne $total) {
  Write-Error 'merge failed or size mismatch'
}

Remove-Item -LiteralPath $workDir -Recurse -Force
Write-Output ('done: {0} ({1:N1} MB)' -f $OutFile, ((Get-Item -LiteralPath $OutFile).Length / 1MB))
