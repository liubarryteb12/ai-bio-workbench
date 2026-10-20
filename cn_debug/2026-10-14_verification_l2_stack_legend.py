"""l2_05 composition_stack 图例压图复现与修法验证（本地最小数据）。"""
import pathlib

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

OUT = pathlib.Path(r"d:/00.AIagent/codespace/AI辅助生信分析流程工作台/cn_debug/fig_caption_check")
OUT.mkdir(parents=True, exist_ok=True)

plt.rcParams.update({
    "figure.dpi": 150, "savefig.dpi": 150, "font.size": 9,
    "axes.titlesize": 10, "axes.grid": False,
    "figure.autolayout": True, "savefig.bbox": "tight",
    "image.cmap": "viridis",
})


def caption(fig, *parts):
    parts = [str(p) for p in parts if p not in (None, "")]
    if not parts:
        return
    w, h = fig.get_size_inches()
    if w >= h:
        fig.text(0.5, -0.02, "   |   ".join(parts),
                 ha="center", va="top", fontsize=8)
    else:
        fig.text(1.02, 1.0, "\n".join(parts),
                 ha="left", va="top", fontsize=8, linespacing=1.5)


def cat_colors(labels):
    cats = sorted(set(labels))
    cmap = plt.get_cmap("tab20")
    return {c: cmap(i % 20) for i, c in enumerate(cats)}, cats


donors = ["H061", "H062", "H066", "P185", "P186", "P187", "P189", "P190"]
diag = ["Healthy"] * 3 + ["Psoriasis"] * 5
celltypes = ["Langerhans_cell", "NK_ILC", "T_cell", "activated_keratinocyte",
             "basal_keratinocyte", "channel_keratinocyte", "macrophage_mDC",
             "melanocyte", "mitotic", "pDC", "progenitor_keratinocyte",
             "suprabasal_keratinocyte", "unknown"]
rng = np.random.default_rng(42)
prop = rng.dirichlet(np.ones(len(celltypes)) * 0.6, size=len(donors))

# --- 修法：图例移到轴框外右侧 ---
colors, _ = cat_colors(celltypes)
plt.rcParams["figure.autolayout"] = False
fig, ax = plt.subplots(figsize=(11, 6.5))
bottom = np.zeros(len(donors))
for ci, c in enumerate(celltypes):
    ax.bar(range(len(donors)), prop[:, ci], bottom=bottom,
           color=colors[c], label=c, width=0.7)
    bottom += prop[:, ci]
ax.set_xticks(range(len(donors)))
ax.set_xticklabels(["%s\n(%s)" % (d, diag[i]) for i, d in enumerate(donors)], fontsize=8)
ax.set_ylabel("celltype proportion")
caption(fig, "line2 scrna: celltype composition per donor",
        "from step14 scrna_composition",
        "n=%d donors, diagnosis labeled" % len(donors))
ax.legend(fontsize=8, ncol=1, loc="upper left", bbox_to_anchor=(1.02, 1.0),
          borderaxespad=0, frameon=False)
fig.subplots_adjust(left=0.07, right=0.76, top=0.97, bottom=0.16)
fig.savefig(OUT / "l2_05_fixed.png")
plt.close(fig)
plt.rcParams["figure.autolayout"] = True
print("wrote", OUT / "l2_05_fixed.png")
