# DCM 三线贯通基准：跨线整合报告

日期 2026-11-05｜项目 PRJ_DCM_BENCH_20261105｜分线设计 line1_bulk / line2_scrna / line3_spatial

## 0. 一句话结论

三条线都跑通了（L1 全链、L2 全链、L3 全链），**但跨线串联验证的是"流程能走通"，不是"结论能成立"**。
L1 的差异表达实为**跨队列比较**（新鲜右室间隔活检 vs 重新对齐的历史 GSE11625），
L2 的细胞类型标签由 marker 自动打分得出，未经人工核验，
L3 的主对比是 **n=1 vs 1**。
三线唯一的强结论是流程本身：相同数据在 11.5GB 手机上从原始数据走到空间定位，且每一步都有自校验与台账。

## 1. 三线产出概览

| 线 | 数据 | 规模 | 关键产出 | 状态 |
|---|---|---|---|---|
| L1 bulk | GSE245825 原始 counts | DCM 58 / Ctrl 12 | 差异基因、WGCNA hub、PPI hub、ML、图件 | 完成 |
| L2 snRNA | GSE185100 10x 三组 | 77,436 细胞 -> 74,883 | 32 聚类 -> 10 细胞类型、263,943 行 DEG、LIANA 互作、签名 | 完成 |
| L3 Visium | GSE218759 三切片 | 14,976 spot -> 7,078 | 域、Moran's I、NNLS 解卷积、靶基因定位 | 完成 |

## 2. L1 的关键修正（这次基准最重要的科学产出）

### 2.1 问题

按 `|log2FC| >= 1 且 adj.P < 0.05` 得到的大批"差异基因"，在留一交叉验证下 AUC = 1.000。
**AUC 完美不是好消息**：它说明模型区分的是"哪一批样本"，不是"有没有病"。

### 2.2 归因（已定量）

- 43,098 个基因里 **11,841 个（27%）** 在一组中 >=95% 为零（单侧沉默）；
- 典型形态是**技术性非编码基因**和**低检出基因**，不是生物学差异；
- DCM 58 例是新鲜右室间隔活检、Ctrl 12 例是重新对齐的历史 GSE11625 系列，两批的建库/处理流程不同。

### 2.3 处置（三张表并存，不掩盖方差）

按 Argon 裁定**不做 ComBat**（批次校正会把真实的队列差异一起抹掉，而这个差异本身就是解释的一部分）：

1. `deg_limma` 原始表：保持行数兼容，不动；
2. `processed_sexadj/`：加性别协变量的 OLS（`y ~ 1 + is_DCM + is_male`），BH 校正，3,603 个显著；
3. `deg_*_cohortfiltered.tsv`：剔除单侧沉默/技术性/低检出后，2,796 个显著（OLS 侧 2,834 可用）。

### 2.4 最终靶点

Top5 = **ATM, RPL7, ANKRD36C, UBN2, INO80D**。
其中**只有 ATM 同时被 WGCNA hub（20 个）与 PPI hub（200 个）支持，且两组检出率都是 100%**。
RPL7 是核糖体蛋白、ANKRD36C 是未表征基因，两者在队列过滤后被降级。

## 3. L2：从 77,436 细胞到 10 类

| 步骤 | 数字 | 备注 |
|---|---|---|
| 原始 | 77,436 细胞 x 33,939 基因 | 10 个 10x 样本（DCM 4 / Fetal 3 / Non-diseased 3） |
| QC | 74,883 细胞 | nFeature 200-6,000、pct_mt < 20、去双细胞 |
| 基因 | 29,327 | HVG 2,000（seurat 方法） |
| 整合 | Harmony，10 批次，201 秒 | 供体混合熵 0.380 -> 0.773（+0.393） |
| 聚类 | 32 个 | |
| 注释 | 10 类 | 心肌 30,771 / 成纤维 20,608 / 内皮 8,271 / 巨噬 5,781 / 周细胞 4,589 / 平滑肌 1,553 / T 1,493 / 施万 1,240 / B 135 / 未知 442（0.6%） |
| DEG | 263,943 行，12,561 显著 | 伪影筛查后 2,585（207 个泛细胞类型可疑） |
| LIANA | 36 万+ LR 对，1,485 细胞 | 配体受体覆盖 0.844 |

### 3.1 L2 的两个方法学修正

1. **供体混合门禁改为相对判据**：原型用 4,587 细胞的绝对阈值，在三个发育阶段混合的数据上必然误判。
   改成"校正后熵 vs 未校正熵"的相对增益（实测 +0.393 通过）。
2. **DEG 伪影筛查不删行**：保留 `deg_all.tsv` 行数兼容，新增 `is_suspect` / `suspect_reason` 列与
   配套 `*_filtered.tsv`（Argon 裁定）。

### 3.2 元数据以 GEO soft 为准

GPL24676 显示 DCM1 男 / DCM2-4 女（5-10 岁），Fetal1-2 男 / Fetal3 女（19-20 周），
GSM5606413-15 的 GEO 标题是 `Non-diseased1-3`（4-14 岁），而压缩包内文件名写的是 `Young1-3`。
两个名字都保留（`donor` 与 `geo_title`），报告以 GEO 为准。

## 4. L3：空间定位

| 步骤 | 结果 |
|---|---|
| ingest | 3 切片、14,976 spots、19,465 基因（跨样本基因宇宙完全同序） |
| QC | 保留 7,078 spots（A_Ctrl 1,935 / C_TTg_HF 2,157 / D_Ctrl_HF 2,986） |
| 空间域 | 每切片 4-8 个域，marker 合理（Myh7/Nppa/Ankrd1/Fabp4/Pdk4） |
| Moran's I | 最高 Acta1 (0.656)、Myh6 (0.585)、Lrtm1 (0.572)，三样本一致 |
| NNLS 解卷积 | 7,078/7,078 全部求解，跨物种匹配率 50.1%（14,678/29,317） |
| 靶基因定位 | ATM、UBN2、INO80D 在小鼠中找到；RPL7、ANKRD36C **如实报告缺失** |

### 4.1 L3 的元数据事实

三个样本**全部为雄性**，品系 "hybrid of C57BL/6 and ICR"，同一张玻片 `V11Y10-334` 的 A1/C1/D1 区域。
A_Ctrl 与 D_Ctrl_HF 共享基因型 `Tcf21iCre/R26 tdTomato`（干净的主对比），
C_TTg_HF 额外带 `MGTH2A`（Gata4）。
探针集**不含 chrMT 基因**，所以 pct_mito 恒为 0。

## 5. 跨线整合：宏观筛选 -> 微观定位 -> 原位验证

| L1 靶点 | L1 证据 | L2 细胞类型特异性 | L3 空间富集 |
|---|---|---|---|
| **ATM** | WGCNA hub + PPI hub 双重支持，两组 100% 检出 | 见 `deg_celltype`（ATM 在各类型均有表达） | 检出 215 spots，表达量低（mean 0.026），域间差异不明显 |
| RPL7 | 核糖体蛋白，队列过滤后降级 | - | **小鼠中无大写同名基因**，如实缺失 |
| ANKRD36C | 未表征，队列过滤后降级 | - | **小鼠中缺失** |
| UBN2 | WGCNA hub | - | 检出 1,336 spots（mean 0.171），域间分布较均匀 |
| INO80D | WGCNA hub | - | 检出 2,170 spots（mean 0.295），检出最广 |

### 5.1 这条链能说明什么，不能说明什么

**能说明**：流程可以把"bulk 筛出的候选"一路推到"空间上在哪儿"，并如实报告每一步的缺失与不确定。

**不能说明**：

1. L1 的差异大部分是队列差异，ATM 的"hub"地位也可能部分来自批次结构；
2. L3 的主对比是 n=1 vs 1，任何"疾病 vs 对照"的空间差异都只是描述性的；
3. 跨物种只做了大写同名匹配（匹配率 50.1%），**没有正式 ortholog 表**，
   同源误配与表达域差异都没有排除；
4. L2 的细胞类型是自动注释，未经人工核验；标签错分会直接错置配体受体对。

## 6. 本轮修掉的缺陷（都在真机上暴露并验证）

| 缺陷 | 根因 | 修复 | 证据 |
|---|---|---|---|
| LIANA 把手机打崩 | anndata backed 子集物化时整层读 layers（nnz 2.1 亿） | h5py 按行区间读 CSR | RSS 9,063MB -> 792MB |
| 母版 normalize OOM | 同一根因（整层加载） | 分块就地标准化 | 74,883 细胞跑通 |
| L3 ingest 基因 ID 校验失败 | scanpy 把 var_names 换成 symbol 并加后缀 | 核对改用 var['gene_ids'] | 三切片通过 |
| L3 ingest 误判非整数计数 | scanpy 把 10x int32 转成 float32 | 判值不判 dtype，再显式转 int32 | 通过 |
| L3 QC 拒绝输入 | ingest 读了 lowres 图却没写 uns['spatial'] | 补齐 scanpy 空间容器 | 14,976 -> 7,078 |
| domains/autocorr 依赖 squidpy | aarch64 装不上；装上后 1.8.3 又删了 morans_i | 自实现 cKDTree 建图 + 分块 Moran/Geary | 22.5 秒、域与 I 值合理 |
| 解卷积缺少跨物种匹配率记录 | 分母错用矩阵基因数 | 分母改签名基因数，加三个记录数与错误码 | 50.1% 如实报告 |
| 台账回执引号被吃掉 | 远端 echo 剥引号 | 单引号包裹 + 真实 bash 回执测试 | 已入库 |

## 7. 复现

```bash
# L2 细胞通讯（内存受限的关键参数）
BIO_LIANA_PERMS=none BIO_LIANA_MAX_CELLS_PER_CT=150 \
  bash scripts/cellcomm_adapt.sh --input processed/scrna_annotated.h5ad \
  --input processed/scrna_norm.h5ad --output processed/results/cellcomm_interactions.tsv

# L3 全链
bash scripts/ingest_visium.sh --input raw_data/GSE218759_RAW.tar \
  --input raw_data/GPL24247_family.soft.gz --output processed/spatial_counts_mouse.h5ad
bash scripts/qc_visium.sh --input processed/spatial_counts_mouse.h5ad --output processed/spatial_qc_mouse.h5ad
bash scripts/domains_visium.sh --input processed/spatial_qc_mouse.h5ad --output processed/domains_mouse.h5ad
bash scripts/autocorr_visium.sh --input processed/domains_mouse.h5ad --output results/spatial_autocorr.tsv
bash scripts/deconv_visium.sh --input processed/domains_mouse.h5ad \
  --input ../line2_scrna/processed/results/signatures.tsv --output processed/spatial_deconv_mouse.h5ad
bash scripts/localization_visium.sh --input processed/deconv_mouse.h5ad \
  --input results/target_genes.txt --output results/gene_localization.tsv
```

内存纪律：每个步骤都套 `ulimit -v`（3-6GB）。超限变成干净报错，而不是拖垮设备。

## 8. 下一步（按优先级）

1. **L1 队列效应的正面处理**：把"批次结构"作为变量建模（而不是当噪声），
   或在干净的单队列子集上重跑差异分析，看 ATM 是否仍成立。
2. **L2 注释人工核验**：抽 200 个细胞的 marker 图，人工确认 10 类标签。
3. **跨物种正式 ortholog 表**：接入 MGI/HGNC 同源表，替掉大写同名匹配。
4. **L3 扩样本**：n=1 vs 1 只能描述，需要同基因型多切片才谈得上统计。
5. **k40 脚本漂移零化**：把远端生产逻辑全部回流仓库，再加 SHA256 同源门禁
   （`docs/k40_script_drift_audit.md` 已记录现状：9 个分叉、11 个野生）。
