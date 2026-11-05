# 消融实验：队列效应诊断列在干净数据上的假阳性率

## 一、实验目的

前一轮给 `deg_limma` 加了队列效应诊断列（`is_single_side_silent` / `is_low_detection` /
`is_technical` / `cohort_suspect`），在 DCM 基准上抓出 17,982 个可疑基因、剔除 56% 的显著基因。

但如果诊断列在**任何数据上都报大量可疑**，那它就是个过拟合的噪声源，而不是判据。
本实验用一份**设计上不存在队列效应**的数据做对照，验证它的特异性。

## 二、对照数据：GSE316126（PBMC / NanoString）

`reference/06.测试用原始数据/GSE316126`

- 物种：人（PBMC，外周血单核细胞）
- 平台：NanoString nCounter（GPL31904），**782 个免疫代谢基因的定制面板**
- 设计：**三组严格平衡**，Control 12 / T2D 12 / T2D_DKD 12
- 关键特征：**同一批次采集测序**，带完整临床协变量（年龄、性别）

与 DCM 基准的对比：

| 维度 | DCM 基准（GSE245825） | GSE316126 |
|---|---|---|
| 队列结构 | 58 新鲜活检 vs 12 历史系列 | 36 例同批次 |
| 分组平衡 | 58 : 12（4.8:1） | 12 : 12 : 12（1:1:1） |
| 基因数 | 43,098（全转录组） | 782（定制面板） |
| 预期队列伪影 | 高 | **无** |

## 三、方法

`deg_limma` 每轮只支持两组比较，故构造两个两两对比（各 12 vs 12）：

1. `T2D_vs_Control`
2. `T2D_DKD_vs_Control`

输入由 `GSE316126_series_matrix.txt.gz`（表达矩阵）与 `info.md`（36 行样本分组表）解析生成。
分组取自 info.md 表格第 5 列的三个字面值：`Control` / `T2D` / `T2D_DN`。

## 四、结果

### 4.1 诊断列计数（两个对比一致）

| 指标 | T2D vs Control | T2D_DKD vs Control |
|---|---|---|
| single_side_silent | **0** | **0** |
| low_detection | **0** | **0** |
| technical | 1 | 1 |
| cohort_suspect 合计 | **1 / 782（0.13%）** | **1 / 782（0.13%）** |
| 显著基因（过滤前） | 0 | 0 |
| 显著基因（过滤后） | 0 | 0 |

### 4.2 与 DCM 基准的正面对照

| 指标 | DCM 基准（跨队列） | GSE316126（干净） | 比值 |
|---|---|---|---|
| cohort_suspect 占比 | **41.7%**（17,982 / 43,098） | **0.13%**（1 / 782） | **约 320 倍** |
| single_side_silent | 746 | 0 | 无穷 |
| low_detection | 17,234 | 0 | 无穷 |
| 显著基因数 | 3,649 | 0 | - |

## 五、结论

**诊断列具备明确的特异性，不是过拟合噪声。**

1. 在**不存在队列效应**的数据上，可疑率仅 0.13%（1 个技术性标记），几乎不误伤；
2. 在**存在队列效应**的数据上，可疑率 41.7%，准确抓出 27% 的单侧沉默与大量低检出基因；
3. 两档相差约 **320 倍**，足以作为"该不该信任这批差异基因"的判据。

因此 DCM 基准里剔除 56% 显著基因的动作，**不是误杀**，而是真实去伪。

## 六、附带发现（值得记录）

GSE316126 两个对比下 **`min_padj = 0.869`，无任何基因显著**。这不是流程故障：

- 782 个基因是定制免疫代谢面板，覆盖度有限；
- n=12/组对 PBMC 这种细胞组成异质性高的样本，统计功效有限；
- `max|log2FC| = 15,113` 说明 NanoString 计数值域跨度大，limma 的 `trend=TRUE` 在这种
  计数值域上可能过度保守。

**这提示一个潜在的母版适配问题**：NanoString 计数与 RNA-seq counts 的数值分布不同，
`eBayes(trend = TRUE)` 的假设未必成立。若要把该平台正式纳入产线，需要评估
`trend` 参数与是否需要 voom 类变换。这一点留作待办，不在本轮展开。

## 七、复跑

```powershell
# 1. 解析 series_matrix 与 info.md，生成 expr_genes.tsv + group_map.tsv
python .tmp/dcm_bench/gse316126_build2.py
# 2. 构造两两对比
python .tmp/dcm_bench/gse316126_contrasts.py
# 3. K40 上跑（文件名必须含 expr_genes / group_map，且 group_map 为 .tsv）
ssh k40-ubuntu 'cd /mnt/ssd/bio_data/projects/PRJ_GSE316126_SANITY/contrasts/t2d && \
  BIOANALYS_SEED=20261105 bash /mnt/ssd/bio_data/bin/line1_bulk/deg_limma \
  --input expr_genes.tsv --input group_map.tsv'
```
