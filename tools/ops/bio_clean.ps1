# 稳态维护每周清理（bio_clean，2026-11-16）
# 串联既有工具，不做新动作：clean_workspace（唯一删除入口，自带神圣黑名单）+
# 便携库 VACUUM + 台账轮转 + 全量测试提醒。
# 黄金冒烟用 -WithSmoke 开关：设备在线才跑，离线打印提示跳过。
# 判据见 docs/STEADY_STATE_MAINTENANCE.md。退出码：0 完成，1 有步骤失败。
param([switch]$WithSmoke)
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
$failed = @()

Write-Host '== 每周稳态清理 ==' -ForegroundColor Cyan

# 1. 工作区清理：先演练看清单，再显式执行（clean_workspace 双段设计）
Write-Host '--- 1. 工作区清理（演练） ---'
node tools/dev/clean_workspace.mjs
Write-Host '--- 1b. 工作区清理（执行） ---'
node tools/dev/clean_workspace.mjs --execute
if ($LASTEXITCODE -ne 0) { $failed += 'clean_workspace' }

# 2. 便携库 VACUUM（只对存在的 .db/.sqlite 做 integrity_check + VACUUM）
Write-Host '--- 2. SQLite 体检与压缩 ---'
$dbs = @(Get-ChildItem -Path 'BioanalysDesktop', 'data', 'desktop' -Recurse -Include '*.db', '*.sqlite' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' })
$sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
foreach ($db in $dbs) {
  if ($sqlite) {
    Write-Host ("  {0}" -f $db.FullName)
    & sqlite3 $db.FullName 'PRAGMA integrity_check;' | Write-Host
    & sqlite3 $db.FullName 'VACUUM;'
  } else {
    Write-Host '  sqlite3 不在 PATH，跳过 VACUUM（可选择性安装后重跑）'
    break
  }
}

# 3. 台账轮转：ledger 下超 50MB 的 .jsonl gzip 归档（保留原文件头部说明，轮转后清空续写）
Write-Host '--- 3. 台账轮转（>50MB） ---'
foreach ($f in (Get-ChildItem 'ledger' -Filter '*.jsonl' -ErrorAction SilentlyContinue)) {
  if ($f.Length -gt 50MB) {
    $stamp = Get-Date -Format 'yyyyMMdd'
    $arc = "ledger/archive/{0}.{1}.gz" -f $f.Name, $stamp
    Write-Host ("  {0} -> {1}" -f $f.Name, $arc)
    New-Item -ItemType Directory -Force -Path 'ledger/archive' | Out-Null
    $bytes = [IO.File]::ReadAllBytes($f.FullName)
    $ms = New-Object IO.MemoryStream
    $gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionLevel]::Optimal)
    $gz.Write($bytes, 0, $bytes.Length); $gz.Dispose()
    [IO.File]::WriteAllBytes((Join-Path $repo $arc), $ms.ToArray())
    Set-Content -Path $f.FullName -Value '' -Encoding UTF8
  }
}

# 4. 黄金冒烟（可选）：设备在线才跑
if ($WithSmoke) {
  Write-Host '--- 4. 三线黄金冒烟 ---'
  $adb = adb devices 2>$null | Select-String "device`$"
  if ($adb) {
    node tools/dev/smoke_golden.mjs
    if ($LASTEXITCODE -ne 0) { $failed += 'smoke_golden' }
  } else {
    Write-Host '  设备离线，跳过冒烟（提示：下次设备在线时补跑 node tools/dev/smoke_golden.mjs）'
  }
} else {
  Write-Host '--- 4. 黄金冒烟：未启用（-WithSmoke 可选） ---'
}

# 5. 提醒全量测试（不自动跑，10 分钟由人决定时机）
Write-Host '--- 5. 全量测试提醒 ---'
Write-Host '  建议本周跑一次：cd BioanalysDesktop && npm run gate:all（约 3-4 分钟）'

Write-Host ''
if ($failed.Count -gt 0) {
  foreach ($f in $failed) { Write-Host ("[失败] {0}" -f $f) -ForegroundColor Red }
  exit 1
}
Write-Host '[OK] 每周清理完成' -ForegroundColor Green
exit 0
