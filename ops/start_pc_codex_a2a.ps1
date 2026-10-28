<#
.SYNOPSIS
  Start the Codex A2A adapter on the PC loopback and verify its Agent Card.
.DESCRIPTION
  codex-a2a is a PC-plane component. It must run next to the Windows Codex CLI,
  not on the phone. This launcher keeps the inbound face on 127.0.0.1:8000 and
  injects a random session credential without echoing it.
#>
[CmdletBinding()]
param(
    [int]$Port = 8000,
    [string]$WorkspaceRoot = (Get-Location).Path,
    [string]$CodexCliBin = 'C:\Users\18765\AppData\Local\OpenAI\Codex\bin\6257d9e8f63c0f2b\codex.exe'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Get-Command codex-a2a -ErrorAction SilentlyContinue)) {
    throw 'codex-a2a is not installed; run: uv tool install codex-a2a'
}
if (-not (Test-Path -LiteralPath $CodexCliBin)) {
    throw "Codex CLI binary not found: $CodexCliBin"
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listener) {
    throw "port $Port is already in use; stop the previous serve first"
}

$bytes = [byte[]]::new(24)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$token = 'a2a_sec_' + (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')

$env:A2A_STATIC_AUTH_CREDENTIALS = @'
[{"id":"local-bearer","scheme":"bearer","token":"__TOKEN__","principal":"automation"}]
'@.Replace('__TOKEN__', $token)
$env:A2A_HOST = '127.0.0.1'
$env:A2A_PORT = [string]$Port
$env:A2A_PUBLIC_URL = "http://127.0.0.1:$Port"
$env:CODEX_WORKSPACE_ROOT = $WorkspaceRoot
$env:CODEX_CLI_BIN = $CodexCliBin

$proc = Start-Process -FilePath 'codex-a2a' -ArgumentList 'serve' -WindowStyle Hidden -PassThru
Write-Output "SERVE_STARTED pid=$($proc.Id) port=$Port"

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    try {
        $card = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/.well-known/agent-card.json" -TimeoutSec 4
        Write-Output ("PC_SERVE_CARD_OK name={0} version={1}" -f $card.name, $card.version)
        Write-Output "A2A_SESSION_TOKEN_PREFIX=$($token.Substring(0, 8))"
        exit 0
    } catch {
    }
}

Write-Error 'Agent Card did not become ready within 30 seconds'
exit 1
