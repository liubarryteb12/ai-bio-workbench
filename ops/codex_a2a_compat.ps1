[CmdletBinding()]
param(
  [int]$Port = 9912,
  [string]$Upstream = 'http://127.0.0.1:9910',
  [string]$Prompt = 'Reply with exactly CODEX_A2A_COMPAT_OK and no other text.'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$logDir = Join-Path $root '.Temp'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir 'codex_a2a_compat_proxy.out.log'
$errLog = Join-Path $logDir 'codex_a2a_compat_proxy.err.log'

$proxy = Start-Process `
  -FilePath 'python3' `
  -ArgumentList @((Join-Path $PSScriptRoot 'codex_a2a_compat_proxy.py'), '--port', $Port, '--upstream', $Upstream) `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -PassThru `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog

try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    try {
      $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/.well-known/agent-card.json" -TimeoutSec 2
      $ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 200
    }
  }
  if (-not $ready) {
    throw 'compat proxy not ready'
  }

  $token = (ssh k40 'cat "$HOME/.pi/agent/.peer_token"').Trim()
  if (-not $token) {
    throw 'peer token unavailable'
  }
  $env:A2A_CLIENT_BEARER_TOKEN = $token
  $env:NO_PROXY = 'localhost,127.0.0.1,k40,k40.local,100.64.0.0/10'
  $env:no_proxy = $env:NO_PROXY

  & codex-a2a call "http://127.0.0.1:$Port" $Prompt 2>&1
  $code = $LASTEXITCODE
  Write-Output ('CODEX_A2A_COMPAT_EXIT=' + $code)
  if ($code -ne 0) {
    exit $code
  }
} finally {
  if ($proxy -and -not $proxy.HasExited) {
    Stop-Process -Id $proxy.Id
    $proxy.WaitForExit()
  }
}
