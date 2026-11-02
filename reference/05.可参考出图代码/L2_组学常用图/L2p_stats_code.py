"""L2 Python 统计四件套：散点 / 条形 / 箱线 / 热图（一次进程出 4 张验证图）

设计（2026-11-02，4 Argon 第九轮裁定的批量粒度）：
  - 仿 r_l1_rest 的「1 runner 出多图」既有范式，摊薄 proot 里 Python 冷启动与 import 开销；
  - 4 张图各自独立纯函数，每次调用前 clf + close("all")，防画布污染与单图崩盘连坐；
  - 确定性：单一 seed 派生 rng，合成数据自带（不读外部文件），跨平台可复现；
  - 落盘后逐一校验存在且 >4KB，任一缺失即非零退出（防「runner 成功但图没出」的静默假绿）。
"""
import os, sys
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

SEED = int(os.environ.get('BIOANALYS_SEED', '20261013'))
rng = np.random.default_rng(SEED)
plt.rcParams.update({'font.size': 7, 'axes.linewidth': 0.6, 'savefig.dpi': 300})


def _fresh():
    """每张图前重置画布状态：合跑 4 图时防图层与 rcParams 串味。"""
    plt.clf()
    plt.close('all')


def _synth_deg(n_genes=400):
    """确定性 DEG 表：20% 差异基因、logFC 双向、BH 校正 padj。"""
    log2fc = rng.normal(0, 1.0, n_genes)
    idx = np.arange(n_genes)
    up = idx[: n_genes // 10]
    down = idx[n_genes // 10: 2 * (n_genes // 10)]
    log2fc[up] += 2.4
    log2fc[down] -= 2.4
    pval = np.clip(10 ** (-np.abs(log2fc) * 2.2 + rng.normal(0, 0.5, n_genes)), 1e-30, 1)
    order = np.argsort(pval)
    ranked = pval[order]
    q = ranked * n_genes / np.arange(1, n_genes + 1)
    q = np.minimum.accumulate(q[::-1])[::-1]
    padj = np.empty(n_genes)
    padj[order] = np.clip(q, 0, 1)
    return pd.DataFrame({
        'gene': [f'GENE{i:03d}' for i in range(n_genes)],
        'logFC': log2fc, 'P.Value': pval, 'adj.P.Val': padj,
        'AveExpr': rng.uniform(3, 12, n_genes),
    })


def render_scatter(out):
    """散点图：logFC vs -log10(padj)，显著性着色。"""
    _fresh()
    df = _synth_deg()
    sig = (df['adj.P.Val'] < 0.05) & (df['logFC'].abs() > 1)
    fig, ax = plt.subplots(figsize=(89 / 25.4, 75 / 25.4))
    ax.scatter(df.loc[~sig, "logFC"], -np.log10(df.loc[~sig, "adj.P.Val"]),
               s=3, c="#b0b0b0", alpha=0.6, linewidths=0, label="NS")
    ax.scatter(df.loc[sig, "logFC"], -np.log10(df.loc[sig, "adj.P.Val"]),
               s=6, c="#D55E00", alpha=0.85, linewidths=0, label="DE")
    ax.axhline(-np.log10(0.05), ls="--", lw=0.5, c="#444444")
    ax.axvline(0, ls="--", lw=0.5, c="#444444")
    ax.set_xlabel("log2(Fold Change)")
    ax.set_ylabel("-log10(adj.P)")
    ax.legend(fontsize=5, frameon=False)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    fig.savefig(out, bbox_inches='tight')
    plt.close(fig)
    return int(sig.sum())


def render_bar(out):
    """条形图：通路富集计数，带误差条。"""
    _fresh()
    n_terms = 12
    terms = [f"GO:{50000 + i:05d}" for i in range(n_terms)]
    counts = rng.integers(8, 120, n_terms)
    err = counts * rng.uniform(0.06, 0.18, n_terms)
    order = np.argsort(counts)[::-1]
    fig, ax = plt.subplots(figsize=(89 / 25.4, 75 / 25.4))
    ax.bar(range(n_terms), counts[order], yerr=err[order], capsize=2,
           color="#56B4E9", edgecolor="#333333", linewidth=0.4, error_kw={"lw": 0.5})
    ax.set_xticks(range(n_terms), [terms[i] for i in order], rotation=55, ha="right", fontsize=5)
    ax.set_ylabel("Gene count")
    ax.set_xlabel("Enriched term")
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    fig.savefig(out, bbox_inches='tight')
    plt.close(fig)
    return int(counts[order][0])


def render_box(out):
    """箱线图：分组表达分布（对数轴）。"""
    _fresh()
    groups = [f"G{i}" for i in range(6)]
    data = [rng.gamma(3.0, 2.0 + 0.7 * i, 120) for i in range(len(groups))]
    fig, ax = plt.subplots(figsize=(89 / 25.4, 70 / 25.4))
    bp = ax.boxplot(data, tick_labels=groups, patch_artist=True, showfliers=False)
    for patch in bp["boxes"]:
        patch.set_facecolor("#E69F00")
        patch.set_alpha(0.65)
    ax.set_yscale("log")
    ax.set_ylabel("Expression (log scale)")
    ax.set_xlabel("Group")
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    fig.savefig(out, bbox_inches='tight')
    plt.close(fig)
    return len(groups)


def render_heatmap(out):
    """热图：模块-表型相关矩阵（含 colorbar）。"""
    _fresh()
    n_mod, n_trait = 10, 6
    base = rng.normal(0, 1, (n_mod, n_trait))
    base[0, 0] = 0.92
    base[1, 1] = -0.88
    fig, ax = plt.subplots(figsize=(89 / 25.4, 95 / 25.4))
    im = ax.imshow(base, aspect="auto", cmap="coolwarm", vmin=-1, vmax=1)
    ax.set_xticks(range(n_trait), [f"T{i}" for i in range(n_trait)], fontsize=6)
    ax.set_yticks(range(n_mod), [f"M{i:02d}" for i in range(n_mod)], fontsize=6)
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    ax.set_title("Module-trait correlation", fontsize=7)
    fig.savefig(out, bbox_inches='tight')
    plt.close(fig)
    return int(base.shape[0] * base.shape[1])


JOBS = [
    ("scatter", "L2p_scatter_verified.png", render_scatter),
    ("bar", "L2p_bar_verified.png", render_bar),
    ("box", "L2p_box_verified.png", render_box),
    ("heatmap", "L2p_heatmap_verified.png", render_heatmap),
]


def main():
    failures = []
    for name, filename, fn in JOBS:
        try:
            detail = fn(filename)
            size = os.path.getsize(filename) if os.path.exists(filename) else 0
            if size <= 4096:
                failures.append(f"{name}: artifact too small ({size}B)")
            else:
                print(f"RENDER_OK {name} file={filename} bytes={size} detail={detail}")
        except Exception as exc:  # 单图崩盘不连坐其余三图
            failures.append(f"{name}: {type(exc).__name__}: {exc}")
    if failures:
        print("L2P_STATS_FAIL " + " | ".join(failures), file=sys.stderr)
        return 1
    print('L2P_STATS_OK seed=%d figures=%d' % (SEED, len(JOBS)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
