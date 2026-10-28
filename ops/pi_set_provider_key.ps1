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
    [ValidateSet('DEEPSEEK_API_KEY','ZAI_API_KEY','ZAI_CODING_CN_API_KEY')]
    [string]$ProviderVariable = 'DEEPSEEK_API_KEY',
    [string]$Model = 'deepseek-v4.1-flash'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($ProviderVariable -eq 'DEEPSEEK_API_KEY' -and $Model -ne 'deepseek-v4.1-flash') {
    throw 'DEEPSEEK_API_KEY may only run model deepseek-v4.1-flash'
}
if ($ProviderVariable -like 'ZAI_*' -and $Model -ne 'glm-5.3-flash') {
    throw 'ZAI keys may only run model glm-5.3-flash'
}

$value = [Environment]::GetEnvironmentVariable($ProviderVariable)
if ([string]::IsNullOrWhiteSpace($value)) {
    throw "environment variable $ProviderVariable is not set"
}

$escaped = $value.Replace("'", "'\\''")
$providerName = if ($ProviderVariable -eq 'DEEPSEEK_API_KEY') { 'deepseek' } else { 'zai' }
ssh k40 "umask 077; printf '%s' '$escaped' > \$HOME/.pi/agent/.provider_key; printf '%s\n' '$providerName' > \$HOME/.pi/agent/.provider_name; printf '%s\n' '$Model' > \$HOME/.pi/agent/.provider_model; chmod 600 \$HOME/.pi/agent/.provider_key \$HOME/.pi/agent/.provider_name \$HOME/.pi/agent/.provider_model; test -s \$HOME/.pi/agent/.provider_key && echo PROVIDER_KEY_STORED provider=$providerName model=$Model"
