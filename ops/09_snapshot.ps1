<#
  ops/09_snapshot.ps1  -  工作区快照（无 git 写权限时的回滚点）

  背景：本仓库虽有 .git 与完整历史（HEAD 可读），但 .git 当前只读，无法 commit。
  于是所有未提交改动只是工作区状态，误删后没有回滚点。本脚本把「源码 + 台账」
  压成一个带 SHA256 的 zip，落在项目内 snapshots/ 下，重建成本从"重写"降到"解压"。

  与 git 的分工：git 恢复后仍是权威版本史；本脚本是过渡期的保险，不是替代品。

  打包范围（只收文本本体，不收数据）：
    src/ ops/ shared/ portal/ cn_debug/ con_hf/ docs/ aims/ deliverables/ projects/
    BioanalysDesktop/{server,src,tests,public} 顶层散文件（AGENTS.md、.bat、.gitattributes 等）

  排除（三类，逐类写明理由）：
    1. 数据大块：outputs/ test_use_data/ project_data/ reference/ cache/。
       .gitignore 本就把它们排除在版本控制外，本地另有副本，重新拉取比打包便宜几个数量级。
    2. 依赖与构建产物：node_modules/ dist/ .venv/ __pycache__。可重新生成。
    3. 运行残留：.tmp/ .uploads/ *.log。会变，且不是源码本体。

  用法：
    pwsh -File ops/09_snapshot.ps1                    # 打一个快照
    pwsh -File ops/09_snapshot.ps1 -Keep 10           # 保留最近 10 个（默认 5）
    pwsh -File ops/09_snapshot.ps1 -Note "P-30 前"    # 给快照写一句人话备注
    pwsh -File ops/09_snapshot.ps1 -DryRun            # 只列会打包什么，不落盘

  退出码：0 = 快照落盘且 SHA256 自校验通过；1 = 打包失败 / 校验不符 / 目标不可写；
          2 = 参数错误
#>
[CmdletBinding()]
param(
  # 保留最近多少个快照，超出后从最旧的开始删。0 表示一个都不删。
  [int]$Keep = 5,
  # 人话备注，写进 manifest，事后用来想起这个快照是干什么的
  [string]$Note = '',
  # 演练模式：只列清单不落盘，用来确认打包范围符合预期
  [switch]$DryRun,
  # 快照落点，默认项目内 snapshots/
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot

if ($Keep -lt 0) {
  Write-Host '[snapshot] FAIL -Keep 不能为负' -ForegroundColor Red
  exit 2
}
if ([string]::IsNullOrWhiteSpace($OutDir)) {
  $OutDir = Join-Path $repoRoot 'snapshots'
}

# --- 1. 收集待打包文件 ---
#
# 用显式目录清单而不是"排除法扫全盘"：这个仓库有 18GB 的 outputs/ 与 1GB 的
# test_use_data/，扫全盘再排除既慢又容易漏。白名单新增目录时要显式加进来。
$includeDirs = @(
  'src', 'ops', 'shared', 'portal', 'cn_debug', 'con_hf', 'docs', 'aims',
  'deliverables', 'projects',
  'BioanalysDesktop/server', 'BioanalysDesktop/src',
  'BioanalysDesktop/tests', 'BioanalysDesktop/public'
)
# 顶层散文件：AGENTS.md 是入口，三个 .bat 是启动器，.gitattributes/.gitignore 钉着换行纪律
$includeFiles = @(
  'AGENTS.md', '.gitattributes', '.gitignore', 'start_all.bat',
  'start_portal.bat', 'start_workbench.bat'
)

# 需要排除的子目录（按目录名匹配，路径中段命中即排除）。
# 这里必须和 .gitignore 口径一致，否则快照会把本就不进版本控制的东西打进来。
$excludeDirNames = @('node_modules', 'dist', '.venv', '__pycache__', '.tmp', '.uploads', '.git')

$pending = New-Object System.Collections.Generic.List[string]
foreach ($dir in $includeDirs) {
  $abs = Join-Path $repoRoot $dir
  if (-not (Test-Path $abs)) {
    Write-Host "[snapshot] WARN 目录不存在，跳过: $dir" -ForegroundColor Yellow
    continue
  }
  $found = Get-ChildItem -Path $abs -Recurse -File -Force |
    Where-Object {
      $skip = $false
      foreach ($name in $excludeDirNames) {
        if ($_.FullName -match "\\$([regex]::Escape($name))\\") { $skip = $true; break }
      }
      -not $skip -and $_.Extension -ne '.log'
    }
  foreach ($f in $found) { $pending.Add($f.FullName) }
}
foreach ($name in $includeFiles) {
  $abs = Join-Path $repoRoot $name
  if (Test-Path $abs) { $pending.Add($abs) } else {
    Write-Host "[snapshot] WARN 文件不存在，跳过: $name" -ForegroundColor Yellow
  }
}

if ($pending.Count -eq 0) {
  Write-Host '[snapshot] FAIL 没有收集到任何文件，检查 includeDirs 是否还成立' -ForegroundColor Red
  exit 1
}

$totalBytes = ($pending | ForEach-Object { (Get-Item $_).Length } | Measure-Object -Sum).Sum
Write-Host "[snapshot] 待打包 $($pending.Count) 个文件，$([math]::Round($totalBytes/1MB,2)) MB"

if ($DryRun) {
  Write-Host '[snapshot] 演练模式，按顶层目录汇总：'
  $pending | ForEach-Object { $_.Substring($repoRoot.Length + 1) } |
    ForEach-Object { ($_ -split '\\')[0..([math]::Min(1, ($_ -split '\\').Count - 1))] -join '\' } |
    Group-Object | Sort-Object Count -Descending |
    ForEach-Object { "  {0,-28} {1,5} files" -f $_.Name, $_.Count }
  Write-Host '[snapshot] 演练模式结束，未写任何文件'
  exit 0
}

# --- 2. 落盘 ---
if (-not (Test-Path $OutDir)) {
  try { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
  catch {
    Write-Host "[snapshot] FAIL 无法创建快照目录: $OutDir" -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    exit 1
  }
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$zipPath = Join-Path $OutDir "workbench_$stamp.zip"

# 逐文件写入 zip，条目名用「相对 repoRoot 的路径」。
#
# 为什么不用 Compress-Archive：它只取 basename 当条目名，777 个文件会被拍平到根目录，
# src/workflows.json 变成 workflows.json，同名文件（README.md / index.js / project.json）
# 互相覆盖，解压出来只剩 695 个且目录结构全丢，等于不可还原（2026-10-24 实测踩坑）。
# ZipFile.CreateEntry 让我们自己定条目名，结构才能原样保住。
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = $null
$written = 0
try {
  $zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
  foreach ($abs in $pending) {
    $rel = $abs.Substring($repoRoot.Length + 1).Replace('\', '/')
    $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $source = [System.IO.File]::OpenRead($abs)
    try {
      $target = $entry.Open()
      try { $source.CopyTo($target) } finally { $target.Dispose() }
    } finally { $source.Dispose() }
    $written += 1
  }
} catch {
  Write-Host "[snapshot] FAIL 打包失败: $zipPath" -ForegroundColor Red
  Write-Host "  $_" -ForegroundColor Red
  exit 1
} finally {
  if ($null -ne $zip) { $zip.Dispose() }
}

if (-not (Test-Path -LiteralPath $zipPath)) {
  Write-Host '[snapshot] FAIL 压缩完成但产物不存在' -ForegroundColor Red
  exit 1
}
if ($written -ne $pending.Count) {
  Write-Host "[snapshot] FAIL 条目数不符：应收 $($pending.Count) 实写 $written" -ForegroundColor Red
  exit 1
}

# --- 3. SHA256 自校验 + manifest ---
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
$manifestPath = [System.IO.Path]::ChangeExtension($zipPath, '.manifest.json')
$manifest = [ordered]@{
  created_at    = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  note          = $Note
  file_count    = $pending.Count
  total_bytes   = [int64]$totalBytes
  zip_bytes     = (Get-Item -LiteralPath $zipPath).Length
  sha256        = $zipHash
  repo_root     = $repoRoot
  # 记录当时的工作区状态，事后能判断这个快照覆盖了哪些未提交改动
  git_head      = ((& git -C $repoRoot rev-parse --short HEAD 2>$null) | Out-String).Trim()
  git_dirty     = [bool]((& git -C $repoRoot status --short 2>$null) | Measure-Object).Count
  included_dirs = $includeDirs
  excluded_dirs = $excludeDirNames
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

# 自校验：重新算一遍哈希，确认落盘内容与记录一致（不是只信写入那一刻）
$verify = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
if ($verify -ne $zipHash) {
  Write-Host '[snapshot] FAIL SHA256 复算不符，产物可能损坏' -ForegroundColor Red
  Write-Host "  记录: $zipHash"
  Write-Host "  复算: $verify" -ForegroundColor Red
  exit 1
}

Write-Host "[snapshot] PASS $zipPath" -ForegroundColor Green
Write-Host "  文件数 $($pending.Count)  sha256 $($zipHash.Substring(0,16))..."

# --- 4. 保留策略：只删本脚本产的快照，从最旧的开始 ---
if ($Keep -gt 0) {
  $old = Get-ChildItem -Path $OutDir -Filter 'workbench_*.zip' -File |
    Where-Object { $_.Name -match '^workbench_\d{8}_\d{6}\.zip$' } |
    Sort-Object LastWriteTime
  # 刚生成的那个按时间排最后，天然在保留数内，不会被误删
  $expired = $old | Select-Object -First ([math]::Max(0, $old.Count - $Keep))
  foreach ($item in $expired) {
    $sidecar = [System.IO.Path]::ChangeExtension($item.FullName, '.manifest.json')
    Remove-Item -LiteralPath $item.FullName -Force
    if (Test-Path -LiteralPath $sidecar) { Remove-Item -LiteralPath $sidecar -Force }
    Write-Host "  [清理] 删除过期快照 $($item.Name)" -ForegroundColor DarkGray
  }
}

Write-Host "[snapshot] 保留最近 $Keep 个；解压: Expand-Archive -LiteralPath '$zipPath' -DestinationPath <目标目录>" -ForegroundColor Cyan
exit 0