<#
.SYNOPSIS
    tools/ops/local_project_workspace.ps1：本地建项与 K40 项目工作区 CLI 编排。

.DESCRIPTION
    scaffold 是纯本地运维动作，用 PowerShell 非覆盖创建项目骨架，不调用 Python 或 SSH。
    sync 只同步脚本。test、index、validate 会先同步，再通过 k40-ubuntu 调用远端绝对路径。
    index 与 validate 只作用于远端 Root，不会刷新本地 INDEX.json。

.EXAMPLE
    & ./tools/ops/local_project_workspace.ps1 -Action scaffold -ProjectId demo_project
    & ./tools/ops/local_project_workspace.ps1 -Action test
    & ./tools/ops/local_project_workspace.ps1 -Action index
    & ./tools/ops/local_project_workspace.ps1 -Action validate -ProjectId demo_project
#>
[CmdletBinding()]
param(
    [ValidateSet('sync', 'test', 'scaffold', 'index', 'validate')]
    [string]$Action = 'sync',
    [string]$Root = '/mnt/ssd/bio_data',
    [string]$ProjectId = '',
    [string]$SshTarget = 'k40-ubuntu',
    [string]$RemoteRoot = '/mnt/ssd/bio_data'
)

$ErrorActionPreference = 'Stop'
$env:NO_PROXY = 'localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8'

$LF = [string][char]10
$RepoRoot = [System.IO.Path]::GetFullPath(
    (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)
$AllowedRemotePath = '^/mnt/ssd/bio_data(?:/tmp/qa_local_workspace(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*)?$'
$AnalysisLines = @('line1_bulk', 'line2_scrna', 'line3_spatial')
$LedgerNames = @('actions', 'changes', 'errors', 'fixes', 'pitfalls')
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$StrictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)

function Stop-Contract {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [int]$Code = 2
    )
    [Console]::Error.WriteLine("[FAIL] $Message")
    exit $Code
}

function Test-SafeRemotePath {
    param([string]$Path)
    return $Path -match $AllowedRemotePath
}

function Test-SafeProjectId {
    param([string]$Value)
    return $Value -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
}

function Assert-NoReparsePath {
    param([string]$Path)
    $current = [System.IO.Path]::GetFullPath($Path)
    while ($true) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                Stop-Contract "路径包含 symlink 或 reparse point: $current"
            }
        }
        $parent = [System.IO.Path]::GetDirectoryName($current)
        if ([string]::IsNullOrEmpty($parent) -or $parent -eq $current) {
            break
        }
        $current = $parent
    }
}

function Assert-PathWithin {
    param(
        [string]$Path,
        [string]$Base
    )
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $fullBase = [System.IO.Path]::GetFullPath($Base).TrimEnd('\', '/') +
        [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($fullBase, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-Contract "目标路径越出工作区: $fullPath"
    }
}

function Ensure-Directory {
    param([string]$Path)
    Assert-NoReparsePath -Path $Path
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        if (-not $item.PSIsContainer) {
            Stop-Contract "期望目录但发现文件: $Path"
        }
        Assert-NoReparsePath -Path $Path
        return $false
    }
    [void][System.IO.Directory]::CreateDirectory($Path)
    Assert-NoReparsePath -Path $Path
    return $true
}

function ConvertTo-LfText {
    param([string]$Text)
    return ($Text -replace "`r`n", $LF -replace "`r", $LF)
}

function ConvertTo-JsonFileText {
    param([Parameter(Mandatory = $true)]$Value)
    $json = $Value | ConvertTo-Json -Depth 8
    return (ConvertTo-LfText -Text $json) + $LF
}

function Write-Utf8FileIfMissing {
    param(
        [string]$Path,
        [string]$Text
    )
    Assert-NoReparsePath -Path $Path
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        if ($item.PSIsContainer) {
            Stop-Contract "期望文件但发现目录: $Path"
        }
        return $false
    }

    $payload = $Utf8NoBom.GetBytes((ConvertTo-LfText -Text $Text))
    try {
        $stream = [System.IO.File]::Open(
            $Path,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        try {
            $stream.Write($payload, 0, $payload.Length)
            $stream.Flush()
        } finally {
            $stream.Dispose()
        }
    } catch [System.IO.IOException] {
        if (Test-Path -LiteralPath $Path) {
            return $false
        }
        throw
    }
    return $true
}

function Get-ExistingProjectId {
    param([string]$Path)
    try {
        $text = [System.IO.File]::ReadAllText($Path, $StrictUtf8)
        $meta = $text | ConvertFrom-Json -ErrorAction Stop
    } catch {
        Stop-Contract "现有 project.json 无法按 UTF-8 JSON 读取: $Path"
    }
    foreach ($name in @('project_id', 'id')) {
        $property = $meta.PSObject.Properties[$name]
        if ($null -ne $property -and $property.Value -is [string] -and
            -not [string]::IsNullOrWhiteSpace($property.Value)) {
            return $property.Value.Trim()
        }
    }
    return $null
}

function Invoke-LocalScaffold {
    param([string]$Value)

    if (-not (Test-SafeProjectId -Value $Value)) {
        Stop-Contract "ProjectId 不合法: $Value"
    }
    if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) {
        Stop-Contract "工作区根目录不存在: $RepoRoot"
    }
    Assert-NoReparsePath -Path $RepoRoot

    $localProjectsRoot = Join-Path $RepoRoot 'workspace/projects'
    $projectRoot = Join-Path $localProjectsRoot $Value
    Assert-PathWithin -Path $projectRoot -Base $localProjectsRoot
    Assert-NoReparsePath -Path $projectRoot

    $created = [System.Collections.Generic.List[string]]::new()
    if (Ensure-Directory -Path $localProjectsRoot) {
        $created.Add('workspace/projects')
    }
    if (Ensure-Directory -Path $projectRoot) {
        $created.Add("workspace/projects/$Value")
    }

    $metaPath = Join-Path $projectRoot 'project.json'
    if (Test-Path -LiteralPath $metaPath) {
        Assert-NoReparsePath -Path $metaPath
        $existingId = Get-ExistingProjectId -Path $metaPath
        if ($existingId -ne $Value) {
            Stop-Contract "project_id 不匹配: existing=$existingId requested=$Value"
        }
    }

    foreach ($name in @('data', 'figures', 'deliverables', 'debug', 'ledger')) {
        if (Ensure-Directory -Path (Join-Path $projectRoot $name)) {
            $created.Add($name)
        }
    }

    foreach ($line in $AnalysisLines) {
        foreach ($subdir in @('processed', 'figures', 'results')) {
            $relative = "data/$line/$subdir"
            if (Ensure-Directory -Path (Join-Path $projectRoot $relative)) {
                $created.Add($relative)
            }
        }
        $relative = "figures/$line"
        if (Ensure-Directory -Path (Join-Path $projectRoot $relative)) {
            $created.Add($relative)
        }
    }
    if (Ensure-Directory -Path (Join-Path $projectRoot 'figures/adapt')) {
        $created.Add('figures/adapt')
    }

    $meta = [ordered]@{
        schema_version = 1
        project_id = $Value
        name = $Value
        created_at = [DateTimeOffset]::UtcNow.ToString('o')
        lines = $AnalysisLines
    }
    if (Write-Utf8FileIfMissing -Path $metaPath -Text (ConvertTo-JsonFileText -Value $meta)) {
        $created.Add('project.json')
    }

    $readmeText = @(
        '# 项目索引',
        '',
        "- 项目 ID：$Value",
        '- 台账入口：`ledger/`',
        '- 数据入口：`data/`',
        '- 图件入口：`figures/`，派生适配副本在 `figures/adapt/`',
        '- 交付入口：`deliverables/`',
        '- 索引状态：`INDEX.json` 的 `needs_index=true`',
        ''
    ) -join $LF
    if (Write-Utf8FileIfMissing -Path (Join-Path $projectRoot 'README.md') -Text $readmeText) {
        $created.Add('README.md')
    }

    $handoffText = @(
        '# 项目交接',
        '',
        '- 下一步：',
        '- 已知坑：',
        ''
    ) -join $LF
    if (Write-Utf8FileIfMissing -Path (Join-Path $projectRoot 'handoff.md') -Text $handoffText) {
        $created.Add('handoff.md')
    }

    $index = [ordered]@{
        schema_version = 1
        project_id = $Value
        generated_at = $null
        needs_index = $true
        path_map = [ordered]@{}
        artifact_counts = [ordered]@{}
        ledger_summary = [ordered]@{}
    }
    if (Write-Utf8FileIfMissing -Path (Join-Path $projectRoot 'INDEX.json') -Text (ConvertTo-JsonFileText -Value $index)) {
        $created.Add('INDEX.json')
    }

    $projectLedger = Join-Path $projectRoot 'ledger'
    foreach ($name in $LedgerNames) {
        if (Write-Utf8FileIfMissing -Path (Join-Path $projectLedger ($name + '.jsonl')) -Text '') {
            $created.Add("ledger/$name.jsonl")
        }
    }

    $globalLedger = Join-Path $RepoRoot 'ledger'
    Assert-PathWithin -Path $globalLedger -Base $RepoRoot
    if (Ensure-Directory -Path $globalLedger) {
        $created.Add('ledger')
    }
    foreach ($name in $LedgerNames) {
        if (Write-Utf8FileIfMissing -Path (Join-Path $globalLedger ($name + '.jsonl')) -Text '') {
            $created.Add("ledger/$name.jsonl")
        }
    }

    foreach ($name in @('inbox', 'outbox')) {
        $relative = "ledger/sync/$name"
        $path = Join-Path $RepoRoot $relative
        Assert-PathWithin -Path $path -Base $RepoRoot
        if (Ensure-Directory -Path $path) {
            $created.Add($relative)
        }
    }

    Write-Host ("[ OK ] scaffold 仅作用于本地: {0}" -f $projectRoot)
    Write-Host ("[ OK ] 新建 {0} 项，现有文件保持不变" -f $created.Count)
}

function Sync-Scripts {
    $files = @(
        'tools/ops/local_project_workspace.py',
        'tools/reporting/tests/test_local_project_workspace.py'
    )
    $syncScript = Join-Path $RepoRoot 'tools/ops/sync_and_verify_remote.ps1'
    & $syncScript -Files $files -SshTarget $SshTarget -RemoteRoot $RemoteRoot
    $code = $LASTEXITCODE
    if ($null -eq $code) {
        $code = 0
    }
    if ($code -ne 0) {
        Stop-Contract "同步失败，退出码 $code" 1
    }
}

if (-not (Test-SafeRemotePath -Path $Root)) {
    Stop-Contract "Root 只允许 /mnt/ssd/bio_data 或 /mnt/ssd/bio_data/tmp/qa_local_workspace 下的安全子目录: $Root"
}
if (-not (Test-SafeRemotePath -Path $RemoteRoot)) {
    Stop-Contract "RemoteRoot 只允许 /mnt/ssd/bio_data 或 /mnt/ssd/bio_data/tmp/qa_local_workspace 下的安全子目录: $RemoteRoot"
}
if ($SshTarget -ne 'k40-ubuntu') {
    Stop-Contract "SshTarget 只允许 k40-ubuntu: $SshTarget"
}
if ($ProjectId -and -not (Test-SafeProjectId -Value $ProjectId)) {
    Stop-Contract "ProjectId 不合法: $ProjectId"
}
if ($Action -eq 'scaffold' -and -not $ProjectId) {
    Stop-Contract 'scaffold 必须提供 -ProjectId'
}

if ($Action -eq 'scaffold') {
    Invoke-LocalScaffold -Value $ProjectId
    exit 0
}

Sync-Scripts
if ($Action -eq 'sync') {
    exit 0
}

$RemoteScript = "$RemoteRoot/tools/ops/local_project_workspace.py"
$RemoteTest = "$RemoteRoot/tools/reporting/tests/test_local_project_workspace.py"

if ($Action -eq 'test') {
    $remoteCommand = "python3 '$RemoteTest' -v"
} else {
    Write-Host "[INFO] $Action 仅作用于远端 Root=$Root，本地 INDEX.json 不会刷新"
    $remoteCommand = "python3 '$RemoteScript' --root '$Root' $Action"
    if ($ProjectId) {
        $remoteCommand += " --project-id '$ProjectId'"
    }
}

& ssh -o BatchMode=yes -o ConnectTimeout=15 $SshTarget $remoteCommand
$remoteCode = $LASTEXITCODE
if ($null -eq $remoteCode) {
    $remoteCode = 1
}
exit $remoteCode
