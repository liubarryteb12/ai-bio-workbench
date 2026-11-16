<#
.SYNOPSIS
  tools\ops\init_workspace_hierarchy.ps1
  幂等初始化 data\workspace\ 四层目录收敛结构与系统运行区。

.DESCRIPTION
  四层工作区结构（2026-11-14 规约）：
    - data\workspace\references_db\ （外部公共数据与注释参考库）
    - data\workspace\inbox\         （客户需求包接收）
    - data\workspace\runs\          （按作业划分沙箱 00_input, 01_work, 02_output）
    - data\workspace\deliverables\  （终验合格脱敏交付包）
    - data\.ops_state\             （SQLite 状态机与租约）
    - data\logs\                   （系统与服务日志）
    - data\ledger\                 （知识台账与审计流水）
#>
param(
  [string]$DataHome = $env:BIO_DATA_HOME
)

$ErrorActionPreference = 'Stop'

if (-not $DataHome) {
  $repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
  $DataHome = Join-Path $repoRoot 'data'
}

$resolvedDataHome = [System.IO.Path]::GetFullPath($DataHome)
Write-Output "[INIT-WORKSPACE] 数据根路径: $resolvedDataHome"

$directories = @(
  (Join-Path $resolvedDataHome 'workspace\references_db'),
  (Join-Path $resolvedDataHome 'workspace\inbox'),
  (Join-Path $resolvedDataHome 'workspace\runs'),
  (Join-Path $resolvedDataHome 'workspace\deliverables'),
  (Join-Path $resolvedDataHome '.ops_state'),
  (Join-Path $resolvedDataHome 'logs'),
  (Join-Path $resolvedDataHome 'ledger')
)

foreach ($dir in $directories) {
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Write-Output "[CREATED] $dir"
  } else {
    Write-Output "[EXISTS]  $dir"
  }
}

$layoutMetaPath = Join-Path $resolvedDataHome 'workspace\.layout_version'
$metaContent = @{
  layout_version = "2.0.0"
  standard = "references_db,inbox,runs,deliverables"
  initialized_at = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
} | ConvertTo-Json -Compress

[System.IO.File]::WriteAllText($layoutMetaPath, $metaContent, [System.Text.UTF8Encoding]::new($false))
Write-Output "[INIT-WORKSPACE] 目录幂等初始化完成，元数据指纹: $layoutMetaPath"
