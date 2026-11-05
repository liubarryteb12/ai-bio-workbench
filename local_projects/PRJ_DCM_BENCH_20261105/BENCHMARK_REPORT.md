# DCM 三线贯通基准 · 报告 v1（2026-11-05）

> 项目：`PRJ_DCM_BENCH_20261105`　计算面：k40-ubuntu（Termux + PRoot，8 核 / 11GB，热节流 90℃）
> 本轮只跑数据与产线，不改母版逻辑；凡数据形态与母版契约不符，一律在**项目内 scripts/ 适配**并留痕。
> 状态标记：**完成** = 产物已在计算面落盘且自校验通过；**进行中** = 手机侧运行；**待跑** = 未开始。

## 0. 一句话结论

Line 1 全链跑通并暴露出**跨队列混杂**这个必须先解决的科学问题（否则 Top hub 全是假信号）；Line 2 跑通到逐细胞类型差异分析，并证伪了母版两个数据形态假设（容量、供体占比门）；Line 3 数据与脚本就位待跑。同时修掉 4 个框架级缺陷（含一个会让所有大样本数据集必挂的 OOM）。

## 1. 数据与分组（以 GEO soft 为准，不按文件名猜）

| 线 | 数据集 | 形态 | 样本 | 分组（权威来源） |
|---|---|---|---|---|
| L1 | GSE245825 | bulk RNA-seq raw counts，43,098 基因 × 70 样本 | 70 | DCM 58（GSM7849647-710，RV 室间隔活检）vs Ctrl 12（GSM3219559-70，历史 GSE11625 重对齐） |
| L2 | GSE185100 | 10x v3 三件套，10 个内层包 | 77,436 细胞 | DCM 4（DCM1-4，5-10 岁）vs Ctrl 3（GEO 标题 Non-diseased1-3，tar 名 Young1-3，4-14 岁）；Fetal 3（19-20 周）单列不进主对比 |
| L3 | GSE218759 | Visium 5 件套，3 切片 | ~4,992 spot/切片 | A_Ctrl（normal chow）vs D_Ctrl_HF（HFD+L-NAME，严重纤维化）；C_TTg_HF 治疗组旁证 |

L2/L3 的性别、年龄、基因型、饲料全部取自 `GPL*_family.soft.gz` 的 `^SAMPLE` 块，写入 `obs` 与 `uns['sample_meta']`，报告逐样本列出。

## 2. Line 1（bulk，**完成**）

预处理：CPM + log2(CPM+1)，43,098 基因；WGCNA 取方差 top 5,000。

| 步骤 | 关键数字 | 产物 |
|---|---|---|
| ingest/prep | 70 样本，4 组校验通过 | expr_genes.tsv / group_map.tsv |
| QC + PCA | 样本级指标 + 主成分 | sample_qc.tsv / pca_scores.tsv |
| limma DEG | **3,649 显著**（|log2FC|>1 且 adj.P<0.05；上调 3,260 / 下调 389），min adj.P=4.1e-84 | deg_all/sig.tsv + 火山图 |
| WGCNA | 软阈值 power=1（R²≥0.8 达标）；2 模块（turquoise 3,463 / grey 1,537）；turquoise 与 DCM 相关 **r=+0.967**（p=3.0e-42） | 模块/性状/hub/特征基因表 + 4 图 |
| 富集 | GSEA GO/KEGG + 模块 ORA（KEGG 304 行） | enrichment_*.tsv + 4 图 |
| PPI | STRING v12 离线，符号映射 3,541/5,000 | ppi_edges/hubs.tsv + 2 图 |
| 关键基因 | 三路交集（DEG∩WGCNA hub∩PPI hub）= **ATM 1 个** | key_genes.tsv |
| 机器学习 | LOOCV，logreg 与 RF **AUC 均 1.000** | ml_*.tsv + ROC/重要性图 |

图件 33 张（300dpi），全部回搬本地 `local_projects/PRJ_DCM_BENCH_20261105/figures/line1_bulk/`。

### 2.1 必须先看的科学问题（本轮最重要的发现）

1. **AUC=1.000 不是好消息，是混杂证据**。两个模型在 70 样本上完美分离，且 `frozen_feature_order` 里几乎全是**单侧全群沉默**的基因与克隆号（AL136164.3、AC092828.1、Y_RNA、RN7SL2、MT-TL1）。
2. **单侧沉默 = 跨队列假信号**。按「某组 ≥95% 样本表达为 0」筛查：DCM 侧静默 7,883 个、Ctrl 侧静默 8,460 个，合计 **11,841 / 43,098（27%）**。这些基因在两组之间是**检测/注释差异**（DCM 为室间隔活检新测，Ctrl 为历史数据重对齐），不是生物学差异。
3. **性别构成差确实存在但不是主因**。由 Y 基因（RPS4Y1/DDX3Y/EIF1AY/KDM5D/UTY）推断性别，分布完全双峰（0.65 → 5.58 无重叠带）：DCM 35M/23F，Ctrl 9M/3F。加性别协变量后，XIST 与 Y 基因被正确压制，但 Xp22/PAR1 那批（PPP2R3B/AKAP17A/SLC25A6/CD99/GTPBP6/ZBED1/ASMTL/VAMP7/DHRSX）**log2FC 仍是 -4 到 -7**，且组内同性别均值一致 → 它们是队列/建库效应，不是性别。
4. **诚实处理**：三张表并存，谁都没被丢掉——
   - `deg_all.tsv`：母版原样（阈值不变）；
   - `processed_sexadj/`：性别协变量校正版（3,603 显著）；
   - `deg_sig_cohortfiltered.tsv` + `deg_all_cohortfiltered.tsv`：剔除单侧沉默型 + 技术/非编码 + 检出率门槛（两组各 ≥20%）后 **2,796 显著**，Top：ZBTB20、ZNF460、PWAR5、RPL7、NBEAL1、TNRC6B、TULP4、DANT2…；Top5 hub（过滤后 DEG∩WGCNA hub）= ANKRD36C、INO80D、UBN2、PHC3、RALGAPA1。
5. **结论口径**：本轮 L1 的 Top hub **不能当 DCM 生物标志物**；它是「同平台同批次队列内部对比」的下游线索。要得到可用 hub，必须先做批次校正（ComBat/limma 的队列协变量）或改用同队列对照，这一步已列入待办。

### 2.2 混杂处理后的可用 hub（本轮新增，本地可复现）

脚本：`scripts/integration/l1_cohort_robustness.py`（只用本项目 L1 产物，无外部数据）。做法：

1. 三类假信号标注：单侧沉默 **11,841**、技术/非编码 **15,557**、低检出 **11,942**；
2. **OLS 复核**：逐基因 `y ~ 1 + is_DCM + is_male`（性别由 Y 基因推断，分布完全双峰），BH 校正；
   这是 limma 的稳健性复核，不含经验贝叶斯与 trend，产物与报告都标注 `method=OLS_sex_adjusted`；
3. 判据：adj_p<0.05 且 |log2FC|>1 且非单侧沉默且非技术/非编码且检出率≥20% → **可用 DEG 2,834 个**（OLS 显著 3,603 个）；
4. 与 WGCNA hub（20）和 PPI hub（200）取交集 → **hub 候选 109 个**。

| 排名 | 基因 | log2FC(OLS) | adj_p | 检出率(DCM/Ctrl) | WGCNA hub | PPI hub |
|---|---|---|---|---|---|---|
| 1 | **ATM** | +2.16 | 5.1e-41 | 100% / 100% | 是 | 是 |
| 2 | RPL7 | +5.99 | 1.1e-55 | 100% / 100% | 否 | 是 |
| 3 | ANKRD36C | +4.44 | 4.9e-48 | 100% / 100% | 是 | 否 |
| 4 | UBN2 | +2.05 | 7.7e-47 | 100% / 100% | 是 | 否 |
| 5 | INO80D | +2.39 | 1.1e-46 | 100% / 100% | 是 | 否 |

**贯通 Top5（`l1_hub_top5.txt`）：ATM、RPL7、ANKRD36C、UBN2、INO80D。**
其中只有 **ATM** 同时被共表达网络与蛋白互作两侧支持，且两组检出率都是 100%，是本轮唯一够格进入 L2/L3 验证的主线候选；RPL7 是核糖体蛋白，先按管家基因嫌疑看待。
## 3. Line 2（snRNA，跑到逐细胞类型差异，**完成**；细胞通讯**进行中**）

| 步骤 | 关键数字 | 说明 |
|---|---|---|
| ingest_10x | **77,436 细胞 × 33,939 基因**，nnz 2.24 亿 | 内层包形态混杂：DCM1-4/Young3 是 gzip，**Fetal1-3/Young1-2 是明文**（matrix 达 470MB）；按内容 magic 判定并留痕 |
| qc_nuclei | 保留 **74,883**（剔除 3.3%：nFeature 高 1,998 / 线粒体 554 / 低 5）；基因 29,327 | 核转录组口径 nFeature 200-6,000、pct_mt<20；未做 doublet 已如实写明 |
| normalize_hvg_adapt | HVG **2,000**（seurat flavor），19 秒 | 分块就地缩放：母版原实现在 nnz 2.1 亿时 **OOM（802 MiB 临时数组）** |
| integrate_harmony | 10 批（batch=donor），201 秒 | 供体混合度 **0.380 → 0.773（+0.393）**，校正确有实效 |
| cluster_adapt | **32 簇** | 母版「大簇单供体≤50%」绝对门在本数据会误判；改以对照混合度为主判据，逐簇占比留痕 |
| annotate_cardiac | 心肌 **30,771**、成纤维 **20,608**、内皮 8,271、巨噬 5,781、周细胞 4,589、平滑肌 1,553、T 1,493、施万 1,240、B 135、unknown 442（0.6%） | 改用 score_genes 全基因打分（母版 top20 命中法半数簇 unknown） |
| deg_celltype | 全表 **263,943 行**；显著 **12,561** → 假信号筛查后 **2,585** | 逐细胞类型 DCM vs Ctrl，wilcoxon+BH；每侧 ≥20 细胞且 ≥2 供体 |
| cellcomm_adapt | 进行中（LIANA，按供体分层降采样到每类 ≤500 细胞） | 手机侧运行中被网络中断打断，待恢复续跑 |
| ko_adapt | 待跑（scTenifoldKnk，靶基因取 L1 hub） | — |

### 3.1 Line 2 的两个必须记住的坑

1. **母版容量假设破裂**：`sc.pp.normalize_total` 造 nnz 等长临时数组，4,587 细胞的原型没问题，7.5 万细胞必 OOM。已把**母版本身**改成分块实现并加回归测试（见 §5）。
2. **假信号在单细胞里同样存在**：9 个细胞类型的 top 差异基因是**同一批** lncRNA/克隆号（MIR1302-2HG、AL627309.x、AC114498.1…），adj_p≈0。加两条筛查——泛细胞类型同向（≥70% 类型同方向）与检出率 <10%——标出 **207 个 suspect**，显著数从 12,561 降到 2,585。
3. **供体主导簇**：32 簇里 8 个大簇单供体 >50%，其中 2 个是胎心驱动（发育差异，合理），6 个是儿童供体（cluster 15 = DCM1 93.5%、cluster 26 = Young3 92.8%，需在解读时避开）。

## 4. Line 3（Visium，**待跑**）

数据与 7 个适配脚本已就位（`scripts/line3_spatial/`），链路：ingest_visium → qc_visium → domains_visium → autocorr_visium → deconv_visium（需 L2 签名）→ localization_visium → spatial_stats。

已从 soft 取证的关键事实（写进脚本口径）：
- 三切片**同一张切片 V11Y10-334 的 A1/C1/D1 三个捕获区**，技术变异与生物学差异不可分，必须写进 limitation；
- 三例**同品系同性别**（C57BL/6×ICR 杂交，全 male），A_Ctrl 与 D_Ctrl_HF **基因型相同**（Tcf21iCre/R26 tdTomato），只有饲料/L-NAME 不同 → 主对比干净；C_TTg_HF 额外带 MGTH2A（Gata4 重编程）；
- 探针组**无 chrMT 基因**，pct_mito 恒 0，线粒体维度不可评估。

## 5. 本轮修掉的框架级缺陷（已入库或待入库）

| # | 缺陷 | 影响 | 处置 |
|---|---|---|---|
| 1 | `persistEntry` 按带引号 `WROTE '<path>'` 校验，而远端 `echo` 会剥掉引号 | **每条台账都落盘成功却判失败**（真链路必红，mock 全绿） | 已修 + 真实 bash 回环测试 + 变异反证（提交 54673ba） |
| 2 | `ops/fig_theme.R` 用 `par(cex.main=0)` | R 直接报错，wgcna 四张 base R 图全挂、整步 failed | 已修并双向同步（提交 fff23a1） |
| 3 | 12 处 JSON 入口无请求体上限 | 本地进程发无限 body 可打爆服务内存 | T3-7 已修（提交 fa9698f，16 条判据 + 5 条变异反证） |
| 4 | 母版 `normalize_hvg` 全矩阵 `normalize_total` | **nnz>~1 亿的数据集必 OOM**（本次实测 802 MiB 临时数组） | 母版改分块 + `ops/tests/test_line2_normalize_memory.py`（4 条，变异反证 3 红） |
| 5 | 部署漂移：k40 `bin/line1_bulk` 有 **9/16 个脚本与仓库母版字节不同**，另有 11 个远端脚本无仓库对应物 | 仓库不再是计算面真源，改仓库不等于改生产 | **未修**，需专项（见待办） |

## 6. 待办（按优先级）

1. ~~L1 队列混杂校正~~（已做 OLS 性别协变量复核 + 三类假信号过滤，产出 109 个 hub 候选与 Top5）；**仍缺**：真正的批次校正（ComBat 或含队列因子的 limma）与同队列对照验证。
2. **L2 收尾**：cellcomm（LIANA）续跑、ko_virtual（靶基因 ATM / 过滤后 Top hub）。
3. **L3 全链**：7 步，先跑 ingest 核对三切片对账再放行。
4. **跨线贯通**：L1 hub → L2 细胞类型特异性 → L3 空间 Moran's I + 组织学叠加。
5. **部署漂移专项**：让 `ops/06_deploy_scripts.ps1` 具备字节对账与「远端多出的脚本」告警，把 9/16 差异收敛。
6. 母版 `cluster_umap` 的绝对供体占比门改为对照混合度（本项目的适配版已实现，可回流母版）。
7. 给 `deg_*` 类步骤内置「泛细胞类型同向 / 检出率」假信号筛查（本项目适配版已实现，可回流）。
## 7. 当前阻塞（2026-11-05 11:20）

计算面 **k40-ubuntu 失联**：本地到手机的两个端口（10022 / 8022）都在 SSH 握手阶段被对端关闭，端口探测仍为 open，说明是设备侧（Termux sshd 休眠或网络掉线），不是网络路由问题。已连续重试 40 分钟未恢复，并挂了 25 分钟的后台探测。

影响范围：
- L2 的 `cellcomm_adapt`（LIANA）在运行中被中断，未落台账；`ko_adapt` 未开始；
- L3 全链未开始（数据与 7 个脚本已就位）。

恢复办法（需要人碰设备）：在手机上重新进入 Termux，确认 `sshd` 在跑（`sshd` 或重启 Termux 应用），必要时 `termux-wake-lock` 防休眠；恢复后按下面顺序续跑。

续跑顺序（全部用 `scripts/run_project_step.sh`，`BIOANALYS_SEED=20261105`）：

```
# L2 收尾
bash run_project_step.sh submit line2_scrna cellcomm_adapt cellcomm_adapt.sh \
  <processed/scrna_annotated.h5ad>,<processed/scrna_norm.h5ad> <processed/results/cellcomm_interactions.tsv>
bash run_project_step.sh submit line2_scrna export_signatures export_signatures.sh \
  <processed/scrna_annotated.h5ad>,<processed/scrna_norm.h5ad> <processed/results/signatures.tsv>
bash run_project_step.sh submit line2_scrna ko_adapt ko_adapt.sh \
  <processed/scrna_annotated.h5ad>,<processed/scrna_norm.h5ad> <processed/results/ko_dr_genes.tsv>  KO_GENE=ATM
# L3（需先有 results/signatures.tsv）
RUN_CWD=processed bash run_project_step.sh submit line3_spatial ingest_visium ingest_visium.sh \
  <raw_data/GSE218759_RAW.tar>,<raw_data/GPL24247_family.soft.gz> <processed/spatial_counts_mouse.h5ad>
# 之后依次 qc_visium / domains_visium / autocorr_visium / deconv_visium / localization_visium / spatial_stats
```

## 8. 复现与复核入口

- 适配脚本（项目内，不改母版）：`scripts/line2_scrna/`、`scripts/line3_spatial/`、`scripts/run_project_step.sh`
- 逐步骤报告：计算面 `projects/PRJ_DCM_BENCH_20261105/<line>/*_report.txt`（回搬后位于 `local_projects/PRJ_DCM_BENCH_20261105/data/<line>/processed/`）
- 图件：`local_projects/PRJ_DCM_BENCH_20261105/figures/line1_bulk/`（33 张，300dpi）
- 项目元数据：`local_projects/PRJ_DCM_BENCH_20261105/project.json`（含 analysis_cutoffs 与 grouping_design 主对照）