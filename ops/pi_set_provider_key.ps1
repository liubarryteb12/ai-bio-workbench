<#
.SYNOPSIS
  Push the Pi model provider API key into the Termux runtime without logging
  or committing it.
.DESCRIPTION
  The phone only needs Pi Agent plus a provider key. This script reads the key
  from the Windows environment (for example OPENAI_API_KEY), sends it through
  ssh, and writes it to a 0600 file that the Pi tmux session sources.
#>
[CmdletBinding()]
param(
    [ValidateSet('OPENAI_API_KEY','DEEPSEEK_API_KEY','ANTHROPIC_API_KEY','OPENROUTER_API_KEY')]
    [string]$ProviderVariable = 'OPENAI_API_KEY',
    [string]$ProviderName = 'openai'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$value = [Environment]::GetEnvironmentVariable($ProviderVariable)
if ([string]::IsNullOrWhiteSpace($value)) {
    throw "environment variable $ProviderVariable is not set"
}

$escaped = $value.Replace("'", "'\\''")
ssh k40 "umask 077; printf '%s' '$escaped' > \$HOME/.pi/agent/.provider_key; printf '%s\n' '$ProviderName' > \$HOME/.pi/agent/.provider_name; chmod 600 \$HOME/.pi/agent/.provider_key \$HOME/.pi/agent/.provider_name; test -s \$HOME/.pi/agent/.provider_key && echo PROVIDER_KEY_STORED provider=$ProviderName"
