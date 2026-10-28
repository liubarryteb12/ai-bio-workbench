[CmdletBinding()]
param(
    [string]$SshTarget = 'k40-ubuntu',
    [int]$SshPort = 10022
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSCommandPath '..' '..')).Path
$KnownHostsPath = Join-Path $RepoRoot 'ops/k40_known_hosts_10022'
$RemoteDir = '/mnt/ssd/bio_data/tmp/qa_line2_b8/scenic_tf'
$EvidenceId = (Get-Date).ToString('yyyyMMdd_HHmmss')
$ArtifactRoot = Join-Path $RepoRoot ('artifacts/scenic_b8_evidence_' + $EvidenceId)
$LogDir = Join-Path $ArtifactRoot 'logs'
$Files = @(
    'run.log',
    'temperature.log',
    'exit_code.txt',
    'reason.txt',
    'child_exit_code.txt',
    'start_time.txt',
    'end_time.txt'
)

$env:NO_PROXY = 'localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8'
$env:no_proxy = $env:NO_PROXY
$NL = [string][char]10
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Test-Path $KnownHostsPath)) {
    throw "Pinned K40 known_hosts file is missing: $KnownHostsPath"
}

$sshOptions = @(
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', ('UserKnownHostsFile=' + $KnownHostsPath)
)
$scpOptions = @(
    '-q',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', ('UserKnownHostsFile=' + $KnownHostsPath)
)
if ($SshPort -gt 0) {
    $sshOptions += @('-p', [string]$SshPort)
    $scpOptions += @('-P', [string]$SshPort)
}

function Get-Sha256 {
    param([string]$Path)
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-TextByteState {
    param([string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $cr = $false
    foreach ($byte in $bytes) {
        if ($byte -eq 13) { $cr = $true; break }
    }
    $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $utf8 = $true
    try {
        $null = $Utf8Strict.GetString($bytes)
    } catch {
        $utf8 = $false
    }
    return @{ Cr = $cr; Bom = $bom; Utf8 = $utf8 }
}

$probeLines = @('set -eu')
foreach ($file in $Files) {
    $remotePath = $RemoteDir + '/' + $file
    $probeLines += ("if [ -f '$remotePath' ]; then sha256sum '$remotePath'; wc -c < '$remotePath'; else echo 'MISSING $file'; fi")
}
$probeCommand = $probeLines -join $NL
$probeStdout = Join-Path $LogDir 'probe_stdout.log'
$probeStderr = Join-Path $LogDir 'probe_stderr.log'
& ssh @sshOptions $SshTarget $probeCommand 1> $probeStdout 2> $probeStderr
$probeCode = $LASTEXITCODE
[System.IO.File]::WriteAllText((Join-Path $LogDir 'probe_exit_code.txt'), [string]$probeCode, $Utf8NoBom)
if ($probeCode -ne 0) {
    throw "Remote fixed-path probe failed with exit code $probeCode"
}

$remoteState = @{}
$lines = @(Get-Content -Path $probeStdout)
for ($i = 0; $i -lt $lines.Count; $i += 1) {
    $line = $lines[$i].Trim()
    if ($line -match '^MISSING\s+(.+)$') {
        $remoteState[$Matches[1]] = @{ Present = $false; Hash = ''; Size = '' }
    } elseif ($line -match '^([0-9a-f]{64})\s+(.+)$') {
        $hash = $Matches[1]
        $path = $Matches[2]
        $name = Split-Path $path -Leaf
        $size = if ($i + 1 -lt $lines.Count) { $lines[$i + 1].Trim() } else { '' }
        $remoteState[$name] = @{ Present = $true; Hash = $hash; Size = $size }
    }
}

$rows = @("file`tstatus`tremote_sha256`tlocal_sha256`tmatch`tsize_bytes`tcr`tbom`tutf8_valid")
$missing = @()
foreach ($file in $Files) {
    $state = $remoteState[$file]
    if ($null -eq $state -or -not $state.Present) {
        $missing += $file
        $rows += ($file + "`tMISSING`t`t`tFalse`t`t`t`t")
        continue
    }

    $localPath = Join-Path $ArtifactRoot $file
    $scpStdout = Join-Path $LogDir ($file + '_scp_stdout.log')
    $scpStderr = Join-Path $LogDir ($file + '_scp_stderr.log')
    & scp @scpOptions ($SshTarget + ':' + $RemoteDir + '/' + $file) $localPath 1> $scpStdout 2> $scpStderr
    $scpCode = $LASTEXITCODE
    [System.IO.File]::WriteAllText((Join-Path $LogDir ($file + '_scp_exit_code.txt')), [string]$scpCode, $Utf8NoBom)
    if ($scpCode -ne 0) {
        $rows += ($file + "`tPULL_FAILED`t" + $state.Hash + "`t`tFalse`t" + $state.Size + "`t`t`t")
        continue
    }

    $localHash = Get-Sha256 $localPath
    $match = $localHash -eq $state.Hash
    $textState = Get-TextByteState -Path $localPath
    $rows += ($file + "`tPULLED`t" + $state.Hash + "`t" + $localHash + "`t" + $match + "`t" + $state.Size + "`t" + $textState.Cr + "`t" + $textState.Bom + "`t" + $textState.Utf8)
}

[System.IO.File]::WriteAllText((Join-Path $ArtifactRoot 'manifest.tsv'), (($rows -join $NL) + $NL), $Utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $ArtifactRoot 'missing_files.txt'), (($missing -join $NL) + $(if ($missing.Count -gt 0) { $NL } else { '' })), $Utf8NoBom)

$summary = @(
    ('evidence_id=' + $EvidenceId),
    ('remote_dir=' + $RemoteDir),
    ('files_requested=' + $Files.Count),
    ('files_missing=' + $missing.Count),
    ('process_scan=false'),
    ('scenic_run=false'),
    ('b64_used=false')
) -join $NL
[System.IO.File]::WriteAllText((Join-Path $ArtifactRoot 'summary.txt'), $summary + $NL, $Utf8NoBom)

Write-Output ('artifact_root=' + $ArtifactRoot)
Write-Output ('missing=' + ($missing -join ','))
if (@($rows | Select-Object -Skip 1 | Where-Object { $_ -match "`tPULL_FAILED`t" }).Count -gt 0) { exit 1 }
exit 0
