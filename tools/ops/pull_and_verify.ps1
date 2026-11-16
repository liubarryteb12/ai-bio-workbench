<#
.SYNOPSIS
  tools\ops\pull_and_verify.ps1
  通过 ADB 端口 10022 转发建立 SSH 隧道，流式调用 remote_pack.sh 拉取归档包。
  本地通过纯二进制落盘解压后，逐文件强比对 SHA-256。
  
.DESCRIPTION
  核心防线：
    1. 严禁 PowerShell 管道重定向二进制（改由 cmd.exe /c 原始字节流重定向落盘，杜绝 UTF-16 损毁）；
    2. 真正走 10022 端口进入 proot 容器，原子化调用 remote_pack.sh 先算哈希再流式打包；
    3. 彻底废除 /mnt/ssd/ 硬编码，改用环境变量 BIO_REMOTE_RUNS_ROOT；
    4. 正则安全拆分 sha256sum 行，完整支持带空格与子目录路径；
    5. 校验 100% 吻合签发 .verify_passed 回执；校验失败抛出 CHECKSUM_MISMATCH_ABORT 并保留远端现场。
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$JobId,
  [string]$RemoteRunsRoot = $(if ($env:BIO_REMOTE_RUNS_ROOT) { $env:BIO_REMOTE_RUNS_ROOT } else { '/data/data/com.termux/files/home/workspace/runs' }),
  [string]$RemoteJobDir = '',
  [string]$LocalRunsRoot = "$PSScriptRoot\..\..\data\workspace\runs",
  [int]$ForwardPort = 10022,
  [string]$SshUser = $(if ($env:BIO_SSH_USER) { $env:BIO_SSH_USER } else { 'root' }),
  [string]$RemotePackScript = $(if ($env:BIO_REMOTE_PACK_SCRIPT) { $env:BIO_REMOTE_PACK_SCRIPT } else { '/root/tools/ops/remote_pack.sh' }),
  # 离线或单测注入的预置归档包路径
  [string]$MockArchiveSource = ''
)

$ErrorActionPreference = 'Stop'

if (-not $RemoteJobDir) {
  $RemoteJobDir = "$RemoteRunsRoot/$JobId"
}

$targetJobDir = Join-Path $LocalRunsRoot $JobId
New-Item -ItemType Directory -Force -Path $targetJobDir | Out-Null
$resolvedLocalJobDir = [System.IO.Path]::GetFullPath($targetJobDir)

Write-Output "[PULL] 本动作业目标目录: $resolvedLocalJobDir"
Write-Output "[PULL] 远端容器作业目录: $RemoteJobDir"

$localArchive = Join-Path $resolvedLocalJobDir "run_artifacts.tar.zst"

if ($MockArchiveSource -and (Test-Path -LiteralPath $MockArchiveSource)) {
  Write-Output "[MOCK_MODE] 使用测试注入的归档包: $MockArchiveSource"
  Copy-Item -LiteralPath $MockArchiveSource -Destination $localArchive -Force
} else {
  # 1. 校验与建立 ADB 端口 10022 转发
  Write-Output "[ADB] 建立/校验端口转发 tcp:$ForwardPort -> tcp:$ForwardPort"
  try {
    & adb forward tcp:$ForwardPort tcp:$ForwardPort 2>&1 | Out-Null
  } catch {
    Write-Warning "[ADB_WARN] adb 端口转发抛出异常，尝试继续使用现有转发端口: $_"
  }

  # 2. 经由 cmd.exe /c 原始二进制流重定向落盘，杜绝 PowerShell 文本编码破坏
  Write-Output "[SSH_STREAM] 正在建立 SSH:10022 管道流式获取产物 (调用 remote_pack.sh)..."
  $sshTarget = "${SshUser}@127.0.0.1"
  $cmdStr = "ssh -p $ForwardPort -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o ConnectTimeout=15 $sshTarget ""bash '$RemotePackScript' '$RemoteJobDir' stream"" > `"$localArchive`""
  
  & cmd.exe /c $cmdStr
  $pullExitCode = $LASTEXITCODE

  if ($pullExitCode -ne 0) {
    if (Test-Path -LiteralPath $localArchive) { Remove-Item -LiteralPath $localArchive -Force }
    throw "[PULL_ERROR] SSH 流式拉取失败，退出码: $pullExitCode"
  }
}

if (-not (Test-Path -LiteralPath $localArchive) -or (Get-Item $localArchive).Length -le 100) {
  if (Test-Path -LiteralPath $localArchive) { Remove-Item -LiteralPath $localArchive -Force }
  throw "[PULL_ERROR] 拉取文件异常，归档包小于 100 字节或不存在，已终止并保留现场。"
}

$archiveBytes = (Get-Item $localArchive).Length
Write-Output ("[EXTRACT] 成功拉取纯二进制归档包 ({0:N2} MB)，开始本地解包..." -f ($archiveBytes / 1MB))

# 3. 本地解包（tar.exe 原生支持 zstd）
try {
  & tar -xf $localArchive -C $resolvedLocalJobDir
} finally {
  if (Test-Path -LiteralPath $localArchive) {
    Remove-Item -LiteralPath $localArchive -Force
  }
}

# 4. 逐文件 SHA-256 强比对（精准解析 Linux sha256sum 输出，防空格截断）
$checksumFile = Join-Path $resolvedLocalJobDir "checksums.sha256"
if (-not (Test-Path -LiteralPath $checksumFile)) {
  throw "[CHECKSUM_ERROR] 归档包中缺少 checksums.sha256 清单，无法完成闭环验收。"
}

function Compute-FileSha256([string]$filePath) {
  $stream = [System.IO.File]::OpenRead($filePath)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hashBytes = $sha.ComputeHash($stream)
    return (-join ($hashBytes | ForEach-Object { $_.ToString('x2') })).ToLower()
  } finally {
    $stream.Dispose()
  }
}

Write-Output "[VERIFY] 正在比对远端 SHA-256 清单与本地提取文件..."
$lines = Get-Content -LiteralPath $checksumFile
$failCount = 0
$verifiedCount = 0

foreach ($line in $lines) {
  $trimmed = $line.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
  # 按照连续空白字符切分为2部分：第一部分为Hash，第二部分为相对路径
  $parts = $trimmed -split '\s+', 2
  if ($parts.Length -lt 2) { continue }

  $expectedHash = $parts[0].Trim().ToLower()
  $cleanRelPath = $parts[1].Trim().TrimStart('*').Trim().Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $localFilePath = Join-Path $resolvedLocalJobDir $cleanRelPath

  if (-not (Test-Path -LiteralPath $localFilePath)) {
    Write-Warning "[MISSING] 本地缺少清单文件: $cleanRelPath"
    $failCount++
    continue
  }

  $actualHash = Compute-FileSha256 $localFilePath
  if ($actualHash -ne $expectedHash) {
    Write-Warning "[HASH_MISMATCH] 文件 $cleanRelPath 校验失败! 预期: $expectedHash, 实际: $actualHash"
    $failCount++
  } else {
    $verifiedCount++
  }
}

if ($failCount -gt 0) {
  throw "[CHECKSUM_MISMATCH_ABORT] 共 $failCount 个文件校验未通过，拉取失败，远端现场已完好保留！"
}

# 5. 校验 100% 通过，签发回执令牌
$tokenValue = "VERIFIED_AT_$(Get-Date -Format 'yyyyMMddTHHmmssZ')"
$receiptToken = Join-Path $resolvedLocalJobDir ".verify_passed"
[System.IO.File]::WriteAllText($receiptToken, $tokenValue, [System.Text.UTF8Encoding]::new($false))

Write-Output "[PULL_SUCCESS] $verifiedCount 个文件逐字节哈希 100% 校验通过，已签发回执令牌: $tokenValue"
return $tokenValue
