# s3_dr_summary_probe2.py — 一次性原型探针 2
# 目的：确认汇总可用的两项数据
#   - uns['annotation'] 的 marker 集结构（步骤 6 的 16 类 marker）
#   - layers 是否存在 counts（决定能否算 per-celltype 表达占比）
import anndata as ad
import pandas as pd

ad.settings.allow_write_nullable_strings = False  # 坑 #107
ko = ad.read_h5ad("/mnt/ssd/bio_data/line2_scrna/processed/scrna_knockout.h5ad")
print("layers:", list(ko.layers.keys()))
ann = ko.uns["annotation"]
print("annotation keys:", sorted(ann.keys()))
markers = ann.get("marker_sets")
if markers is not None:
    print("marker type:", type(markers).__name__)
    if isinstance(markers, pd.DataFrame):
        print("marker shape:", markers.shape, "columns:", list(markers.columns))
        print(markers.head(3).to_string())
    elif isinstance(markers, dict):
        keys = list(markers.keys())[:20]
        print("marker dict keys:", keys)
        first = markers[keys[0]]
        print("first value:", first)
celltype_counts = ko.obs["celltype"].value_counts()
print("celltype counts:", dict(celltype_counts))
