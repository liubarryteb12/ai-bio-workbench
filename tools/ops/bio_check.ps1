# 稳态维护每日体检（bio_check，2026-11-16）
# 只读检查，零改动零删除。任何一项异常先排障再开工。
# 判据见 docs/STEADY_STATE_MAINTENANCE.md。退出码：0 健康，1 有异常项。
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)  # tools/ops -> repo root
Set-Location $repo
$bad = @()

Write-Host '== 稳态体检 ==' -ForegroundColor Cyan

# 1. 磁盘余量（< 10GB 停手）
$drive = Get-PSDrive -Name D
$freeGb = [math]::Round($drive.Free / 1GB, 1)
if ($freeGb -lt 10) { $bad += "D 盘余量 $freeGb GB < 10GB（UFS 写放大风险）" }
Write-Host ("D 盘余量: {0} GB" -f $freeGb)

# 2. .tmp 体积（BioanalysDesktop/.tmp 超过 1GB 提示清理）
$tmpDirs = @('.tmp', 'BioanalysDesktop/.tmp')
foreach ($t in $tmpDirs) {
  if (Test-Path $t) {
    $sizeMb = [math]::Round(((Get-ChildItem $t -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum) / 1MB, 0)
    Write-Host ("{0}: {1} MB" -f $t, $sizeMb)
    if ($sizeMb -gt 1024) { $bad += "$t 达 $sizeMb MB，建议跑 node tools/dev/clean_workspace.mjs --execute" }
  }
}

# 3. 残留 node/python 进程（非本脚本会话的孤儿；只提示，不杀）
$procs = Get-Process -Name node, python, python3, Rscript -ErrorAction SilentlyContinue
if ($procs) {
  Write-Host ("残留解释器进程: {0} 个" -f $procs.Count)
  $procs | ForEach-Object { Write-Host ("  pid={0} name={1} start={2}" -f $_.Id, $_.ProcessName, $_.StartTime) }
} else {
  Write-Host '无残留解释器进程'
}

# 4. git 工作区状态（脏不拦活，只报数让开工人知道）
$dirty = (git status --porcelain | Measure-Object -Line).Lines
Write-Host ("git 未提交条目: {0}" -f $dirty)

# 5. adb 设备（离线只影响冒烟与下发，不影响本地开发）
$adb = adb devices 2>$null | Select-String "device`$"
if ($adb) { Write-Host ("adb 设备在线: {0}" -f $adb.Count) } else { Write-Host 'adb 设备离线（冒烟与下发不可用）' }

Write-Host ''
if ($bad.Count -gt 0) {
  foreach ($b in $bad) { Write-Host ("[异常] {0}" -f $b) -ForegroundColor Red }
  exit 1
}
Write-Host '[OK] 体检通过' -ForegroundColor Green
exit 0
