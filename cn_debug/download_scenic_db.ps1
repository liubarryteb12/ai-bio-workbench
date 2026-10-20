# 下载 pySCENIC cisTarget 人类数据库（本地中转，随后 scp 到手机 public_references/）
# 代理地址只在命令行临时使用，不写入任何持久文件。
$ErrorActionPreference = "Continue"
$dir = "d:\00.AIagent\codespace\AI辅助生信分析流程工作台\cn_debug\scenic_db"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$proxy = "http://127.0.0.1:7890"
$base = "https://resources.aertslab.org/cistarget/databases/homo_sapiens/hg38/refseq_r80/mc_v10_clust/gene_based"
$files = @(
  @{ name = "hg38_10kbp_up_10kbp_down_full_tx_v10_clust.genes_vs_motifs.rankings.feather"; url = "$base/hg38_10kbp_up_10kbp_down_full_tx_v10_clust.genes_vs_motifs.rankings.feather" },
  @{ name = "hg38_500bp_up_100bp_down_full_tx_v10_clust.genes_vs_motifs.rankings.feather"; url = "$base/hg38_500bp_up_100bp_down_full_tx_v10_clust.genes_vs_motifs.rankings.feather" },
  @{ name = "motifs-v10nr_clust-nr.hgnc-m0.001-o0.0.tbl"; url = "https://resources.aertslab.org/cistarget/motif2tf/motifs-v10nr_clust-nr.hgnc-m0.001-o0.0.tbl" }
)
foreach ($f in $files) {
  $out = Join-Path $dir $f.name
  Write-Output "[download] $($f.name)"
  curl.exe -L --proxy $proxy -sS -o $out $f.url
  if (Test-Path $out) {
    $mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
    Write-Output "[done] $($f.name) = $mb MB"
  } else {
    Write-Output "[fail] $($f.name)"
  }
}
Write-Output "ALL_DONE"
