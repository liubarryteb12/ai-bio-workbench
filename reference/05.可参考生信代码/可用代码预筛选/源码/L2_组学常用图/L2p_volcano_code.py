"""L2 Python 火山图。

用途：同时展示差异表达倍数与显著性，区分上调、下调和不显著基因。
输入数据契约：至少需要 log2FC 与 pvalue 两个数值向量；本脚本内置可复现示例数据。
关键函数：numpy 数组运算、matplotlib.pyplot.scatter() 与 fig.savefig()。
"""

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

rng = np.random.default_rng(42)
plt.rcParams.update({"font.size": 7, "axes.linewidth": 0.6, "savefig.dpi": 300})

n = 4000
log2fc = rng.normal(0, 1.2, n)
pval = rng.uniform(0, 1, n)

order = np.argsort(pval)
ranked = pval[order]
q = ranked * n / np.arange(1, n + 1)
q = np.minimum.accumulate(q[::-1])[::-1]
q = np.clip(q, 0, 1)
padj = np.empty(n)
padj[order] = q

cls = np.where(
    (padj < 0.05) & (log2fc > 1),
    "Up",
    np.where((padj < 0.05) & (log2fc < -1), "Down", "NS"),
)

fig, ax = plt.subplots(figsize=(89 / 25.4, 75 / 25.4))
for class_name, colour, label in [
    ("NS", "#b0b0b0", "NS"),
    ("Up", "#D55E00", "Up"),
    ("Down", "#0072B2", "Down"),
]:
    mask = cls == class_name
    ax.scatter(
        log2fc[mask],
        -np.log10(pval[mask]),
        s=2.5,
        c=colour,
        label=label,
        alpha=0.75,
        linewidths=0,
    )

ax.axvline(1, ls="--", lw=0.5, c="#444444")
ax.axvline(-1, ls="--", lw=0.5, c="#444444")
ax.axhline(-np.log10(0.05), ls="--", lw=0.5, c="#444444")

for i in np.argsort(padj)[:8]:
    ax.annotate(
        f"G{i}",
        (log2fc[i], -np.log10(pval[i])),
        fontsize=4.5,
    )

ax.set_xlabel("log2(Fold Change)")
ax.set_ylabel("-log10(P)")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)

fig.savefig("L2p_volcano_verified.png", bbox_inches="tight")
fig.savefig("L2p_volcano_verified.pdf", bbox_inches="tight")
plt.close(fig)
print("RENDER_OK volcano_py")
