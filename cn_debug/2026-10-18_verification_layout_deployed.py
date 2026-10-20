"""部署后冒烟：从 /mnt/ssd/bio_data/ops 导入 layout_helper，跑一遍默认模板。"""
import sys

sys.path.insert(0, "/mnt/ssd/bio_data/ops")

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from layout_helper import apply_sci_plot_layout, load_layout_spec

spec = load_layout_spec("/tmp/layout_verify/no_such.json")
fig, ax = plt.subplots()
ax.bar(range(4), range(4), label="group")
ax.set_title("deployed smoke")
fig, ax, dpi = apply_sci_plot_layout(fig, ax, spec, footnote_text="n=16")
fig.savefig("/tmp/layout_verify/deployed_smoke.png", dpi=dpi, bbox_inches="tight")
print("deployed-ok", spec["template_id"], dpi)
