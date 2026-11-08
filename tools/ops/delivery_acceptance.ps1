#!/usr/bin/env pwsh
# 交付包端到端验收：人用的一行包装，四道关判据的唯一真源是 tools/reporting/delivery_acceptance_core.mjs。
#
# 本文件必须存为 UTF-8 带 BOM：Windows PowerShell 5.1 无 BOM 时按 ANSI 代码页解码，
# 中文注释的尾字节会吃掉紧邻的引号导致解析断裂（第 21 轮实测：无 BOM 时 node 收到
# 残缺 argv，报 bad option）。delivery_acceptance.test.js 钉住这个 BOM。
#
# 为什么不再是独立实现（2026-11-03，4 Argon 第二十轮 Q1）：验收从「人记得敲的命令」升级为
# 打包链路的后置条件（server/report.js 的 runInlineAcceptance 内联调用同一份核心）。
# 如果 ps1 继续自带一套四关逻辑，两条路会漂移：服务端绿、手敲红（或反之）没法自证。
# 本包装只做三件事：找 tar、把开关原样传给核心、按核心退出码退出（哨兵由核心打印）。
#
# 用法：
#   pwsh -File tools/ops/delivery_acceptance.ps1 -DeliveryDir <含 tar 的目录>
#   可选 -PublicKeyPath 指定公钥（默认 tools/ops/secrets/ed25519_public.pem）
#   可选 -SkipExtract 复用既有 unpacked（篡改探针专用）
#   可选 -ProjectId 验收通过时写回执 tools/ops/delivery_acceptance/records/<id>.receipt.json

param(
  [Parameter(Mandatory = $true)][string]$DeliveryDir,
  [string]$PublicKeyPath = 'ops\secrets\ed25519_public.pem',
  [switch]$SkipExtract,
  [string]$ProjectId = '',
  [string]$ReceiptOutDir = ''
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$core = Join-Path $PSScriptRoot '..\tools\reporting\delivery_acceptance_core.mjs'
if (-not (Test-Path $core)) {
  Write-Host '[ RED ] 缺 tools/reporting/delivery_acceptance_core.mjs（四关判据真源）' -ForegroundColor Red
  Write-Host 'ACCEPTANCE_FAILED 1 项' -ForegroundColor Red
  exit 1
}

$dir = Resolve-Path $DeliveryDir
$tar = Get-ChildItem -Path $dir -Filter '*Client_Delivery.tar.gz' -File | Select-Object -First 1
if (-not $tar) {
  Write-Host '[ RED ] 找不到 *Client_Delivery.tar.gz' -ForegroundColor Red
  Write-Host 'ACCEPTANCE_FAILED 1 项' -ForegroundColor Red
  exit 1
}

# 侧车两种历史命名（tar_sha256_sidecar.txt 与 <name>.tar.gz.sha256）由核心统一认。
$nodeArgs = @($core, $tar.FullName, '--public-key', $PublicKeyPath)
if ($SkipExtract) { $nodeArgs += '--skip-extract' }
if ($ProjectId) { $nodeArgs += @('--project-id', $ProjectId) }
if ($ReceiptOutDir) { $nodeArgs += @('--receipt-out', $ReceiptOutDir) }
node @nodeArgs
exit $LASTEXITCODE
