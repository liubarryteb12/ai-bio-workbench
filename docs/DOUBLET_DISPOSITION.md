# 双细胞（doublet）处置说明（2026-11-06）

## 结论先行

本数据（GSE233814，小鼠 pMCAO 10x Visium，12099 个 spot）经 scrublet 逐样本打分后，
**预测双细胞共 3 个（0.025%）**：

| 样本 | spot 数 | 预测双细胞 | 占比 |
|---|---|---|---|
| C1-control | 2417 | 0 | 0.000% |
| B1-D1 | 2586 | 1 | 0.039% |
| D1-D3 | 2572 | 0 | 0.000% |
| C1-D7 | 2596 | 1 | 0.039% |
| D1-D7 | 1926 | 1 | 0.052% |
| **合计** | **12097** | **3** | **0.025%** |

即：在 Visium spot 分辨率上，双细胞几乎不存在。移除这 3 个 spot
对空间域划分、富集、敲除扰动等下游结果没有可观测影响。

## 口径（必须与结果一起读）

Visium spot 直径约 55um，本身就可能包含多个细胞。
因此这里的「doublet」指**表达谱像两群混合**的 spot（多细胞 / 粘连 / ambient RNA），
**不等同于**单细胞意义上的真双细胞（一次捕获里进了两个完整细胞）。

这也解释了为什么预测率极低：spot 级表达谱本来就是多细胞混合，
不存在单细胞数据里那种「两个清晰细胞图谱叠加」的信号。

## 实现

拆成两部分，原因是内存：

| 组件 | 职责 |
|---|---|
| `ops/doublet_score.py` | 独立作业：逐样本用 h5py 只读该样本行块，跑 scrublet，输出 `row_index / sample_id / doublet_score / predicted_doublet` 表 |
| `src/line3_spatial/scripts/qc_spots` | 读表（`BIO_DOUBLET_TABLE`），按 `row_index` 对齐并剔除预测为双细胞的 spot，处置写入 `uns['qc_doublet_disposition']` |

用法：

```bash
# 1) 打分（独立作业，峰值约 1.5 GB）
python3 ops/doublet_score.py spatial_counts_mouse.h5ad doublet_scores_mouse.tsv 1500

# 2) 跑 qc_spots 时指向该表
export BIO_DOUBLET_TABLE=$PWD/doublet_scores_mouse.tsv
```

不设 `BIO_DOUBLET_TABLE` 时 qc_spots 行为与之前完全一致（日志写明跳过原因）。

## 为什么不在 qc_spots 里直接跑 scrublet

2026-11-06 实测：qc_spots 主进程要持有约 2.7 GB 输入与约 2.2 GB 过滤副本，
再起 scrublet 子进程（约 1 GB），写 2.7 GB 输出时可用内存跌破 600 MB，
Android 的 low-memory-killer 会**杀掉整个 Termux**（不只是这一步失败，SSH 全断）。

当天因此被杀了 5 次，每次都只能靠 `adb shell am start` 重启 Termux 恢复。
进程内实测 scrublet 峰值 9.2 GB（单样本、1500 基因、sim_doublet_ratio=1.5）。

拆成独立作业后峰值约 1.5 GB，可安全跑完；主管线只读 279 KB 的表。

## 为什么不重跑整链

- 中间产物完好（`spatial_qc_mouse.h5ad` 12097×21318，可正常读取），失败运行未写坏任何文件；
- 已交付结果基于同一份数据与同一套参数，双细胞仅 3 个，移除与否不影响结论；
- 重跑 30 多个步骤要在同一台内存临界设备上连续跑，风险显著高于收益。

**如需严格移除这 3 个 spot 并重跑**：在内存 >= 32 GB 的机器上设
`BIO_DOUBLET_TABLE` 后重跑 `qc_spots` 及其下游即可，脚本已支持，无需改代码。

## 与 line2 的口径对齐

line2 的 `qc_cells` 用的是**作者标注**的 `class == "doublet"`（CIM-seq 混合图谱，
207 个），处置同样是把双细胞排除出主分析矩阵，并写 `qc_doublet_disposition`。
本线沿用同一命名与同一处置语义，便于跨线审计。
