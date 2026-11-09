"""L2/L3 Python 关系图两件套：细胞通讯弦图 / 空间自相关双指标图

设计（2026-11-02，4 Argon 第十五轮第 2、3 节裁定）：
  - 语言必须是 Python：line2 的 l2_figures_scrna 与 line3 的 l3_figures_spatial 都是 Python，
    registry 的语言亲和性校验要求模板语言与 linked_mod 一致（写成 R 会当场判红 8 条）。
  - 弦图用纯 matplotlib 三次贝塞尔曲线画，零第三方依赖（不依赖 circlize / chorddiag）。
  - 自相关图用 matplotlib 散点 + 排名连线，双指标语义：Moran's I × -Geary's C。
  - 确定性：单一 seed；落盘校验 >4KB，任一缺失非零退出。
"""
import os, sys
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
# 别名必须避开 pathlib.Path：本文件不做 prelude 的输入存在性检查，但同名 import
# 一旦被复制进适配器 overlay 就会覆盖 prelude 里的 pathlib.Path，
# 导致 Path(input_data).exists() 被当图形路径解析（实测 ValueError）。
from matplotlib.path import Path as MplPath
import matplotlib.patches as patches

SEED = int(os.environ.get('BIOANALYS_SEED', '20261013'))
rng = np.random.default_rng(SEED)
plt.rcParams.update({'font.size': 7, 'axes.linewidth': 0.6, 'savefig.dpi': 300})
OUT_DIR = os.environ.get('R453_OUT_DIR', '.')


def _fresh():
    plt.clf()
    plt.close('all')


def _out(name):
    return os.path.join(OUT_DIR, name)


def _bezier_chord(ax, p0, p1, p2, p3, color, alpha):
    """三次贝塞尔曲线：从 src 弧段到 tgt 弧段的弦。"""
    path = MplPath([p0, p1, p2, p3],
                   [MplPath.MOVETO, MplPath.CURVE4, MplPath.CURVE4, MplPath.CURVE4])
    ax.add_patch(patches.PathPatch(path, facecolor='none', edgecolor=color,
                                   lw=0.7, alpha=alpha, capstyle='round'))


def render_cellcomm_chord(out):
    """细胞通讯弦图：13 个细胞类型圆周排布，弦宽编码通讯强度。"""
    _fresh()
    cell_types = ['T_cell', 'NK_ILC', 'B_cell', 'plasma', 'pDC', 'cDC',
                  'Langerhans_cell', 'melanocyte', 'keratinocyte', 'fibroblast',
                  'endothelial', 'smooth_muscle', 'pericyte']
    n = len(cell_types)
    weights = np.abs(rng.normal(3.0, 1.2, (n, n)))
    np.fill_diagonal(weights, 0)
    fig, ax = plt.subplots(figsize=(120 / 25.4, 120 / 25.4))
    ax.set_xlim(-1.35, 1.35); ax.set_ylim(-1.35, 1.35); ax.set_aspect('equal'); ax.axis('off')
    angles = np.linspace(90, 90 - 360, n, endpoint=False)
    rad = np.deg2rad(angles)
    xs, ys = np.cos(rad), np.sin(rad)
    cmap = plt.cm.coolwarm
    vmax = float(weights.max()) if weights.max() > 0 else 1.0
    edges = 0
    for i in range(n):
        for j in range(n):
            if i == j or weights[i, j] < 0.5:
                continue
            p0 = (xs[i] * 0.98, ys[i] * 0.98)
            p3 = (xs[j] * 0.98, ys[j] * 0.98)
            p1 = (xs[i] * 0.35, ys[i] * 0.35)
            p2 = (xs[j] * 0.35, ys[j] * 0.35)
            _bezier_chord(ax, p0, p1, p2, p3,
                          cmap(weights[i, j] / vmax), 0.42)
            edges += 1
    ax.scatter(xs, ys, s=26, c='#56B4E9', edgecolors='#333333', linewidths=0.4, zorder=3)
    for xi, yi, name in zip(xs, ys, cell_types):
        ha = 'left' if xi >= 0 else 'right'
        ax.text(xi * 1.09, yi * 1.09, name, fontsize=5.2,
                ha=ha, va='center')
    ax.set_title('Cell-cell communication (LIANA)', fontsize=7.5)
    fig.savefig(out, bbox_inches='tight')
    plt.close(fig)
    return edges


def render_spatial_autocorr(out):
    """空间自相关双指标图：Moran's I × -Geary's C，Top 基因连线并标注。"""
    _fresh()
    n_gene = 400
    morans = rng.normal(0.18, 0.22, n_gene)
    geary = -0.85 * morans + rng.normal(0.9, 0.18, n_gene)
    df = pd.DataFrame({'gene': [f'GENE{i:03d}' for i in range(n_gene)],
                       'morans': morans, 'neg_geary': geary})
    top = df.reindex(df['morans'].abs().sort_values(ascending=False).index).head(30)
    label = top.head(10)
    fig, ax = plt.subplots(figsize=(89 / 25.4, 80 / 25.4))
    ax.scatter(df['morans'], df['neg_geary'], s=1.2, c='#9E9E9E', alpha=0.45, linewidths=0)
    ax.plot(top['morans'], top['neg_geary'], color='#0072B2', lw=0.35, alpha=0.55)
    ax.scatter(top['morans'], top['neg_geary'], s=7, c='#D55E00', alpha=0.85, linewidths=0)
    for _, row in label.iterrows():
        ax.annotate(row['gene'], (row['morans'], row['neg_geary']),
                    fontsize=4.2, xytext=(2, 2), textcoords='offset points')
    ax.set_xlabel("Moran's I (spatial autocorrelation)")
    ax.set_ylabel("-Geary's C (spatial gradient)")
    ax.set_title(f'genes = {n_gene} | highlighted = top 30', fontsize=7)
    for side in ('top', 'right'):
        ax.spines[side].set_visible(False)
    fig.tight_layout()
    fig.savefig(out, bbox_inches='tight')
    plt.close(fig)
    return n_gene


JOBS = [
    ('cellcomm_chord', 'L3_cellcomm_chord_verified.png', render_cellcomm_chord),
    ('spatial_autocorr', 'L3_spatial_autocorr_verified.png', render_spatial_autocorr),
]


def main():
    failures = []
    for name, filename, fn in JOBS:
        try:
            detail = fn(_out(filename))
            path = _out(filename)
            size = os.path.getsize(path) if os.path.exists(path) else 0
            if size <= 4096:
                failures.append(f'{name}: artifact too small ({size}B)')
            else:
                print(f'RENDER_OK {name} file={filename} bytes={size} detail={detail}')
        except Exception as exc:
            failures.append(f'{name}: {type(exc).__name__}: {exc}')
    if failures:
        print('L2P_CELLCOMM_AUTOCORR_FAIL ' + ' | '.join(failures), file=sys.stderr)
        return 1
    print(f'L2P_CELLCOMM_AUTOCORR_OK seed={SEED} figures={len(JOBS)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
