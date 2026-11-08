<#
.SYNOPSIS
Stage plotting sources into an English-only payload tree for K40 execution.

.NOTES
Exit codes: 0 success, 2 parameter or workspace boundary error.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PlanPath,
    [Parameter(Mandatory = $true)][string]$ReferenceRoot,
    [Parameter(Mandatory = $true)][string]$Output
)

$ErrorActionPreference = 'Stop'
$RepoRootPath = [System.IO.Path]::GetFullPath(
    (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

function Fail([string]$Message) {
    Write-Host "[FAIL] $Message" -ForegroundColor Red
    exit 2
}

function Get-RealPath([string]$Path) {
    $full = [System.IO.Path]::GetFullPath($Path)
    $pathRoot = [System.IO.Path]::GetPathRoot($full)
    $relative = $full.Substring($pathRoot.Length)
    $parts = $relative.Split(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.StringSplitOptions]::RemoveEmptyEntries
    )
    $real = $pathRoot
    foreach ($part in $parts) {
        $candidate = Join-Path $real $part
        if (Test-Path -LiteralPath $candidate) {
            $item = Get-Item -LiteralPath $candidate -Force
            $target = $item.ResolveLinkTarget($true)
            $real = if ($null -ne $target) { $target.FullName } else { $item.FullName }
        } else {
            $real = $candidate
        }
    }
    return [System.IO.Path]::GetFullPath($real)
}

$RepoRoot = Get-RealPath $RepoRootPath
$WorkspacePrefix = $RepoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
    [System.IO.Path]::DirectorySeparatorChar

function Get-ContainedPath([string]$Root, [string]$Relative, [string]$Label) {
    if ([System.IO.Path]::IsPathRooted($Relative)) {
        Fail "$Label must be relative: $Relative"
    }
    $full = [System.IO.Path]::GetFullPath((Join-Path $Root $Relative))
    $realRoot = Get-RealPath $Root
    $realFull = Get-RealPath $full
    $rootPrefix = $realRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
        [System.IO.Path]::DirectorySeparatorChar
    if (-not $realFull.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Fail "$Label escapes its root: $full"
    }
    return $full
}

function Get-WorkspacePath([string]$Path, [string]$Label) {
    $full = if ([System.IO.Path]::IsPathRooted($Path)) {
        [System.IO.Path]::GetFullPath($Path)
    } else {
        [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Path))
    }
    $realFull = Get-RealPath $full
    if (-not $realFull.StartsWith($WorkspacePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Fail "$Label escapes workspace: $full"
    }
    return $full
}

function Assert-LfNoBom([string]$Path) {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ge 3 -and
        $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        Fail "UTF-8 BOM is forbidden: $Path"
    }
    foreach ($byte in $bytes) {
        if ($byte -eq 0x0D) {
            Fail "CR byte is forbidden: $Path"
        }
    }
    try {
        [void]([System.Text.UTF8Encoding]::new($false, $true)).GetString($bytes)
    } catch {
        Fail "Invalid UTF-8 bytes: $Path"
    }
}

$ReferenceFull = Get-WorkspacePath $ReferenceRoot 'ReferenceRoot'
$PlanFull = Get-WorkspacePath $PlanPath 'PlanPath'
$OutputFull = Get-WorkspacePath $Output 'Output'

if (-not (Test-Path -LiteralPath $ReferenceFull -PathType Container)) {
    Fail "Reference root missing: $ReferenceFull"
}
if (-not (Test-Path -LiteralPath $PlanFull -PathType Leaf)) {
    Fail "Plan missing: $PlanFull"
}
if ((Get-RealPath $OutputFull) -eq $RepoRoot) {
    Fail 'Output must be a child directory of the workspace'
}
if (Test-Path -LiteralPath $OutputFull) {
    Fail "Output already exists, choose a new run id: $OutputFull"
}

try {
    $plan = Get-Content -LiteralPath $PlanFull -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Fail "Plan is not valid JSON: $PlanFull"
}
if ($null -eq $plan.entries) {
    Fail "Plan has no entries: $PlanFull"
}
New-Item -ItemType Directory -Path $OutputFull | Out-Null

$staged = 0
$seenIds = @{}
foreach ($entry in $plan.entries) {
    $entryId = [string]$entry.id
    if ($entryId -notmatch '^[a-z0-9_]+$') {
        Fail "Unsafe entry id: $entryId"
    }
    if ($seenIds.ContainsKey($entryId)) {
        Fail "Duplicate entry id: $entryId"
    }
    $seenIds[$entryId] = $true

    $sourceSuffix = [string]$entry.source_suffix
    if ($sourceSuffix -notmatch '^\.[A-Za-z0-9]+$') {
        Fail "Unsafe source suffix for ${entryId}: $sourceSuffix"
    }
    $source = Get-ContainedPath $ReferenceFull ([string]$entry.source) "Source for $entryId"
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        Fail "Source missing: $source"
    }
    Assert-LfNoBom $source

    $entryDir = Get-ContainedPath $OutputFull $entryId "Entry directory for $entryId"
    New-Item -ItemType Directory -Path $entryDir | Out-Null
    $sourceName = 'source' + $sourceSuffix
    Copy-Item -LiteralPath $source -Destination (Join-Path $entryDir $sourceName)
    foreach ($inputSpec in $entry.inputs) {
        $targetName = [string]$inputSpec.target
        if ($targetName -in @('.', '..') -or $targetName -notmatch '^[A-Za-z0-9._-]+$') {
            Fail "Unsafe input target for ${entryId}: $targetName"
        }
        if ($targetName -eq 'manifest.json') {
            Fail "Reserved input target for ${entryId}: $targetName"
        }
        if ($targetName -match '^source\.[A-Za-z0-9]+$') {
            Fail "Input target collides with staged source for ${entryId}: $targetName"
        }
        $inputSource = Get-ContainedPath $ReferenceFull (
            [string]$inputSpec.source
        ) "Input source for $entryId"
        if (-not (Test-Path -LiteralPath $inputSource -PathType Leaf)) {
            Fail "Input fixture missing: $inputSource"
        }
        Assert-LfNoBom $inputSource
        Copy-Item -LiteralPath $inputSource -Destination (Join-Path $entryDir $targetName)
    }
    $staged++
}

Copy-Item -LiteralPath $PlanFull -Destination (Join-Path $OutputFull 'manifest.json')
Write-Host ("[ OK ] staged {0} entries -> {1}" -f $staged, $OutputFull)
exit 0
