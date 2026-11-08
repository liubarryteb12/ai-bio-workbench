[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('inventory', 'empty-root-red', 'empty-root-green')][string]$Stage, [switch]$VerifyAndRunOnly)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
$env:NO_PROXY = 'localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8'
$folder = if ($Stage -eq 'inventory') { 'qa_incident' } elseif ($Stage -eq 'empty-root-red') { 'empty_root_red' } else { 'empty_root_green_' + (Get-Date -Format 'yyyyMMdd_HHmmss_fff') }
$output = Join-Path $repo ('artifacts/k40_acceptance_20261025/' + $folder)
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
    } finally { $stdout.Dispose(); $stderr.Dispose(); $process.Dispose() }
    Write-Host "$Name exit_code=$code artifacts=$output"
    return $code
}
$files = switch ($Stage) {
    'inventory' { @('tools/ops/qa_incident_inventory.sh') }
    'empty-root-red' { @('tools/reporting/tests/test_local_project_workspace.py') }
    default { @('tools/ops/local_project_workspace.py', 'tools/reporting/tests/test_local_project_workspace.py') }
}
$hashes = @{}
foreach ($relative in $files) {
    $source = Join-Path $repo $relative
    $bytes = [IO.File]::ReadAllBytes($source)
    if ($bytes -contains 13) { throw "$relative contains CR; refusing transfer" }
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) { throw "$relative contains UTF-8 BOM; refusing transfer" }
    [void][Text.UTF8Encoding]::new($false, $true).GetString($bytes)
    $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    $hashes[$relative] = $hash
    [IO.File]::AppendAllText((Join-Path $output 'local_sha256.log'), ($hash + '  ' + $relative + [char]10), $utf8)
}
if ($Stage -eq 'inventory') {
    $source = Join-Path $repo $files[0]
    $code = Capture 'ssh' @('-o','BatchMode=yes','-o','ConnectTimeout=15','k40-ubuntu','bash -s') 'inventory' $bytes
    exit $code
}
if (-not $VerifyAndRunOnly) {
    foreach ($relative in $files) {
        $source = Join-Path $repo $relative
        $destination = 'k40-ubuntu:/mnt/ssd/bio_data/' + $relative
        $syncName = 'sync_' + ($relative -replace '[/]', '__')
        $code = Capture 'scp' @('-q','-o','BatchMode=yes','-o','ConnectTimeout=15','-P','10022',$source,$destination) $syncName $null
        if ($code -ne 0) { exit $code }
    }
}
$command = @'
set -eu
__CHECK__
set +e
timeout 100 python3 /mnt/ssd/bio_data/tools/reporting/tests/test_local_project_workspace.py -v
result=$?
exit "$result"
'@
$fileTests = ($files | Sort-Object | ForEach-Object { 'test -f /mnt/ssd/bio_data/' + $_ }) -join [char]10
$check = $fileTests + [char]10 + 'sha256sum -c - <<LOCAL_SHA256' + [char]10 + (($hashes.GetEnumerator() | Sort-Object Name | ForEach-Object { '{0}  /mnt/ssd/bio_data/{1}' -f $_.Value, $_.Key }) -join [char]10) + [char]10 + 'LOCAL_SHA256'
$command = $command.Replace('__CHECK__', $check)
$command = $command.Replace([string][char]13, '')
$code = Capture 'ssh' @('-p','10022','-o','BatchMode=yes','-o','ConnectTimeout=15','k40-ubuntu',$command) 'unittest' $null
exit $code
