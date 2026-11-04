"""L2 Python 三件套：火山图 / marker 点图 / 分组小提琴图（scanpy + seaborn 风格）"""
import numpy as np, scanpy as sc, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import scanpy.plotting as scp

rng = np.random.default_rng(42)
plt.rcParams.update({"font.size": 8, "axes.linewidth": 0.6, "savefig.dpi": 300,
                     "legend.frameon": False, "savefig.bbox": "tight"})
sc.set_figure_params(dpi=300, dpi_save=300, frameon=False, fontsize=8)


def caption(fig, *parts):
    """图注置于坐标轴框外：竖版图（宽<高）在右上角纵向多行；
    横版图（宽>=高）在图幅下方纵向多行（一条一行）。规范见 docs/figure_spec.md 三之二。"""
    parts = [str(p) for p in parts if p not in (None, "")]
    if not parts:
        return
    w, h = fig.get_size_inches()
    text = "\n".join(parts)
    if w >= h:
        fig.text(0.01, -0.02, text, ha="left", va="top", fontsize=8, linespacing=1.5)
    else:
        fig.text(1.02, 1.0, text, ha="left", va="top", fontsize=8, linespacing=1.5)


# ---- L2-05P 火山图（matplotlib 手写，替代 Bizard R 版）----
# 黄金数据集：合成基准必须同时含上调、下调与不显著三档点，否则红蓝两色在图上永远
# 不会出现（纯 uniform 的 p 经 BH 校正后最小值约 0.54，一个显著点都没有）。
# 因此显式注入 240 个确定性显著基因，再交给 BH 校正，让三档点都真实落在图上。
n, n_up, n_down = 4000, 120, 120
log2fc = rng.normal(0, 1.2, n)
pval = rng.uniform(0, 1, n)
log2fc[:n_up] = rng.uniform(1.6, 3.2, n_up)
log2fc[n_up:n_up + n_down] = -rng.uniform(1.5, 3.0, n_down)
pval[:n_up + n_down] = 10 ** rng.uniform(-8, -3, n_up + n_down)
L2_CUT, P_CUT = 1.0, 0.05
# BH 校正
order = np.argsort(pval); ranked = pval[order]
q = ranked * n / np.arange(1, n + 1)
q = np.minimum.accumulate(q[::-1])[::-1]; q = np.clip(q, 0, 1)
padj = np.empty(n); padj[order] = q
cls = np.where((padj < P_CUT) & (log2fc > L2_CUT), "Up",
      np.where((padj < P_CUT) & (log2fc < -L2_CUT), "Down", "NS"))
fig, ax = plt.subplots(figsize=(89/25.4, 75/25.4))
# NS 先画，显著点压在上层（否则红蓝点会被灰色点云盖住）
for c, col in [("NS", "#BEBEBE"), ("Up", "#EE0000"), ("Down", "#3B4992")]:
    m = cls == c
    ax.scatter(log2fc[m], -np.log10(pval[m]), s=2.5, c=col,
               label=f"{c} (n={int(m.sum())})", alpha=0.75, linewidths=0)
ax.axvline(L2_CUT, ls="--", lw=0.5, c="#595959"); ax.axvline(-L2_CUT, ls="--", lw=0.5, c="#595959")
ax.axhline(-np.log10(P_CUT), ls="--", lw=0.5, c="#595959")
xlo, xhi = ax.get_xlim(); ylo, yhi = ax.get_ylim()
# 轴顶留 12% 净空给 log2FC 竖直标注与基因名，否则标注会与点云、彼此压字
ax.set_ylim(ylo, yhi * 1.42)
ax.set_xlim(xlo - 0.10 * (xhi - xlo), xhi + 0.10 * (xhi - xlo))
yhi = ax.get_ylim()[1]
# 阈值标注位置固定：p 阈值贴左侧轴框内缘，log2FC 竖直标注置轴框顶部（规范 三之三）
# 阈值标注给白底、压到数据点之上：轴内文字不得被点云穿插（规范 三之三）
box = dict(facecolor="white", edgecolor="none", pad=0.8)
thr_texts = [
    ax.text(xlo + 0.02 * (xhi - xlo), -np.log10(P_CUT) + 0.04 * (yhi - ylo),
            f"adj p={P_CUT:g}", ha="left", va="bottom", fontsize=8, bbox=box, zorder=6),
    ax.text(L2_CUT, yhi, f"log2FC={L2_CUT:g}", rotation=90, ha="right", va="top",
            fontsize=8, bbox=box, zorder=6),
    ax.text(-L2_CUT, yhi, f"log2FC=-{L2_CUT:g}", rotation=90, ha="right", va="top",
            fontsize=8, bbox=box, zorder=6),
]
# 标注取显著基因里最显著的 4 个上调 + 4 个下调，避免全挤在同一簇导致标签互压
up_idx = np.where(cls == "Up")[0]; up_idx = up_idx[np.argsort(padj[up_idx])][:3]
dn_idx = np.where(cls == "Down")[0]; dn_idx = dn_idx[np.argsort(padj[dn_idx])][:3]
top = np.concatenate([up_idx, dn_idx])
# 基因名排成阶梯挂在轴顶净空带里：上调靠右、下调靠左，逐级下移，避免互相压字
texts = []
for grp, idx in [("Down", dn_idx), ("Up", up_idx)]:
    for k, i in enumerate(idx):
        # 基因名分列在两条竖直阈值线外侧，绝不与 log2FC 阈值标注争同一位置
        x_txt = (-L2_CUT - 0.35) if grp == "Down" else (L2_CUT + 0.35)
        y_txt = yhi - (0.05 + 0.085 * k) * (yhi - ylo)
        texts.append(ax.annotate(
            f"G{i}", xy=(log2fc[i], -np.log10(pval[i])), xytext=(x_txt, y_txt),
            fontsize=8, ha="right" if grp == "Down" else "left", va="center",
            arrowprops=dict(arrowstyle="-", color="0.55", lw=0.4,
                            shrinkA=1, shrinkB=2)))
# 规范 三之二：图内文字不得互相重叠，标签必须自动避让（不得靠缩小字号绕开）
for t in texts:
    t.set_clip_on(False)
ax.set_xlabel("log2(Fold Change)"); ax.set_ylabel("-log10(adjusted P)")
for s in ("top", "right"): ax.spines[s].set_visible(False)
# 竖版图：图例移到轴框外右上角单列，图注一条一行（不外扩会压数据）
ax.legend(loc="upper left", bbox_to_anchor=(1.02, 1.0), frameon=False, fontsize=8)
fig.subplots_adjust(right=0.74)
caption(fig, "line: master volcano (golden data)",
        f"threshold |log2FC|>{L2_CUT:g} & adj p<{P_CUT:g}",
        f"{n} genes, {int((cls != 'NS').sum())} significant",
        "red = up, blue = down, grey = NS")
fig.savefig("L2p_volcano_verified.png"); fig.savefig("L2p_volcano_verified.pdf")
plt.close(fig); print("RENDER_OK volcano_py")

# ---- L2-06P marker 点图（scanpy dotplot）----
n_per, k, n_genes = 250, 4, 6
X = np.vstack([rng.normal(0, 1, size=(n_per, 40)) for _ in range(k)]).astype("float32")
adata = sc.AnnData(X)
adata.var_names = [f"G{i}" for i in range(40)]
adata.obs["leiden"] = pd_col = np.repeat([f"CT{i+1}" for i in range(k)], n_per)
# 让前 6 个基因在各群有差异
for g in range(n_genes):
    adata.X[g::k, g] += 3.0
sc.pp.neighbors(adata, n_neighbors=15, random_state=42)
sc.tl.umap(adata, random_state=42)
sc.tl.leiden(adata, resolution=0.8, flavor="igraph", n_iterations=2, directed=False, key_added="leiden")
sc.pl.dotplot(adata, var_names=[f"G{i}" for i in range(n_genes)], groupby="leiden",
              cmap="viridis", dot_max=0.6, smallest_dot=8,
              save="_L2p_dotplot_verified.png")
print("RENDER_OK dotplot_py")

# ---- L2-07P 分组小提琴图 ----
sc.pl.violin(adata, keys=[f"G{i}" for i in range(n_genes)], groupby="leiden",
             palette=["#0072B2", "#D55E00", "#009E73", "#CC79A7"],
             jitter=0.35, size=0.4, save="_L2p_violin_verified.png")
print("RENDER_OK violin_py")
