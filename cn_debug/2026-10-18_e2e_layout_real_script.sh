#!/usr/bin/env bash
# 真实母版脚本端到端验证：pca_matrix 显式传 width=6,height=5，
# 检查 Rprofile 包装后模板是否仍生效（画幅应为 16:9）。
set -uo pipefail

TMP=/tmp/bio_layout_e2e
rm -rf "$TMP"
mkdir -p "$TMP"

cat > "$TMP/project.json" <<'JSON'
{
  "project_id": "E2E_LAYOUT",
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
export BIOANALYS_LAYOUT_LIB=/mnt/ssd/bio_data/bin
export R_PROFILE_USER=/mnt/ssd/bio_data/ops/layout_autoload/Rprofile
export BIOANALYS_SEED=20261018
# 与 task.js 一致：垫片目录必须排在 /usr/bin 前面
export PATH="/mnt/ssd/bio_data/ops/layout_autoload/bin:/mnt/ssd/bio_data/bin/line1_bulk:$PATH"

cd "$TMP" || exit 1
bash /mnt/ssd/bio_data/bin/line1_bulk/pca_matrix \
  --input /mnt/ssd/bio_data/projects/default/line1_bulk/processed/expr_genes.tsv \
  --input /mnt/ssd/bio_data/projects/default/line1_bulk/processed/group_map.tsv \
  --seed 20261018 > "$TMP/stdout.log" 2> "$TMP/stderr.log"
code=$?
echo "EXIT=$code"
echo "--- stdout (tail) ---"
tail -5 "$TMP/stdout.log"
echo "--- stderr ---"
cat "$TMP/stderr.log"
echo "--- files ---"
ls -l "$TMP"
echo "--- MediaBox ---"
strings "$TMP/pca_plot.pdf" | grep -i MediaBox | head -3
