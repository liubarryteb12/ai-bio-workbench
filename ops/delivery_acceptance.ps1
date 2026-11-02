#!/usr/bin/env pwsh
# 交付包端到端验收：tar 侧车哈希 → 解包 → 清单验签 → 计数核对
#
# 存在的理由（2026-11-02，4 Argon 第十六轮 Priority 1）：
# 客户买到的是最终交付包（报告 + 图 + 表 + .sig），不是仓库里的中间产物。
# 过去只验证过各模块单独可用，没有一条命令能把「拿到一个 tar 到确认它可信」
# 走完。本脚本把这四道关固化成可复跑的一次调用，任一道红即整体红。
#
# 判据（四道全绿才算通过）：
#   1. tar 本体 SHA256 与侧车文件一致（防传输损坏与替换）
#   2. 解包成功且目录结构含 CHECKSUMS.sha256 / CHECKSUMS.sig / delivery_manifest.json
#   3. 清单逐文件哈希校验 + Ed25519 验签返回 VERIFIED
#   4. 清单登记的各类计数与磁盘实际文件数一致
#
# 用法：
#   pwsh -File ops/delivery_acceptance.ps1 -DeliveryDir <含 tar 的目录>
#   可选 -PublicKeyPath 指定公钥（默认 ops/secrets/ed25519_public.pem）

param(
  [Parameter(Mandatory = $true)][string]$DeliveryDir,
  [string]$PublicKeyPath = 'ops/secrets/ed25519_public.pem'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$dir = Resolve-Path $DeliveryDir
$failures = @()
function Fail([string]$msg) { $script:failures += $msg; Write-Host ("[ RED ] " + $msg) -ForegroundColor Red }
function Ok([string]$msg) { Write-Host ("[ OK  ] " + $msg) -ForegroundColor Green }

# 关 1：tar 侧车哈希
$tar = Get-ChildItem -Path $dir -Filter '*Client_Delivery.tar.gz' -File | Select-Object -First 1
if (-not $tar) {
  Fail "找不到 *Client_Delivery.tar.gz"
  exit 1
}
# 侧车有两种历史命名：tar_sha256_sidecar.txt（演练包）与 <name>.tar.gz.sha256（打包器产物）。
# 两者格式相同（"<sha256>  <文件名>"），一并接受，避免命名差异被误判成缺校验。
$sidecar = Join-Path $dir 'tar_sha256_sidecar.txt'
if (-not (Test-Path $sidecar)) {
  $alt = Join-Path $dir ($tar.Name + '.sha256')
  if (Test-Path $alt) { $sidecar = $alt }
}
if (Test-Path $sidecar) {
  $expected = (Get-Content $sidecar -Raw).Trim().Split(' ')[0].ToLower()
  $actual = (Get-FileHash $tar.FullName -Algorithm SHA256).Hash.ToLower()
  if ($expected -eq $actual) { Ok "tar SHA256 与侧车一致：$($actual.Substring(0,16))..." }
  else { Fail "tar SHA256 不一致：期望 $expected 实际 $actual" }
} else {
  Fail "缺 tar_sha256_sidecar.txt，无法校验 tar 本体"
}

# 关 2：解包
$unpack = Join-Path $dir 'unpacked'
if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force }
New-Item -ItemType Directory -Path $unpack | Out-Null
tar -xzf $tar.FullName -C $unpack
if ($LASTEXITCODE -ne 0) { Fail "解包失败"; exit 1 }
# 交付根目录是 tar 内唯一的一级目录
$delivery = Get-ChildItem -Path $unpack -Directory | Select-Object -First 1
if (-not $delivery) { Fail "解包后没有一级目录"; exit 1 }
foreach ($need in @('CHECKSUMS.sha256', 'CHECKSUMS.sig', 'delivery_manifest.json')) {
  if (-not (Test-Path (Join-Path $delivery.FullName $need))) { Fail "交付包缺 $need" }
}
Ok "解包完成：$($delivery.Name)"

# 关 3：清单哈希 + Ed25519 验签
if (-not (Test-Path $PublicKeyPath)) {
  Fail "公钥缺失：$PublicKeyPath"
} else {
  $env:BIO_ED25519_PUBLIC_KEY_PATH = (Resolve-Path $PublicKeyPath).Path
  $out = node ops/verify_delivery_signature.mjs --delivery-dir $delivery.FullName 2>&1
  $text = ($out | Out-String).Trim()
  if ($LASTEXITCODE -eq 0 -and $text -match 'VERIFIED') {
    Ok "清单哈希与 Ed25519 验签通过：$text"
  } else {
    Fail "验签失败：$text"
  }
}

# 关 4：清单与磁盘的集合双向差集（2026-11-02，4 Argon 第十七轮第 1 节）
#
# 为什么不能只做「总数相减」：磁盘 115 含 4 个签名元数据自身 + 111 个业务文件，
# 清单 117 条是不带小节前缀的相对路径。两个维度硬比只会得到假阳性。
# 为什么也不能只看第 3 关：第 3 关是单向检查（遍历清单查磁盘），
# 磁盘上多出的未登记「幽灵文件」（临时调试物、.bak、未脱敏配置）它 100% 放行。
#
# 判据：把清单每条按所属小节拼成磁盘相对路径，与「磁盘集合扣除元数据白名单」
# 求双向差集，两侧都必须为空。多出即幽灵文件，缺失即清单漂移。
$metaFiles = @('CHECKSUMS.sha256', 'CHECKSUMS.sig', 'delivery_manifest.json', 'ED25519_PUBLIC_KEY.pem')
# 清单按分类登记业务文件；解读报告不在该登记表内，属交付必需但不入哈希清单
# 打包器会额外写这些说明性文件：它们不参与哈希清单（清单只管受保护业务件），
# 但属交付必需，不能算幽灵私货。
$allowedUnlistedPrefixes = @('03_Interpretation_Report/')
$allowedUnlistedFiles = @('01_Adapted_Code/_report.txt')

$manifestPath = Join-Path $delivery.FullName 'delivery_manifest.json'
if (Test-Path $manifestPath) {
  $mf = Get-Content $manifestPath -Raw | ConvertFrom-Json
  # 小节 -> 磁盘目录前缀（实测:两个目录，01 放代码，02 放图表）
  $sectionDir = @{
    scripts = '01_Adapted_Code'
    adapted_code = '01_Adapted_Code'
    figures = '02_Figures_and_Tables'
    tables = '02_Figures_and_Tables'
  }
  $declared = New-Object System.Collections.Generic.HashSet[string]
  foreach ($prop in $mf.files.PSObject.Properties) {
    $prefix = $sectionDir[$prop.Name]
    foreach ($rel in @($prop.Value)) {
      if ($null -eq $rel) { continue }
      $full = if ($prefix) { "$prefix/$rel" } else { "$rel" }
      [void]$declared.Add(($full -replace '\\', '/'))
    }
  }

  $diskAll = Get-ChildItem $delivery.FullName -Recurse -File | ForEach-Object {
    $_.FullName.Substring($delivery.FullName.Length + 1).Replace('\', '/')
  }
  $diskBusiness = $diskAll | Where-Object { $metaFiles -notcontains $_ }

  # 双向差集：(磁盘 - 白名单前缀) 与 清单
  $ghosts = @()
  foreach ($f in $diskBusiness) {
    if ($declared.Contains($f)) { continue }
    $allowed = $false
    if ($allowedUnlistedFiles -contains $f) { $allowed = $true }
    if (-not $allowed) {
      foreach ($p in $allowedUnlistedPrefixes) { if ($f.StartsWith($p)) { $allowed = $true; break } }
    }
    if (-not $allowed) { $ghosts += $f }
  }
  $missingFiles = @($declared | Where-Object { -not (Test-Path (Join-Path $delivery.FullName $_)) })

  if ($ghosts.Count -eq 0) {
    Ok ("无幽灵文件：磁盘业务文件 " + $diskBusiness.Count + " 个，全部在清单或白名单内")
  } else {
    Fail ("发现 " + $ghosts.Count + " 个未登记文件（幽灵私货）：" + ($ghosts -join ', '))
  }
  if ($missingFiles.Count -eq 0) {
    Ok ("清单 " + $declared.Count + " 条全部落到磁盘")
  } else {
    Fail ("清单有 " + $missingFiles.Count + " 条在磁盘缺失：" + ($missingFiles -join ', '))
  }

  # counts 内部自洽：分项之和必须等于清单条目数（排除不受 counts 管理的分类）
  $sumCounted = 0
  $mismatch = @()
  foreach ($row in $mf.counts.PSObject.Properties) {
    $sumCounted += [int]$row.Value
    $declaredInSection = @($mf.files.($row.Name)).Count
    if ($declaredInSection -ne 0 -and [int]$row.Value -ne $declaredInSection) {
      $mismatch += ($row.Name + '：counts=' + $row.Value + ' 条目=' + $declaredInSection)
    }
  }
  if ($mismatch.Count -eq 0) { Ok ("counts 分项与清单条目逐类一致，合计 " + $sumCounted) }
  else { Fail ("counts 与清单条目不一致：" + ($mismatch -join '；')) }
}

Write-Host ''
if ($failures.Count -gt 0) {
  Write-Host ("ACCEPTANCE_FAILED " + $failures.Count + " 项") -ForegroundColor Red
  exit 1
}
Write-Host 'DELIVERY_ACCEPTANCE_OK 四道关全绿' -ForegroundColor Green
exit 0
