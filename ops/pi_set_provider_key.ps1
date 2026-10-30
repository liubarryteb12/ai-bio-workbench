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
    [string]$ProviderVariable = 'ZAI_API_KEY',
    [string]$Model = 'glm-5.3-flash'
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

$providerName = if ($ProviderVariable -eq 'DEEPSEEK_API_KEY') { 'deepseek' } else { 'zai' }

function Invoke-SshWithStdin {
    param(
        [Parameter(Mandatory)][string]$RemoteCommand,
        [Parameter(Mandatory)][string]$InputText
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = 'ssh'
    $startInfo.ArgumentList.Add('k40')
    $startInfo.ArgumentList.Add($RemoteCommand)
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true

    $process = [System.Diagnostics.Process]::Start($startInfo)
    try {
        $process.StandardInput.Write($InputText)
        $process.StandardInput.Close()
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        $exitCode = $process.ExitCode
    }
    finally {
        $process.Dispose()
    }

    if ($exitCode -ne 0) {
        throw "ssh provider key upload failed: $stderr"
    }
    return $stdout
}

$remoteKeyPath = '$HOME/.pi/agent/.provider_keys/' + $providerName
$uploadCommand = 'umask 077; mkdir -p "$HOME/.pi/agent/.provider_keys"; cat > "' + $remoteKeyPath + '"'
Invoke-SshWithStdin -RemoteCommand $uploadCommand -InputText $value | Out-Null

$finalizeTemplate = @'
umask 077
__LEGACY_COPY__printf '%s\n' '__PROVIDER__' > "$HOME/.pi/agent/.provider_name"
printf '%s\n' '__MODEL__' > "$HOME/.pi/agent/.provider_model"
chmod 700 "$HOME/.pi/agent/.provider_keys"
chmod 600 "$HOME/.pi/agent/.provider_keys/__PROVIDER__" "$HOME/.pi/agent/.provider_name" "$HOME/.pi/agent/.provider_model"
test -s "$HOME/.pi/agent/.provider_keys/__PROVIDER__"
echo "PROVIDER_KEY_STORED provider=__PROVIDER__ model=__MODEL__"
'@
$legacyCopy = if ($providerName -eq 'zai') {
    'cp "$HOME/.pi/agent/.provider_keys/zai" "$HOME/.pi/agent/.provider_key"; chmod 600 "$HOME/.pi/agent/.provider_key"; '
} else {
    ''
}
$finalizeCommand = $finalizeTemplate.Replace('__LEGACY_COPY__', $legacyCopy).Replace('__PROVIDER__', $providerName).Replace('__MODEL__', $Model)
$finalizeOutput = & ssh k40 $finalizeCommand 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $finalizeOutput -notmatch 'PROVIDER_KEY_STORED') {
    throw "provider key finalize failed: $($finalizeOutput.Trim())"
}
$finalizeOutput.Trim()
