# Q4 实证：782 基因 NanoString 面板在 STRING 中的 PPI 可行性

## 一、结论先行

**我之前的判断是错的，实测推翻了它。**

我在提问时的猜测是「782 基因面板做 PPI 覆盖度会很低，网络会稀疏到无意义」。
实测结果完全相反：

| 指标 | 我的猜测 | **实测** |
|---|---|---|
| 蛋白在 STRING 中匹配 | 很低 | **760 / 782 = 97.2%** |
| 面板内部边数（combined_score >= 400） | 几十条 | **12,332 条** |
| 网络形态 | 稀疏到无意义 | **稠密，可做** |

样本边（score >= 400）：
```
ARF5   - ACAP2      815
PDK4   - PDK2       795
PDK4   - PPARGC1A   838
```

## 二、测法（可复跑）

数据源：`/mnt/ssd/bio_data/public_references/stringdb/`

- `9606.protein.info.v12.0.txt.gz`（19,699 条，4 列：protein_id / preferred_name / size / annotation）
- `9606.protein.links.v12.0.txt.gz`（combined_score 0-1000）
- 基因表：从 `GSE316126_series_matrix.txt.gz` 直接提 782 个 symbol

步骤：
1. `protein.info` 的 `preferred_name`（第 2 列，索引 1）作为 symbol 映射；
2. 面板 782 个 symbol 大写后与 `preferred_name` 比对，得到 760 个 STRING protein id；
3. 扫 `protein.links`，只保留两端都在面板内的边，且 `combined_score >= 400`（母版默认阈值）。

**踩过的坑**：第一版我用 `p[2]` 取 symbol，但那实际是 `protein_size`，导致
「782 基因匹配 0 个蛋白」的荒谬结论。**表头有 4 列，preferred_name 是第 2 列**。
这个错误差点被当成「NanoString 面板与 STRING 不兼容」的证据。

## 三、这意味着什么

1. **PPI 该做**。97.2% 的匹配率说明 NanoString 免疫代谢面板与 STRING 的蛋白组覆盖高度重合，
   这本身是因为该面板选的基因就是免疫/代谢的核心调控基因，STRING 覆盖充分。
2. **12,332 条边**对一个 782 节点的网络是稠密的（平均度约 31），足以支撑 hub 分析与模块划分。
3. **仍需标注覆盖度**：782/19,699（4.0%）——面板只覆盖 STRING 人类蛋白组的一小部分，
   所以网络是「面板内部互作图」，不是「全蛋白组 PPI 的子图」。报告里必须写清楚这个口径，
   否则读者会误以为是全局网络。

## 四、对 Q4 选项的影响

我原先给 Argon 的选项是：
- A 不做 PPI
- B 只做 782 基因内部限定网络并标覆盖度

**实测支持 B，且比我原先预想的更有价值**（不是「勉强能做」，而是「匹配率 97%、边数 1.2 万」）。
A（不做）的理由已被推翻。

## 五、待办

1. 若采纳 B，需要在 `ppi_string` 上加一个「限定面板模式」：只统计给定 gene list 内部的边，
   并在报告输出 `n_panel_genes` / `n_matched_proteins` / `n_edges` / `coverage_pct`；
2. 需要验证 `ppi_string` 当前是否已支持「只保留输入基因列表内部的边」——
   若不支持，当前实现会把面板基因与全蛋白组的边一起算进来，那会是错的。
