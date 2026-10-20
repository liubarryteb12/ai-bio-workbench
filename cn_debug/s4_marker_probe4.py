# s4_marker_probe4：导出步骤5产物键集合到 JSON（供输入契约定稿，避免 ssh 输出截断）
import json

import anndata as ad

ad.settings.allow_write_nullable_strings = False

PATHS = {
    "mouse": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_domains_mouse.h5ad",
    "human": "/mnt/ssd/bio_data/line3_spatial/processed/spatial_domains_human.h5ad",
}
out = {}
for species, path in PATHS.items():
    a = ad.read_h5ad(path)
    out[species] = {
        "obs_cols": sorted(str(c) for c in a.obs.columns),
        "var_cols": sorted(str(c) for c in a.var.columns),
        "uns_keys": sorted(str(k) for k in a.uns.keys()),
        "layers": sorted(str(k) for k in a.layers.keys()),
        "obsm": sorted(str(k) for k in a.obsm.keys()),
        "shape": list(a.shape),
        "X_format": a.X.getformat(),
        "domain_nunique": int(a.obs["domain"].nunique()),
    }
with open("/tmp/s4_step5_keys.json", "w") as fh:
    json.dump(out, fh, indent=1, ensure_ascii=False)
print("PROBE4_DONE")
