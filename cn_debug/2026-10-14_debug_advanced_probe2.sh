#!/usr/bin/env bash
# 探针2：虚拟敲除 uns 结构 + 小鼠基因集可达性 + BiocManager
set -u
P=/mnt/ssd/bio_data/projects/default

echo "=== line2 uns['virtual_knockout'] ==="
python3 - <<'PY'
import anndata as ad
a = ad.read_h5ad("/mnt/ssd/bio_data/projects/default/line2_scrna/processed/scrna_knockout.h5ad")
vk = a.uns["virtual_knockout"]
print("type:", type(vk).__name__)
if isinstance(vk, dict):
    for k, v in vk.items():
        t = type(v).__name__
        s = str(v)
        print("  %-28s %-10s %s" % (k, t, s[:110].replace("\n", " ")))
print("--- annotation uns keys ---")
ann = a.uns.get("annotation")
if isinstance(ann, dict):
    for k, v in ann.items():
        print("  %-28s %-10s %s" % (k, type(v).__name__, str(v)[:100].replace("\n", " ")))
PY

echo "=== BiocManager / 小鼠注释包 ==="
Rscript -e 'cat("BiocManager", requireNamespace("BiocManager", quietly=TRUE), "\n"); cat("AnnotationDbi", requireNamespace("AnnotationDbi", quietly=TRUE), "\n")' 2>&1 | tail -5

echo "=== gseapy 小鼠库可达性 ==="
python3 - <<'PY' 2>&1 | tail -12
import gseapy
for name, org in [("KEGG_2019_Mouse", "mouse"),
                  ("GO_Biological_Process_2023", "human"),
                  ("WikiPathways_2019_Mouse", "mouse")]:
    try:
        gs = gseapy.get_library(name=name, organism=org)
        print("OK  %-34s terms=%d" % (name, len(gs)))
    except Exception as e:
        print("ERR %-34s %s" % (name, str(e)[:80]))
PY

echo "=== line3 uns['knockout'] 结构 ==="
python3 - <<'PY'
import anndata as ad
a = ad.read_h5ad("/mnt/ssd/bio_data/projects/default/line3_spatial/processed/spatial_knockout_mouse.h5ad")
ko = a.uns.get("knockout")
print("type:", type(ko).__name__)
if isinstance(ko, dict):
    for k, v in ko.items():
        print("  %-24s %-10s %s" % (k, type(v).__name__, str(v)[:120].replace("\n", " ")))
PY

echo "=== line2 SCENIC regulon 靶基因结构（调控网络用） ==="
python3 - <<'PY'
import pandas as pd
r = pd.read_csv("/mnt/ssd/bio_data/projects/default/line2_scrna/processed/scenic_regulons.csv", index_col=[0,1], header=[0,1])
print("regulons.csv shape:", r.shape)
print("cols:", [c for c in r.columns][:8])
PY
