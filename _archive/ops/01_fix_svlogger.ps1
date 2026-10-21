<#
  ops/01_fix_svlogger.ps1  —  修复 log 子服务 crash-loop（LOGDIR 未传承，踩坑台账 #88）

  现象：sv status sshd / crond / ssh-agent 报
        run: xxx: (pid N) ...; down: log: Ns, normally up, want up
  根因：termux-services 自带 svlogger 用 $LOGDIR 拼日志目录，而 runsvdir 启动的
        子进程环境里没有 LOGDIR，于是 mkdir -p "/sv/xxx" 失败，svlogd 起不来。
        boot 脚本里 export LOGDIR 只在那个进程树生效，追不上已存在的 runsvdir。
        （此前的判断"export 完 sv up 即可"不完整，故归档为 #88）
  对照：ubuntu-sshd 的 log/run 是手写绝对路径，一直正常。

  修法：把 log/run 软链替换为手写绝对路径的文件。
        可回滚：原软链的指向文本写在 <log/run>.origin，删除后重链即可。

  用法：  pwsh -File ops/01_fix_svlogger.ps1
  退出码：0 = 三个服务 log 子服务全部进 run；1 = 有服务未修复
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'

$svcs = @('sshd', 'crond', 'ssh-agent')
$base = '/data/data/com.termux/files/usr/var/service'
$logroot = '/data/data/com.termux/files/usr/var/log'

$failed = $false
$envSetup = 'export PREFIX=/data/data/com.termux/files/usr; export PATH=$PREFIX/bin:$PREFIX/bin/applets:$PATH; export SVDIR=$PREFIX/var/service'

function Remote([string]$cmd) {
  & ssh -o ConnectTimeout=10 k40 $cmd 2>&1
}

foreach ($svc in $svcs) {
  Write-Host "[fix:$svc] ======"
  $remoteLog = "$base/$svc/log/run"
  $localFile = Join-Path $PSScriptRoot "svlogger_$svc"

  if (-not (Test-Path $localFile)) {
    Write-Host "[fix:$svc] FAIL 本地模板缺失: $localFile" -ForegroundColor Red
    $failed = $true
    continue
  }

  # [1] 记录原始指向（软链备份），幂等：已备份过就跳过
  $origin = Remote "if [ -L '$remoteLog' ]; then readlink '$remoteLog'; elif [ -f '$remoteLog' ]; then echo 'REGULAR_FILE'; else echo 'MISSING'; fi"
  Write-Host "  origin = $($origin | Where-Object { $_ -match '^\S+$' } | Select-Object -First 1)"
  if ("$origin".Trim() -notmatch 'MISSING|REGULAR_FILE') {
    Remote "if [ ! -f '${remoteLog}.origin' ]; then if [ -L '$remoteLog' ]; then readlink '$remoteLog' > '${remoteLog}.origin'; elif [ -f '$remoteLog' ]; then echo REGULAR_FILE > '${remoteLog}.origin'; fi; fi" | Out-Null
  }

  # [2] 删除软链（必须先删，否则 scp 会跟随软链写 /usr/share 下的公共文件）
  Remote "rm -f '$remoteLog'" | Out-Null

  # [3] 传新脚本并赋可执行权限
  & scp -o ConnectTimeout=10 $localFile "k40:$remoteLog" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[fix:$svc] FAIL scp" -ForegroundColor Red
    $failed = $true
    continue
  }
  Remote "chmod 755 '$remoteLog'; mkdir -p '$logroot/$svc'" | Out-Null

  # [4] 重启 log 子服务让 supervise 重新执行 run
  $restart = Remote "$envSetup; sv restart '$svc/log' 2>&1; sleep 1; sv status '$svc' 2>&1"
  foreach ($line in ($restart | Where-Object { $_ -match '^(run|down|fail|warn)' })) {
    Write-Host "  $line"
  }
}

# --- 复核 ---
Write-Host ''
Write-Host '[fix] 复核 ======'
$verifyCmd = "$envSetup; for s in sshd crond ssh-agent; do echo `"`$s: `$(sv status `$s 2>&1)`"; done"
$out = Remote $verifyCmd | Where-Object { $_ -match '^(sshd|crond|ssh-agent):' }
foreach ($line in $out) { Write-Host "  $line" }

foreach ($line in $out) {
  if ($line -match 'down:\s*log' -or $line -match 'fail') { $failed = $true }
}

Write-Host ''
if ($failed) {
  Write-Host '[fix] 总体 = FAIL' -ForegroundColor Red
  exit 1
} else {
  Write-Host '[fix] 总体 = PASS（log 子服务已进 run）' -ForegroundColor Green
  exit 0
}
