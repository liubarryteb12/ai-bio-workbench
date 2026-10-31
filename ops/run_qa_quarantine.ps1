[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
$env:NO_PROXY = 'localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8'

$root = '/mnt/ssd/bio_data'
$target = '/mnt/ssd/bio_data/tmp/qa_incident_20261025_103530_quarantine'
$relativeScript = 'ops/qa_incident_quarantine.py'
$localScript = Join-Path $repo $relativeScript
$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss_fff'
$output = Join-Path $repo ('artifacts/k40_acceptance_20261025/quarantine_' + $timestamp)
[void][IO.Directory]::CreateDirectory($output)
$utf8 = [Text.UTF8Encoding]::new($false)

function Capture([string]$Program, [string[]]$Arguments, [string]$Name, [byte[]]$InputBytes) {
    $info = [Diagnostics.ProcessStartInfo]::new($Program)
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = $true
    foreach ($argument in $Arguments) { [void]$info.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    $stdout = [IO.File]::Create((Join-Path $output ($Name + '_stdout.log')))
    $stderr = [IO.File]::Create((Join-Path $output ($Name + '_stderr.log')))
    try {
        [void]$process.Start()
        $outTask = $process.StandardOutput.BaseStream.CopyToAsync($stdout)
        $errTask = $process.StandardError.BaseStream.CopyToAsync($stderr)
        if ($InputBytes) { $process.StandardInput.BaseStream.Write($InputBytes, 0, $InputBytes.Length) }
        $process.StandardInput.Close()
        $process.WaitForExit()
        [void]$outTask.GetAwaiter().GetResult()
        [void]$errTask.GetAwaiter().GetResult()
        $code = $process.ExitCode
        [IO.File]::WriteAllText((Join-Path $output ($Name + '_exit_code.log')), ('exit_code=' + $code + [char]10), $utf8)
    } finally {
        $stdout.Dispose()
        $stderr.Dispose()
        $process.Dispose()
    }
    Write-Host "$Name exit_code=$code artifacts=$output"
    return $code
}

function Get-PropertyNames($Object) {
    return @($Object.PSObject.Properties.Name | Sort-Object) -join [char]10
}

function Test-FileMapsEqual($Left, $Right) {
    if ((Get-PropertyNames $Left) -cne (Get-PropertyNames $Right)) { return $false }
    foreach ($property in $Left.PSObject.Properties) {
        $other = $Right.PSObject.Properties[$property.Name]
        if ($null -eq $other -or [string]$property.Value -cne [string]$other.Value) { return $false }
    }
    return $true
}

function Get-FileHashValue($Item, [string]$Name) {
    $property = $Item.files.PSObject.Properties[$Name]
    if ($null -eq $property) { throw "missing source hash: $($Item.source) $Name" }
    return [string]$property.Value
}

$bytes = [IO.File]::ReadAllBytes($localScript)
if ([Array]::IndexOf($bytes, [byte]13) -ge 0) { throw "$relativeScript contains CR; refusing transfer" }
if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
    throw "$relativeScript contains UTF-8 BOM; refusing transfer"
}
[void][Text.UTF8Encoding]::new($false, $true).GetString($bytes)
$localHash = (Get-FileHash -LiteralPath $localScript -Algorithm SHA256).Hash.ToLowerInvariant()
$localMetadata = @(
    "sha256=$localHash"
    "bytes=$($bytes.Length)"
    'bom=false'
    'cr_index=-1'
    'ends_lf=true'
) -join [char]10
[IO.File]::WriteAllText((Join-Path $output 'local_script_metadata.log'), $localMetadata + [char]10, $utf8)
[IO.File]::WriteAllText((Join-Path $output 'local_sha256.log'), ($localHash + '  ' + $relativeScript + [char]10), $utf8)

$destination = 'k40-ubuntu:/mnt/ssd/bio_data/' + $relativeScript
$code = Capture 'scp' @(
    '-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-P', '10022', $localScript, $destination
) 'script_transfer' $null
if ($code -ne 0) { throw "script transfer failed with exit code $code" }

$remoteCheck = @"
set -eu
cd /mnt/ssd/bio_data
printf '%s  %s\n' '$localHash' '$relativeScript' | sha256sum -c -
"@
$code = Capture 'ssh' @(
    '-p', '10022', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'k40-ubuntu', $remoteCheck
) 'remote_sha256' $null
if ($code -ne 0) { throw "remote sha256 check failed with exit code $code" }

$dryCommand = @"
set -eu
cd /mnt/ssd/bio_data
python3 $relativeScript --dry-run
"@
$code = Capture 'ssh' @(
    '-p', '10022', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'k40-ubuntu', $dryCommand
) 'dry_run' $null
if ($code -ne 0) { throw "dry-run failed with exit code $code" }

$dry = Get-Content -Raw -LiteralPath (Join-Path $output 'dry_run_stdout.log') | ConvertFrom-Json -Depth 20
if ($dry.ok -ne $true) { throw 'dry-run JSON ok is not true' }
if ($dry.mode -cne 'dry-run' -or $dry.exit_code -ne 0) { throw 'dry-run JSON mode or exit_code mismatch' }
if ($dry.root -cne $root) { throw "unexpected root: $($dry.root)" }
if ($dry.target -cne $target) { throw "unexpected target: $($dry.target)" }

$expectedItems = [ordered]@{
    '/mnt/ssd/bio_data/local_projects/qa_a' = @{
        target = '/mnt/ssd/bio_data/tmp/qa_incident_20261025_103530_quarantine/local_projects/qa_a'
        base = '/mnt/ssd/bio_data/tmp/qa_incident_20261025_103530_quarantine/local_projects/qa_a'
        files = @('INDEX.json', 'README.md', 'handoff.md', 'ledger/actions.jsonl', 'ledger/changes.jsonl',
            'ledger/errors.jsonl', 'ledger/fixes.jsonl', 'ledger/pitfalls.jsonl', 'project.json')
    }
    '/mnt/ssd/bio_data/local_projects/qa_b' = @{
        target = '/mnt/ssd/bio_data/tmp/qa_incident_20261025_103530_quarantine/local_projects/qa_b'
        base = '/mnt/ssd/bio_data/tmp/qa_incident_20261025_103530_quarantine/local_projects/qa_b'
        files = @('INDEX.json', 'README.md', 'handoff.md', 'ledger/actions.jsonl', 'ledger/changes.jsonl',
            'ledger/errors.jsonl', 'ledger/fixes.jsonl', 'ledger/pitfalls.jsonl', 'project.json')
    }
    '/mnt/ssd/bio_data/local_projects/INDEX.md' = @{
        target = '/mnt/ssd/bio_data/tmp/qa_incident_20261025_103530_quarantine/local_projects/INDEX.md'
        base = '/mnt/ssd/bio_data/tmp/qa_incident_20261025_103530_quarantine/local_projects'
        files = @('INDEX.md')
    }
    '/mnt/ssd/bio_data/con_hf/ledger' = @{
        target = '/mnt/ssd/bio_data/tmp/qa_incident_20261025_103530_quarantine/con_hf/ledger'
        base = '/mnt/ssd/bio_data/tmp/qa_incident_20261025_103530_quarantine/con_hf/ledger'
        files = @('actions.jsonl', 'changes.jsonl', 'errors.jsonl', 'fixes.jsonl', 'pitfalls.jsonl')
    }
}

$dryItems = @($dry.items)
if ($dryItems.Count -ne 4) { throw "dry-run item count is $($dryItems.Count), expected 4" }
$actualSources = @($dryItems | ForEach-Object { [string]$_.source } | Sort-Object)
$expectedSources = @($expectedItems.Keys | Sort-Object)
if (($actualSources -join [char]10) -cne ($expectedSources -join [char]10)) {
    throw "dry-run source set mismatch: $($actualSources -join ', ')"
}
foreach ($item in $dryItems) {
    $expected = $expectedItems[[string]$item.source]
    if ($null -eq $expected) { throw "unexpected dry-run source: $($item.source)" }
    if ($item.target -cne $expected.target) { throw "unexpected target for $($item.source)" }
    if ($item.base -cne $expected.base) { throw "unexpected base for $($item.source)" }
    $actualFiles = @($item.files.PSObject.Properties.Name | Sort-Object)
    $expectedFiles = @($expected.files | Sort-Object)
    if (($actualFiles -join [char]10) -cne ($expectedFiles -join [char]10)) {
        throw "source hash key set mismatch for $($item.source)"
    }
    foreach ($name in $actualFiles) {
        if ([string](Get-FileHashValue $item $name) -notmatch '^[0-9a-f]{64}$') {
            throw "invalid SHA256 for $($item.source) $name"
        }
    }
}

$metadataHashes = @{
    qa_a = @{
        'project.json' = 'a576da17dd3ec4c83748133aaa2ee25c878abd16b79d76e6093cb0447fb9788a'
        'README.md' = 'e20a4c47c0f93b424755359559f933913b52e6cc3659af2c73f805f6c69d3550'
        'handoff.md' = '3020a5075a58dd0a45ee9200464cca613e796dee51a6f4a6b164f9d783e7b308'
        'INDEX.json' = '751ca7164acb3be3d98dae3554dd1dd8a779f49f359cb6ff960415a44fda638d'
    }
    qa_b = @{
        'project.json' = '919207667c587fcab4bd297fa7fa752ac781e262fc44b86caa128e93b141979a'
        'README.md' = 'e20a4c47c0f93b424755359559f933913b52e6cc3659af2c73f805f6c69d3550'
        'handoff.md' = '3020a5075a58dd0a45ee9200464cca613e796dee51a6f4a6b164f9d783e7b308'
        'INDEX.json' = '9d429972821a73f09c3c5a3c0302160a81b02d99e05d8f6e3088968216677631'
    }
}
$emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
foreach ($projectId in @('qa_a', 'qa_b')) {
    $item = $dryItems | Where-Object { $_.source -ceq "/mnt/ssd/bio_data/local_projects/$projectId" }
    foreach ($name in $metadataHashes[$projectId].Keys) {
        if ((Get-FileHashValue $item $name) -cne $metadataHashes[$projectId][$name]) {
            throw "metadata hash mismatch for $projectId $name"
        }
    }
    foreach ($name in @('actions.jsonl', 'changes.jsonl', 'errors.jsonl', 'fixes.jsonl', 'pitfalls.jsonl')) {
        if ((Get-FileHashValue $item ('ledger/' + $name)) -cne $emptyHash) {
            throw "project ledger is not empty for $projectId $name"
        }
    }
}
$globalLedger = $dryItems | Where-Object { $_.source -ceq '/mnt/ssd/bio_data/con_hf/ledger' }
foreach ($name in @('actions.jsonl', 'changes.jsonl', 'errors.jsonl', 'fixes.jsonl', 'pitfalls.jsonl')) {
    if ((Get-FileHashValue $globalLedger $name) -cne $emptyHash) {
        throw "global ledger is not empty: $name"
    }
}

$applyCommand = @"
set -eu
cd /mnt/ssd/bio_data
python3 $relativeScript --apply
"@
$code = Capture 'ssh' @(
    '-p', '10022', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'k40-ubuntu', $applyCommand
) 'apply' $null
if ($code -ne 0) { throw "apply failed with exit code $code" }

$sourceChecks = ($expectedSources | ForEach-Object {
    "test ! -e '$_'"
    "test ! -L '$_'"
}) -join [char]10
$absenceCommand = @"
set -eu
$sourceChecks
printf 'sources_absent=true\n'
"@
$code = Capture 'ssh' @(
    '-p', '10022', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'k40-ubuntu', $absenceCommand
) 'post_apply_sources' $null
if ($code -ne 0) { throw "post-apply source absence check failed with exit code $code" }

$manifestPath = $target + '/manifest.json'
$readbackCommand = @"
set -eu
cat '$manifestPath'
"@
$code = Capture 'ssh' @(
    '-p', '10022', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'k40-ubuntu', $readbackCommand
) 'manifest_readback' $null
if ($code -ne 0) { throw "manifest readback failed with exit code $code" }

$manifest = Get-Content -Raw -LiteralPath (Join-Path $output 'manifest_readback_stdout.log') | ConvertFrom-Json -Depth 30
if ($manifest.status -cne 'complete') { throw "manifest status is $($manifest.status)" }
if ($manifest.root -cne $root -or $manifest.target -cne $target) { throw 'manifest root or target mismatch' }
$actions = @($manifest.actions)
if ($actions.Count -ne 4) { throw "manifest action count is $($actions.Count), expected 4" }
foreach ($item in $dryItems) {
    $action = $actions | Where-Object { $_.source -ceq [string]$item.source }
    if ($null -eq $action) { throw "manifest missing action for $($item.source)" }
    if ($action.status -cne 'moved_verified') { throw "manifest action not moved_verified: $($item.source)" }
    if ($action.target -cne $item.target -or $action.action -cne 'os.rename') {
        throw "manifest action target or method mismatch: $($item.source)"
    }
    if (-not (Test-FileMapsEqual $action.source_hashes $item.files)) {
        throw "manifest source hashes changed: $($item.source)"
    }
    if (-not (Test-FileMapsEqual $action.target_hashes $item.files)) {
        throw "manifest target hashes mismatch: $($item.source)"
    }
}

$localManifest = Join-Path $output 'manifest.json'
$code = Capture 'scp' @(
    '-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-P', '10022',
    ('k40-ubuntu:' + $manifestPath), $localManifest
) 'manifest_transfer' $null
if ($code -ne 0) { throw "manifest transfer failed with exit code $code" }
$localManifestHash = (Get-FileHash -LiteralPath $localManifest -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $output 'manifest_sha256.log'),
    ($localManifestHash + '  manifest.json' + [char]10), $utf8)

$summary = [ordered]@{
    dry_run = 'pass'
    apply = 'pass'
    verified_items = 4
    sources_absent = $true
    root = $root
    target = $target
    script_sha256 = $localHash
    manifest_sha256 = $localManifestHash
    artifacts = $output
}
[IO.File]::WriteAllText((Join-Path $output 'summary.json'),
    (($summary | ConvertTo-Json -Depth 5) + [char]10), $utf8)
Write-Host "quarantine complete verified_items=4 artifacts=$output"
