# 用途：按扫描清单执行编码整顿。默认只处理 P0 生产代码，--all 扩展到全部。
#
# 设计要点：
#   1. 一律用字节流读写，不经过 Get-Content 与 Set-Content，避免 PowerShell
#       silently 改编码或改行尾。
#   2. 每个文件转换前备份到 ops/encoding_backup/<原始相对路径>。
#   3. 转换是幂等的，重复跑第二次全部 SKIP。
#   4. GBK 判定沿用扫描器的 gbk_likeness 阈值，低于阈值的一律不碰，转人工。
#
# 用法：
#   pwsh -File ops/fix_encoding.ps1              # 只处理 P0
#   pwsh -File ops/fix_encoding.ps1 -WhatIf      # 预演，不写盘
#   pwsh -File ops/fix_encoding.ps1 -All         # 处理 P0 加 P2 加 P3

param(
    [switch]$All,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DetailPath = Join-Path $Root "docs\encoding-audit-detail.tsv"
$BackupRoot = Join-Path $Root "ops\encoding_backup"

if (-not (Test-Path $DetailPath)) {
    Write-Output "detail_not_found=$DetailPath run scan_encoding.ps1 first"
    exit 2
}

$targets = Import-Csv -Path $DetailPath -Delimiter "`t"
if (-not $All) {
    $targets = $targets | Where-Object { $_.priority -eq "P0" }
}

$gbkEncoding = [System.Text.Encoding]::GetEncoding(936)

function Convert-ToLfBytes {
    param([byte[]]$Bytes)
    $out = New-Object System.Collections.Generic.List[byte]
    for ($i = 0; $i -lt $Bytes.Length; $i++) {
        if ($Bytes[$i] -eq 0x0D) { continue }
        $out.Add($Bytes[$i])
    }
    return $out.ToArray()
}

function Convert-GbkToUtf8Lf {
    param([byte[]]$Bytes)
    $text = $gbkEncoding.GetString($Bytes)
    $normalized = $text -replace "`r`n", "`n"
    $normalized = $normalized -replace "`r", "`n"
    return [System.Text.Encoding]::UTF8.GetBytes($normalized)
}

function Strip-Bom {
    param([byte[]]$Bytes)
    if ($Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF) {
        return $Bytes[3..($Bytes.Length - 1)]
    }
    return $Bytes
}

$converted = 0
$skipped = 0
$failed = 0

foreach ($row in $targets) {
    $relative = $row.relative_path
    $actions = $row.actions
    if ([string]::IsNullOrWhiteSpace($actions)) { continue }
    if ($actions -like "*encoding_needs_manual_review*") {
        Write-Output "MANUAL_REVIEW_SKIP $relative"
        $skipped++
        continue
    }

    $full = Join-Path $Root $relative
    if (-not (Test-Path -LiteralPath $full)) {
        Write-Output "MISSING $relative"
        $skipped++
        continue
    }

    $original = [System.IO.File]::ReadAllBytes($full)
    $before = $original.Length
    $bytes = $original

    $needsGbk = $actions -like "*gbk_to_utf8*"
    $needsLf = ($actions -like "*crlf_to_lf*") -or ($actions -like "*normalize_mixed_line_ending*")
    $needsBom = $actions -like "*strip_bom*"

    try {
        if ($needsGbk) {
            $bytes = Convert-GbkToUtf8Lf -Bytes $bytes
        } elseif ($needsLf) {
            $bytes = Convert-ToLfBytes -Bytes $bytes
        }
        if ($needsBom) {
            $bytes = Strip-Bom -Bytes $bytes
        }
    } catch {
        Write-Output "CONVERT_ERROR $relative : $($_.Exception.Message)"
        $failed++
        continue
    }

    $unchanged = ($bytes.Length -eq $before)
    if ($unchanged) {
        for ($i = 0; $i -lt $before; $i++) {
            if ($bytes[$i] -ne $original[$i]) { $unchanged = $false; break }
        }
    }
    if ($unchanged) {
        Write-Output "ALREADY_CLEAN $relative"
        $skipped++
        continue
    }

    if ($WhatIf) {
        Write-Output "WOULD_CONVERT $relative ($before -> $($bytes.Length) bytes)"
        $converted++
        continue
    }

    $backup = Join-Path $BackupRoot $relative
    $backupDir = Split-Path -Parent $backup
    if (-not (Test-Path -LiteralPath $backupDir)) {
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    }
    if (-not (Test-Path -LiteralPath $backup)) {
        [System.IO.File]::WriteAllBytes($backup, $original)
    }

    [System.IO.File]::WriteAllBytes($full, $bytes)

    $verify = [System.IO.File]::ReadAllBytes($full)
    $crCount = 0
    foreach ($b in $verify) { if ($b -eq 0x0D) { $crCount++ } }
    if (($crCount -gt 0) -and $needsLf) {
        Write-Output "VERIFY_CR_REMAIN $relative cr=$crCount"
        $failed++
        continue
    }

    Write-Output "CONVERTED $relative ($before -> $($bytes.Length) bytes)"
    $converted++
}

Write-Output "SUMMARY converted=$converted skipped=$skipped failed=$failed total=$($targets.Count)"
if ($failed -gt 0) { exit 1 }
exit 0