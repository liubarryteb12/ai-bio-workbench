<#
  tools/ops/04_check_logs.ps1  —  台账隔离校验的 PC 侧一键入口

  内部流程：scp tools/ops/03_check_logs_remote.sh -> 容器 /tmp -> ssh 执行 -> 传回退出码
  用途：在本地一条命令完成 /mnt/ssd/bio_data/system_logs/ 的台账合法性校验。

  校验项（详见 tools/ops/03_check_logs_remote.sh 与 docs/ledger-schema.md）：
    [1] line_id 枚举合法
    [2] io_files 路径不跨线
    [3] io_files.output 不写 public_references
    [4] checkpoint_status=passed 时 random_seed 必须有值

  用法：  pwsh -File tools/ops/04_check_logs.ps1 [-LogsDir <服务器上日志目录>]
  退出码：0 = 全部合法（或无 JSON 文件）；1 = 有违规 / 链路不通 / scp 失败
#>
[CmdletBinding()]
param(
  [string]$RemoteHost = 'k40-ubuntu',
  # 待校验的日志目录，默认指向 SSD 数据面；数据面未挂载时脚本会明确报错而不静默
  [string]$LogsDir = '/mnt/ssd/bio_data/system_logs',
  # 服务器侧中转目录（不用 Termux home，proot 读不到，见 tools/ops/README.md 已知限制）
  [string]$RemoteTmp = '/tmp'
)

$ErrorActionPreference = 'Continue'

# 修 2026-10-20：pwsh 的 Console::OutputEncoding 在中文 Windows 上是 gb2312，
# 从 ssh 读远端 UTF-8 输出（如 03 脚本的「总体 = PASS」）会按 GBK 解码成乱码，
# 导致下面的 verdict 正则失配、明明 PASS 也 exit 1（今日实测踩到）。
# 双保险：① 统一按 UTF-8 读（显示也恢复正常）；② verdict 判定只匹配 ASCII 部分。
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$localScript = Join-Path $PSScriptRoot '03_check_logs_remote.sh'
if (-not (Test-Path $localScript)) {
  Write-Host '[logs] FAIL 本地缺少 03_check_logs_remote.sh' -ForegroundColor Red
  exit 1
}

$remoteScript = "$RemoteTmp/03_check_logs_remote.sh"

# --- 1. 传脚本（scp 覆盖写，勿追加） ---
$scpOut = & scp -o ConnectTimeout=10 $localScript "${RemoteHost}:$remoteScript" 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host '[logs] FAIL scp 失败（链路不通？先跑 tools/ops/00_link_check.ps1）' -ForegroundColor Red
  $scpOut | ForEach-Object { Write-Host "  $_" }
  exit 1
}

# --- 2. 远端执行，stdout+stderr 一起收回 ---
# 首连接 known_hosts warning 会混入输出（坑#90），用黑名单排除 ssh/scp 自己的噪声，
# 校验脚本的输出一律展示，不做白名单过滤，避免吞掉 03 脚本给出的排查提示。
$raw = & ssh -o ConnectTimeout=10 -o BatchMode=yes $RemoteHost "bash $remoteScript '$LogsDir'" 2>&1
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

$lines | ForEach-Object { Write-Host $_ }

# --- 3. 汇总结论 ---
# 按 03 脚本的结论行判定，不依赖 ssh 退出码透传（退出码会被 warning 与非零行干扰）；
# 也不假定它在输出末尾：直接找 "= PASS/FAIL" 结论行，找不到即视为校验没跑完。
# 注意（2026-10-20 修）：只匹配 ASCII 的 "= PASS/FAIL"，不匹配中文「总体」——
# pwsh 读 ssh 输出时中文可能因 Console::OutputEncoding=gb2312 解码错位。
$verdict = $lines | Where-Object { $_ -match '=\s*(PASS|FAIL)' } | Select-Object -Last 1
if ($verdict -and $verdict -match '=\s*PASS') {
  Write-Host ''
  Write-Host '[logs] PASS' -ForegroundColor Green
  exit 0
} else {
  Write-Host ''
  if (-not $verdict) {
    Write-Host '[logs] FAIL 未拿到校验结论行（链路异常或远端脚本未跑完？先跑 tools/ops/00_link_check.ps1）' -ForegroundColor Red
  } else {
    Write-Host '[logs] FAIL（见上文 VIOLATION）' -ForegroundColor Red
  }
  exit 1
}
