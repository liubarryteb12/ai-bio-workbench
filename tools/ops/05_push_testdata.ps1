<#
  tools/ops/05_push_testdata.ps1  —  测试数据一键上盘（P1-2 预案的可执行形态）

  背景：test_use_data/ 三套可用 GEO 数据分别对应三条分析线，需进入
  /mnt/ssd/bio_data/<line>/raw_data/（目录约定见 docs/directories.md，每线四个子目录
  raw_data/processed/results/envs）。数据面就在手机自带存储上（用户 2026-10-13 拍板：
  不外挂 SSD，把手机当 Linux 服务器用），/mnt/ssd/bio_data 只是约定路径名，落在容器 eMMC。

  传输路径：本地 scp 经 ssh 隧道直送服务器目标目录，无中转。
  为什么不用 adb push + /sdcard 中转：容器（proot-distro）看不见 Android 的
  /sdcard 与 /storage（2026-10-13 实测，见踩坑台账 #95），而计算面就在容器里，
  数据最终必须落在容器可见的路径上。scp 走已有 ssh 别名，两个面都能直达。

  注意：数据面固定容器面（k40-ubuntu）。分析计算在容器内跑，底座 Termux 面的路径
  容器看不见（两个面的文件系统视图不同，坑 #95）。

  命名约定：Linux 系统内一律英文路径与文件名（用户约定）。本地 test_use_data/ 下的
  中文目录名是用户既有资产，不重命名；脚本用映射表集中引用，推到服务器的文件名
  统一换成英文（$RemoteNameMap）。本地改目录名只需改 $datasets 一处。

  用法：  pwsh -File tools/ops/05_push_testdata.ps1 [-Force] [-SsdRoot <服务器路径>]
         演练（不动真实数据面，目标必须是临时目录）：
         pwsh -File tools/ops/05_push_testdata.ps1 -Rehearse -SsdRoot /tmp/push_rehearsal
  退出码：0 = 三套数据全部就位且字节数校验通过
          1 = 链路不通 / 数据面不可写 / 目标已存在同名文件（未加 -Force）/ 字节校验不符
#>
[CmdletBinding()]
param(
  # 目标已存在同名文件时覆盖；不加则拒绝，守住"不自动覆盖用户文件"红线
  [switch]$Force,
  # 演练模式：SSD 未在位时把完整链路（建目录 → scp → 字节校验）在临时目录跑一遍，
  # 证明脚本逻辑本身可用，不用等硬件。演练禁止指向真实数据面，防止误写。
  [switch]$Rehearse,
  [string]$SsdRoot = '/mnt/ssd/bio_data'
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
$dataRoot = Join-Path $repoRoot 'test_use_data'

# 三套可用数据与三条线的映射（工作区盘点结论，计划 workspace/handoff/archive/2026-10-13_plan_goal全量推进.md 1.1 节）
# Source 是本地既有目录名（用户资产，不重命名），只在这张表里出现一次；
# Files 列本地文件名，推到 Linux 前按 $RemoteNameMap 换成英文名。
$datasets = @(
  @{
    Line   = 'line1_bulk'
    Source = '测试数据3（可用）'
    Files  = @('GPL11532-32230.txt', 'GSE277173_family.soft.gz', 'GSE277173_series_matrix.txt.gz', '分组情况.txt')
  }
  @{
    Line   = 'line2_scrna'
    Source = '测试数据4（可用-sc）'
    Files  = @('GPL21697_family.soft.gz', 'GSE254707_RAW.tar', '分组情况.txt')
  }
  @{
    Line   = 'line3_spatial'
    Source = '测试数据5（可用-spatial)'
    Files  = @('GPL24247_family.soft.gz', 'GPL24676_family.soft.gz', 'GSE192741_RAW.tar', '分组情况.txt')
  }
)

# Linux 系统内一律英文路径与文件名（用户约定）：本地中文文件名推到服务器前换成英文。
# 以后新增中文文件，在这里加一行映射即可，远端命名保持英文稳定。
$RemoteNameMap = @{
  '分组情况.txt' = 'grouping.txt'
}

function Get-RemoteName([string]$LocalName) {
  if ($RemoteNameMap.ContainsKey($LocalName)) { return $RemoteNameMap[$LocalName] }
  return $LocalName
}

# ssh 输出是多行数组，-match 对集合返回匹配元素而非布尔，必须显式收敛，
# 否则 warning 行混入时 truthy 判定会漂移（坑 #94）
function Test-SshAlive([string]$HostAlias) {
  $out = & ssh -o ConnectTimeout=10 -o BatchMode=yes $HostAlias 'echo SSH_OK' 2>&1
  return ($LASTEXITCODE -eq 0 -and [bool]($out | Where-Object { "$_" -match 'SSH_OK' }))
}

# --- 1. 确认数据面可达 ---
# 数据面在手机自带存储上（用户 2026-10-13 拍板：不外挂 SSD，把手机当 Linux 服务器用）。
# /mnt/ssd/bio_data 只是这个数据面的约定路径名，实际落在容器 eMMC 上。
# 这里只确认 ssh 链路通 + 目标可写，不再做挂载探测（早期外挂 SSD 方案的残留，坑 #96）。
$targetHost = $null
if ($Rehearse) {
  if ($SsdRoot -eq '/mnt/ssd/bio_data') {
    Write-Host '[push] FAIL 演练模式不得指向真实数据面 /mnt/ssd/bio_data，请用 -SsdRoot 指定临时目录' -ForegroundColor Red
    exit 1
  }
  if (-not (Test-SshAlive 'k40-ubuntu')) {
    Write-Host '[push] FAIL 容器 ssh 不通（先跑 tools/ops/00_link_check.ps1）' -ForegroundColor Red
    exit 1
  }
  $targetHost = 'k40-ubuntu'
  Write-Host "[push] 演练模式：跳过数据面检查，目标 $targetHost : $SsdRoot"
} else {
  Write-Host '[push] 确认数据面可达（容器 ssh + 目标可写）...'

  if (-not (Test-SshAlive 'k40-ubuntu')) {
    Write-Host '[push] FAIL 容器 ssh 不通（先跑 tools/ops/00_link_check.ps1）' -ForegroundColor Red
    exit 1
  }

  # 计算在容器内跑，数据面固定容器面；只确认根路径可创建可写
  $targetHost = 'k40-ubuntu'
  $probe = & ssh -o ConnectTimeout=10 -o BatchMode=yes $targetHost "mkdir -p '$SsdRoot' && [ -w '$SsdRoot' ] && echo WRITABLE || echo NOT_WRITABLE" 2>&1
  if ($LASTEXITCODE -ne 0 -or -not ($probe | Where-Object { "$_" -match 'WRITABLE' })) {
    Write-Host '[push] FAIL 数据面不可写：' -ForegroundColor Red
    $probe | ForEach-Object { Write-Host "  $_" }
    exit 1
  }
  Write-Host "  目标面: $targetHost，数据面 $SsdRoot 可写（手机自带存储）"
}

# --- 2. 建三线目录骨架（每线四个子目录，docs/directories.md 约定） ---
$mkdirScript = 'set -e; ' + (($datasets | ForEach-Object {
    "mkdir -p $SsdRoot/$($_.Line)/raw_data $SsdRoot/$($_.Line)/processed $SsdRoot/$($_.Line)/results $SsdRoot/$($_.Line)/envs"
  }) -join '; ') + "; mkdir -p $SsdRoot/public_references $SsdRoot/system_logs; echo DIRS_OK"

$mkdirOut = & ssh -o ConnectTimeout=10 -o BatchMode=yes $targetHost $mkdirScript 2>&1
if ($LASTEXITCODE -ne 0 -or -not ($mkdirOut | Where-Object { "$_" -match 'DIRS_OK' })) {
  Write-Host '[push] FAIL 服务器侧建目录失败：' -ForegroundColor Red
  $mkdirOut | ForEach-Object { Write-Host "  $_" }
  exit 1
}
Write-Host '[push] 三线目录骨架就位（raw_data/processed/results/envs + public_references + system_logs）'

# --- 3. 本地数据存在性预检 + 目标同名文件检查 ---
$pending = @()
foreach ($ds in $datasets) {
  $srcDir = Join-Path $dataRoot $ds.Source
  if (-not (Test-Path $srcDir)) {
    Write-Host "[push] FAIL 本地缺少数据目录: $srcDir" -ForegroundColor Red
    exit 1
  }
  foreach ($f in $ds.Files) {
    $local = Join-Path $srcDir $f
    if (-not (Test-Path $local)) {
      Write-Host "[push] FAIL 本地缺少文件: $local" -ForegroundColor Red
      exit 1
    }
    $remote = "$SsdRoot/$($ds.Line)/raw_data/$(Get-RemoteName $f)"
    $exists = & ssh -o ConnectTimeout=10 -o BatchMode=yes $targetHost "test -e '$remote' && echo EXISTS || echo ABSENT" 2>&1
    $existsFlag = [bool]($exists | Where-Object { "$_" -match 'EXISTS' })
    if ($existsFlag -and -not $Force) {
      Write-Host "[push] FAIL 目标已存在同名文件: $remote" -ForegroundColor Red
      Write-Host '  确认要覆盖请加 -Force；否则请先在服务器侧处理该文件。'
      exit 1
    }
    $pending += [pscustomobject]@{
      Line       = $ds.Line
      Local      = $local
      LocalName  = $f
      RemoteName = (Get-RemoteName $f)
      Remote     = $remote
      Bytes      = (Get-Item $local).Length
    }
  }
}

# --- 4. scp 直送目标目录（走 ssh 隧道，无中转） ---
$total = ($pending | Measure-Object -Property Bytes -Sum).Sum
Write-Host "[push] 待传输 $($pending.Count) 个文件，合计 $([math]::Round($total/1MB,1)) MB，scp 直送 $targetHost"

$index = 0
foreach ($item in $pending) {
  $index++
  $label = if ($item.LocalName -ne $item.RemoteName) { "$($item.LocalName) -> $($item.RemoteName)" } else { $item.LocalName }
  Write-Host "  [$index/$($pending.Count)] scp $label -> $($item.Line)/raw_data/"
  & scp -o ConnectTimeout=10 "$($item.Local)" "$($targetHost):$($item.Remote)" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[push] FAIL scp 失败: $($item.Local)" -ForegroundColor Red
    exit 1
  }
}

# --- 5. 字节数校验（逐文件比对本地与远端 stat 结果） ---
Write-Host '[push] 校验服务器侧文件字节数...'
$mismatch = 0
foreach ($item in $pending) {
  $r = & ssh -o ConnectTimeout=10 -o BatchMode=yes $targetHost "stat -c '%s' '$($item.Remote)' 2>/dev/null || echo MISSING" 2>&1
  $remoteBytes = ($r | Where-Object { "$_" -match '^\d+$' } | Select-Object -First 1)
  if (-not $remoteBytes) {
    Write-Host "  [校验] MISSING $($item.Remote)" -ForegroundColor Red
    $mismatch++
    continue
  }
  if ([int64]$remoteBytes -ne $item.Bytes) {
    Write-Host "  [校验] SIZE_MISMATCH $($item.Remote) 本地 $($item.Bytes) vs 远端 $remoteBytes" -ForegroundColor Red
    $mismatch++
  }
}

if ($mismatch -gt 0) {
  Write-Host ''
  Write-Host "[push] FAIL $mismatch 个文件校验不符" -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host "[push] PASS 三套数据全部就位并校验通过（目标 $SsdRoot/<line>/raw_data/）" -ForegroundColor Green
exit 0
