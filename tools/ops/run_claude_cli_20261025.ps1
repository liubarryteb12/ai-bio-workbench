[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Probe', 'Review', 'Standards')]
    [string]$Mode,

    [ValidateSet('deepseek-v4.1-flash', 'glm-5.3-flash')]
    [string]$Model = 'deepseek-v4.1-flash',

    [string]$PromptFile,

    [string]$OutputDir = 'artifacts/claude_cli_20261025'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd(
    [char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
)
$exe = if ($env:CLAUDE_CLI) { $env:CLAUDE_CLI } else { 'claude.exe' }

function Assert-NoReparsePoint {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$ParameterName
    )

    $current = $Path
    while ($true) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "$ParameterName must not traverse a symlink or reparse point: $current"
            }
        }
        if ($current.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            break
        }
        $parent = [System.IO.Path]::GetDirectoryName($current)
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) {
            break
        }
        $current = $parent
    }
}

function Resolve-WorkspacePath {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$ParameterName,
        [switch]$RequireExists,
        [switch]$RequireFile,
        [switch]$RequireDirectory
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "$ParameterName must not be empty."
    }
    $candidate = if ([System.IO.Path]::IsPathRooted($Path)) {
        [System.IO.Path]::GetFullPath($Path)
    } else {
        [System.IO.Path]::GetFullPath((Join-Path $rootFull $Path))
    }
    $insidePrefix = $rootFull + [System.IO.Path]::DirectorySeparatorChar
    if (-not $candidate.StartsWith($insidePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$ParameterName must resolve inside the workspace: $candidate"
    }
    Assert-NoReparsePoint -Path $candidate -ParameterName $ParameterName
    if ($RequireExists -and -not (Test-Path -LiteralPath $candidate)) {
        throw "$ParameterName does not exist: $candidate"
    }
    if ($RequireFile -and -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "$ParameterName must be a file: $candidate"
    }
    if ($RequireDirectory -and -not (Test-Path -LiteralPath $candidate -PathType Container)) {
        throw "$ParameterName must be a directory: $candidate"
    }
    return $candidate
}

function Redact-Text {
    param([AllowNull()][string]$Text)

    if ($null -eq $Text) {
        return ''
    }

    $redacted = $Text
    $secretNames = @(
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'CLAUDE_CODE_OAUTH_TOKEN',
        'CLAUDE_API_KEY'
    )
    foreach ($name in $secretNames) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            $redacted = $redacted.Replace($value, '<REDACTED>')
        }
    }

    $redacted = [regex]::Replace(
        $redacted,
        '(?i)(authorization\s*:\s*bearer\s+)\S+',
        '$1<REDACTED>'
    )
    $redacted = [regex]::Replace(
        $redacted,
        '(?i)((?:api[_-]?key|auth[_-]?token|oauth[_-]?token)\s*[=:]\s*)\S+',
        '$1<REDACTED>'
    )
    $redacted = [regex]::Replace(
        $redacted,
        '(?i)\bsk-[A-Za-z0-9_-]{8,}\b',
        '<REDACTED>'
    )
    return $redacted
}

function Write-Utf8Lf {
    param(
        [Parameter(Mandatory)][string]$Path,
        [AllowNull()][string]$Text
    )

    $normalized = (Redact-Text $Text) -replace "`r`n", "`n" -replace "`r", "`n"
    [System.IO.File]::WriteAllText(
        $Path,
        $normalized,
        [System.Text.UTF8Encoding]::new($false)
    )
}

function Invoke-HiddenCli {
    param(
        [Parameter(Mandatory)][string]$Label,
        [AllowEmptyString()]
        [Parameter(Mandatory)][string[]]$Arguments,
        [AllowNull()][string]$StandardInput,
        [int]$TimeoutSeconds = 120
    )

    $stdoutPath = Join-Path $outputRoot "$Label.stdout.log"
    $stderrPath = Join-Path $outputRoot "$Label.stderr.log"

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $exe
    $psi.WorkingDirectory = $root
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardInput = $true
    foreach ($argument in $Arguments) {
        [void]$psi.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $psi
    $startedAt = [DateTimeOffset]::Now
    [void]$process.Start()
    if ($null -ne $StandardInput) {
        $process.StandardInput.Write($StandardInput)
    }
    $process.StandardInput.Close()

    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $completed = $process.WaitForExit($TimeoutSeconds * 1000)
    if (-not $completed) {
        try {
            $process.Kill($true)
        } catch {
            $process.Kill()
        }
        [void]$process.WaitForExit(5000)
    }

    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $durationMs = [int]([DateTimeOffset]::Now - $startedAt).TotalMilliseconds
    $exitCode = if ($completed) { $process.ExitCode } else { 124 }

    Write-Utf8Lf -Path $stdoutPath -Text $stdout
    Write-Utf8Lf -Path $stderrPath -Text $stderr

    return [pscustomobject]@{
        Label = $Label
        ExitCode = $exitCode
        TimedOut = -not $completed
        DurationMs = $durationMs
        StdoutPath = $stdoutPath
        StderrPath = $stderrPath
        Stdout = Redact-Text $stdout
        Stderr = Redact-Text $stderr
    }
}

$outputRoot = Resolve-WorkspacePath -Path $OutputDir -ParameterName 'OutputDir'
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$outputRoot = Resolve-WorkspacePath -Path $outputRoot -ParameterName 'OutputDir' -RequireExists -RequireDirectory

$exists = Test-Path -LiteralPath $exe -PathType Leaf
$probeLines = @(
    "timestamp=$([DateTimeOffset]::Now.ToString('o'))",
    "mode=$Mode",
    "exe=$exe",
    "test_path=$($exists.ToString().ToLowerInvariant())",
    "output_dir=$outputRoot"
)

if (-not $exists) {
    Write-Utf8Lf -Path (Join-Path $outputRoot 'probe_environment.log') -Text (($probeLines + 'decision=missing_exe') -join "`n")
    Write-Error "Claude CLI executable not found at the authorized path."
    exit 2
}

$hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
$probeLines += "sha256=$hash"
Write-Utf8Lf -Path (Join-Path $outputRoot 'probe_environment.log') -Text ($probeLines -join "`n")

if ($Mode -eq 'Probe') {
    $version = Invoke-HiddenCli -Label 'version' -Arguments @('--version') -TimeoutSeconds 30
    $help = Invoke-HiddenCli -Label 'help' -Arguments @('--help') -TimeoutSeconds 30

    $summary = @(
        "version_exit=$($version.ExitCode)",
        "version_timed_out=$($version.TimedOut.ToString().ToLowerInvariant())",
        "help_exit=$($help.ExitCode)",
        "help_timed_out=$($help.TimedOut.ToString().ToLowerInvariant())"
    )
    Write-Utf8Lf -Path (Join-Path $outputRoot 'probe_summary.log') -Text ($summary -join "`n")

    $versionText = if ($version.Stdout.Trim()) { $version.Stdout.Trim() } else { '<empty>' }
    $helpText = if ($help.Stdout.Trim()) { $help.Stdout.Trim() } else { '<empty>' }
    Write-Output "VERSION_EXIT=$($version.ExitCode)"
    Write-Output "VERSION=$versionText"
    Write-Output "HELP_EXIT=$($help.ExitCode)"
    Write-Output "HELP_PREVIEW=$($helpText.Substring(0, [Math]::Min(500, $helpText.Length)))"
    if ($version.ExitCode -ne 0 -or $help.ExitCode -ne 0) {
        exit 1
    }
    exit 0
}

if ([string]::IsNullOrWhiteSpace($Model)) {
    Write-Error "$Mode mode requires -Model."
    exit 2
}
if ([string]::IsNullOrWhiteSpace($PromptFile)) {
    Write-Error "$Mode mode requires -PromptFile."
    exit 2
}

$promptPath = Resolve-WorkspacePath -Path $PromptFile -ParameterName 'PromptFile' -RequireExists -RequireFile

$prompt = [System.IO.File]::ReadAllText($promptPath, [System.Text.Encoding]::UTF8)
$runLabel = if ($Mode -eq 'Standards') { 'standards' } else { 'review' }
$resultFileName = if ($Mode -eq 'Standards') { 'standards_review.md' } else { 'review_result.md' }
$summaryFileName = if ($Mode -eq 'Standards') { 'standards_summary.log' } else { 'review_summary.log' }
$runArgs = @(
    '--print',
    '--model', $Model,
    '--tools', '',
    '--max-turns', '1',
    '--no-session-persistence',
    '--setting-sources', 'user',
    '--permission-mode', 'dontAsk',
    '--output-format', 'json'
)
$run = Invoke-HiddenCli -Label $runLabel -Arguments $runArgs -StandardInput $prompt -TimeoutSeconds 180

$reportedModel = ''
$reportedModelSource = 'model_usage_keys'
$usageKeys = @()
$totalCostUsd = '<unparsed>'
$resultText = ''
$jsonParsed = $false
$subtype = ''
$isError = $null
$numTurns = $null
$maxTurnsStatus = 'unknown'
try {
    $payload = $run.Stdout | ConvertFrom-Json
    $jsonParsed = $true
    $usageKeys = if ($payload.PSObject.Properties.Name -contains 'modelUsage') {
        @($payload.modelUsage.PSObject.Properties.Name)
    } else {
        @()
    }
    if ($usageKeys.Count -gt 0) {
        $reportedModel = ($usageKeys -join ',')
    }
    if ($payload.PSObject.Properties.Name -contains 'model') {
        $reportedModel = [string]$payload.model
        $reportedModelSource = 'top_level_model'
    }
    if ($payload.PSObject.Properties.Name -contains 'total_cost_usd') {
        $totalCostUsd = [string]$payload.total_cost_usd
    }
    if ($null -ne $payload.result) {
        $resultText = [string]$payload.result
    }
    $subtype = [string]$payload.subtype
    if ($payload.PSObject.Properties.Name -contains 'is_error') {
        $isError = [bool]$payload.is_error
    }
    if ($null -ne $payload.num_turns) {
        $numTurns = [int]$payload.num_turns
    }
    if ($subtype -match 'max[_-]?turns') {
        $maxTurnsStatus = 'reached'
    } elseif ($null -ne $numTurns) {
        $maxTurnsStatus = 'not_reached'
    }
} catch {
    $payload = $null
    $reportedModel = '<unparsed>'
    $reportedModelSource = '<unparsed>'
    $usageKeys = @()
    $totalCostUsd = '<unparsed>'
    $resultText = ''
}

if ($resultText) {
    Write-Utf8Lf -Path (Join-Path $outputRoot $resultFileName) -Text $resultText
}

$validationFailures = @()
if (-not $jsonParsed) { $validationFailures += 'invalid_json' }
if ($run.ExitCode -ne 0) { $validationFailures += "cli_exit_$($run.ExitCode)" }
if ($run.TimedOut) { $validationFailures += 'timed_out' }
if ($subtype -ne 'success') { $validationFailures += "subtype_$subtype" }
if ($isError -ne $false) { $validationFailures += "is_error_$isError" }
if ($usageKeys.Count -eq 0) { $validationFailures += 'model_usage_keys_missing_or_empty' }
if ($reportedModel -ne $Model) { $validationFailures += 'reported_model_mismatch' }
if (($usageKeys | Where-Object { $_ -ne $Model }).Count -gt 0) {
    $validationFailures += 'reported_model_extra'
}
if ($maxTurnsStatus -eq 'reached') { $validationFailures += 'max_turns_reached' }

$resultLines = @(
    "timestamp=$([DateTimeOffset]::Now.ToString('o'))",
    "requested_model=$Model",
    "reported_model=$reportedModel",
    "reported_model_source=$reportedModelSource",
    "model_usage_keys=$($usageKeys -join ',')",
    "total_cost_usd=$totalCostUsd",
    "json_parsed=$($jsonParsed.ToString().ToLowerInvariant())",
    "subtype=$subtype",
    "is_error=$isError",
    "num_turns=$numTurns",
    "max_turns_limit=1",
    "max_turns_status=$maxTurnsStatus",
    "exit=$($run.ExitCode)",
    "timed_out=$($run.TimedOut.ToString().ToLowerInvariant())",
    "duration_ms=$($run.DurationMs)",
    "validation_failures=$($validationFailures -join ',')",
    "stdout_log=$($run.StdoutPath)",
    "stderr_log=$($run.StderrPath)",
    "result_log=$(Join-Path $outputRoot $resultFileName)"
)
Write-Utf8Lf -Path (Join-Path $outputRoot $summaryFileName) -Text ($resultLines -join "`n")
Write-Output ($resultLines -join "`n")
if ($validationFailures.Count -gt 0) {
    exit 1
}
exit 0
