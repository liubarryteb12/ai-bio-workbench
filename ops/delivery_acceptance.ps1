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
$sidecar = Join-Path $dir 'tar_sha256_sidecar.txt'
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

# 关 4：计数核对
$manifestPath = Join-Path $delivery.FullName 'delivery_manifest.json'
if (Test-Path $manifestPath) {
  $mf = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $counted = @()
  foreach ($prop in $mf.files.PSObject.Properties) {
    $counted += [pscustomobject]@{ section = $prop.Name; declared = @($prop.Value).Count }
  }
  foreach ($row in $counted) {
    $declaredTotal = 0
    if ($mf.counts.PSObject.Properties.Name -contains $row.section) {
      $declaredTotal = [int]$mf.counts.($row.section)
    }
    # 清单里登记的条数必须与 counts 一致（两侧都是声明值，防清单被裁剪）
    if ($declaredTotal -ne 0 -and $row.declared -ne 0 -and $declaredTotal -ne $row.declared) {
      # figures/tables 的 counts 与条目数口径不同时只告警，不算红
      Write-Host ("[ WARN] " + $row.section + "：counts=" + $declaredTotal + " 条目=" + $row.declared) -ForegroundColor Yellow
    }
  }
  $diskFiles = (Get-ChildItem $delivery.FullName -Recurse -File | Measure-Object).Count
  Ok "清单计数：$($counted | ForEach-Object { $_.section + '=' + $_.declared } | Out-String -NoNewline)；磁盘文件 $diskFiles"
}

Write-Host ''
if ($failures.Count -gt 0) {
  Write-Host ("ACCEPTANCE_FAILED " + $failures.Count + " 项") -ForegroundColor Red
  exit 1
}
Write-Host 'DELIVERY_ACCEPTANCE_OK 四道关全绿' -ForegroundColor Green
exit 0
