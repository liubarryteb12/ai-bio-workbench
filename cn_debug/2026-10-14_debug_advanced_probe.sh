#!/usr/bin/env bash
# 探针：补做高级分析前确认环境与产物结构（只读）
set -u
P=/mnt/ssd/bio_data/projects/default

echo "=== R packages ==="
Rscript -e 'pkgs <- c("GSVA","clusterProfiler","org.Hs.eg.db","org.Mm.eg.db","msigdbr","limma","BiocParallel","GSEABase"); for (p in pkgs) cat(sprintf("%-16s %s\n", p, requireNamespace(p, quietly=TRUE)))' 2>&1 | tail -20

echo "=== python packages ==="
python3 -c 'import gseapy; print("gseapy", gseapy.__version__); print("has_ssgsea", hasattr(gseapy, "ssgsea")); print("has_gsva", hasattr(gseapy, "gsva"))' 2>&1 | tail -5

echo "=== line2 ko_dr_genes.tsv ==="
head -2 "$P/line2_scrna/processed/ko_dr_genes.tsv"
echo "rows:"; wc -l < "$P/line2_scrna/processed/ko_dr_genes.tsv"

echo "=== line2 cluster_markers.tsv ==="
head -2 "$P/line2_scrna/processed/cluster_markers.tsv"

echo "=== line2 deg_all_by_celltype.tsv ==="
head -2 "$P/line2_scrna/processed/deg_all_by_celltype.tsv"

echo "=== line2 dr_genes_summary.tsv ==="
head -3 "$P/line2_scrna/processed/dr_genes_summary.tsv"

echo "=== line3 ko_dr_genes_mouse.tsv ==="
head -2 "$P/line3_spatial/processed/ko_dr_genes_mouse.tsv"
echo "rows:"; wc -l < "$P/line3_spatial/processed/ko_dr_genes_mouse.tsv"

echo "=== line3 domain_markers_mouse.tsv ==="
head -2 "$P/line3_spatial/processed/domain_markers_mouse.tsv"

echo "=== line3 gene_localization_mouse.tsv ==="
head -2 "$P/line3_spatial/processed/gene_localization_mouse.tsv"

echo "=== line2 gmt cache ==="
ls -la "$P/line2_scrna/references/gmt_cache/" 2>/dev/null | head -12
ls -la /mnt/ssd/bio_data/projects/default/line2_scrna/references/ 2>/dev/null | head

echo "=== h5ad uns keys (line2 knockout / deg / annotated) ==="
python3 - <<'PY'
import anndata as ad, os
P = "/mnt/ssd/bio_data/projects/default/line2_scrna/processed"
for f in ["scrna_knockout.h5ad", "scrna_deg.h5ad", "scrna_annotated.h5ad"]:
    p = os.path.join(P, f)
    if not os.path.exists(p):
        print(f, "MISSING"); continue
    a = ad.read_h5ad(p)
    print("--", f, a.shape)
    print("   uns:", list(a.uns.keys()))
    print("   obs:", list(a.obs.columns))
    print("   var:", list(a.var.columns))
PY
