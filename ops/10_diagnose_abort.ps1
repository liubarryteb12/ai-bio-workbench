<#
  ops/10_diagnose_abort.ps1  :   proot abort 分诊器（只读诊断，不改任何状态）

  判据来自 con_hf/pitfalls_ledger.md 的 P-23、P-28、P-29 三条，按下列同形现象分诊：
    P-29  ssh 连接流喂饱 abort 环：严格 15 秒周期，无人操作也崩，abort pid 每次不同
    P-23  容器内跑了 proot 敏感命令：自己敲过 find / ps / grep -r / proc 遍历后当场崩
    P-28  /tmp 堆积（已推翻为根因，仅作卫生项复查）

  用法：  pwsh -File ops/10_diagnose_abort.ps1
          pwsh -File ops/10_diagnose_abort.ps1 -Serial 3a3e1f52
  退出码：0 = 未发现 abort 或判定为卫生项；1 = 判定 P-29 或 P-23，需按脚本提示处置；
          2 = 链路不通，先跑 ops/00_link_check.ps1

  纪律：本脚本只读。不重启服务、不 reset 容器、不动任何 marker。
        reset / install 是最后手段，须人工确认后执行。
#>
[CmdletBinding()]
param(
  [string]$Serial = '3a3e1f52',
  [int]$LogLines = 400
)

$ErrorActionPreference = 'Continue'
$script:Verdict = 'unknown'

function Write-Line([string]$tag, [string]$detail) {
  Write-Host ('{0,-26} {1}' -f $tag, $detail)
}

# --- 定位 adb：与 00_link_check.ps1 同一套候选路径 ---
$adb = $null
foreach ($cand in @(
    'C:\adb\platform-tools\adb.exe',
    '$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe',
    '$env:USERPROFILE\AppData\Local\Android\Sdk\platform-tools\adb.exe'
  )) {
  if (Test-Path $cand) { $adb = $cand; break }
}
if (-not $adb) {
  $c = Get-Command adb -ErrorAction SilentlyContinue
  if ($c) { $adb = $c.Source }
}
if (-not $adb) {
  Write-Host '[FAIL] adb not found' -ForegroundColor Red
  exit 2
}
Write-Host '[abort-diag] adb = ' + $adb

# --- 前置：设备必须在线。abort 的日志在 logcat，设备离线什么都取不到 ---
$devLine = & $adb devices 2>&1 | Select-String $Serial
if (-not $devLine -or ($devLine -match 'offline|unauthorized')) {
  Write-Host '[abort-diag] 设备离线或未授权，先插 USB、授权、亮屏' -ForegroundColor Red
  Write-Host '             然后重跑 pwsh -File ops/00_link_check.ps1'
  exit 2
}
Write-Line '设备' (($devLine.ToString().Trim()))

# --- 取 logcat。abort 的特征串来自 P-23 与 P-29 的原始日志 ---
$log = & $adb shell 'logcat -d -t ' + $LogLines + '' 2>&1
if (-not $log) {
  Write-Host '[FAIL] logcat 无输出，可能未授权或 log 缓冲已滚掉' -ForegroundColor Red
  exit 2
}

$assertHits = @($log | Select-String -Pattern 'length1 > 0|compare_paths2|signal 6|abort')
if (-not $assertHits -or $assertHits.Count -eq 0) {
  Write-Host '[abort-diag] 最近 ' + $LogLines + ' 行 logcat 未见 abort 特征' -ForegroundColor Green
  Write-Host '             结论：当前无 abort 活动，无需处置'
  exit 0
}

# --- 提取 abort 时间戳，算周期与密集度 ---
$stamps = @()
foreach ($h in $assertHits) {
  $m = [regex]::Match($h.ToString(), '^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})')
  if ($m.Success) {
    try {
      $ts = [datetime]::ParseExact($m.Groups[1].Value, 'MM-dd HH:mm:ss', $null)
      # 同一次 abort 会打多行（signal 6 与 assertion 各一行），按秒去重，
      # 否则平均间隔被腰斩，15 秒周期的判据失效（实测假数据下算出 7.2 秒）。
      if (-not ($stamps -contains $ts)) { $stamps += $ts }
    } catch { }
  }
}

$count = $assertHits.Count
$interval = 'n/a'
if ($stamps.Count -ge 2) {
  $span = ($stamps[-1] - $stamps[0]).TotalSeconds
  if ($span -gt 0) {
    $interval = [string]::Format('{0:F1}s', ($span / ($stamps.Count - 1)))
  }
}
Write-Line 'abort 特征命中' ($count + ' 处, 平均间隔 ' + $interval + ')')

# --- 判据一：15 秒周期 + 无人操作 = P-29 的自我维持环 ---
$isPeriodic = $false
if ($interval -ne 'n/a') {
  $sec = [double]($interval -replace 's', '')
  $isPeriodic = ($sec -ge 10 -and $sec -le 20)
}

# --- 判据二：日志里有没有容器内的 proot 敏感命令（P-23 特征） ---
$sensitive = @($log | Select-String -Pattern 'find |/proc/\[0-9|grep -r|pgrep|\bps\b')
$hasSensitive = ($sensitive.Count -gt 0)

# --- 判据三：/tmp 堆积（P-28 已推翻为根因，仅作卫生复查） ---
$tmpCount = 'unknown'
try {
  $tmpOut = & $adb shell 'run-as com.termux sh -c ' + 'ls -1 /data/data/com.termux/files/home/.proot-distro 2>/dev/null | wc -l' 2>&1
  $tmpCount = (($tmpOut | Where-Object { $_ -match '^\d+' }) -join '').Trim()
  if (-not $tmpCount) { $tmpCount = 'unknown' }
} catch { }
Write-Line '/tmp 卫生项' ('P-28 已推翻为根因，仅记录: ' + $tmpCount + ')')

if ($hasSensitive) {
  Write-Host ''
  Write-Host '[abort-diag] 判定 = P-23（容器内敏感命令触发）' -ForegroundColor Yellow
  Write-Host '  依据：logcat 里出现 find / proc 遍历 / grep -r 这类 proot 敏感命令。'
  Write-Host '  处置：容器内改用 ls 列文件；判活读 wrapper 的 wrapper_pid，不用 ps/pgrep。'
  Write-Host '        GC 放宿主侧执行，容器内不跑 find（第 515 次 abort 即由此触发）。'
  $script:Verdict = 'P-23'
} elseif ($isPeriodic) {
  Write-Host ''
  Write-Host '[abort-diag] 判定 = P-29（ssh 连接流喂饱 abort 环）' -ForegroundColor Red
  Write-Host '  依据：平均间隔 ' + $interval + '，与 P-29 实测的严格 15 秒周期同形。'
  Write-Host '  处置顺序：'
  Write-Host '    1. 停掉本机所有 ssh 轮询源（chain_runner 起的 runner、后台 job）'
  Write-Host '    2. 静默 3 分钟后再看 logcat，abort 计数零增长才算解除'
  Write-Host '    3. 确认 runner 轮询 60s、重试 2 次（P-29 永久修复方案第 1 条）'
  Write-Host '    4. 清残留 _running 标记：只删 wrapper_pid 已死的'
  $script:Verdict = 'P-29'
} else {
  Write-Host ''
  Write-Host '[abort-diag] 判定 = 未归类（有 abort 但不同形于 P-23 / P-29）' -ForegroundColor Yellow
  Write-Host '  下一步：贴 logcat 原始行进 con_hf/pitfalls_ledger.md 追加新条目，'
  Write-Host '          先建 tight red 反馈环再建理论（AGENTS.md 第五节）。'
  $script:Verdict = 'unclassified'
}

Write-Host ''
Write-Line '结论' ($script:Verdict + ')')
if ($script:Verdict -eq 'unclassified') { exit 1 }
exit 1
