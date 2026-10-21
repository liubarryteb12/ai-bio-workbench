<#
  ops/06_deploy_scripts.ps1  —  src/ 分析脚本部署通道（P3-S0）

  背景：任务引擎按命令名执行 step（buildTaskScript 拼 step + 参数并注入本线 bin 到 PATH），
  但本地 src/<line>/scripts/ 的脚本此前在服务器上不存在，一切 step 都是 command not found。
  本脚本补上这条通道（bin/ 与 envs/ 全局一份，所有项目共用，不随项目复制）：
    src/<line>/scripts/*     -> 服务器 bin/<line>/       （scp + chmod 755 + 字节校验 + 可执行位复核）
    src/<line>/envs/manifest.txt -> 服务器 envs/<line>/  （环境声明，台账 environment 的来源）

  与 ops/05_push_testdata.ps1 同模式（数据面上线后的标准上数姿势）：
  同名文件默认拒绝（不自动覆盖），-Force 才覆盖；逐个字节校验。

  用法：  pwsh -File ops/06_deploy_scripts.ps1 [-Line line1_bulk] [-Force] [-Rehearse]
         -Line     只部署一条线（line1_bulk / line2_scrna / line3_spatial），不带则三线全量
         -Force    目标已存在同名文件时覆盖
         -Rehearse 演练模式，目标必须是临时目录（不动真实数据面）
  退出码：0 = 部署全部成功且字节校验通过；1 = 链路失败 / 目标存在同名文件（未加 -Force）/ 校验不符
#>
[CmdletBinding()]
param(
  [string]$Line = '',
  [switch]$Force,
  # 演练模式：目标必须是临时目录，防止误写真实数据面
  [switch]$Rehearse,
  [string]$SsdRoot = '/mnt/ssd/bio_data'
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot

$validLines = @('line1_bulk', 'line2_scrna', 'line3_spatial')
if ($Line -ne '') {
  if ($validLines -notcontains $Line) {
    Write-Host "[deploy] FAIL -Line 非法: $Line，只能是 $($validLines -join ' / ')" -ForegroundColor Red
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

# --- 1. 确认链路与目标可写 ---
$targetHost = 'k40-ubuntu'
if (-not (Test-SshAlive $targetHost)) {
  Write-Host '[deploy] FAIL 容器 ssh 不通（先跑 ops/00_link_check.ps1）' -ForegroundColor Red
  exit 1
}

if ($Rehearse) {
  if ($SsdRoot -eq '/mnt/ssd/bio_data') {
    Write-Host '[deploy] FAIL 演练模式不得指向真实数据面 /mnt/ssd/bio_data，请用 -SsdRoot 指定临时目录' -ForegroundColor Red
    exit 1
  }
  Write-Host "[deploy] 演练模式：目标 $targetHost : $SsdRoot"
} else {
  $probe = & ssh -o ConnectTimeout=10 -o BatchMode=yes $targetHost "mkdir -p '$SsdRoot' && [ -w '$SsdRoot' ] && echo WRITABLE || echo NOT_WRITABLE" 2>&1
  if ($LASTEXITCODE -ne 0 -or -not ($probe | Where-Object { "$_" -match 'WRITABLE' })) {
    Write-Host '[deploy] FAIL 数据面不可写：' -ForegroundColor Red
    $probe | ForEach-Object { Write-Host "  $_" }
    exit 1
  }
}

# --- 2. 收集本地待部署文件（scripts/ 的步骤脚本 + envs/ 的环境清单） ---
$pending = @()
foreach ($line in $lines) {
  # 待部署项：@(本地路径, 远端相对路径, 是否需要可执行位)
  $items = @()
  $srcDir = Join-Path $repoRoot "src/$line/scripts"
  if (-not (Test-Path $srcDir)) {
    Write-Host "[deploy] FAIL 本地缺少目录: $srcDir" -ForegroundColor Red
    exit 1
  }
  # 只收文件（README 等文档不部署；scripts/ 下每个可执行文件即一个步骤）
  $files = Get-ChildItem -Path $srcDir -File | Where-Object { $_.Name -ne 'README.md' }
  if (-not $files -or $files.Count -eq 0) {
    Write-Host "[deploy] WARN $line 的 scripts/ 下没有可部署脚本，跳过" -ForegroundColor Yellow
  } else {
    foreach ($file in $files) {
      $items += ,@($file.FullName, "bin/$line/$($file.Name)", $true)
    }
  }
  # 环境清单：台账 environment 的正本，随部署通道同步到服务器 envs/<line>/
  $manifestFile = Join-Path $repoRoot "src/$line/envs/manifest.txt"
  if (-not (Test-Path $manifestFile)) {
    Write-Host "[deploy] FAIL 本地缺少环境清单: $manifestFile" -ForegroundColor Red
    exit 1
  }
  $items += ,@($manifestFile, "envs/$line/manifest.txt", $false)

  foreach ($item in $items) {
    $localPath = $item[0]
    $remote = "$SsdRoot/$($item[1])"
    $exists = & ssh -o ConnectTimeout=10 -o BatchMode=yes $targetHost "test -e '$remote' && echo EXISTS || echo ABSENT" 2>&1
    $existsFlag = [bool]($exists | Where-Object { "$_" -match 'EXISTS' })
    if ($existsFlag -and -not $Force) {
      Write-Host "[deploy] FAIL 目标已存在同名文件: $remote" -ForegroundColor Red
      Write-Host '  确认要覆盖请加 -Force；否则请先在服务器侧处理该文件。'
      exit 1
    }
    $pending += [pscustomobject]@{
      Line       = $line
      Local      = $localPath
      Name       = Split-Path -Leaf $localPath
      Remote     = $remote
      Bytes      = (Get-Item $localPath).Length
      Executable = $item[2]
    }
  }
}

if ($pending.Count -eq 0) {
  Write-Host '[deploy] 没有可部署的文件，退出'
  exit 0
}

# --- 3. 建 bin/<line>/ 与 envs/<line>/ 目录并 scp 部署 ---
$remoteDirs = ($lines | ForEach-Object { "'$SsdRoot/bin/$_' '$SsdRoot/envs/$_'" }) -join ' '
$mkdirOut = & ssh -o ConnectTimeout=10 -o BatchMode=yes $targetHost "mkdir -p $remoteDirs && echo DIRS_OK" 2>&1
if ($LASTEXITCODE -ne 0 -or -not ($mkdirOut | Where-Object { "$_" -match 'DIRS_OK' })) {
  Write-Host '[deploy] FAIL 服务器侧建目录失败：' -ForegroundColor Red
  $mkdirOut | ForEach-Object { Write-Host "  $_" }
  exit 1
}

Write-Host "[deploy] 待部署 $($pending.Count) 个文件，scp 直送 $targetHost"
$index = 0
foreach ($item in $pending) {
  $index++
  $kind = if ($item.Executable) { 'bin/' } else { 'envs/' }
  Write-Host "  [$index/$($pending.Count)] scp $kind$($item.Line)/$($item.Name)"
  & scp -o ConnectTimeout=10 "$($item.Local)" "$($targetHost):$($item.Remote)" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[deploy] FAIL scp 失败: $($item.Local)" -ForegroundColor Red
    exit 1
  }
}

# --- 3.5 可执行位批量置位（2026-10-21 起一次 ssh 搞定，不再逐文件 chmod） ---
# 坑 P-20：原先 58 个文件各来一次 ssh（chmod 58 次 + 校验 58 次），proot 容器在这个窗口内
# 重启一次，就把已经成功落盘的文件报成 MISSING（假红灯），退出码 1 但实际部署成功。
$execRemotes = @($pending | Where-Object { $_.Executable } | ForEach-Object { $_.Remote })
if ($execRemotes.Count -gt 0) {
  $chmodCmd = 'chmod 755 ' + (($execRemotes | ForEach-Object { "'" + $_ + "'" }) -join ' ') + ' && echo CHMOD_OK'
  $chmodOut = & ssh -o ConnectTimeout=10 -o BatchMode=yes $targetHost $chmodCmd 2>&1
  if ($LASTEXITCODE -ne 0 -or -not ($chmodOut | Where-Object { "$_" -match 'CHMOD_OK' })) {
    Write-Host '[deploy] FAIL 批量 chmod 755 失败：' -ForegroundColor Red
    $chmodOut | ForEach-Object { Write-Host "  $_" }
    exit 1
  }
}

# --- 4. 远端校验（字节数 + 可执行位，一次 ssh 批量取回） ---
# 契约：链路失败（ssh 连续两次非 0）判「链路失败」，绝不算成「文件缺失」；
#       只有远端明确回 MISSING 才算文件缺失（假红灯和假绿灯一样有害，见 P-20）。
$listArgs = ($pending | ForEach-Object { "'" + $_.Remote + "'" }) -join ' '
$checkCmd = (@(
  "printf '%s" + [char]92 + "n' " + $listArgs + ' | while IFS= read -r p; do'
  '  if [ ! -e "$p" ]; then printf "MISSING|%s\n" "$p"; continue; fi'
  '  s=$(stat -c %s "$p" 2>/dev/null || echo -1)'
  '  if [ -x "$p" ]; then x=1; else x=0; fi'
  '  printf "FILE|%s|%s|%s\n" "$p" "$s" "$x"'
  'done'
) -join ([string][char]10))

Write-Host '[deploy] 校验服务器侧文件（字节数 + 可执行位，单次 ssh 批量）...'
$checkOut = $null
for ($attempt = 1; $attempt -le 2; $attempt++) {
  $checkOut = & ssh -o ConnectTimeout=10 -o BatchMode=yes $targetHost $checkCmd 2>&1
  if ($LASTEXITCODE -eq 0) { break }
  if ($attempt -eq 1) { Write-Host '[deploy] 校验 ssh 失败，重试一次...' -ForegroundColor Yellow; Start-Sleep -Seconds 2 }
}
if ($LASTEXITCODE -ne 0) {
  Write-Host '[deploy] FAIL 校验链路失败（ssh 连续两次非 0，不是文件缺失）：' -ForegroundColor Red
  $checkOut | ForEach-Object { Write-Host "  $_" }
  exit 1
}

$sizeMap = @{}
$execMap = @{}
foreach ($line in $checkOut) {
  $s = "$line"
  if ($s -match '^FILE\|(.+)\|(-?\d+)\|([01])$') {
    $sizeMap[$matches[1]] = [int64]$matches[2]
    $execMap[$matches[1]] = ($matches[3] -eq '1')
  }
  elseif ($s -match '^MISSING\|(.+)$') {
    $sizeMap[$matches[1]] = $null
  }
}

$mismatch = 0
foreach ($item in $pending) {
  if (-not $sizeMap.ContainsKey($item.Remote)) {
    Write-Host "  [校验] NO_RESULT $($item.Remote)（远端未返回该路径的结果）" -ForegroundColor Red
    $mismatch++
    continue
  }
  if ($null -eq $sizeMap[$item.Remote]) {
    Write-Host "  [校验] MISSING $($item.Remote)" -ForegroundColor Red
    $mismatch++
    continue
  }
  if ($sizeMap[$item.Remote] -ne $item.Bytes) {
    Write-Host "  [校验] SIZE_MISMATCH $($item.Remote) 本地 $($item.Bytes) vs 远端 $($sizeMap[$item.Remote])" -ForegroundColor Red
    $mismatch++
  }
}

if ($mismatch -gt 0) {
  Write-Host ''
  Write-Host "[deploy] FAIL $mismatch 个文件校验不符" -ForegroundColor Red
  exit 1
}

# --- 5. 可执行位复核（部署的最终目的就是 step 能跑起来；envs/manifest.txt 不要求） ---
$execMismatch = 0
foreach ($item in $pending) {
  if (-not $item.Executable) { continue }
  if (-not $execMap.ContainsKey($item.Remote) -or -not $execMap[$item.Remote]) {
    Write-Host "  [复核] NOT_EXECUTABLE $($item.Remote)" -ForegroundColor Red
    $execMismatch++
  }
}

if ($execMismatch -gt 0) {
  Write-Host ''
  Write-Host "[deploy] FAIL $execMismatch 个文件不可执行" -ForegroundColor Red
  exit 1
}

$scriptCount = @($pending | Where-Object { $_.Executable }).Count
$manifestCount = @($pending | Where-Object { -not $_.Executable }).Count
Write-Host ''
Write-Host "[deploy] PASS $scriptCount 个脚本 + $manifestCount 个环境清单部署完成（字节校验 + 可执行位复核均过）" -ForegroundColor Green
exit 0
