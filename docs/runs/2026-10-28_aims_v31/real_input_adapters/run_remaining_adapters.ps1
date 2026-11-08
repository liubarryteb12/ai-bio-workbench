$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$runDir = $PSScriptRoot
$baseUri = 'http://127.0.0.1:18787'
$projectId = 'PRJ_AIMS_V3_20261027'

$cases = @(
  [pscustomobject]@{
    id = 'fig_l2_pca'
    line = 'line1_bulk'
    input = 'data/line1_bulk/processed/pca_scores.tsv'
    vars = [ordered]@{
      input_data = 'data/line1_bulk/processed/pca_scores.tsv'
      group_col = 'group'
    }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l2_pca.png'
  },
  [pscustomobject]@{
    id = 'fig_l2_heatmap'
    line = 'line1_bulk'
    input = 'data/line1_bulk/processed/expr_genes.tsv'
    vars = [ordered]@{
      input_data = 'data/line1_bulk/processed/expr_genes.tsv'
      row_col = 'gene'
      column_col = 'sample'
      value_col = 'expr'
      group_col = 'group'
    }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l2_heatmap.png'
  },
  [pscustomobject]@{
    id = 'fig_l2_volcano'
    line = 'line1_bulk'
    input = 'data/line1_bulk/processed/deg_all.tsv'
    vars = [ordered]@{
      input_data = 'data/line1_bulk/processed/deg_all.tsv'
      group_col = 'group'
      label_genes = @('ELOVL2')
    }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l2_volcano.png'
  },
  [pscustomobject]@{
    id = 'fig_l2p_dotplot'
    line = 'line2_scrna'
    input = 'data/line2_scrna/processed/target_gene_localization.tsv'
    vars = [ordered]@{
      input_data = 'data/line2_scrna/processed/target_gene_localization.tsv'
      group_col = 'celltype'
    }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2p_dotplot.png'
  },
  [pscustomobject]@{
    id = 'fig_l2p_volcano'
    line = 'line2_scrna'
    input = 'data/line2_scrna/processed/deg_all_by_celltype.tsv'
    vars = [ordered]@{
      input_data = 'data/line2_scrna/processed/deg_all_by_celltype.tsv'
      group_col = 'celltype'
      label_genes = @('S100A8')
    }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2p_volcano.png'
  },
  [pscustomobject]@{
    id = 'fig_l2p_umap'
    line = 'line3_spatial'
    input = 'data/line3_spatial/processed/spatial_dimred_human.h5ad'
    vars = [ordered]@{
      input_data = 'data/line3_spatial/processed/spatial_dimred_human.h5ad'
      group_col = 'group'
    }
    output = 'local_projects/PRJ_AIMS_V3_20261027/figures/line3_spatial/custom_fig_l2p_umap.png'
  }
)

$results = @()
foreach ($case in $cases) {
  $body = @{
    projectId = $projectId
    lineId = $case.line
    templateId = $case.id
    adaptVars = $case.vars
    seed = 20261013
  } | ConvertTo-Json -Depth 8

  $derive = Invoke-RestMethod -Uri "$baseUri/api/figures/adapt/derive" -Method Post -ContentType 'application/json' -Body $body
  if (-not $derive.ok) {
    throw "derive failed for $($case.id): $($derive.errors -join '; ')"
  }
  $submit = Invoke-RestMethod -Uri "$baseUri/api/tasks/submit" -Method Post -ContentType 'application/json' -Body ($derive.task | ConvertTo-Json -Depth 8)
  if (-not $submit.taskId) {
    throw "submit failed for $($case.id): $($submit.error)"
  }

  do {
    Start-Sleep -Seconds 60
    $running = Invoke-RestMethod -Uri "$baseUri/api/tasks" -TimeoutSec 10
  } while ($running.tasks.Count -gt 0)

  $ledgerGlob = "/mnt/ssd/bio_data/system_logs/*_${projectId}_$($case.line)_adapt_$($case.id)_*.json"
  $remoteLedger = (ssh k40-ubuntu "ls -t $ledgerGlob | head -n 1").Trim()
  if (-not $remoteLedger) {
    throw "ledger missing for $($case.id)"
  }
  $localLedger = Join-Path $runDir "$($case.id)_ledger.json"
  scp -o BatchMode=yes -o ConnectTimeout=10 "k40-ubuntu:$remoteLedger" $localLedger
  $ledger = Get-Content -Raw -LiteralPath $localLedger | ConvertFrom-Json
  $localOutput = Join-Path $repo $case.output
  if ($ledger.status -ne 'completed' -or $ledger.exit_code -ne 0) {
    throw "K40 task failed for $($case.id): status=$($ledger.status) exit=$($ledger.exit_code)"
  }
  if (-not (Test-Path -LiteralPath $localOutput)) {
    throw "local output missing for $($case.id): $localOutput"
  }
  $hash = (Get-FileHash -LiteralPath $localOutput -Algorithm SHA256).Hash.ToLowerInvariant()
  $results += [pscustomobject]@{
    template_id = $case.id
    line_id = $case.line
    task_id = $ledger.task_id
    status = $ledger.status
    exit_code = $ledger.exit_code
    input = $ledger.io_files.input[0]
    output = $ledger.io_files.output[0]
    local_output = $case.output
    sha256 = $hash
    bytes = (Get-Item -LiteralPath $localOutput).Length
    ledger = $remoteLedger
  }
}

$results | Export-Csv -LiteralPath (Join-Path $runDir 'real_input_results.csv') -NoTypeInformation -Encoding utf8
$results | ConvertTo-Json -Depth 6
