<#
.SYNOPSIS
  Push the provider key and endpoint into the phone runtime over ssh stdin.
.DESCRIPTION
  Reads values from local variables, base64-encodes them, and writes 0600
  files on the phone. Nothing sensitive appears in command lines or logs.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ApiKey,
    [Parameter(Mandatory)][ValidateSet('deepseek','zai')][string]$ProviderName,
    [Parameter(Mandatory)][ValidateSet('deepseek-v4.1-flash','glm-5.3-flash')][string]$Model,
    [Parameter(Mandatory)][string]$BaseUrl
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($BaseUrl -notmatch '^https?://') {
    throw "BaseUrl must start with http(s)://"
}

$payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($ApiKey, $ProviderName, $Model, $BaseUrl) -join "`n"))
$remote = @'
umask 077
echo "__PAYLOAD__" | base64 -d > "$HOME/.pi/agent/.provider_payload"
KEY=$(sed -n 1p "$HOME/.pi/agent/.provider_payload")
NAME=$(sed -n 2p "$HOME/.pi/agent/.provider_payload")
MODEL=$(sed -n 3p "$HOME/.pi/agent/.provider_payload")
URL=$(sed -n 4p "$HOME/.pi/agent/.provider_payload")
printf '%s' "$KEY" > "$HOME/.pi/agent/.provider_key"
printf '%s\n' "$NAME" > "$HOME/.pi/agent/.provider_name"
printf '%s\n' "$MODEL" > "$HOME/.pi/agent/.provider_model"
printf '%s\n' "$URL" > "$HOME/.pi/agent/.provider_base_url"
rm -f "$HOME/.pi/agent/.provider_payload"
chmod 600 "$HOME/.pi/agent/.provider_key" "$HOME/.pi/agent/.provider_name" "$HOME/.pi/agent/.provider_model" "$HOME/.pi/agent/.provider_base_url"
echo PROVIDER_STORED provider="$NAME" model="$MODEL"
'@.Replace('__PAYLOAD__', $payload)

$remote | ssh k40 bash
