<#
  Bootstrap the local, git-ignored .env.a2a file from the phone peer token.
  The token is never printed or written to logs.

  Usage:
    pwsh -NoProfile -File ops/bootstrap_a2a_env.ps1
    pwsh -NoProfile -File ops/bootstrap_a2a_env.ps1 -Check
#>
[CmdletBinding()]
param(
  [string]$Serial = '3a3e1f52',
  [string]$SshTarget = 'k40',
  [string]$PiHost = '127.0.0.1',
  [int]$PiA2APort = 9910,
  [switch]$Check
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $root '.env.a2a'

function Test-EnvFile {
  if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    throw 'ERR_A2A_ENV_MISSING'
  }
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $name, $value = $line -split '=', 2
    $values[$name.Trim()] = $value.Trim()
  }
  $required = @(
    'CODEX_WORKSPACE_ROOT',
    'A2A_HOST',
    'A2A_PORT',
    'PI_TAILSCALE_IP',
    'PI_A2A_PORT',
    'PI_A2A_ENDPOINT',
    'A2A_CLIENT_BEARER_TOKEN',
    'NO_PROXY'
  )
  $missing = @($required | Where-Object { -not $values.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($values[$_]) })
  if ($missing.Count -gt 0) {
    throw ('ERR_A2A_ENV_KEYS_MISSING: ' + ($missing -join ','))
  }
  if ($values['A2A_HOST'] -ne '127.0.0.1') {
    throw 'ERR_A2A_HOST_NOT_LOOPBACK'
  }
  if ($values['A2A_CLIENT_BEARER_TOKEN'].Length -lt 48) {
    throw 'ERR_A2A_TOKEN_TOO_SHORT'
  }
  if ($values['PI_A2A_ENDPOINT'] -notmatch '^http://[^/]+:9910/?$') {
    throw 'ERR_A2A_ENDPOINT_MALFORMED'
  }
  Write-Output ('A2A_ENV_CHECK=ok token_len=' + $values['A2A_CLIENT_BEARER_TOKEN'].Length + ' endpoint=' + $values['PI_A2A_ENDPOINT'])
}

if ($Check) {
  Test-EnvFile
  exit 0
}

if ($PiHost -notin @('127.0.0.1', 'localhost')) {
  throw 'ERR_PI_HOST_NOT_LOOPBACK: use an explicit Tailscale host only after transport verification'
}

$forwardList = (& adb -s $Serial forward --list 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) {
  throw ('ERR_ADB_FORWARD_LIST: ' + $forwardList.Trim())
}
foreach ($port in @($PiA2APort, 9911)) {
  if ($forwardList -notmatch ('(?m)^' + [regex]::Escape($Serial) + '\s+tcp:' + $port + '\s+tcp:' + $port + '\s*$')) {
    & adb -s $Serial forward "tcp:$port" "tcp:$port" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw ('ERR_ADB_FORWARD: ' + $port)
    }
  }
}

$token = (& ssh $SshTarget 'cat "$HOME/.pi/agent/.peer_token"' 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $token.Length -lt 48) {
  throw 'ERR_PEER_TOKEN_UNAVAILABLE'
}

$endpoint = 'http://{0}:{1}' -f $PiHost, $PiA2APort
$lines = @(
  '# Generated locally by ops/bootstrap_a2a_env.ps1. Never commit this file.',
  'CODEX_WORKSPACE_ROOT=.',
  'A2A_HOST=127.0.0.1',
  'A2A_PORT=8000',
  ('PI_TAILSCALE_IP=' + $PiHost),
  ('PI_A2A_PORT=' + $PiA2APort),
  ('PI_A2A_ENDPOINT=' + $endpoint),
  ('A2A_CLIENT_BEARER_TOKEN=' + $token),
  'NO_PROXY=127.0.0.1,localhost,100.64.0.0/10'
)
[System.IO.File]::WriteAllText(
  $envPath,
  (($lines -join "`n") + "`n"),
  [System.Text.UTF8Encoding]::new($false)
)
Set-ItemProperty -LiteralPath $envPath -Name IsReadOnly -Value $false
Write-Output ('A2A_ENV_BOOTSTRAP=ok token_len=' + $token.Length + ' endpoint=' + $endpoint)
