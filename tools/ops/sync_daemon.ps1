<#
.SYNOPSIS
    WP-3.3 sync daemon：默认 stub 模式供 CI；real 模式接通工作台全链路。

.DESCRIPTION
    本脚本只做编排，导入建项、K40 派发、产物回收与交付打包由 Invoke-*-Stub 占位。
    这些占位是后续接通的窄 seam：函数签名不变时，替换实现不需要改主流程。
    网络只访问本地 portal，NO_PROXY 显式豁免 127.0.0.1 和 localhost。

.PARAMETER PortalBase
    本机 portal 地址，默认 http://127.0.0.1:8080。

.PARAMETER SyncToken
    编排面令牌。默认读 SYNC_TOKEN；空值时退出码 2。

.PARAMETER BatchSize
    每轮处理的 pending 数量，SYNC_BATCH 环境变量可覆盖；默认 1 串行。

.PARAMETER Mode
    stub 为 CI 与空转演练；real 调用 18787 建项、任务、回搬、报告与 result。

.EXAMPLE
    pwsh -File tools/ops/sync_daemon.ps1 -Once
    pwsh -File tools/ops/sync_daemon.ps1 -Once -Mode real
    pwsh -File tools/ops/sync_daemon.ps1 -Once -PortalBase http://127.0.0.1:8080
#>
[CmdletBinding()]
param(
    [string]$PortalBase = ($env:PORTAL_BASE ? $env:PORTAL_BASE : 'http://127.0.0.1:8080'),
    [string]$SyncToken = $env:SYNC_TOKEN,
    [int]$BatchSize = ($env:SYNC_BATCH ? [int]$env:SYNC_BATCH : 1),
    [string]$SpoolRoot = 'ledger/sync/outbox',
    [string]$ActionsPath = 'ledger/actions.jsonl',
    [switch]$Once,
    [int]$IntervalSec = 30,
    [int]$BackoffSeconds = 1,
    [string]$Mode = 'stub',
    [string]$WorkbenchBase = ($env:BIO_WORKBENCH_BASE ? $env:BIO_WORKBENCH_BASE : 'http://127.0.0.1:18787'),
    [string]$WorkbenchUser = $env:BIO_WORKBENCH_USER,
    [string]$WorkbenchPass = $env:BIO_WORKBENCH_PASS,
    [bool]$ReuseExistingProject = ($env:SYNC_REUSE_EXISTING -eq '1')
)

$ErrorActionPreference = 'Stop'
$env:NO_PROXY = '127.0.0.1,localhost'
$env:no_proxy = '127.0.0.1,localhost'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PortalBase = $PortalBase.TrimEnd('/')
$SpoolRoot = Join-Path $RepoRoot $SpoolRoot
$ActionsPath = Join-Path $RepoRoot $ActionsPath
$ActionId = 'ACT-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + (Get-Random -Minimum 1000 -Maximum 9999)

function Test-SafeProjectId {
    param([string]$ProjectId)
    return ($ProjectId -and $ProjectId -match '^[A-Za-z0-9._-]{1,64}$' -and !$ProjectId.StartsWith('.'))
}

function Get-RealProjectId {
    param([string]$Ticket, [object]$Requirement)
    $candidates = @(
        [string]$Requirement.projectId,
        [string]$Requirement.project_id,
        [string]$Requirement.basicInfo.projectId,
        [string]$Requirement.basic_info.project_id,
        [string]$Requirement.basicInfo.name,
        $Ticket
    ) | Where-Object { $_ -and $_.Trim() }
    foreach ($candidate in $candidates) {
        $safe = $candidate.Trim().Replace(' ', '_').Replace('/', '_').Replace('\', '_').Replace(':', '_')
        if (Test-SafeProjectId -ProjectId $safe) { return $safe }
    }
    throw "无法派生合法 project_id：ticket=$Ticket"
}

function Invoke-WorkbenchApi {
    param(
        [string]$Path,
        [string]$Method = 'GET',
        [object]$Body = $null
    )
    $raw = "$WorkbenchUser`:$WorkbenchPass"
    $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($raw))
    $headers = @{ Authorization = "Basic $basic" }
    if ($null -ne $Body) {
        return Invoke-RestMethod -Uri ($WorkbenchBase + $Path) -Method $Method -Headers $headers `
            -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress -Depth 12)
    }
    return Invoke-RestMethod -Uri ($WorkbenchBase + $Path) -Method $Method -Headers $headers
}

function Invoke-FigureApplyReal {
    param([string]$ProjectId, [object]$Requirement)
    $figures = @($Requirement.figure_templates)
    if ($figures.Count -eq 0) { return $null }
    $lineId = if (-not [string]::IsNullOrWhiteSpace($Requirement.lineId)) {
        [string]$Requirement.lineId
    } else {
        [string]$Requirement.seriesId
    }
    return Invoke-WorkbenchApi -Path '/api/projects/figures/apply' -Method 'POST' -Body @{
        projectId = $ProjectId
        lineId = $lineId
        figure_templates = $figures
        pipelineDag = @($Requirement.pipelineDag)
    }
}

function Invoke-ProjectCreateReal {
    param([string]$Ticket, [string]$ProjectId, [object]$Requirement, [string]$PackagePath)
    $body = if ($Requirement) { $Requirement } else { @{ projectId = $ProjectId } }
    if (!$body.projectId) { $body.projectId = $ProjectId }
    $existingProjects = Invoke-WorkbenchApi -Path '/api/projects/list'
    if (@($existingProjects.projects | Where-Object { $_.projectId -eq $ProjectId }).Count -gt 0) {
        $figureApply = Invoke-FigureApplyReal -ProjectId $ProjectId -Requirement $Requirement
        return @{
            imported = $true
            existing = $true
            project_id = $ProjectId
            package_path = $PackagePath
            workbench_project_id = $ProjectId
            response = @{ projectId = $ProjectId; existing = $true; figure_apply = $figureApply }
        }
    }
    try {
        $response = Invoke-WorkbenchApi -Path '/api/projects/create' -Method 'POST' -Body $body
        return @{
            imported = $true
            existing = $false
            project_id = $ProjectId
            package_path = $PackagePath
            workbench_project_id = $response.projectId
            response = $response
        }
    } catch {
        $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        if ($statusCode -eq 409) {
            $figureApply = Invoke-FigureApplyReal -ProjectId $ProjectId -Requirement $Requirement
            return @{
                imported = $true
                existing = $true
                project_id = $ProjectId
                package_path = $PackagePath
                workbench_project_id = $ProjectId
                response = @{ projectId = $ProjectId; existing = $true; figure_apply = $figureApply }
            }
        }
        throw
    }
}

function Wait-TaskComplete {
    param([string]$TaskId)
    Start-Sleep -Seconds 60
    for (;;) {
        $running = Invoke-WorkbenchApi -Path '/api/tasks'
        $still = @($running.tasks | Where-Object { $_.taskId -eq $TaskId })
        if ($still.Count -eq 0) { return $true }
        Start-Sleep -Seconds 60
    }
}

function Invoke-TaskDispatchReal {
    param([string]$Ticket, [string]$ProjectId, [object]$Requirement)
    $lineId = if (-not [string]::IsNullOrWhiteSpace($Requirement.lineId)) {
        [string]$Requirement.lineId
    } else {
        [string]$Requirement.seriesId
    }
    if (!$lineId) { throw "无法确定分析线：ticket=$Ticket" }
    $seedValue = $Requirement.seed
    if (!$seedValue) {
        $envSeed = [string]$env:SYNC_SEED
        if (!$envSeed) { throw "real mode 需要显式种子：requirement.seed 或 SYNC_SEED，ticket=$Ticket" }
        $seedValue = [int]$envSeed
    }
    $executionPlan = Invoke-WorkbenchApi -Path '/api/projects/execution-plan' -Method 'POST' -Body @{
        projectId = $ProjectId
        pipelineDag = @($Requirement.pipelineDag)
    }
    $tasks = @($executionPlan.tasks)
    if ($tasks.Count -eq 0) { throw "执行计划为空：ticket=$Ticket" }
    $results = @()
    foreach ($task in $tasks) {
        $step = [string]$task.step
        $body = @{
            projectId = $ProjectId
            lineId = $lineId
            step = [string]$step
            inputs = @($task.inputs) | Where-Object { $_ }
            outputs = @($task.outputs) | Where-Object { $_ }
            seed = [int]$seedValue
        }
        $adapted = [bool]$task.adapted
        if ($task.kind -eq 'adapted_figure' -or $adapted) {
            $body.adapted = $adapted
            $body.scriptPath = [string]$task.scriptPath
            $body.language = [string]$task.language
            $body.canonicalOutput = [string]$task.canonicalOutput
            $body.dependsOnStep = [string]$task.depends_on_step
        }
        if ([string]$step -like '*knockout*' -or [string]$step -like '*ko_*') {
            $body.targetKoGene = [string]$Requirement.biologicalPriors.targetKoGene
        }
        $response = Invoke-WorkbenchApi -Path '/api/tasks/submit' -Method 'POST' -Body $body
        Wait-TaskComplete -TaskId $response.taskId | Out-Null
        $results += @{
            task_id = $response.taskId
            step = [string]$step
            kind = [string]$task.kind
            depends_on_step = [string]$task.depends_on_step
            waited = $true
        }
    }
    return @{ dispatched = $true; project_id = $ProjectId; tasks = $results }
}

function Invoke-PullOutputsReal {
    param([string]$Ticket, [string]$ProjectId, [object]$DispatchResult)
    $scriptPath = Join-Path $RepoRoot 'tools/ops/07_pull_outputs.ps1'
    $output = & pwsh -NoProfile -File $scriptPath -Project $ProjectId 2>&1
    $exitCode = $LASTEXITCODE
    return @{
        pulled = ($exitCode -eq 0)
        project_id = $ProjectId
        dispatch = $DispatchResult
        exit_code = $exitCode
        output = ($output | Out-String).Trim()
    }
}

function Invoke-ReportBuildReal {
    param([string]$Ticket, [string]$ProjectId, [object]$PullResult)
    $response = Invoke-WorkbenchApi -Path '/api/report/build' -Method 'POST' -Body @{
        projectId = $ProjectId
        force = $true
    }
    return @{
        packed = $true
        project_id = $ProjectId
        pull = $PullResult
        response = $response
    }
}

function Build-RealResultFiles {
    param([string]$ProjectId, [object]$ReportResult)
    $resultFiles = @()
    $totalBytes = 0
    $projectRoot = Join-Path (Join-Path $RepoRoot 'workspace/projects') $ProjectId
    $deliverRoot = Join-Path $projectRoot 'deliverables'
    foreach ($file in @($ReportResult.response.files)) {
        $leaf = Split-Path -Leaf ([string]$file.name)
        $localPath = Join-Path $deliverRoot $leaf
        if (!(Test-Path $localPath)) { continue }
        $bytes = [IO.File]::ReadAllBytes($localPath)
        if ($bytes.Length -gt 24MB -or ($totalBytes + $bytes.Length) -gt 24MB) { continue }
        $resultFiles += @{
            path = "deliverables/$leaf"
            sha256 = (Get-FileHash -Path $localPath -Algorithm SHA256).Hash.ToLowerInvariant()
            size = $bytes.Length
            content_base64 = [Convert]::ToBase64String($bytes)
        }
        $totalBytes += $bytes.Length
    }
    $figureRoot = Join-Path $projectRoot 'figures'
    if (Test-Path $figureRoot) {
        $images = @(Get-ChildItem $figureRoot -Recurse -File | Where-Object {
            $_.Extension -match '^\.(png|jpg|jpeg|webp)$'
        } | Sort-Object FullName | Select-Object -First 12)
        foreach ($image in $images) {
            $bytes = [IO.File]::ReadAllBytes($image.FullName)
            if ($bytes.Length -gt 6MB -or ($totalBytes + $bytes.Length) -gt 22MB) { continue }
            $rel = $image.FullName.Substring($projectRoot.Length).TrimStart('\', '/').Replace('\', '/')
            $resultFiles += @{
                path = $rel
                sha256 = (Get-FileHash -Path $image.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                size = $bytes.Length
                content_base64 = [Convert]::ToBase64String($bytes)
            }
            $totalBytes += $bytes.Length
        }
    }
    return $resultFiles
}

function Invoke-SyncResultReal {
    param([object]$Body)
    return Invoke-SyncApi -Path '/api/sync/result' -Method 'POST' -Body $Body
}

function Write-Action {
    param(
        [string]$Ticket = '',
        [string]$Step,
        [string]$Status = 'ok',
        [object]$Detail = $null,
        [int]$Attempt = 0
    )
    $entry = [ordered]@{
        id = $ActionId
        ts = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
        type = 'action'
        kind = 'portal_sync_daemon'
        ticket = $Ticket
        step = $Step
        status = $Status
        attempt = $Attempt
        detail = $Detail
    }
    $dir = Split-Path -Parent $ActionsPath
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Add-Content -Path $ActionsPath -Value ($entry | ConvertTo-Json -Compress -Depth 8) -Encoding utf8
}

function Invoke-SyncApi {
    param(
        [string]$Path,
        [string]$Method = 'GET',
        [object]$Body = $null
    )
    $headers = @{ Authorization = 'Bearer ' + $SyncToken }
    if ($null -ne $Body) {
        return Invoke-RestMethod -Uri ($PortalBase + $Path) -Method $Method -Headers $headers `
            -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress -Depth 8)
    }
    return Invoke-RestMethod -Uri ($PortalBase + $Path) -Method $Method -Headers $headers
}

function Test-SafeTicket {
    param([string]$Ticket)
    return ($Ticket -and $Ticket.Trim() -eq $Ticket -and $Ticket.Length -le 180 `
        -and $Ticket -notmatch '[/\\]' -and $Ticket -notmatch '^\.' -and $Ticket -notin @('.', '..'))
}

function Test-SafeTarPath {
    param([string]$Entry)
    if (!$Entry -or $Entry.Length -gt 240 -or $Entry.StartsWith('/') -or $Entry.Contains('\')) {
        return $false
    }
    if ($Entry -match '^[A-Za-z]:') { return $false }
    foreach ($part in ($Entry -split '/')) {
        if ($part -eq '..' -or $part -eq '') { return $false }
    }
    return $true
}

function Invoke-SafeUnpack {
    param(
        [string]$ArchivePath,
        [string]$Ticket,
        [string]$Destination
    )
    if (!(Test-SafeTarPath -Entry $Ticket)) {
        throw "拒绝 zip-slip：ticket 路径非法 $Ticket"
    }
    $spoolResolved = [System.IO.Path]::GetFullPath($SpoolRoot)
    $destResolved = [System.IO.Path]::GetFullPath($Destination)
    if (!$destResolved.StartsWith($spoolResolved + [System.IO.Path]::DirectorySeparatorChar)) {
        throw '拒绝 zip-slip：解包落点在 spool 之外'
    }
    if (Test-Path $destResolved) {
        if (!$destResolved.StartsWith($spoolResolved + [System.IO.Path]::DirectorySeparatorChar)) {
            throw '拒绝 zip-slip：清理前发现越界落点'
        }
        Remove-Item -LiteralPath $destResolved -Recurse -Force
    }
    New-Item -ItemType Directory -Path $destResolved -Force | Out-Null
    $modeLines = & tar --list --verbose -f $ArchivePath 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('tar listing failed: ' + ($modeLines -join '; ')) }
    foreach ($line in $modeLines) {
        $trimmed = ([string]$line).Trim()
        if (!$trimmed) { continue }
        $typeChar = $trimmed.Substring(0, 1)
        if ($typeChar -ne 'd' -and $typeChar -ne '-') {
            throw '拒绝 zip-slip：tar 包含 symlink 或 device entry'
        }
    }
    $names = & tar --list -f $ArchivePath 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('tar names failed: ' + ($names -join '; ')) }
    foreach ($name in $names) {
        if (!$name) { continue }
        if (!(Test-SafeTarPath -Entry ([string]$name))) {
            throw "拒绝 zip-slip：tar 路径非法 $name"
        }
    }
    & tar -xzf $ArchivePath -C $destResolved
    if ($LASTEXITCODE -ne 0) { throw 'tar unpack failed' }
    return $destResolved
}

function Invoke-ImportStub {
    param([string]$Ticket, [string]$PackagePath)
    return @{ imported = $true; project_id = $Ticket; package_path = $PackagePath }
}

function Invoke-DispatchStub {
    param([string]$Ticket, [object]$ImportResult)
    return @{ dispatched = $true; project_id = $Ticket; import = $ImportResult }
}

function Invoke-PullStub {
    param([string]$Ticket, [object]$DispatchResult)
    return @{ pulled = $true; project_id = $Ticket; dispatch = $DispatchResult }
}

function Invoke-PackStub {
    param([string]$Ticket, [object]$PullResult)
    return @{ packed = $true; project_id = $Ticket; pull = $PullResult }
}

function Invoke-SyncTicket {
    param([string]$Ticket)
    if (!(Test-SafeTicket -Ticket $Ticket)) {
        Write-Action -Ticket $Ticket -Step 'portal_sync_ticket' -Status 'invalid'
        return
    }
    $attempts = 3
    for ($attempt = 1; $attempt -le $attempts; $attempt++) {
        $stage = 'claim'
        try {
            $claim = Invoke-SyncApi -Path '/api/sync/claim' -Method 'POST' -Body @{ ticket = $Ticket }
            Write-Action -Ticket $Ticket -Step 'portal_sync_claim' -Attempt $attempt -Detail @{ sha256 = $claim.sha256 }
            $archive = Join-Path $SpoolRoot ($claim.sha256 + '.tar.gz')
            New-Item -ItemType Directory -Path $SpoolRoot -Force | Out-Null
            Invoke-WebRequest -Uri $claim.download_url -OutFile $archive -Headers @{ Authorization = 'Bearer ' + $SyncToken } -UseBasicParsing
            Write-Action -Ticket $Ticket -Step 'portal_sync_download' -Attempt $attempt -Detail @{ bytes = (Get-Item $archive).Length }
            $actual = (Get-FileHash -Path $archive -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -ne $claim.sha256) { throw 'archive sha256 mismatch' }
            Write-Action -Ticket $Ticket -Step 'portal_sync_verify' -Attempt $attempt -Detail @{ sha256 = $actual }
            $destination = Join-Path $SpoolRoot $Ticket
            $unpacked = Invoke-SafeUnpack -ArchivePath $archive -Ticket $Ticket -Destination $destination
            Write-Action -Ticket $Ticket -Step 'portal_sync_unpack' -Attempt $attempt -Detail @{ destination = $unpacked }
            $requirement = $null
            $requirementPath = Join-Path $unpacked 'requirement.json'
            if (!(Test-Path $requirementPath)) {
                $flatRequirement = Get-ChildItem $unpacked -File -Filter '*.json' | Select-Object -First 1
                if ($flatRequirement) { $requirementPath = $flatRequirement.FullName }
            }
            if (Test-Path $requirementPath) {
                $requirement = Get-Content -LiteralPath $requirementPath -Raw | ConvertFrom-Json
            }
            if ($Mode -eq 'real') {
                $projectId = Get-RealProjectId -Ticket $Ticket -Requirement $requirement
                $stage = 'project_create'
                if ($ReuseExistingProject) {
                    $import = @{
                        imported = $true
                        existing = $true
                        project_id = $projectId
                        package_path = $unpacked
                        workbench_project_id = $projectId
                        response = @{ projectId = $projectId; existing = $true }
                    }
                } else {
                    $import = Invoke-ProjectCreateReal -Ticket $Ticket -ProjectId $projectId -Requirement $requirement -PackagePath $unpacked
                }
                Write-Action -Ticket $Ticket -Step 'portal_sync_import_real' -Attempt $attempt -Detail @{ project_id = $projectId }
                $stage = 'task_dispatch'
                $dispatch = Invoke-TaskDispatchReal -Ticket $Ticket -ProjectId $projectId -Requirement $requirement
                Write-Action -Ticket $Ticket -Step 'portal_sync_dispatch_real' -Attempt $attempt -Detail @{ task_count = @($dispatch.tasks).Count }
                $stage = 'pull_outputs'
                $pull = Invoke-PullOutputsReal -Ticket $Ticket -ProjectId $projectId -DispatchResult $dispatch
                Write-Action -Ticket $Ticket -Step 'portal_sync_pull_real' -Attempt $attempt -Detail @{ exit_code = $pull.exit_code }
                $stage = 'report_build'
                $pack = Invoke-ReportBuildReal -Ticket $Ticket -ProjectId $projectId -PullResult $pull
                Write-Action -Ticket $Ticket -Step 'portal_sync_pack_real' -Attempt $attempt -Detail @{ files = @($pack.response.files).Count }
                $stage = 'result_files'
                $resultFiles = Build-RealResultFiles -ProjectId $projectId -ReportResult $pack
            } else {
                $import = Invoke-ImportStub -Ticket $Ticket -PackagePath $unpacked
                Write-Action -Ticket $Ticket -Step 'portal_sync_import_stub' -Attempt $attempt -Detail $import
                $dispatch = Invoke-DispatchStub -Ticket $Ticket -ImportResult $import
                Write-Action -Ticket $Ticket -Step 'portal_sync_dispatch_stub' -Attempt $attempt -Detail $dispatch
                $pull = Invoke-PullStub -Ticket $Ticket -DispatchResult $dispatch
                Write-Action -Ticket $Ticket -Step 'portal_sync_pull_stub' -Attempt $attempt -Detail $pull
                $pack = Invoke-PackStub -Ticket $Ticket -PullResult $pull
                Write-Action -Ticket $Ticket -Step 'portal_sync_pack_stub' -Attempt $attempt -Detail $pack
            }
            if (!$resultFiles) { $resultFiles = @() }
            $stage = 'sync_result'
            $resultBody = @{
                ticket = $Ticket
                status = 'done'
                manifest = @{
                    archive_sha256 = $claim.sha256
                    project_id = if ($import.project_id) { $import.project_id } else { $Ticket }
                    imported = $import.imported
                    reused_existing_project = $import.existing
                    dispatched = $dispatch.dispatched
                    pulled = $pull.pulled
                    packed = $pack.packed
                    mode = $Mode
                    result_file_count = @($resultFiles).Count
                }
                files = @($resultFiles)
            }
            $result = Invoke-SyncResultReal -Body $resultBody
            Write-Action -Ticket $Ticket -Step 'portal_sync_result' -Attempt $attempt -Detail $result
            return
        } catch {
            $message = $_.Exception.Message -replace 'Bearer\s+[^\s]+', 'Bearer <REDACTED>'
            $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
            $responseBody = if ($_.ErrorDetails.Message) {
                $_.ErrorDetails.Message -replace 'Bearer\s+[^\s]+', 'Bearer <REDACTED>'
            } else { '' }
            Write-Action -Ticket $Ticket -Step 'portal_sync_attempt' -Status 'failed' -Attempt $attempt -Detail @{
                stage = $stage
                status_code = $statusCode
                error = $message
                response = $responseBody
            }
            if ($attempt -lt $attempts) {
                Start-Sleep -Seconds ($BackoffSeconds * [Math]::Pow(2, $attempt - 1))
            }
        }
    }
    $failure = @{ reason = 'sync ticket failed after 3 attempts'; ticket = $Ticket }
    try {
            $result = Invoke-SyncResultReal -Body @{
            ticket = $Ticket
            status = 'failed'
            manifest = $failure
            files = @()
        }
        Write-Action -Ticket $Ticket -Step 'portal_sync_failed_result' -Detail $result
    } catch {
        $message = $_.Exception.Message -replace 'Bearer\s+[^\s]+', 'Bearer <REDACTED>'
        Write-Action -Ticket $Ticket -Step 'portal_sync_failed_result' -Status 'failed' -Detail @{ error = $message }
    }
}

function Invoke-SyncOnce {
    $pending = Invoke-SyncApi -Path '/api/sync/pending' -Method 'GET'
    $tickets = @($pending.tickets | Select-Object -First ([Math]::Max(1, $BatchSize)))
    Write-Action -Step 'portal_sync_pending' -Detail @{ count = $tickets.Count }
    foreach ($ticket in $tickets) {
        Invoke-SyncTicket -Ticket $ticket.ticket
    }
}

if (!$SyncToken) {
    Write-Action -Step 'portal_sync_daemon' -Status 'failed' -Detail @{ reason = 'SYNC_TOKEN missing' }
    exit 2
}

if ($Mode -eq 'real' -and (!$WorkbenchUser -or !$WorkbenchPass)) {
    Write-Action -Step 'portal_sync_daemon' -Status 'failed' -Detail @{ reason = 'real mode needs BIO_WORKBENCH_USER and BIO_WORKBENCH_PASS' }
    exit 2
}

do {
    try {
        Invoke-SyncOnce
    } catch {
        $message = $_.Exception.Message -replace 'Bearer\s+[^\s]+', 'Bearer <REDACTED>'
        Write-Action -Step 'portal_sync_daemon' -Status 'failed' -Detail @{ error = $message }
    }
    if ($Once) { break }
    Start-Sleep -Seconds ([Math]::Max(1, $IntervalSec))
} while ($true)
