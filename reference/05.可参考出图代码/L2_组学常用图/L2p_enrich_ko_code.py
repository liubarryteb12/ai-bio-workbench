"""L2 Python 富集与虚拟敲除三件套：GSEA 山丘图 / ORA 气泡图 / DR 调控网络

设计（2026-11-02，4 Argon 第十一轮第 2 节批次 B 裁定）：
  - 仿 L2p_stats_code.py 的「1 runner 出多图」范式，摊薄 proot 里 Python 冷启动与 import 开销；
  - 三图各自独立纯函数，每次调用前 clf + close("all")，单图崩盘不连坐其余两图；
  - 确定性：单一 seed 派生 rng，合成数据自带（不读外部文件），跨机可复现；
  - 落盘后逐一校验存在且 >4KB，任一缺失即非零退出（防「runner 成功但图没出」的静默假绿）。

三图对应的业务表（均为 line2_scrna 自己声明的产物，零改动上游 workflows.json）：
  gsea     <- l2_branches_enrich / enrichment_gsea.tsv
  ora      <- l2_branches_enrich / enrichment_ora.tsv
  ko_net   <- l2_ko_drpost       / dr_regulatory_network.tsv
"""
import os, sys
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import networkx as nx

SEED = int(os.environ.get('BIOANALYS_SEED', '20261013'))
rng = np.random.default_rng(SEED)
# matplotlib 的命名色只认 'grey'(0-100 整数后缀的少数形式)，'grey30'/'grey20' 会直接 ValueError。
# 统一用 hex，避免再踩（实测 2026-11-02：gsea 与 ora 两图因此双双失败）。
plt.rcParams.update({'font.size': 7, 'axes.linewidth': 0.6, 'savefig.dpi': 300})
OUT_DIR = os.environ.get('R453_OUT_DIR', '.')


def _fresh():
    """每张图前重置画布状态：合跑三图时防图层与 rcParams 串味。"""
    plt.clf()
    plt.close('all')


def _out(name):
    return os.path.join(OUT_DIR, name)


def render_gsea(out):
    """GSEA 山丘图：按细胞类型分组，展示归一化富集分数的分布形态。"""
    _fresh()
    n_terms = 180
    celltypes = ['basal_keratinocyte', 'suprabasal', 'hair_follicle', 'immune_infiltrate']
    nes = np.concatenate([
        rng.normal(loc, 0.6, n_terms)
        for loc in (1.85, 1.42, -0.95, 0.55)
    ])
    groups = np.repeat(celltypes, n_terms)
    fig, ax = plt.subplots(figsize=(89 / 25.4, 75 / 25.4))
    order = list(dict.fromkeys(groups))
    for idx, group in enumerate(order):
        values = np.sort(nes[groups == group])
        ax.fill_between(values, idx, idx + np.linspace(0, 0.32, values.size),
                        color=plt.cm.tab10(idx % 10), alpha=0.55, lw=0)
        ax.plot(values, np.repeat(idx, values.size), color='#4d4d4d', lw=0.6)
    ax.set_yticks(range(len(order)), order)
    ax.axvline(0, ls='--', lw=0.4, c='#737373')
    ax.set_xlabel('Normalized enrichment score (NES)')
    ax.set_title('GSEA NES by cell type')
    for side in ('top', 'right'):
        ax.spines[side].set_visible(False)
    fig.savefig(out, bbox_inches='tight')
    plt.close(fig)
    return len(nes)


def render_ora(out):
    """ORA 气泡图：Term 富集显著性 vs 重叠基因数，气泡大小编码 combined score。"""
    _fresh()
    n_terms = 15
    terms = [f'HALLMARK pathway {i:02d}' for i in range(n_terms)]
    overlap = rng.integers(4, 40, n_terms)
    padj = np.clip(10 ** (-rng.uniform(2, 9, n_terms)), 1e-12, 1)
    combined = overlap * np.abs(rng.normal(20, 6, n_terms))
    fig, ax = plt.subplots(figsize=(100 / 25.4, 75 / 25.4))
    scatter = ax.scatter(
        -np.log10(padj), overlap,
        s=combined / combined.max() * 120 + 8,
        c=combined, cmap='viridis', alpha=0.8, linewidths=0.4, edgecolors='#333333',
    )
    for i in np.argsort(padj)[:4]:
        ax.annotate(terms[i], (-np.log10(padj[i]), overlap[i]),
                    fontsize=5, xytext=(3, 3), textcoords='offset points')
    ax.set_xlabel('-log10(adjusted p)')
    ax.set_ylabel('overlap genes')
    ax.set_title('Over-representation analysis')
    fig.colorbar(scatter, ax=ax, fraction=0.046, pad=0.04, label='combined score')
    for side in ('top', 'right'):
        ax.spines[side].set_visible(False)
    fig.savefig(out, bbox_inches='tight')
    plt.close(fig)
    return n_terms


def render_ko_network(out):
    """虚拟敲除的差异调控网络：靶基因与 top 扰动基因的核心子网。"""
    _fresh()
    n_tf = 12
    n_target = 22
    graph = nx.DiGraph()
    hub = 'KO_TARGET'
    graph.add_node(hub)
    for i in range(n_tf):
        weight = float(rng.uniform(0.3, 1.0))
        graph.add_edge(f'TF{i:02d}', hub, weight=weight)
    targets = [f'GENE{i:03d}' for i in range(n_target)]
    for i, target in enumerate(targets):
        tester = f'TF{rng.integers(0, n_tf):02d}'
        graph.add_edge(tester, target, weight=float(rng.uniform(0.2, 0.9)))
    pos = nx.spring_layout(graph, seed=SEED, k=0.6)
    fig, ax = plt.subplots(figsize=(89 / 25.4, 75 / 25.4))
    hub_neighbors = set(graph.predecessors(hub)) | {hub}
    node_colors = ['#D55E00' if node == hub else ('#0072B2' if node in hub_neighbors else '#999999')
                   for node in graph.nodes]
    nx.draw_networkx_edges(graph, pos, ax=ax, alpha=0.45, width=0.6, arrows=False)
    nx.draw_networkx_nodes(graph, pos, ax=ax, node_size=90, node_color=node_colors, linewidths=0.3)
    nx.draw_networkx_labels(graph, pos, ax=ax, font_size=4.2)
    ax.set_title('Differential regulation network (knockout)')
    ax.axis('off')
    fig.savefig(out, bbox_inches='tight')
    plt.close(fig)
    return graph.number_of_edges()


JOBS = [
    ('gsea', 'L2p_gsea_verified.png', render_gsea),
    ('ora', 'L2p_enrichment_verified.png', render_ora),
    ('ko_network', 'L2p_konetwork_verified.png', render_ko_network),
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
        print('L2P_ENRICH_KO_FAIL ' + ' | '.join(failures), file=sys.stderr)
        return 1
    print(f'L2P_ENRICH_KO_OK seed={SEED} figures={len(JOBS)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
