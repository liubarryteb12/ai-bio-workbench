<#
  ops/07_pull_outputs.ps1  —  产出回搬通道（服务器 -> 本地电脑）

  背景：计算全部在手机 Linux 服务器端完成，本地是零算力交互终端。用户拍板：
  分析产物（processed/ results/ figures/ 下的文件）与任务台账（system_logs/）必须
  回搬到本地电脑存档，服务器只保留运行态正本。本脚本是这条回搬通道：
    服务器 /mnt/ssd/bio_data/projects/<项目>/<line>/{processed,results,figures}/*
        ->  本地 outputs/<项目>/<line>/{processed,results,figures}/
    服务器 /mnt/ssd/bio_data/system_logs/*.json
        ->  本地 outputs/system_logs/

  与 ops/05 / 06 同模式（ssh alive 探测 + scp + 逐文件字节校验），但跳过规则不同：
  **本地已存在且字节数与远端一致 → 跳过；字节数不同 → 覆盖**（同名不同内容必须刷新，
  否则本地存档会长期停留在旧副本上，V 类验收读本地会被误导——2026-10-19 实测踩到：
  远端 wgcna_module_trait.tsv 已从 40 模块的 2371B 变成 20 模块的 956B，
  本地同名副本因"存在即跳过"一直没更新）。-Force 表示字节数相同也重拉。

  用法：  pwsh -File ops/07_pull_outputs.ps1 [-Project default] [-Line line2_scrna] [-Force]
         -Project 项目 ID（默认 default），回搬该项目下的产物
         -Line    只回搬一条线（line1_bulk / line2_scrna / line3_spatial），不带则三线全量 + system_logs
         -Force   字节数相同也重拉（默认只重拉远端已更新的文件）
  退出码：0 = 全部回搬且字节校验通过；1 = 链路失败 / scp 失败 / 校验不符
#>
[CmdletBinding()]
param(
  [string]$Line = '',
  [string]$Project = 'default',
  [switch]$Force,
  [string]$SsdRoot = '/mnt/ssd/bio_data',
  [string]$LocalRoot = ''
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
if ($LocalRoot -eq '') { $LocalRoot = Join-Path $repoRoot 'outputs' }

# 项目 ID 校验（与后端 server/domain.js 的 sanitizeProjectId 同规则）
if ($Project -notmatch '^[A-Za-z0-9._-]{1,64}$' -or $Project.StartsWith('.')) {
  Write-Host "[pull] FAIL -Project 非法: $Project（只允许字母数字 . _ -，不以 . 开头）" -ForegroundColor Red
  exit 1
}
$projectRoot = "$SsdRoot/projects/$Project"

$validLines = @('line1_bulk', 'line2_scrna', 'line3_spatial')
if ($Line -ne '') {
  if ($validLines -notcontains $Line) {
    Write-Host "[pull] FAIL -Line 非法: $Line，只能是 $($validLines -join ' / ')" -ForegroundColor Red
    exit 1
  }
  $lines = @($Line)
} else {
  $lines = $validLines
}

# ssh 输出是多行数组，-match 对集合返回匹配元素而非布尔，必须显式收敛（坑 #94）
function Test-SshAlive([string]$HostAlias) {
  $out = & ssh -o ConnectTimeout=10 -o BatchMode=yes $HostAlias 'echo SSH_OK' 2>&1
  return ($LASTEXITCODE -eq 0 -and [bool]($out | Where-Object { "$_" -match 'SSH_OK' }))
}

# --- 1. 确认链路 ---
$targetHost = 'k40-ubuntu'
if (-not (Test-SshAlive $targetHost)) {
  Write-Host '[pull] FAIL 容器 ssh 不通（先跑 ops/00_link_check.ps1）' -ForegroundColor Red
  exit 1
}

# --- 2. 列远端产物清单：项目内三线 processed/ + results/ + figures/ 一级文件 + system_logs 台账 ---
# 清单带字节数（find -printf '%s\t%p'），跳过规则要按"同名且同大小"判定，光有路径不够。
$pending = @()
foreach ($line in $lines) {
  foreach ($sub in @('processed', 'results', 'figures')) {
    $remoteDir = "$projectRoot/$line/$sub"
    $out = & ssh -o ConnectTimeout=10 -o BatchMode=yes $targetHost "find '$remoteDir' -maxdepth 1 -type f -printf '%s\t%p\n' 2>/dev/null" 2>&1
    $files = @($out | Where-Object { "$_" -match "^(\d+)\t$remoteDir/" })
    if ($files.Count -eq 0) {
      Write-Host "[pull] WARN $Project/$line/$sub 无文件，跳过" -ForegroundColor Yellow
      continue
    }
    foreach ($f in $files) {
      $parts = "$f".Trim() -split "`t"
      $pending += [pscustomobject]@{
        Remote = $parts[1]
        Size   = [int64]$parts[0]
        Local  = Join-Path $LocalRoot "$Project/$line/$sub/$(Split-Path -Leaf $parts[1])"
      }
    }
  }
}
$logOut = & ssh -o ConnectTimeout=10 -o BatchMode=yes $targetHost "find '$SsdRoot/system_logs' -maxdepth 1 -type f -name '*.json' -printf '%s\t%p\n' 2>/dev/null" 2>&1
foreach ($f in @($logOut | Where-Object { "$_" -match "^(\d+)\t.*\.json$" })) {
  $parts = "$f".Trim() -split "`t"
  $pending += [pscustomobject]@{
    Remote = $parts[1]
    Size   = [int64]$parts[0]
    Local  = Join-Path $LocalRoot "system_logs/$(Split-Path -Leaf $parts[1])"
  }
}

if ($pending.Count -eq 0) {
  Write-Host '[pull] 远端没有可回搬的文件，退出'
  exit 0
}

# --- 3. 增量判定：不存在→拉；同名同大小→跳过；同名不同大小→覆盖（-Force：同名同大小也拉）---
$todo = @(); $nNew = 0; $nSame = 0; $nStale = 0
foreach ($item in $pending) {
  if (-not (Test-Path $item.Local)) { $nNew++; $todo += $item; continue }
  $localSize = (Get-Item $item.Local).Length
  if ($localSize -eq $item.Size -and -not $Force) { $nSame++; continue }
  $nStale++; $todo += $item
}
Write-Host ("[pull] 清单 $($pending.Count) 个：新增 $nNew / 未变跳过 $nSame / 远端已更新需覆盖 $nStale")

if ($todo.Count -eq 0) {
  Write-Host '[pull] 没有待回搬文件（本地均为最新副本），退出'
  exit 0
}

# --- 4. scp 回搬 ---
Write-Host "[pull] 待回搬 $($todo.Count) 个文件，落 $LocalRoot"
$index = 0
$fail = 0
foreach ($item in $todo) {
  $index++
  $localDir = Split-Path -Parent $item.Local
  New-Item -ItemType Directory -Force -Path $localDir | Out-Null
  Write-Host "  [$index/$($todo.Count)] scp $($item.Remote)"
  & scp -o ConnectTimeout=10 "$($targetHost):$($item.Remote)" "$($item.Local)" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[pull] FAIL scp 失败: $($item.Remote)" -ForegroundColor Red
    $fail++
  }
}
if ($fail -gt 0) {
  Write-Host "[pull] FAIL $fail 个文件 scp 失败" -ForegroundColor Red
  exit 1
}

# --- 5. 字节校验（远端 stat 批量 vs 本地 Length）---
Write-Host '[pull] 校验回搬文件字节数...'
$remotePaths = ($todo | ForEach-Object { "'$($_.Remote)'" }) -join ' '
$statOut = & ssh -o ConnectTimeout=10 -o BatchMode=yes $targetHost "stat -c '%n %s' $remotePaths 2>/dev/null" 2>&1
$remoteSizes = @{}
foreach ($statLine in $statOut) {
  if ("$statLine" -match '^(.+) (\d+)$') { $remoteSizes[$Matches[1]] = [int64]$Matches[2] }
}
$mismatch = 0
foreach ($item in $todo) {
  $remoteSize = $remoteSizes[$item.Remote]
  $localSize = (Get-Item $item.Local).Length
  if ($null -eq $remoteSize -or $remoteSize -ne $localSize) {
    Write-Host "  [校验] SIZE_MISMATCH $(Split-Path -Leaf $item.Remote) 远端 $remoteSize vs 本地 $localSize" -ForegroundColor Red
    $mismatch++
  }
}
if ($mismatch -gt 0) {
  Write-Host "[pull] FAIL $mismatch 个文件校验不符" -ForegroundColor Red
  exit 1
}

$totalMb = [math]::Round((($todo | ForEach-Object { (Get-Item $_.Local).Length }) | Measure-Object -Sum).Sum / 1MB, 1)
Write-Host ''
Write-Host "[pull] PASS $($todo.Count) 个文件回搬至 $LocalRoot（合计 $totalMb MB，字节校验全过；其中远端已更新刷新 $nStale 个）" -ForegroundColor Green
exit 0
