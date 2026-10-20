<#
  ops/08_migrate_to_projects.ps1  —  数据面迁移到项目结构的 PC 侧一键入口

  内部流程：scp ops/08_migrate_to_projects.sh -> 容器 /tmp -> ssh 执行 -> 传回退出码。
  迁移内容：顶层三线 line1_bulk/line2_scrna/line3_spatial -> projects/<项目>/
           脚本 bin/ 与环境声明 envs/ 提到顶层全局（所有项目共用一份）
           旧台账 io_files 路径加项目前缀 + 补 project_id

  幂等：已迁移（projects/<项目> 存在且顶层三线已不在）时直接报 ALREADY_MIGRATED 退出 0。

  用法：  pwsh -File ops/08_migrate_to_projects.ps1 [-Project default] [-SsdRoot <路径>]
  退出码：0 = 迁移完成或已迁移；1 = 链路失败 / 校验不符；2 = 前置条件不满足
#>
[CmdletBinding()]
param(
  [string]$RemoteHost = 'k40-ubuntu',
  [string]$SsdRoot = '/mnt/ssd/bio_data',
  [string]$Project = 'default',
  [string]$RemoteTmp = '/tmp'
)

$ErrorActionPreference = 'Continue'

# 项目 ID 校验（与 server/domain.js 的 sanitizeProjectId 同规则）
if ($Project -notmatch '^[A-Za-z0-9._-]{1,64}$' -or $Project.StartsWith('.')) {
  Write-Host "[migrate] FAIL -Project 非法: $Project" -ForegroundColor Red
  exit 2
}

$localScript = Join-Path $PSScriptRoot '08_migrate_to_projects.sh'
if (-not (Test-Path $localScript)) {
  Write-Host '[migrate] FAIL 本地缺少 08_migrate_to_projects.sh' -ForegroundColor Red
  exit 2
}
$remoteScript = "$RemoteTmp/08_migrate_to_projects.sh"

# --- 1. 传脚本 ---
$scpOut = & scp -o ConnectTimeout=10 $localScript "${RemoteHost}:$remoteScript" 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host '[migrate] FAIL scp 失败（链路不通？先跑 ops/00_link_check.ps1）' -ForegroundColor Red
  $scpOut | ForEach-Object { Write-Host "  $_" }
  exit 1
}

# --- 2. 远端执行（SSD_ROOT / PROJECT 经环境变量传入） ---
$raw = & ssh -o ConnectTimeout=10 -o BatchMode=yes $RemoteHost "SSD_ROOT='$SsdRoot' PROJECT='$Project' bash $remoteScript" 2>&1
$noise = @(
  'Warning: Permanently added',
  'Warning: Remote host identification has changed',
  'Warning: the RSA host key',
  'Pseudo-terminal will not be allocated',
  'TERM variable not set'
)
$lines = $raw | Where-Object {
  $line = "$_".TrimEnd()
  if ([string]::IsNullOrWhiteSpace($line)) { return $false }
  foreach ($n in $noise) { if ($line.StartsWith($n)) { return $false } }
  return $true
}
$lines | ForEach-Object { Write-Host "  $_" }

$exit = $LASTEXITCODE
if ($exit -eq 0) {
  Write-Host "[migrate] PASS 迁移完成或已迁移（项目 $Project）" -ForegroundColor Green
} else {
  Write-Host "[migrate] FAIL 退出码 $exit" -ForegroundColor Red
}
exit $exit
