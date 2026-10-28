$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$baseUri = 'http://127.0.0.1:18788'
$projectId = 'PRJ_AIMS_V3_20261027'

$cases = @(
  [pscustomobject]@{
    id = 'fig_l1_groupedbar'; line = 'line1_bulk'
    input = 'data/line1_bulk/processed/enrichment_gsea_go.tsv'
    vars = [ordered]@{ input_data = 'data/line1_bulk/processed/enrichment_gsea_go.tsv'; x_col = 'Description'; value_col = 'NES'; group_col = 'ont' }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_groupedbar.png'
  },
  [pscustomobject]@{
    id = 'fig_l1_scatter'; line = 'line1_bulk'
    input = 'data/line1_bulk/processed/ml_core_hub_genes.tsv'
    vars = [ordered]@{ input_data = 'data/line1_bulk/processed/ml_core_hub_genes.tsv'; x_col = 'rf_importance'; y_col = 'gbdt_importance'; label_genes = @('CXCL16') }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_scatter.png'
  },
  [pscustomobject]@{
    id = 'fig_l1_boxplot'; line = 'line1_bulk'
    input = 'data/line1_bulk/processed/deg_all.tsv'
    vars = [ordered]@{ input_data = 'data/line1_bulk/processed/deg_all.tsv'; value_col = 'log2FC' }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_boxplot.png'
  },
  [pscustomobject]@{
    id = 'fig_l1_density'; line = 'line1_bulk'
    input = 'data/line1_bulk/processed/expr_genes.tsv'
    vars = [ordered]@{ input_data = 'data/line1_bulk/processed/expr_genes.tsv' }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_density.png'
  },
  [pscustomobject]@{
    id = 'fig_l1_histogram'; line = 'line1_bulk'
    input = 'data/line1_bulk/processed/expr_genes.tsv'
    vars = [ordered]@{ input_data = 'data/line1_bulk/processed/expr_genes.tsv' }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_histogram.png'
  },
  [pscustomobject]@{
    id = 'fig_l1_violin'; line = 'line1_bulk'
    input = 'data/line1_bulk/processed/deg_all.tsv'
    vars = [ordered]@{ input_data = 'data/line1_bulk/processed/deg_all.tsv'; value_col = 'log2FC' }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_violin.png'
  },
  [pscustomobject]@{
    id = 'fig_l2_umap'; line = 'line2_scrna'
    input = 'data/line2_scrna/processed/scrna_clustered.h5ad'
    vars = [ordered]@{ input_data = 'data/line2_scrna/processed/scrna_clustered.h5ad'; group_col = 'leiden' }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2_umap.png'
  },
  [pscustomobject]@{
    id = 'fig_l3_multipanel'; line = 'line1_bulk'
    input = 'data/line1_bulk/processed/external_validation_preds.tsv'
    vars = [ordered]@{ input_data = 'data/line1_bulk/processed/external_validation_preds.tsv'; group_col = 'true'; value_col = 'prob_LS' }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l3_multipanel.png'
  },
  [pscustomobject]@{
    id = 'fig_l2p_violin'; line = 'line2_scrna'
    input = 'data/line2_scrna/processed/celltype_composition.tsv'
    vars = [ordered]@{ input_data = 'data/line2_scrna/processed/celltype_composition.tsv'; group_col = 'celltype'; value_col = 'prop' }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2p_violin.png'
  },
  [pscustomobject]@{
    id = 'fig_l3_sankey'; line = 'line1_bulk'
    input = 'data/line1_bulk/processed/wgcna_modules.tsv'
    vars = [ordered]@{ input_data = 'data/line1_bulk/processed/wgcna_modules.tsv'; module_col = 'module' }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l3_sankey.png'
  }
)

function Wait-Task {
  param([string]$TaskId)
  Start-Sleep -Seconds 60
  while ($true) {
    $running = Invoke-RestMethod -Uri "$baseUri/api/tasks" -TimeoutSec 15
    $still = @($running.tasks | Where-Object { $_.taskId -eq $TaskId })
    if ($still.Count -eq 0) { return }
    Start-Sleep -Seconds 60
  }
}

$results = @()
foreach ($case in $cases) {
  Write-Host "[CASE] $($case.id)"
  $deriveBody = @{
    projectId = $projectId
    lineId = $case.line
    templateId = $case.id
    adaptVars = $case.vars
    seed = 20261013
  } | ConvertTo-Json -Depth 10
  $derive = Invoke-RestMethod -Uri "$baseUri/api/figures/adapt/derive" -Method Post -ContentType 'application/json' -Body $deriveBody -TimeoutSec 60
  if (-not $derive.ok) { throw "derive failed for $($case.id): $($derive.errors -join '; ')" }
  $submitBody = $derive.task | ConvertTo-Json -Depth 10
  $submit = Invoke-RestMethod -Uri "$baseUri/api/tasks/submit" -Method Post -ContentType 'application/json' -Body $submitBody -TimeoutSec 60
  if (-not $submit.taskId) { throw "submit failed for $($case.id): $($submit.error)" }
  Wait-Task -TaskId $submit.taskId
  $ledgerGlob = "/mnt/ssd/bio_data/system_logs/*_${projectId}_$($case.line)_adapt_$($case.id)_*.json"
  $remoteLedger = (ssh k40-ubuntu "ls -t $ledgerGlob | head -n 1").Trim()
  if (-not $remoteLedger) { throw "ledger missing for $($case.id)" }
  $ledger = (ssh k40-ubuntu "cat '$remoteLedger'") | ConvertFrom-Json
  if ($ledger.status -ne 'completed' -or [int]$ledger.exit_code -ne 0
      -or $ledger.checkpoint_status -ne 'passed') {
    throw "K40 task failed for $($case.id): status=$($ledger.status) exit=$($ledger.exit_code) checkpoint=$($ledger.checkpoint_status)"
  }
  $remoteOutput = [string]$ledger.io_files.output[0]
  $remoteHash = ((ssh k40-ubuntu "sha256sum '$remoteOutput'") -split '\s+')[0].Trim().ToLowerInvariant()
  $localOutput = Join-Path $repo $case.output
  if (-not (Test-Path -LiteralPath $localOutput)) { throw "local output missing for $($case.id): $localOutput" }
  $bytes = (Get-Item -LiteralPath $localOutput).Length
  if ($bytes -le 1000) { throw "local output too small for $($case.id): $bytes" }
  $localHash = (Get-FileHash -LiteralPath $localOutput -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($localHash -ne $remoteHash) {
    throw "local/remote hash mismatch for $($case.id): $localHash != $remoteHash"
  }
  $results += [pscustomobject]@{
    template_id = $case.id
    line_id = $case.line
    task_id = $ledger.task_id
    input = $case.input
    local_output = $case.output
    bytes = $bytes
    sha256 = $localHash
    ledger = $remoteLedger
  }
}
$results | Export-Csv -LiteralPath (Join-Path $PSScriptRoot 'new_adapter_results.csv') -NoTypeInformation -Encoding utf8
$results | ConvertTo-Json -Depth 5
