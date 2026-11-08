<#
.SYNOPSIS
  在手机上执行命令：默认 adb，adb 不可用即报错；ssh 只作显式特殊开关。

.DESCRIPTION
  为什么优先 adb（2026-11-06 决定）：
    adb 由系统 adbd 提供，Termux 进程被杀后依然可用；
    sshd 跑在 Termux 内部，Termux 一死连接就断（本机实测过 5 次，
    每次都只能靠 adb shell am start 重启 Termux 才能恢复）。
  因此 adb 作为主通道，sshd 只在显式 -Transport ssh 时启用，默认不回落。

  权限边界（实测）：
    adb shell 身份是 uid=2000(shell)，读不到 /data/data/com.termux；
    但该 Termux 是 debuggable，可用 run-as com.termux 以 Termux UID 执行，
    再经 proot-distro 进入 ubuntu 容器。全程无需 root。

.PARAMETER Level
  termux  = 直接在 Termux 用户态执行（不进容器）
  ubuntu  = 进入 proot ubuntu 容器执行（分析命令用这个）

.PARAMETER Command
  要执行的 bash 片段。与 -ScriptPath 二选一。

.PARAMETER ScriptPath
  本地 .sh 文件，内容通过 stdin 送入设备，避免引号转义问题。

.PARAMETER RemoteScriptPath
  容器内临时脚本落点。缺省按进程号与随机数生成唯一路径，避免并发执行互相覆盖。

.PARAMETER PushLocalPath
  本地文件路径。内容经 base64 送入容器，写到 -PushRemotePath。

.PARAMETER PushRemotePath
  -PushLocalPath 在容器内的目标路径。必须给绝对路径。

.PARAMETER TimeoutSec
  adb 调用超时秒数，默认 1800。

.PARAMETER RequireAdb
  置位后 adb 失败即报错，不回落 ssh（用于确认 adb 通道本身是否健康）。

.EXAMPLE
  pwsh -File ops/adb_exec.ps1 -Level ubuntu -Command "python3 -c print(6*7)"

.EXAMPLE
  pwsh -File ops/adb_exec.ps1 -Level ubuntu -ScriptPath .tmp/step.sh
#>
param(
  [ValidateSet('termux', 'ubuntu')][string]$Level = 'ubuntu',
  [string]$Command,
  [string]$ScriptPath,
  [string]$RemoteScriptPath,
  [string]$PushLocalPath,
  [string]$PushRemotePath,
  [int]$TimeoutSec = 1800,
  # adb 是默认且唯一的主通道；ssh 需要显式选择，只用于验证备用链路。
  [ValidateSet('adb', 'ssh')][string]$Transport = 'adb',
  # 给远端进程设地址空间上限（MB）。0 表示不限制。
  # 为什么需要：本机 Termux 的 phantom killer 已关、电池白名单已加、wake lock 已持、
  # oom_score_adj 已是 -1000，保护措施全开仍被杀 5 次 —— 真正的原因是自身峰值内存
  # 把系统逼进 LMK 区间。加 ulimit -v 后，超限只让该进程拿到 MemoryError 并退出，
  # 进程组存活（实测）。
  [int]$MemLimitMB = 0,
  # 保留该开关用于显式声明「adb 必须可用」。默认 adb 本身已经是失败即报错。
  [switch]$RequireAdb
)

$ErrorActionPreference = 'Stop'
$ADB = 'C:\adb\platform-tools\adb.exe'
$PREFIX = '/data/data/com.termux/files/usr'
$ROOTFS = $PREFIX + '/var/lib/proot-distro/containers/ubuntu/rootfs'
$REMOTE_SCRIPT = if ($RemoteScriptPath) {
  $RemoteScriptPath
} else {
  '/tmp/dsh_adb_cmd_' + $PID + '_' + (Get-Random -Minimum 100000 -Maximum 999999) + '.sh'
}
$REMOTE_SCRIPT_HOST = $ROOTFS + $REMOTE_SCRIPT
$NL = [char]10

$EnvSetup = @'
export PREFIX=/data/data/com.termux/files/usr
export PATH=$PREFIX/bin:$PATH
export HOME=/data/data/com.termux/files/home
export TMPDIR=$PREFIX/tmp
'@

function Get-Payload {
  if ($PushLocalPath) {
    if (-not $PushRemotePath) { throw '提供 -PushLocalPath 时必须同时提供 -PushRemotePath' }
    if ($PushRemotePath -notmatch '^/[A-Za-z0-9._/-]+$') { throw "PushRemotePath 非法: $PushRemotePath" }
    if (-not (Test-Path -LiteralPath $PushLocalPath)) { throw "本地文件不存在: $PushLocalPath" }
    $bytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $PushLocalPath))
    $encoded = [Convert]::ToBase64String($bytes)
    $parent = Split-Path -Parent $PushRemotePath
    $lines = @('mkdir -p ' + $parent, ': > ' + $PushRemotePath)
    for ($offset = 0; $offset -lt $encoded.Length; $offset += 1024) {
      $chunk = $encoded.Substring($offset, [Math]::Min(1024, $encoded.Length - $offset))
      $lines += ('printf %s ' + [char]39 + $chunk + [char]39 + ' >> ' + $PushRemotePath + '.b64')
    }
    $lines += 'base64 -d ' + $PushRemotePath + '.b64 > ' + $PushRemotePath
    $lines += 'rm -f ' + $PushRemotePath + '.b64'
    $lines += 'sha256sum ' + $PushRemotePath
    return ($lines -join $NL) + $NL
  }
  if ($ScriptPath) {
    if (-not (Test-Path -LiteralPath $ScriptPath)) { throw "脚本不存在: $ScriptPath" }
    return (Get-Content -LiteralPath $ScriptPath -Raw)
  }
  if ($Command) { return $Command }
  throw '必须提供 -Command 或 -ScriptPath'
}

function Invoke-AdbStdin([string]$script) {
  $bashPath = $PREFIX + "/bin/bash -s"
  $out = $script | & $ADB shell ("run-as com.termux " + $bashPath) 2>&1
  return @{ Output = $out; Code = $LASTEXITCODE }
}

function Invoke-ViaAdb([string]$payload) {
  if ($Level -eq 'termux') {
    return Invoke-AdbStdin ($EnvSetup + $NL + $payload)
  }
  # ubuntu：先把 payload 落进容器 rootfs 的 /tmp，再在容器内执行。
  # 不能直接把脚本经 stdin 传给容器内 bash —— stdin 已被外层 bash -s 占用。
  # $EnvSetup 是 here-string，末尾不含换行，必须显式补 $NL，
  # 否则下一行命令会粘到最后一个 export 上（实测报 export: --: not a valid identifier）
  $writer = $EnvSetup + $NL + 'cat > ' + $REMOTE_SCRIPT_HOST + " <<'DSH_ADB_EOF'" + $NL + $payload + $NL + 'DSH_ADB_EOF' + $NL
  $w = Invoke-AdbStdin $writer
  if ($w.Code -ne 0) { return $w }
  $runner = $EnvSetup + $NL + 'proot-distro login ubuntu -- bash ' + $REMOTE_SCRIPT + $NL
  return Invoke-AdbStdin $runner
}

function Repair-Forwards {
  # ssh 备用通道依赖 adb 端口转发（8022/10022）。adb server 重启后转发会丢，
  # 表现为 Connection refused —— 这里按需重建，让备用通道真的可用。
  try {
    $have = (& $ADB forward --list 2>&1) -join " "
    foreach ($port in @('8022', '10022')) {
      if ($have -notmatch ("tcp:" + $port + " tcp:" + $port)) {
        & $ADB forward ("tcp:" + $port) ("tcp:" + $port) 2>&1 | Out-Null
      }
    }
  } catch {
    Write-Verbose "转发修复失败（继续尝试直连）：$_"
  }
}

function Invoke-ViaSsh([string]$payload) {
  $target = if ($Level -eq 'ubuntu') { 'k40-ubuntu' } else { 'k40' }
  $ssh = 'D:/Git/usr/bin/ssh.exe'
  Repair-Forwards
  $out = $payload | & $ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $target "bash -s" 2>&1
  return @{ Output = $out; Code = $LASTEXITCODE }
}

$payload = Get-Payload

# 内存上限：只在显式给 -MemLimitMB 时注入，避免默认改变既有行为。
if ($MemLimitMB -gt 0) {
  $kb = $MemLimitMB * 1024
  $limitLine = "ulimit -v " + $kb + " 2>/dev/null || true" + $NL
  $payload = $limitLine + $payload
}

$used = $Transport
$result = $null

if ($Transport -eq 'ssh') {
  # 显式特殊开关：只用于验证 sshd 本身是否健康，不是默认路径
  $result = Invoke-ViaSsh $payload
} else {
  $probe = & $ADB get-state 2>&1
  if (($probe -join '').Trim() -ne 'device') { throw "adb 通道不可用: $probe" }
  $result = Invoke-ViaAdb $payload
  $used = 'adb'
}

$result.Output | ForEach-Object { Write-Output $_ }
Write-Verbose ("transport=" + $used + " code=" + $result.Code)
exit $result.Code
