#!/usr/bin/env bash
# 真实 Python 母版脚本端到端验证：bulk_figures 自带 layout_guard，
# 检查 sitecustomize 的模板是否仍能叠加生效（画幅 / DPI）。
set -uo pipefail

TMP=/tmp/bio_layout_e2e_py
rm -rf "$TMP"
mkdir -p "$TMP/processed" "$TMP/figures"

cp /mnt/ssd/bio_data/projects/default/line1_bulk/processed/expr_genes.tsv \
   /mnt/ssd/bio_data/projects/default/line1_bulk/processed/deg_all.tsv \
   /mnt/ssd/bio_data/projects/default/line1_bulk/processed/pca_scores.tsv \
   /mnt/ssd/bio_data/projects/default/line1_bulk/processed/group_map.tsv \
   /mnt/ssd/bio_data/projects/default/line1_bulk/processed/sample_qc.tsv \
   "$TMP/processed/"

cat > "$TMP/project.json" <<'JSON'
{
  "project_id": "E2E_LAYOUT_PY",
  "plot_layout_config": {
    "template_id": "template_2_cell_wide",
    "dpi": 300,
    "theme_rules": {
      "aspect_ratio": "16:9",
      "legend_position": "bottom_center",
      "legend_direction": "horizontal",
      "axis_style": "boxed",
      "x_label_rotation": "auto_45",
      "show_footnote_panel": true
    }
  }
}
JSON

export BIOANALYS_PROJECT_JSON="$TMP/project.json"
export PYTHONPATH="/mnt/ssd/bio_data/ops/layout_autoload:${PYTHONPATH:-}"
export BIOANALYS_SEED=20261018
export PATH="/mnt/ssd/bio_data/ops/layout_autoload/bin:/mnt/ssd/bio_data/bin/line1_bulk:$PATH"

cd "$TMP/processed" || exit 1
bash /mnt/ssd/bio_data/bin/line1_bulk/bulk_figures --input . --seed 20261018 \
  > "$TMP/stdout.log" 2> "$TMP/stderr.log"
echo "EXIT=$?"
echo "--- stdout (tail) ---"
tail -8 "$TMP/stdout.log"
echo "--- stderr ---"
cat "$TMP/stderr.log"
echo "--- figures ---"
ls -l "$TMP/figures"

python3 - "$TMP/figures" <<'PY'
import glob
import os
import struct
import sys

out = sys.argv[1]
for path in sorted(glob.glob(os.path.join(out, "*.png"))):
    with open(path, "rb") as fh:
        data = fh.read(33)
    width, height = struct.unpack(">II", data[16:24])
    dpi = None
    with open(path, "rb") as fh:
        blob = fh.read(4096)
    idx = blob.find(b"pHYs")
    if idx >= 0:
        px, py, unit = struct.unpack(">IIB", blob[idx + 4:idx + 13])
        if unit == 1:
            dpi = (round(px * 0.0254), round(py * 0.0254))
    print(os.path.basename(path), "%dx%d" % (width, height),
          "ratio=%.3f" % (width / height), "dpi=%s" % (dpi,))
PY
