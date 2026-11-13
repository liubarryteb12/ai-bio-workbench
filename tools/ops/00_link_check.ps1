<#
  tools/ops/00_link_check.ps1  —  链路连通自检（幂等，只读探测）

  逐段探测：本地 -> adb -> forward -> Termux sshd(8022) -> 容器 sshd(10022)
  任一环节失败时明确指出断在哪一段，exit code 非 0。

  用法：  pwsh -File tools/ops/00_link_check.ps1
  退出码：0 = 四段全通；1 = 有段落败（输出会指明环节）
#>
[CmdletBinding()]
param(
  [string]$Serial = $env:BIO_ADB_SERIAL,
  [string[]]$ForwardPairs = @('tcp:8022 tcp:8022', 'tcp:10022 tcp:10022')
)

$ErrorActionPreference = 'Continue'
$script:Failed = $false
$script:Warned = $false

function Write-Step([string]$tag, [string]$status, [string]$detail) {
  $color = if ($status -like 'PASS*' -or $status -eq 'RUN' -or $status -eq 'PASS') { 'Green' }
           elseif ($status -like 'FAIL*') { 'Red' } else { 'Yellow' }
  Write-Host ('{0,-28} {1,-14} {2}' -f $tag, $status, $detail) -ForegroundColor $color
  if ($status -like 'FAIL*') { $script:Failed = $true }
  if ($status -like 'WARN*') { $script:Warned = $true }
}

# --- 定位 adb：仓库既有脚本的约定路径优先，其次 Android SDK，最后 PATH ---
$adb = $null
foreach ($cand in @(
    'C:\adb\platform-tools\adb.exe',
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "$env:USERPROFILE\AppData\Local\Android\Sdk\platform-tools\adb.exe"
  )) {
  if (Test-Path $cand) { $adb = $cand; break }
}
if (-not $adb) {
  $c = Get-Command adb -ErrorAction SilentlyContinue
  if ($c) { $adb = $c.Source }
}
if (-not $adb) {
  Write-Host '[FAIL] adb not found (tried C:\adb, Android SDK, PATH)' -ForegroundColor Red
  exit 1
}
Write-Host "[link-check] adb = $adb"
Write-Host ('[link-check] time = {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))

# --- 环节1：设备在线 ---
$devLine = & $adb devices 2>&1 | Select-String $Serial
if ($devLine -and ($devLine -notmatch 'offline' + '|unauthorized')) {
  Write-Step '环节1 adb device' 'PASS' ($devLine.ToString().Trim())
} else {
  Write-Step '环节1 adb device' 'FAIL' ("serial $Serial offline/unauthorized -> 检查 USB 连接与手机授权")
  exit 1
}

# --- 环节2：forward 在位（幂等，缺则补） ---
# adb forward --list 输出格式为 "serial local remote"（local 在前 remote 在后，空格分隔）。
# 8022/10022 两条在本机 local 与 remote 相同，匹配时不能想当然。
$existing = & $adb forward --list 2>&1
foreach ($pair in $ForwardPairs) {
  $parts = $pair.Split(' ')
  $localSocket = $parts[0]
  $remoteSocket = $parts[1]
  $pattern = [regex]::Escape($localSocket) + '\s+' + [regex]::Escape($remoteSocket)
  if ($existing -match $pattern) {
    Write-Step "环节2 forward $localSocket" 'PASS' '在位'
    continue
  }
  & $adb forward $parts 2>&1 | Out-Null
  $after = & $adb forward --list 2>&1
  if ($after -match $pattern) {
    Write-Step "环节2 forward $localSocket" 'PASS' '已重建'
  } else {
    Write-Step "环节2 forward $localSocket" 'FAIL' "重建失败 -> 重跑 or 重启 adb server"
  }
}

# --- 环节3：Termux sshd ---
# 首连接会把 known_hosts warning 打到 stderr，只取有效行
$termux = & ssh -o ConnectTimeout=10 -o BatchMode=yes k40 'echo TERMUX_OK; uname -m' 2>&1 | Where-Object { $_ -match '^(TERMUX_OK|Linux)' }
if ($termux -match 'TERMUX_OK') {
  Write-Step '环节3 Termux sshd' 'PASS' (($termux -join ' ').Trim())
} else {
  Write-Step '环节3 Termux sshd' 'FAIL' (($termux -join ' ').Trim() + ' -> 查 runit sshd 服务与 8022 监听')
}

# --- 环节4：Ubuntu 容器 sshd ---
$cont = & ssh -o ConnectTimeout=10 -o BatchMode=yes k40-ubuntu 'echo CONTAINER_OK; /mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript --version 2>&1 | head -1; /usr/bin/python3 --version' 2>&1 | Where-Object { $_ -match '^(CONTAINER_OK|Rscript|Python)' }
if ($cont -match 'CONTAINER_OK') {
  $ver = ($cont | Where-Object { $_ -match 'version' }) -join ' | '
  Write-Step '环节4 容器 sshd' 'PASS' $ver.Trim()
} else {
  Write-Step '环节4 容器 sshd' 'FAIL' (($cont -join ' ').Trim() + ' -> 查容器是否启动、10022 监听、proot 状态')
}

# --- 服务状态（Termux 侧，只读） ---
$svCmd = 'export PREFIX=/data/data/com.termux/files/usr; export PATH=$PREFIX/bin:$PREFIX/bin/applets:$PATH; export SVDIR=$PREFIX/var/service; for s in sshd crond ssh-agent ubuntu-sshd; do echo "$s: $(sv status $s 2>&1)"; done'
# ssh 首次连接会把 known_hosts warning 打到 stderr（非 tty 下混入输出），按 sv 输出特征过滤
$svOut = & ssh -o ConnectTimeout=10 -o BatchMode=yes k40 $svCmd 2>&1 | Where-Object { $_ -match '^(sshd|crond|ssh-agent|ubuntu-sshd):' }
foreach ($line in $svOut) {
  if ($line -match '^(\S+):\s+(.*)$') {
    $name = $Matches[1]; $state = $Matches[2]
    # runit 的主服务在 run 就算活；log 子服务 down 单独记 WARN（已知问题：缺 LOGDIR，见踩坑台账）
    if ($state -match '^run') {
      if ($state -match 'down: log') {
        Write-Step "服务 $name" 'WARN' ($state.Trim() + '  [log 子服务缺 LOGDIR]')
      } else {
        Write-Step "服务 $name" 'RUN' $state.Trim()
      }
    } else {
      Write-Step "服务 $name" 'FAIL' $state.Trim()
    }
  }
}
if (-not $svOut) {
  Write-Step '服务 sshd/crond/...' 'FAIL' '无输出 -> sv status 查询失败或 SSH 层异常'
}

# --- 汇总结论 ---
Write-Host ''
if ($script:Failed) {
  Write-Host '[link-check] 总体 = FAIL（见上文 FAIL 环节）' -ForegroundColor Red
  exit 1
} elseif ($script:Warned) {
  Write-Host '[link-check] 总体 = PASS（有 WARN，见上文）' -ForegroundColor Yellow
  exit 0
} else {
  Write-Host '[link-check] 总体 = PASS' -ForegroundColor Green
  exit 0
}
