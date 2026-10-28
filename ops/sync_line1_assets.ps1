# 用途：把 K40 上的 line1_bulk 改造资产拉回本地工作区，保证双端一致。
# 背景：改造脚本的唯一母版在 K40 /mnt/ssd/bio_data/bin/line1_bulk/，本地
# src/line1_bulk/scripts/ 只是副本。任何远端改动都要用本脚本回灌，避免手工搬运出错。
#
# 用法：pwsh -File ops/sync_line1_assets.ps1
# 可选：pwsh -File ops/sync_line1_assets.ps1 -CheckOnly
#
# 前置条件：ssh -p 10022 k40-ubuntu 能免密登录。

param(
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

$RemoteHost = "k40-ubuntu"
$RemotePort = 10022
$RemoteDir = "/mnt/ssd/bio_data/bin/line1_bulk"
$LocalDir = Join-Path $PSScriptRoot "..\src\line1_bulk\scripts"

# 与远端台账 ledger-separator-detection-fix.md 中的清单保持一致。
$Assets = @(
    "gsva_pathway_score"
    "lasso_cox_model"
    "wgcna_module_trait"
    "geo_tcga_common_deg"
    "limma_deg_analysis"
    "roc_diagnostic_curve"
    "geo_pca_scatter"
    "univariate_cox_screen"
    "multivariate_cox_model"
    "lasso_feature_select"
    "multi_metric_survival_roc"
    "prognostic_diagnostic_roc"
    "survival_analysis"
"rf_gene_select"
"cibersort_reference"
"oncopredict_ridge"
"drug_sensitivity_correlation"
)

if (-not (Test-Path $LocalDir)) {
    New-Item -ItemType Directory -Path $LocalDir -Force | Out-Null
    Write-Output "created_local_dir=$LocalDir"
}

$mismatch = 0
$missing = 0
$synced = 0

foreach ($asset in $Assets) {
    $remotePath = "$RemoteDir/$asset"
    $localPath = Join-Path $LocalDir $asset

    $remoteHash = (& ssh -p $RemotePort $RemoteHost "sha256sum $remotePath 2>/dev/null | cut -d' ' -f1").Trim()
    if ([string]::IsNullOrWhiteSpace($remoteHash)) {
        Write-Output "MISSING_REMOTE=$asset"
        $missing++
        continue
    }

    if (Test-Path $localPath) {
        $localHash = (Get-FileHash -Path $localPath -Algorithm SHA256).Hash.ToLower()
    } else {
        $localHash = ""
    }

    if ($localHash -eq $remoteHash) {
        Write-Output "IN_SYNC=$asset $remoteHash"
        continue
    }

    if ($CheckOnly) {
        Write-Output "OUT_OF_SYNC=$asset remote=$remoteHash local=$localHash"
        $mismatch++
        continue
    }

    & scp -P $RemotePort "${RemoteHost}:${remotePath}" $localPath
    if ($LASTEXITCODE -ne 0) {
        Write-Output "SCP_FAILED=$asset exit=$LASTEXITCODE"
        $mismatch++
        continue
    }

    $pulledHash = (Get-FileHash -Path $localPath -Algorithm SHA256).Hash.ToLower()
    if ($pulledHash -ne $remoteHash) {
        Write-Output "HASH_MISMATCH_AFTER_PULL=$asset remote=$remoteHash local=$pulledHash"
        $mismatch++
        continue
    }

    Write-Output "SYNCED=$asset $remoteHash"
    $synced++
}

Write-Output "SUMMARY synced=$synced out_of_sync=$mismatch missing_remote=$missing total=$($Assets.Count)"

if ($mismatch -gt 0 -or $missing -gt 0) {
    exit 1
}
exit 0
