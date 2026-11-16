param(
  [string]$ZipPath = 'D:\00.AIagent\codespace\PowerShell-7.7.0-win-x64.zip'
)

$urls = @(
  'https://github.com/PowerShell/PowerShell/releases/download/v7.7.0/PowerShell-7.7.0-win-x64.zip',
  'https://ghfast.top/https://github.com/PowerShell/PowerShell/releases/download/v7.7.0/PowerShell-7.7.0-win-x64.zip',
  'https://github.com/PowerShell/PowerShell/releases/download/v7.7.0/PowerShell-7.7.0-win-x64.zip|proxy:http://127.0.0.1:7890'
)
$expected = 115330228
$status = 'D:\00.AIagent\codespace\.pwsh7-status.log'
$curlLog = 'D:\00.AIagent\codespace\.pwsh7-curl.err.log'

function Write-Status([string]$message) {
  Add-Content -LiteralPath $status -Value "[$(Get-Date -Format HH:mm:ss)] $message"
}

Set-Content -LiteralPath $status -Value "[$(Get-Date -Format HH:mm:ss)] download loop started"

$attempt = 0
while ($attempt -lt 120) {
  $attempt++
  $current = 0
  if (Test-Path -LiteralPath $ZipPath) {
    $current = (Get-Item -LiteralPath $ZipPath).Length
  }
  if ($current -ge $expected) {
    Write-Status "download complete: $current bytes"
    break
  }
  Write-Status "attempt $attempt from offset $current"
  $route = $urls[($attempt - 1) % $urls.Count]
  $target = ($route -split '\|proxy:')[0]
  $useProxy = ($route -split '\|proxy:')[1]
  if ($useProxy) {
    & curl.exe -L --proxy $useProxy --speed-limit 10240 --speed-time 60 -C - -o $ZipPath $target 2>> $curlLog
  } else {
    & curl.exe -L --speed-limit 10240 --speed-time 60 -C - -o $ZipPath $target 2>> $curlLog
  }
  $code = $LASTEXITCODE
  $now = 0
  if (Test-Path -LiteralPath $ZipPath) { $now = (Get-Item -LiteralPath $ZipPath).Length }
  Write-Status "attempt $attempt curl exit=$code size=$now"
  if ($now -ge $expected) {
    Write-Status "download complete: $now bytes"
    break
  }
  Start-Sleep -Seconds 3
}

$final = (Get-Item -LiteralPath $ZipPath -ErrorAction SilentlyContinue).Length
if (-not $final -or $final -lt $expected) {
  Write-Status "FAILED: still incomplete at $final bytes after $attempt attempts"
  exit 1
}

Write-Status 'launching elevated install step'
$stepScript = Join-Path $PSScriptRoot 'pwsh7_system_step.ps1'
$proc = Start-Process -FilePath 'pwsh' -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $stepScript, '-ZipPath', $ZipPath
) -Verb RunAs -PassThru -Wait
Write-Status "elevated step exit=$($proc.ExitCode)"

$pwsh7 = 'C:\Program Files\PowerShell\7\pwsh.exe'
if (Test-Path -LiteralPath $pwsh7) {
  $version = & $pwsh7 -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
  Write-Status "INSTALLED: $pwsh7 ($version)"
  exit 0
}

Write-Status 'FAILED: pwsh7 missing after install step'
exit 1
