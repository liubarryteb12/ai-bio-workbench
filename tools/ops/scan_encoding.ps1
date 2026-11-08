# 用途：编码整顿第一阶段的只读体检。扫描工作区内文件的编码与行尾，
# 产出按风险分级的待改清单。本脚本只读，不修改任何文件。
#
# 背景：规范要求本地文件 UTF-8 无 BOM 加 LF 行尾。历史遗留的 reference
# 目录下大量文件可能是 GBK 或 CRLF，直接传 K40 会让 awk 数值比较退化为
# 字符串比较。
#
# 用法：pwsh -File tools/ops/scan_encoding.ps1
# 输出：docs/encoding-audit-report.md 与 docs/encoding-audit-detail.tsv

param(
    [string]$Root = (Join-Path $PSScriptRoot ".."),
    [int]$MaxScanBytes = 20MB
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path $Root).Path
$DocsDir = Join-Path $Root "docs"
if (-not (Test-Path $DocsDir)) {
    New-Item -ItemType Directory -Path $DocsDir -Force | Out-Null
}

$ExcludeDirs = @(".git", "node_modules", "__pycache__", ".venv", "venv", "outputs", "artifacts", ".codex", ".agents", ".tmp", ".Temp", "cache", "snapshots", "encoding_backup", "encoding_backup_20261024")

function Test-ExcludedPath {
    param([string]$RelativePath)
    # Match any path segment, not only the first one. Third-party trees such as
    # BioanalysDesktop/node_modules ship CRLF by design on Windows and are not
    # ours to rewrite.
    foreach ($segment in ($RelativePath -split "[\\/]")) {
        if ($ExcludeDirs -contains $segment) { return $true }
    }
    return $false
}
$BinaryExtensions = @(".rds", ".h5ad", ".h5", ".png", ".jpg", ".jpeg", ".pdf", ".zip", ".gz", ".tar", ".RData", ".rda", ".xlsx", ".docx", ".exe", ".dll", ".apk", ".so", ".o")

$SkipDir = {
    param([string]$DirectoryName)
    return $ExcludeDirs -contains $DirectoryName
}

function Test-Utf8Bom {
    param([byte[]]$Bytes)
    return ($Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF)
}

function Test-AnyBom {
    param([byte[]]$Bytes)
    if ($Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF) { return "UTF8" }
    if ($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFF -and $Bytes[1] -eq 0xFE) { return "UTF16LE" }
    if ($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFE -and $Bytes[1] -eq 0xFF) { return "UTF16BE" }
    return ""
}

function Get-LineEndingKind {
    param([byte[]]$Bytes)
    $crlf = 0
    $loneCr = 0
    $loneLf = 0
    for ($i = 0; $i -lt $Bytes.Length; $i++) {
        if ($Bytes[$i] -eq 0x0D) {
            if ($i + 1 -lt $Bytes.Length -and $Bytes[$i + 1] -eq 0x0A) {
                $crlf++
                $i++
            } else {
                $loneCr++
            }
        } elseif ($Bytes[$i] -eq 0x0A) {
            $loneLf++
        }
    }
    if ($crlf -gt 0 -and ($loneLf -gt 0 -or $loneCr -gt 0)) { return "MIXED" }
    if ($crlf -gt 0) { return "CRLF" }
    if ($loneLf -gt 0 -or $loneCr -gt 0) { return "LF" }
    return "NONE"
}

function Test-StrictUtf8 {
    param([byte[]]$Bytes)
    try {
        $strict = New-Object System.Text.UTF8Encoding($false, $true)
        [void]$strict.GetString($Bytes)
        return $true
    } catch {
        return $false
    }
}

function Get-GbkLikeness {
    param([byte[]]$Bytes)
    $highBytePairs = 0
    $highByteSingles = 0
    for ($i = 0; $i -lt $Bytes.Length; $i++) {
        if ($Bytes[$i] -ge 0x81 -and $Bytes[$i] -le 0xFE) {
            if ($i + 1 -lt $Bytes.Length -and $Bytes[$i + 1] -ge 0x40 -and $Bytes[$i + 1] -le 0xFE) {
                $highBytePairs++
                $i++
            } else {
                $highByteSingles++
            }
        }
    }
    if ($highBytePairs -eq 0) { return 0.0 }
    return [math]::Round($highBytePairs / [double]($highBytePairs + $highByteSingles), 4)
}

$records = New-Object System.Collections.Generic.List[object]
$scannedFiles = 0
$skippedBinary = 0
$skippedLarge = 0
$excludedSeen = @{}

$allFiles = Get-ChildItem -Path $Root -Recurse -File -Force
foreach ($file in $allFiles) {
    $relative = $file.FullName.Substring($Root.Length).TrimStart("\", "/")
    $topSegment = ($relative -split "[\\/]")[0]
    if (Test-ExcludedPath $relative) {
        $excludeKey = if ($topSegment) { $topSegment } else { "(root)" }
        if (-not $excludedSeen.ContainsKey($excludeKey)) {
            $excludedSeen[$excludeKey] = 0
        }
        $excludedSeen[$excludeKey] = $excludedSeen[$excludeKey] + 1
        continue
    }

    $extension = [System.IO.Path]::GetExtension($file.Name).ToLower()
    if ($BinaryExtensions -contains $extension) {
        $skippedBinary++
        continue
    }
    if ($file.Length -gt $MaxScanBytes) {
        $skippedLarge++
        continue
    }

    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    $scannedFiles++

    $bomKind = Test-AnyBom -Bytes $bytes
    $lineEnding = Get-LineEndingKind -Bytes $bytes
    $isStrictUtf8 = Test-StrictUtf8 -Bytes $bytes
    $encoding = if ($isStrictUtf8) { "UTF8" } else { "NON_UTF8" }
    $gbkLikeness = if ($isStrictUtf8) { 0.0 } else { Get-GbkLikeness -Bytes $bytes }

    $needsAction = @()
    if ($bomKind -eq "UTF8") { $needsAction += "strip_bom" }
    if ($bomKind -eq "UTF16LE" -or $bomKind -eq "UTF16BE") { $needsAction += "convert_utf16" }
    if ($lineEnding -eq "CRLF") { $needsAction += "crlf_to_lf" }
    if ($lineEnding -eq "MIXED") { $needsAction += "normalize_mixed_line_ending" }
    if ($encoding -eq "NON_UTF8" -and $gbkLikeness -ge 0.6) { $needsAction += "gbk_to_utf8" }
    elseif ($encoding -eq "NON_UTF8") { $needsAction += "encoding_needs_manual_review" }

    $topDir = if ($topSegment) { $topSegment } else { "(root)" }
    $priority = switch -Regex ($relative) {
        "^[\\/]?(src|ops|BioanalysDesktop)[\\/]" { if ($needsAction.Count -gt 0) { "P0" } else { "OK" } }
        "^[\\/]?reference[\\/]" { if ($needsAction.Count -gt 0) { "P2" } else { "OK" } }
        "^[\\/]?docs[\\/]" { if ($needsAction.Count -gt 0) { "P3" } else { "OK" } }
        default { if ($needsAction.Count -gt 0) { "P3" } else { "OK" } }
    }

    $records.Add([pscustomobject]@{
        Priority = $priority
        RelativePath = $relative
        TopDir = $topDir
        Encoding = $encoding
        GbkLikeness = $gbkLikeness
        BomKind = if ($bomKind) { $bomKind } else { "none" }
        LineEnding = $lineEnding
        Bytes = $file.Length
        Actions = ($needsAction -join "|")
    })
}

$actionable = $records | Where-Object { $_.Actions -ne "" } | Sort-Object Priority, RelativePath
$detailPath = Join-Path $DocsDir "encoding-audit-detail.tsv"
$detailLines = New-Object System.Collections.Generic.List[string]
$detailLines.Add("priority`trelative_path`tencoding`tgbk_likeness`tbom`tline_ending`tbytes`tactions")
foreach ($record in $actionable) {
    $detailLines.Add(
        ($record.Priority + "`t" + $record.RelativePath + "`t" + $record.Encoding + "`t" +
         $record.GbkLikeness + "`t" + $record.BomKind + "`t" + $record.LineEnding + "`t" +
         $record.Bytes + "`t" + $record.Actions)
    )
}
[System.IO.File]::WriteAllBytes($detailPath, [System.Text.Encoding]::UTF8.GetBytes(($detailLines -join "`n")))

$byTopDir = $records | Group-Object TopDir | Sort-Object Name
$report = New-Object System.Collections.Generic.List[string]
$report.Add("# Encoding audit report")
$report.Add("")
$report.Add("Scanned at: " + (Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz"))
$report.Add("Root: " + $Root)
$report.Add("Excluded top-level dirs: " + ($ExcludeDirs -join ", "))
$report.Add("Skipped binary by extension: " + $skippedBinary)
$report.Add("Skipped files over " + $MaxScanBytes + " bytes: " + $skippedLarge)
$report.Add("Files scanned: " + $scannedFiles)
$report.Add("Files needing action: " + $actionable.Count)
$report.Add("")
$report.Add("## Per top-level directory")
$report.Add("")
$report.Add("| directory | files | needing action |")
$report.Add("| --- | --- | --- |")
foreach ($group in $byTopDir) {
    $needs = ($group.Group | Where-Object { $_.Actions -ne "" }).Count
    $report.Add("| " + $group.Name + " | " + $group.Count + " | " + $needs + " |")
}
$report.Add("")
$report.Add("## Action totals")
$report.Add("")
$actionCounts = @{}
foreach ($record in $actionable) {
    foreach ($action in ($record.Actions -split "\|")) {
        if (-not $actionCounts.ContainsKey($action)) { $actionCounts[$action] = 0 }
        $actionCounts[$action] = $actionCounts[$action] + 1
    }
}
foreach ($key in ($actionCounts.Keys | Sort-Object)) {
    $report.Add("- " + $key + ": " + $actionCounts[$key])
}
$report.Add("")
$report.Add("## Priority counts")
$report.Add("")
foreach ($priority in @("P0", "P2", "P3")) {
    $count = ($actionable | Where-Object { $_.Priority -eq $priority }).Count
    $report.Add("- " + $priority + ": " + $count)
}
$report.Add("")
$report.Add("## Detail")
$report.Add("")
$report.Add("Full list in encoding-audit-detail.tsv. Priority P0 covers src, ops and")
$report.Add("BioanalysDesktop, which affect the dual-plane runtime directly. P2 covers")
$report.Add("reference material. P3 covers docs and root files. Rows with action")
$report.Add("encoding_needs_manual_review are non-UTF8 but do not look like GBK, so")
$report.Add("converting them blind would risk data loss; review those first.")
$report.Add("")
$report.Add("## Notes")
$report.Add("")
$report.Add("Encoding detection uses strict UTF-8 decoding. Files that fail are then")
$report.Add("scored for GBK likeness by counting high-byte pairs, which is a heuristic,")
$report.Add("not a proof. Treat the manual-review rows as unverified.")

$reportPath = Join-Path $DocsDir "encoding-audit-report.md"
[System.IO.File]::WriteAllBytes($reportPath, [System.Text.Encoding]::UTF8.GetBytes(($report -join "`n")))

Write-Output "report=$reportPath"
Write-Output "detail=$detailPath"
Write-Output "scanned=$scannedFiles needing_action=$($actionable.Count) skipped_binary=$skippedBinary skipped_large=$skippedLarge"
foreach ($key in ($actionCounts.Keys | Sort-Object)) {
    Write-Output ("action " + $key + " = " + $actionCounts[$key])
}
exit 0
