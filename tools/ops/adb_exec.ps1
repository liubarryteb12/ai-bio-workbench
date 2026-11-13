<#
.SYNOPSIS
  在算力节点上执行命令：固定走 adb，adb 不可用即报错。

.DESCRIPTION
  为什么只用 adb（2026-11-06 决定，2026-11-11 封存 SSH）：
    adb 由系统 adbd 提供，Termux 进程被杀后依然可用；
    sshd 跑在 Termux 内部，Termux 一死连接就断（本机实测过 5 次，
    每次都只能靠 adb shell am start 重启 Termux 才能恢复）。
  用户当前不使用 SSH，备用通道已封存至 _archive/ssh_retired_20261111/。

  权限边界（实测）：
    adb shell 身份是 uid=2000(shell)，读不到 /data/data/com.termux；
    但该 Termux 是 debuggable，可用 run-as com.termux 以 Termux UID 执行，
    再经 proot-distro 进入 ubuntu 容器。全程无需 root。

.PARAMETER Level
  host      = 在节点基础用户空间执行（不进容器）
  container = 进入 Linux 容器执行（分析命令用这个）
  termux / ubuntu = 兼容旧调用名

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
  pwsh -File tools/ops/adb_exec.ps1 -Level ubuntu -Command "python3 -c print(6*7)"

.EXAMPLE
  pwsh -File tools/ops/adb_exec.ps1 -Level container -ScriptPath .tmp/step.sh
#>
param(
  [ValidateSet('host', 'container', 'termux', 'ubuntu')][string]$Level = 'container',
  [string]$Command,
  [string]$ScriptPath,
  [string]$RemoteScriptPath,
  [string]$PushLocalPath,
  [string]$PushRemotePath,
  [int]$TimeoutSec = 1800,
  # 单通道：只接受 adb，SSH 备用通道已封存。
  [ValidateSet('adb')][string]$Transport = 'adb',
  # 给远端进程设地址空间上限（MB）。0 表示不限制。
  # 为什么需要：本机 Termux 的 phantom killer 已关、电池白名单已加、wake lock 已持、
  # oom_score_adj 已是 -1000，保护措施全开仍被杀 5 次 —— 真正的原因是自身峰值内存
  # 把系统逼进 LMK 区间。加 ulimit -v 后，超限只让该进程拿到 MemoryError 并退出，
  # 进程组存活（实测）。
  [int]$MemLimitMB = 0,
  # 保留该开关用于显式声明「adb 必须可用」。默认 adb 本身已经是失败即报错。
  [switch]$RequireAdb,
  # 目标设备序列号。缺省读 BIO_ADB_SERIAL，仍为空时交给 adb 自己选唯一在线设备。
  [string]$Serial = $env:BIO_ADB_SERIAL,
  # adb 可执行文件路径。缺省读 BIO_ADB_PATH，其次用约定路径，最后退回 PATH。
  [string]$AdbPath = $env:BIO_ADB_PATH,
  # 远端基础用户空间前缀与容器名，允许使用者按自己的环境覆盖。
  [string]$RemoteHome = $(if ($env:BIO_REMOTE_HOME) { $env:BIO_REMOTE_HOME } elseif ($env:BIO_TERMUX_PREFIX) { $env:BIO_TERMUX_PREFIX } else { '/data/data/com.termux/files/usr' }),
  [string]$RemoteHomeDir = $(if ($env:BIO_REMOTE_HOME_DIR) { $env:BIO_REMOTE_HOME_DIR } else { '' }),
  [string]$ContainerName = $(if ($env:BIO_CONTAINER_NAME) { $env:BIO_CONTAINER_NAME } elseif ($env:BIO_PROOT_DISTRO) { $env:BIO_PROOT_DISTRO } else { 'ubuntu' })
)

$ErrorActionPreference = 'Stop'
$ADB = if ($AdbPath) { $AdbPath } elseif (Test-Path -LiteralPath 'C:\adb\platform-tools\adb.exe') { 'C:\adb\platform-tools\adb.exe' } else { 'adb' }
$PREFIX = $RemoteHome
$ROOTFS = $PREFIX + '/var/lib/proot-distro/containers/' + $ContainerName + '/rootfs'
$ADB_TARGET = if ($Serial) { @('-s', $Serial) } else { @() }
$EffectiveLevel = switch ($Level) {
  'host' { 'termux' }
  'container' { 'ubuntu' }
  default { $Level }
}
$HOME_DIR = if ($RemoteHomeDir) { $RemoteHomeDir } else { $PREFIX + '/../home' }
$REMOTE_SCRIPT = if ($RemoteScriptPath) {
  $RemoteScriptPath
} else {
  '/tmp/dsh_adb_cmd_' + $PID + '_' + (Get-Random -Minimum 100000 -Maximum 999999) + '.sh'
}
$REMOTE_SCRIPT_HOST = $ROOTFS + $REMOTE_SCRIPT
$NL = [char]10

$EnvSetup = "export PREFIX=$PREFIX`nexport PATH=$PREFIX/bin:`$PATH`nexport HOME=$HOME_DIR`nexport TMPDIR=$PREFIX/tmp`n"

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
  $out = $script | & $ADB @ADB_TARGET shell ("run-as com.termux " + $bashPath) 2>&1
  return @{ Output = $out; Code = $LASTEXITCODE }
}

function Invoke-ViaAdb([string]$payload) {
  if ($EffectiveLevel -eq 'termux') {
    return Invoke-AdbStdin ($EnvSetup + $NL + $payload)
  }
  # ubuntu：先把 payload 落进容器 rootfs 的 /tmp，再在容器内执行。
  # 不能直接把脚本经 stdin 传给容器内 bash —— stdin 已被外层 bash -s 占用。
  # $EnvSetup 是 here-string，末尾不含换行，必须显式补 $NL，
  # 否则下一行命令会粘到最后一个 export 上（实测报 export: --: not a valid identifier）
  $writer = $EnvSetup + $NL + 'cat > ' + $REMOTE_SCRIPT_HOST + " <<'DSH_ADB_EOF'" + $NL + $payload + $NL + 'DSH_ADB_EOF' + $NL
  $w = Invoke-AdbStdin $writer
  if ($w.Code -ne 0) { return $w }
  $runner = $EnvSetup + $NL + 'proot-distro login ' + $ContainerName + ' -- bash ' + $REMOTE_SCRIPT + $NL
  return Invoke-AdbStdin $runner
}

$payload = Get-Payload

# 内存上限：只在显式给 -MemLimitMB 时注入，避免默认改变既有行为。
if ($MemLimitMB -gt 0) {
  $kb = $MemLimitMB * 1024
  $limitLine = "ulimit -v " + $kb + " 2>/dev/null || true" + $NL
  $payload = $limitLine + $payload
}

$result = $null
$probe = & $ADB @ADB_TARGET get-state 2>&1
if (($probe -join '').Trim() -ne 'device') { throw "adb 通道不可用: $probe" }
$result = Invoke-ViaAdb $payload

$result.Output | ForEach-Object { Write-Output $_ }
Write-Verbose ("transport=adb code=" + $result.Code)
exit $result.Code
