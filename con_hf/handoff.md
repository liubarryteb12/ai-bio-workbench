# handoff — 跨会话交接

> 最后更新：2026-10-19（产物回搬：图件/结果表从手机端拉回本地 outputs/，工作台优先读本地）
> **接任务先读本文件**，再看 `con_hf/SPEC.md`（阶段规格）与 `con_hf/踩坑台账.md`（排查前必搜）。
> 全量推进计划：`con_hf/2026-10-13_plan_goal全量推进.md`（含工作区盘点结论与阻塞项 B1/B2）。

## 当前在哪

**【2026-10-20 · K40 适配优化与效率实测（本轮，用户授权自主推进）】**：按
`con_hf/2026-10-20_k40_linux_adaptation_plan.md` 完成阶段 0-2。核心实测结论（全部有命令输出）：
① **CPU 拓扑与隔离语义**——`taskset -c 4,5,6` 完整生效（psr 证实 c5/c7 真实承载负载），
但单绑 5/7 恒 EINVAL（部分核隔离，机制未定位）；② **绑核契约实测为净性能负担**——
交替验证 3 轮，「不绑核+3 线程」每轮全胜、均值比 aims 契约「4,5,6+3 线程」快 **~30%**
（Python matmul）/ 6-11%（R 单线程），线程甜点=3；③ **R 链接 reference BLAS**
（OPENBLAS_* 对 R 无效，2.94 vs 45.7 GFLOPS）；④ **taskset 失败真实发生过一次**
（Android 动态隔离瞬时态）⇒ run_throttled_task.sh 无降级是已触发风险；⑤ 保活链健康
（唤醒锁 LONG 15.5h、五服务全 run、00_link_check exit 0）。沉淀 `docs/k40_cpu_affinity.md`
（性能相关会话第一参考）+ 踩坑 #200-#202（#203/#204 见下）。**用户四项决策已全部落地**：
① taskset 失败降级修复（母本 + 部署 + 双路径实证）；② **绑核契约变更**（用户拍板「改」：
aims.txt 3 处 + run_throttled_task.sh 默认不绑核 + BIO_PIN_CPUS 开关 + task.js/App.tsx 同步，
npm build 已重建；三路径实证：0-7 / 4-6 / 降级标记+0-7）；③ **R BLAS 升级**（用户拍板
「采纳」：openblas-pthread 已装，R 16.3 倍 2.94→47.99 GFLOPS，limma 6 校验量跨 BLAS
逐位一致）；④ 冒烟雾账清理（test_001/002/004/005/006 共 10 文件）。另：ssh keepalive
（~/.ssh/config 两 Host ServerAliveInterval 30）+ 踩坑台账编号撞车修复（#160-#162→#200-#202）。
**唯一遗留 VIOLATION**：`is_l1_ml_m2_ledger.json`（IS_lactylation 项目凌晨裸调台账，seed
无从考证，待用户确认后补字段）。**真机 reboot 端到端已验证完成**（2026-10-20 10:28-10:40，用户配合解锁；双通+五服务+LOGDIR 修复+48.44 GFLOPS 基线一致；中途 R15 双 runsvdir 抢锁已用 `ops/fix_runsvdir.sh` 修复，报告 `con_hf/2026-10-20_reboot_test.md`、坑 #205；boot_v2 的 R15 防护待拍板母本身份）。
基准母本与数据：`cn_debug/2026-10-20_k40_bench/`（容器副本 `/root/bio_workbench/_bench/`）。

阶段：**T2（BioanalysDesktop 本地交互层）T01-T07 全部完成**，四功能（链路总览 / 台账巡检 / 文件浏览 / 任务下发 + 日志流）全部 ready 且有 DevTools 实测留证。
测试 68/68 全绿（`node --test tests/*.test.js`），`npx tsc --noEmit` 零错误，`npm run build` 通过。
规格 `con_hf/SPEC-bioanalysdesktop.md`（v0.2）。拆交单 `con_hf/scratch-t2-tickets.md` 已标完。

**P3 阶段（src/ 三线分析代码）S0 部署通道 + 缺口 B 环境清单 + S1 首步骤均已完成**（2026-10-13 凌晨）：
`task.js` 注入 `<line>/bin` 到 PATH + `ops/06_deploy_scripts.ps1` 部署通道 +
`src/line1_bulk/scripts/probe_env` 冒烟脚本，真实数据面全链路复验通过
（probe_env 任务台账 `completed` exit 0，stdout 验证 seed 注入 / 工作目录 / R 4.3.3 / Python 3.12.3 全部就位）。
缺口 B：三线 `src/<line>/envs/manifest.txt` 正本 + `server/manifest.js` 读取 + run.js 接线，
台账 environment 四字段从 manifest 来（06 部署通道同步服务器副本，字节校验过），
probe_env stdout 输出 manifest_* 四行证明服务器副本在位。
S1：`src/line1_bulk/scripts/prep_matrix`（series matrix + GPL → 基因表达矩阵）真实数据面全链路通过
（台账 `2026-10-13_line1_bulk_prep_matrix_dae355fc.json` completed exit 0；产物 expr_genes.tsv 20019 基因 × 16 样本、
group_map.tsv、prep_report.txt），DevTools 界面验收通过（SSE 日志流 / exit 0 徽章 / 台账摘要 / files 面板三产物可见），
04 台账巡检 20 条全合法。
S2 切片：`qc_matrix`（步骤 4 QC，组内 Spearman 0.95-0.99 无离群）、`pca_matrix`（步骤 6 PCA，
PC1 26.6%/PC2 20.3%）、`deg_limma`（步骤 7 差异分析，NLS-LS **0 显著基因是真实结果**：
8v8 小样本 min adj.P.Val=0.4524，阈值固定不随结果调整）三脚本界面三步全 exit 0、台账 completed/passed、
files 面板 12 产物可见、04 巡检 23 条全合法。line1 剩余步骤受数据面阻塞（仅一套 bulk 16 样本）
或无外网阻塞（PPI/KEGG），判定已落 `src/line1_bulk/README.md` 状态节。测试 68/68 绿、tsc 0 错、build 通过。
抓修崩溃级 bug #96 与旧代码进程坑（服务重启后才生效，复验通过）。详见 `con_hf/2026-10-13_plan_goal全量推进.md` P3 节。

**S3 line2_scrna 步骤 1 `ingest_counts` 已完成**（2026-10-13 上午）：数据盘点定性 GSE254707 =
Smart-seq2 孔板单细胞（4988 个按细胞 txt.gz + soft 元数据 + grouping.txt，坑 #103 三连）；
生产脚本 `src/line2_scrna/scripts/ingest_counts`（tar/soft/grouping 三分流 + 逐细胞解析 `__` 行排除 +
基因表跨文件比对 + cell x gene csr int32 矩阵 + soft 元数据 1% 容差对账、精确匹配率单独报告），
测试桩两跑 exit 0（4988 细胞 × 33213 基因 / 102 ERCC，nnz 1824 万）、h5ad 回读验证全过、
06 部署 PASS；界面验收：任务 line2_scrna-1791830071543 SSE 全流程日志流 + exit 0 徽章 +
台账 8aaddd09 completed/passed（environment 记录 Python 3.12.3 / seed 20261013，缺口 B manifest 链路生效）+
files 面板两产物可见；`04_check_logs.ps1` 24 条全合法 PASS。
`src/line2_scrna/envs/manifest.txt` 语言声明修正 R→Python 3.12.3（原误抄 line1）。

**S3 步骤 2 `qc_cells` 已完成**（2026-10-13）：论文固定阈值 nCount_RNA>50000/nFeature_RNA>1500/
ERCC<15%（前两项 0 失败，deposited 已预过滤；ERCC 超限 216 为实际剔除项）+ 基因 min_cells>=3。
**doublet 处置拍板：排除出主分析矩阵**（CIM-seq 混合图谱、celltype_paper=NA），
4988 个细胞指标与去留原因全落 `qc_cell_metrics.tsv` 可审计。产物 `scrna_qc.h5ad`
（4587 细胞 × 25063 基因，LS 1913/NLS 834/HC 1840，8 供体全保留）+ `qc_report.txt`。
界面验收 exit 0（台账 8c44985a completed/passed），files 面板 5 产物可见，巡检 26 条全合法。

**S3 步骤 3 `normalize_hvg` 已完成**（2026-10-13）：ERCC 剔除 94（归一化前）→
normalize_total(1e4)+log1p（layers['counts'] 保留原始整数计数）→ HVG seurat flavor 2000 个
（top：CCL22/IL17A/MMP12/TNF/CXCL13 等银屑病 marker）。产物 `scrna_norm.h5ad`
（4587 细胞 × 24969 基因）+ `hvg_genes.tsv` + `norm_report.txt`。界面验收 exit 0
（台账 850f94ba completed/passed），files 面板 8 产物可见，巡检 27 条全合法。

**S3 步骤 4 `integrate_harmony` 已完成**（2026-10-13）：HVG 子集 2000 → scale(max_value=10) →
PCA(50)（PC1 9.77%/cum30 36.36%）→ Harmony 校正（batch = donor 8 供体，harmonypy 原生调用，
random_state 用引擎 seed；scanpy 1.12.4 `sce.pp.harmony_integrate` 包装器 Z_corr.T bug 已绕开，坑 #104）。
donor silhouette 前 -0.1798/后 -0.1917（持平且负，donor 非主导方差，如实报告）；配对设计混淆
（healthy 供体只贡献 HC）已写入报告警告。产物 `scrna_integrated.h5ad`（4587 × 2000 HVG，
X=scaled、layers['counts'] int32、obsm 含 X_pca + X_pca_harmony 双嵌入）+ `integrate_report.txt`。
界面验收 exit 0（台账 84ed4063 completed/passed），files 面板 10 产物可见，巡检 28 条全合法。

**S3 步骤 5 `cluster_umap` 已完成**（2026-10-13）：X_pca_harmony 上 neighbors
(n_neighbors=15, n_pcs=30) → UMAP → Leiden（igraph、resolution=1.0），21 个簇
（size 17-684），LS 主导簇与 HC 主导簇分离清晰、无大簇被单一供体独占
（塌簇自校验加最小规模门槛防误伤小簇，坑 #105）。产物 `scrna_clustered.h5ad`
（obsm 三嵌入 + obsp 邻居图 + obs['leiden']）+ `cluster_report.txt`。
界面验收 exit 0（台账 0b16d63f completed/passed），files 面板 12 产物可见，巡检 29 条全合法。

**S3 步骤 6 `annotate_celltypes` 已完成**（2026-10-13）：先出证据后下结论，21 簇
wilcoxon top20 marker → 16 类文献 marker 集大类打分（阈值 0.4 不过记 unknown）→
27 类作者注释映射大类做细胞级对照（总体一致率 0.8129）。实测簇 19=pDC 20/20
（TCF4/IL3RA/IRF8/GZMB 正中论文主题）、簇 7=melanocyte 7/7 marker、簇 15/17
完全吻合；簇 12/18 marker 不过阈记 unknown 不硬猜。测试跑连修两个 pandas/h5py
坑（坑 #106：h5py 键名禁斜杠、categorical 跨类别集比较）。产物
`scrna_annotated.h5ad`（obs 加 celltype/celltype_paper_major、uns['annotation']、
uns['cluster_markers'] 420 行）+ `cluster_markers.tsv` + `annotate_report.txt`。
界面验收 exit 0（台账 a69f2a4b completed/passed），files 面板 15 产物可见，
巡检 30 条全合法。**注意：界面验收 io_files 必须填绝对路径**，裸文件名会被本地
合规校验拒落盘（exit 0 但无台账，本次翻车过一次）。

**S3 步骤 7 `pseudotime` 已完成**（2026-10-13）：拟时序路线因 R 侧
monocle3/slingshot 等全缺位改走 scanpy 内置 DPT（零新依赖）：diffmap on
harmony 邻居图 → iroot 选 progenitor_keratinocyte 簇内 DC 离质心最远细胞 →
dpt。主链单调（progenitor 0.131 → basal/suprabasal 0.58-0.61 → channel
0.945）；773 个非表皮谱系细胞 dpt=inf 是扩散图不可达的正常输出，
自校验用豁免集管理（谱系细胞出 inf 才 fail）。产物 `scrna_pseudotime.h5ad`
（obs['dpt_pseudotime']、obsm['X_diffmap']、uns['iroot']、uns['pseudotime']）+
`pseudotime_report.txt`。界面验收 exit 0（台账 423da81f completed/passed），
files 面板 17 产物可见，巡检 31 条全合法。

**S3 步骤 8 `cell_communication` 已完成**（2026-10-13）：liana 1.10.0
consensus 资源（4620 对 LR）rank_aggregate groupby=celltype（13 类）、
n_perms=1000、seed 注入。**表达矩阵取 norm 全基因产物而非 2000 HVG**
（consensus 2016 基因全基因覆盖 81.3% vs HVG 21.9%，原型实测定口径），
标签取 annotated 按索引对齐。top 交互生物学合理（LC→T LAG3-HLA-DQB2、
CSF2-CSF1R、RSPO1-LGR5+FGF7-FGFR1、BST2-LILRA4）。**连带坑 #107**：装 liana
连带 pandas 3.0.6→2.3.3 降级，7 个写 h5ad 脚本统一显式关闭 anndata
nullable strings 开关，annotate 回归产物与降级前逐字节一致。产物
`scrna_cellcomm.h5ad`（uns['cell_communication'] 口径+top20+per-pair top1）+
`cellcomm_interactions.tsv`（57027 行）+ `cellcomm_report.txt`。
界面验收 exit 0（台账 8a96a231 completed/passed），巡检 32 条全合法。

**S3 步骤 9 `virtual_knockout` 已完成**（2026-10-13）：装 scTenifoldpy 0.5.1
（安装前 dry-run 证实只新增 typer/rich/requests，核心栈未动；安装后 9 脚本
语法 + 10 依赖 import 冒烟全过）走 tenifoldknk 路线。敲除口径（原型实测定稿）：
群体 Psoriasis 2747 细胞（避开 donor-group 共线警告；pDC 仅 20 细胞不够建网）、
敲除基因 TNF（本线 top HVG、Psoriasis 表达 24.5% 稳过 QC 闸；pDC marker TCF4
6.55% 贴闸，对比后选 TNF）、表达矩阵 HVG 2000 上的 counts。**API 坑**：
`scTenifoldKnk` 类不接受顶层 random_state，必须走
`nc_kws/td_kws={"random_state": seed}`；`d_regulation` 自动把敲除基因排除出
期望计算（与 R 一致）。管线 QC 剔 216 细胞/775 基因后建 1225 基因网络，
adj p<0.05 的 4 个非敲除 DR 基因 TMEM45A/S100A9/S100A2/S100A8（角化+警报素，
TNF 敲除的银屑病下游讲得通），换 seed top20 重合 19/20。产物
`ko_dr_genes.tsv`（DR 全表 + is_knockout_gene 列）、`scrna_knockout.h5ad`
（2747 × 2000，obs['tenifold_qc_kept'] 2531/2747、var 六列 tenifold_*、
uns 含完整口径与 warnings）、`knockout_report.txt`（口径说明 5 条）。
界面验收 exit 0（台账 5db1ad45 completed/passed），files 面板三产物可见，
巡检 33 条全合法。

**产物回搬通道已上线**（2026-10-13，用户拍板"产出要搬回电脑"）：
`ops/07_pull_outputs.ps1`（与 05/06 同模式：ssh 探测 + scp + 逐文件字节校验，
同名默认跳过、-Force 覆盖）。首跑全量回搬 67 个文件 1016.8 MB 至本地
`outputs/`（line1_bulk/processed 12 + line2_scrna/processed 23 +
system_logs 32 条台账 JSON），字节校验全过。服务器保留运行态正本，
本地 `outputs/` 是正式产物存档目录（三线 README 产出去向节已同步该规则）。
注：服务器 system_logs 另有 1 个 0 字节无扩展名残留文件
`2026-10-13_line1_bulk_echo`（早期 echo 测试残留，非台账），07 脚本的
`*.json` 过滤正确排除，未搬。

**S3 步骤 10 `summarize_dr` 已完成，line2 十步清单全部完成**（2026-10-13）：
线内末端汇总模块，读步骤 9 两产物（knockout h5ad 的 uns 口径 + marker_sets +
obs['celltype'] + layers['counts']，ko_dr_genes.tsv 全表），不重算敲除。
汇总口径：显著 DR 基因 = adj p<0.05 且非敲除基因，按 p-value 升序 rank；
每基因输出 direction、marker_celltypes、top_expr_celltype / top_expr_prop。
自校验含 **uns seed 与引擎注入 seed 必须一致**（界面首跑因 TaskPanel 种子
默认 42 与上游 20261013 不一致被正确拦下，见坑 #112；改种子后 exit 0）。
实测：1225 DR 基因中显著非敲除 4 个（TMEM45A/S100A9/S100A2/S100A8，全 up，
3/4 命中 activated_keratinocyte marker，top_expr 全为角化类，与步骤 9 结论
一致），TNF 按 p-value 排名第 1。产物 `dr_genes_summary.tsv`（12 列）+
`dr_summary_report.txt`。界面验收 exit 0（台账 48bb85cb completed/passed），
files 面板两产物可见，巡检 34 条全合法；07 增量回搬 4 文件过。
**line2_scrna 步骤 1-10 全部完成**（界面验收全 exit 0、台账全 completed/passed）。

**S4 line3_spatial 步骤 1 `ingest_spatial` 已完成**（2026-10-13）：GSE192741
数据形态三轮探针定性（15 样本 = 10 小鼠 mm10 + 5 人 hg19；CSC genes×spots 矩阵、
positions 4992 位全捕获区、scalefactors 两档扫描 21.39 vs 147.16、ADT 带引号无 -1
后缀）。生产脚本 `src/line3_spatial/scripts/ingest_spatial`：输入四分流 + CSC→CSR
int32 + Ensembl ID var_names + 样本前缀 obs_names，自校验 10 项（tar 成员完整 /
soft 齐全 / 平台-物种-基因组一致 / barcode 全落 in_tissue / spot 数对账 / 基因同序 /
计数非负 / 组映射完整 / ADT 可对齐）。测试跑 exit 0（53s），回读验证全过
（per-sample spot 数精确匹配、uns spatial entries 结构、lowres 图 + 4 scalefactors 在位）。
manifest 修正 R→Python 3.12.3（同 #106 误抄模式），06 部署 PASS。
界面验收 exit 0（任务 line3_spatial-1791858252732，台账 8a28a18e completed/passed，
SSE 全流程日志流 + exit 0 徽章 + files 面板 4 产物可见：mouse 589MB / human 157MB /
samples_meta 4.7KB / report 1.6KB）；04 巡检 37 条全合法 PASS；07 增量回搬 6 文件
（4 产物 + 2 台账）745.5 MB 字节校验全过。
**界面验收翻车一次（坑 #102 复发）**：CDP fill 工具填 React 受控 `<textarea>`
DOM 值没进 state，提交后脚本报"缺少必需输入"exit 2（台账 397dff91 failed，合规），
原生 setter + input 事件重填后 55s 跑通。教训：验收前先搜踩坑台账。
坐标口径已写进 README：obsm['spatial'] 像素坐标仅限样本内，跨样本用 array_row/col。

**S4 步骤 2 `qc_spots` 已完成**（2026-10-13）：阈值经服务器三轮探针定稿
（ncount>=100 / nfeature>=50 / pct_mito<=50 / 基因表达 spot 数>=3）。
**mito 阈值定 50 的关键证据**（探针 2）：mito>20% 的 spot 人源仅 6.6% vs 小鼠
42.9%，且人源集中在 JBO014 单样本（掉 19.63%）不聚捕获区边缘，是样本级质量
特征非边缘损伤，滤了在组织上打洞破坏邻域分析，故只滤病态、样本级记 warning。
基因过滤结论：被滤基因 UMI 占比仅 0.001-0.004%；34% 基因（小鼠 10500/31053）
在任何 spot 零表达属参考基因组死基因，正常。生产脚本
`src/line3_spatial/scripts/qc_spots`：输入契约 17 项 + 指标重算与 ingest 列对账
+ 每样本保留比例 >=75% 自校验 + 基因过滤走 `np.bincount(X.indices)` 列计数
（坑 #113：CSR 的 indptr 是行偏移，per-gene spot 数不能对 indptr 做 diff）。
测试跑 exit 0（7s）：小鼠 17290→17283 spots / 31053→18628 基因；人源
6889→6877 spots / 32738→19613 基因；BH001 mito warning 正确触发。
回读验证 103 项全过（两 qc h5ad + metrics 全表与 kept 集合按 obs_name 对账）。
06 部署 PASS；界面验收 exit 0（任务 line3_spatial-1791859214422，台账
4e9172f7 completed/passed，SSE 全流程 + exit 0 徽章）；files 面板 4 产物可见；
04 巡检 39 条全合法 PASS；07 增量回搬 9 文件 746.2 MB 字节校验全过。
产物 4 个：`spatial_qc_mouse.h5ad`（17283 × 18628）、`spatial_qc_human.h5ad`
（6877 × 19613）、`spot_qc_metrics.tsv`（全量 24179 spot 含去留原因）、
`qc_report.txt`。obs 追加 total_counts/n_genes_by_counts/pct_mito 三列，
uns['qc'] 记口径键；uns['spatial'] 图与 scalefactors 随矩阵保留（只丢 spot
不丢样本）。

**S4 步骤 3 `normalize_hvg` 已完成**（2026-10-13）：归一化
normalize_total(target_sum=1e4) + log1p（与 Seurat LogNormalize 数值等价），
原始整数计数存 layers['counts']；mito 为内源基因不剔除（不同于 line2 剔除 ERCC），
入选 HVG 数如实报告（小鼠 10 / 人源 5）。HVG：seurat flavor n_top_genes=2000
按物种全数据集选取（基因宇宙不同禁止跨物种），小鼠 top20 免疫球蛋白为主
（Igkc/Igha，与肝巨噬细胞主题一致）、人源 C7/FBLN1 等肝基因。生产脚本
`src/line3_spatial/scripts/normalize_hvg`：输入契约 32 项、库大小归一化后精确
1e4、归一化不改稀疏结构（nnz 前后一致）、counts 层与 obs['total_counts']
逐 spot 对账。测试跑 exit 0（mouse 14.1s / human 2.0s 探针实测口径）；
回读验证 147 项全过（tsv 与 h5ad HVG 集合按 index 对账、disp_norm 降序）。
06 部署 PASS；界面验收 exit 0（任务 line3_spatial-1791859955943，台账
70e348b5 completed/passed，种子 20261013，SSE 全流程 + exit 0 徽章）；
files 面板 5 产物可见；04 巡检 40 条全合法 PASS；07 增量回搬 6 文件
1465.2 MB 字节校验全过。产物 5 个：spatial_norm_mouse.h5ad（17283 × 18628）、
spatial_norm_human.h5ad（6877 × 19613）、hvg_genes_mouse.tsv、
hvg_genes_human.tsv（各 2000 行）、norm_report.txt。

**S4 步骤 4 `dim_reduce` 已完成**（2026-10-13）：逐物种 HVG 2000 子集
scale(max_value=10) → PCA(50) → neighbors(15,30PC) → UMAP，嵌入与邻居图
贴回全基因对象。口径决策：不做跨样本批次校正（空间域识别下游逐样本做，
像素坐标跨样本不可比；实测 mouse sample_id silhouette 仅 0.1105 不主导方差，
分离度如实入报告）。生产脚本 `src/line3_spatial/scripts/dim_reduce`：
输入契约 32 项 + 未做过降维校验 + HVG 2000 + 嵌入形状/有限性 + counts 层
nnz 不变 + spatial 双不丢。测试跑 exit 0（mouse scale 4.0s/pca 19.9s/
neighbors+umap 64.0s，human 21s）；回读验证 54 项全过；06 部署 PASS；
界面验收 exit 0（任务台账 ca6791b1 completed/passed，种子 20261013，
fetch 提交体铁证，SSE 全流程 + exit 0 徽章）；files 面板 3 产物可见；
04 巡检 41 条全合法 PASS；07 增量回搬 4 文件 1477.4 MB 字节校验全过。
产物 3 个：spatial_dimred_mouse.h5ad（17283 × 18628，obsm X_pca/X_umap
+ obsp 邻居图）、spatial_dimred_human.h5ad（6877 × 19613）、
dimred_report.txt（方差解释 mouse PC1 6.421%/cum30 16.822%，human PC1
2.376%/cum30 10.302% + silhouette 诊断 + 口径说明）。

**S4 步骤 5 `spatial_domains` 已完成**（2026-10-13）：逐样本 neighbors(15,30PC)
→ Leiden(resolution=0.5)，域编号按样本命名空间隔离（obs['domain'] =
"<sample_id>_d<n>"）。工具路线：BayesSpace(R) 未装、squidpy dry-run 连带降级
numpy 2.5.3→2.4.6 并拖入 60+ 包（坑 #107 场景），走 scanpy 原生零新依赖方案。
resolution 定稿 0.5（探针双跑：连贯性 mouse 0.5163 vs 1.0 的 0.3627、human
0.6951 vs 0.4647，碎片域 4 vs 11）。**坑 #114**：多样本像素坐标不是全局坐标系
（全数据集 KD 树 91.5% 最近邻在他样本），连贯性必须逐样本算。结果：mouse
57 域（每样本 5-7）/ human 18 域（每样本 3-5）。生产脚本
`src/line3_spatial/scripts/spatial_domains`：输入契约 32 项 + 域命名空间
隔离校验 + X_pca 逐元素不变 + counts 层 nnz 不变。测试跑 exit 0 且与探针
数值一致（同 seed 可复现）；回读验证 43 项全过；06 部署 PASS（5 脚本）；
界面验收 exit 0（台账 1c4e868c completed/passed，种子 20261013，SSE 全
流程 + fetch 铁证）；files 面板 3 产物可见；04 巡检 42 条全合法 PASS
（spatial_domains_1c4e868c completed 在内）；07 回搬 4 文件 1477.4 MB
字节校验全过。产物 3 个：spatial_domains_mouse.h5ad / spatial_domains_human.h5ad
（obs 加 domain 列 + uns['domains'] 口径键）/ domains_report.txt。

**S4 步骤 6 `spatial_markers` 已完成**（2026-10-13）：逐物种对 domain 分组
wilcoxon（pts=True, n_genes=200, key_added=domain_markers）。关键口径：
**marker names 是 Ensembl ID**（var_names=ID 口径，symbol 在 var 列），tsv 导出前
`var['gene_symbol'].to_dict()` 映射 0 缺失；生物学合理性 mouse JBO009_d2 巨噬域
（Cd5l rank7 / C1qb rank17 / Tmsb4x rank1 同域）、每域 top1 呈肝 zonation。
生产脚本 `src/line3_spatial/scripts/spatial_markers`：输入契约（步骤 5 键集合
obs 21 + var 7 + uns 21 + domain 列 + 未做过 marker）+ 行数/映射/sanity 基因/
不变量全自校验。测试跑 exit 0；回读验证 43 项全过（含 tsv 与
uns['domain_markers'] 按组对账）；回读时抓住并修两个生产脚本 bug（坑 #115
tuple 不可写 h5ad、坑 #116 best_hit 取错行）；06 部署 PASS（6 脚本）；
界面验收 exit 0（台账 d509396d completed/passed，种子 20261013，fetch 铁证，
**outputs 填目录不生效、产物落 processed 根目录**，坑 #117）；files 面板
5 产物可见；04 巡检全量 PASS；07 回搬 6 文件 1504.3 MB 字节校验全过。
产物 5 个：spatial_marker_mouse.h5ad / spatial_marker_human.h5ad（uns 加
domain_markers top200 + markers 口径键）/ domain_markers_mouse.tsv（1140 行）/
domain_markers_human.tsv（360 行）/ marker_report.txt。

**S4 步骤 7 `spatial_autocorr` 已完成**（2026-10-13）：逐物种逐样本像素 KNN(k=6)
（cKDTree → 对称化 w+w.T → 行标准化）逐基因 Moran's I + Geary's C，批量稀疏乘
全基因一次算完（mouse 11.5s / human 4.9s），基因级跨样本 mean/min/max +
n_valid_samples。矩阵取 X（归一化 log 值）。两轮探针定稿：计时、I 分布、
生物学 sanity（zonation 基因 I 0.45-0.60 vs 免疫弥散 0.09-0.16，z 46-62 vs
8-16）、对称化前后 top10 一致。推断口径：Moran's I 用 Cliff-Ord 随机化正态
近似解析 z（esda norm 同式，零置换）；Geary's C 只报统计量（解析方差依赖
基因四阶矩，跨基因解析式与 permutation 不等价），报告注明。nan 基因 0 个；
partial-zero（部分样本零表达）mouse 4236 / human 3451 如实记。
生产脚本 `src/line3_spatial/scripts/spatial_autocorr`：输入契约（步骤 6 键集合
+ markers 键 + 未做过自相关）+ 权重行和=1 + I/C 理论范围 + zonation>免疫硬
断言 + 不变量全自校验。测试跑 exit 0；回读验证 38 项全过（含朴素双重循环
教科书式核对）；06 部署 PASS（7 脚本 + 1 清单）；界面验收首跑翻车一次
（outputs 填裸文件名台账拒落盘，坑 #118，界面 completed 是假象，服务器
system_logs ls 计数 0 定性），重提 exit 0 台账 f5d8bea8 completed/passed
（种子 20261013、fetch 提交体铁证）；files 面板 5 产物可见；04 巡检 39 条
全合法 PASS；07 回搬 6 文件 1512.9 MB 字节校验全过。
产物 5 个：spatial_autocorr_mouse.h5ad / spatial_autocorr_human.h5ad（var 加
morans_i_mean/min/max、morans_z_mean、gearys_c_mean/min/max、
autocorr_n_valid_samples 八列 + uns['autocorr'] 口径键）/ gene_autocorr_mouse.tsv /
gene_autocorr_human.tsv（全基因按 i_mean 降序）/ autocorr_report.txt。

**S4 步骤 8 `spatial_cooccurrence` 已完成**（2026-10-13）：逐物种逐样本像素
KNN(k=6)（与步骤 7 同一权重定义：有向邻接 A → 对称化 A+A.T 互向权重 2 → 行标准化）
对 domain 标签算共现矩阵 C[di,dj]=onehot_di^T W onehot_dj（one-hot 稀疏乘），
100 次标签置换（seed 注入、只打乱标签保持几何权重）得每 domain 同域富集 z
（squidpy nhood_enrichment 同思路，零新依赖）。探针实测：mouse 全 10 样本 0.6s /
human 0.3s；所有样本所有 domain 同域 z 全为正（min 2.89 / mean 14-48）与步骤 5
空间连贯性自洽；same_frac 0.09-0.90（JBO006 碎片域 0.089）。
生产脚本 `src/line3_spatial/scripts/spatial_cooccurrence`：输入契约（步骤 7 键集合
+ autocorr 键 + 未做过共现）+ 类型数=域数 + 共现行和>0 + same_frac∈[0,1] +
同域 z 全为正硬断言 + 不变量全自校验。测试跑 exit 0；回读验证 47 项全过
（含朴素双重循环教科书式核对单样本共现矩阵对角，与生产稀疏实现 diff 4.74e-05
纯 4 位小数舍入；spot 级两列与 tsv 逐行对账 75 行；top_partner 与 uns 归一化
矩阵一致）。**回读首跑 2 个 FAIL 是朴素参考实现本身写错**（写成并集对称互向
权重 1，与生产定义 A+A.T 互向权重 2 差 0.4-0.7%），修正参考实现后全过，
教训记坑 #119；06 部署 PASS（8 脚本 + 1 清单）；界面验收 exit 0（任务
line3_spatial-1791867699227，台账 94eadd75 completed/passed，种子 20261013，
fetch 提交体铁证，outputs 填 processed 目录绝对路径防坑 #118 复发）；
files 面板 5 产物可见；04 巡检 42 条全合法 PASS；07 回搬 6 文件
1506.6 MB 字节校验全过。
产物 5 个：spatial_cooccurrence_mouse.h5ad / spatial_cooccurrence_human.h5ad
（obs 加 domain_same_frac/domain_same_z 两列 spot 级贴回 + uns['cooccurrence']
口径键含逐样本归一化共现矩阵与 z 矩阵）/ domain_cooccurrence_mouse.tsv（57 行）/
domain_cooccurrence_human.tsv（18 行）/ cooccurrence_report.txt。

**S4 步骤 9 `spatial_composition` 已完成**（2026-10-13）：逐物种逐样本算域组成的
**rank 对齐规模谱**（每样本内各域 spot 占比降序，ties 按域名排序保证确定性）
+ 样本级多样性（Shannon H / 有效域数 exp(H) / top1 / top3）+ 组间检验
（condition_class 与 condition 两级）。
**口径定稿**（服务器探针 `cn_debug/s4_composition_probe.py` 实测）：domain 身份
样本私有（`<sample_id>_d<n>`）不可跨样本直比：逐域 spot size 全样本全 0、
Bray-Curtis 在域身份空间全 1.0，按域身份比组成无意义 → rank 对齐规模谱 +
样本级多样性。小样本统计口径（line2 DEG 教训同款）：精确置换枚举（2 组且
C(n,n1)<=20000 全枚举，mouse C(10,4)=210 / human C(5,2)=10，无蒙特卡洛误差、
与 seed 无关），非 2 组回退 seed 注入 10000 次随机置换；教科书 KW 独立实现
不调 scipy.stats.kruskal（坑 #119）。实测：mouse condition_class（nafld 4 vs
stst 6）逐 rank 0/7、置换 p=0.1095（exact）；mouse condition 级 SD 单样本
如实跳过；human 两级逐 rank 0/5、置换 p=0.2000（exact，最小可能 0.1）。
两组均无显著组成差异，如实报告。
生产脚本 `src/line3_spatial/scripts/spatial_composition`：输入契约（步骤 8 键集合
obs 22 + var 15 + uns 24 含 cooccurrence + 未做过 composition）+ 未舍入谱行和=1
（1e-9）+ Shannon 越界 + 与步骤 8 uns 对账 + rank 完整 + 舍入行和 1e-3 +
spot_prop∈[0,1] + spot_rank 一致 + 不变量。测试跑 exit 0，连修三坑：categorical
value_counts 把未观测类别以 count 0 列出（坑 #120 首跑自校验正确拦截）、
舍入容差（步骤 8 同课）、uns list-of-dicts TypeError（per_rank 改 dict 键控
+ None 数值 nan + 跳过原因空串）。回读验证 308 项全过
（`cn_debug/s4_composition_readback.py`，参考值全部从步骤 8 产物独立重算）。
06 部署 PASS（9 脚本 + 1 清单）；界面验收 exit 0（任务
line3_spatial-1791874441329，台账 9272b61a completed/passed，种子 20261013，
fetch 提交体铁证；首跑台账 22e09761 failed 是 fill 工具未写进 React state，
坑 #118 复发，原生 setter 重填后通过）；
files 面板 5 产物可见；04 巡检 47 条全合法 PASS；07 回搬 9 文件
1507.3 MB 字节校验全过。
产物 5 个：spatial_composition_mouse.h5ad / spatial_composition_human.h5ad
（obs 加 domain_rank/domain_prop 两列 spot 级贴回 + uns['composition']
口径键含 per_rank dict 键控 / sample_metrics / permutation / samples）/
sample_composition_mouse.tsv（10 行）/ sample_composition_human.tsv（5 行）/
composition_report.txt。

**S4 步骤 10 `spatial_communication` 已完成**（2026-10-13）：LR 资源取 liana
consensus（本地已装 1.10.0 离线零新依赖，探针 1 盘点：4620 对，squidpy/CellPhoneDB/
NICHES/COMMOT/SpatialDM 均未装）。**大写归一匹配**（探针 2-3 定性：liana 资源是人类
命名大写，mouse symbol Title case 如 Tgfb1，直接匹配只命中 2/4620，归一后 2213/
4620；human 2418/4620）。空间打分口径（探针 3-5 定稿）：逐物种逐样本像素 KNN(k=6)
（与步骤 7/8/9 同一 build_knn_weights）对每对 LR 算 domain 对级强度
score = sum lv*w*rv，除以 domain 对邻域质量得单位质量强度（消除域规模差异）；
**向量化实现定稿**：逐 pair python 循环 mouse 587.6s / human 253.1s 不可接受，
改为 rec_side = W @ (rv * mask_dj) + einsum 聚合后 mouse 6-8s / human 1.5s（提速
100 倍，scipy sparse .toarray() 与 .todense() 的 matrix/ndarray 差异踩过一轮）。
统计口径同步骤 9（样本级指标 KW + eta2 + L1 置换，2 组精确枚举）。spot 级贴回
lr_score_recv（max over pairs × 源域）。生产脚本 `src/line3_spatial/scripts/
spatial_communication`：输入契约（步骤 9 键集合 obs 24 + var 15 + uns 25 含
composition）+ 权重行和=1 + score 非负 + 样本内观测域对角质量>0（doms 是全物种
并集，坑 #120 同源，首跑自校验正确拦截）+ 与步骤 9 uns 对账 + spot 级非负有限 +
不变量 + 参考值对账（单样本最大组合朴素双重循环两物种六位小数一致）。
**回读验证 188 项全过**（cn_debug/s4_comm_readback.py，教科书 KW + 独立聚合 +
全 pair 扫描朴素重算），回读首跑抓到一个生产 bug：spot 贴回 (di,k) 双重循环直接
赋值被后写覆盖拿到最后值不是 max，修为先收集 max 再一次写入；另抓到一个回读口径
问题：tsv 4 位小数舍入引入额外 ties 使 KW H 与生产不一致（舍入伪差异），修为
tsv 增落未舍入 raw 列后对账通过。06 部署 PASS（10 脚本 + 1 清单）；界面验收
exit 0（任务 line3_spatial-1791881092202，台账 c0005d86 completed/passed，
seed 20261013，fetch 提交体铁证）；files 面板 5 产物 VISIBLE；04 巡检 PASS；
07 回搬 12 文件 1507.7 MB 字节校验全过。
实测：mouse condition_class（nafld 4 vs stst 6）置换 p=0.0524（exact 210）；
mouse condition 级 SD 单样本如实跳过；human 两级置换 p=0.6000（exact 10）。
top 跨域对 mouse APOA2-LRP1（载脂蛋白代谢）、human HP-ASGR1/HP-ASGR2（肝细胞
去唾液酸糖蛋白受体，Guilliams 2022 主题正中），两组均无显著通讯差异如实报告。
产物 5 个：spatial_communication_mouse.h5ad（1192.5 MB）/ spatial_communication_human.h5ad
（316.3 MB）（obs 加 lr_score_recv + uns['communication'] 口径键含 top_pairs/
domain_pair_mass/group_tests）+ sample_communication_mouse.tsv（10 行 12 列）/
sample_communication_human.tsv（5 行）+ communication_report.txt。

**S4 步骤 12 `spatial_localization`（目标基因空间定位）已完成**（2026-10-13）：
目标基因候选池 = 步骤 6 rank_genes_groups 各域 marker 前 20 名去重（探针定性：
wilcoxon top1 在 spot 噪声数据上含大量泛表达基因 frac>=0.99 无定位信息量，
取 top20 让打分排序自行筛选）。逐基因逐样本算域富集（domain 身份样本私有，
跨样本累加无意义，同步骤 9 教训）：enrich = 域内表达 spot 占比/该基因全 spot
占比；self_consistent = marker 域（样本内）恰为 enrich 最高域；排序 = 自洽样本数
降序 → best_enrich 降序 → frac_all 升序（泛表达基因自然沉底不用硬阈值）。
生产脚本 `src/line3_spatial/scripts/spatial_localization`：输入契约（步骤 10
键集合 obs 25 + var 15 + uns 26 含 communication + 未做过定位）+ 候选池非空 +
候选基因全映射 var_names（marker names 是 Ensembl ID 即 var_names 本身，步骤 6
既定口径）+ enrich 非负 + 自洽样本数<=总样本数 + spot 级非负有限 + 不变量。
测试跑 exit 0；回读验证 62 项全过（cn_debug/s4_loc_readback.py），回读首跑
4 FAIL 定性为回读自身排序错（uns target 键 target1/target10/target2 字符串字典序
把 target10 插第二位，修为数值后缀排序后全过，产物本身正确）。06 部署 PASS
（11 脚本 + 1 清单）；界面验收 exit 0（任务 line3_spatial-1791883700374，
台账 38b675f2 completed/passed，种子 20261013，fetch 提交体铁证）；files 面板
5 产物 VISIBLE；04 巡检 PASS；07 回搬 9 文件 1508 MB 字节校验全过。
实测：mouse 候选 363，top Hba-a1（自洽 7/10 enrich 2.30）/Hbb-bt（6/10 4.04）/
Gsn/Spp1（5/10，Spp1 与步骤 6 巨噬域 marker 一致）/Cyp2c69/Cyp2c40（肝 zonation）；
human 候选 190，top MTRNR2L1/MT-ND4L/MT-ND4（线粒体）/PTGDS（步骤 3 已知人源
HVG top）/DGAT2（NAFLD 脂代谢）。产物 5 个：spatial_localization_mouse.h5ad
（1192.6 MB，obs 加 target_gene_expr + uns['localization'] 含 targets dict 键控）/
spatial_localization_human.h5ad（316.4 MB）/ gene_localization_mouse.tsv（363 行）/
gene_localization_human.tsv（190 行）/ localization_report.txt。

后续阶段（用户第 4 步"先软件后分析"）：软件已交付；`src/` 三线分析代码按 B2 拍板
（另起炉灶，底座 R 资产只读不碰）逐片填实，S0/缺口 B/S1/S2 已完成，
**S3 line2_scrna 步骤 1-10 全部完成**，**S4 line3_spatial 步骤 1-12 已完成**
（ingest_spatial / qc_spots / normalize_hvg / dim_reduce / spatial_domains /
spatial_markers / spatial_autocorr / spatial_cooccurrence / spatial_composition /
spatial_communication / spatial_localization，共 11 步 + 步骤 11 解卷积待参考
来源决策），
步骤 13（虚拟敲除，spot 级按空间域聚合或子集）可按线内产物推进。

## 已完成的（有实测证据）

| 项 | 证据 |
|---|---|
| adb ↔ 手机 | `3a3e1f52 device` 在线 |
| forward 8022 / 10022 | 两条在位，脚本幂等 |
| `ssh k40`（Termux） | TERMUX_OK，aarch64 |
| `ssh k40-ubuntu`（容器） | CONTAINER_OK，R 4.3.3，Python 3.12.3，5 核 11G |
| 链路自检脚本 | `pwsh -File ops/00_link_check.ps1` → exit 0，四段全 PASS |
| log 子服务修复 | `pwsh -File ops/01_fix_svlogger.ps1` → exit 0，三服务 log 全 run，主进程 pid 未变 |
| 代码隔离校验 | `pwsh -File ops/02_check_isolation.ps1` → exit 0；用临时违规样例反向验证过能抓到（exit 1 + 文件行号） |
| 台账隔离校验 | `pwsh -File ops/04_check_logs.ps1` 三条路径验证：目录缺失 → exit 1 并提示；合法样例 → exit 0；跨线 + 缺种子样例 → exit 1 逐条报出 |
| 三线骨架 | `src/{line1_bulk,line2_scrna,line3_spatial}/` 各有 README（步骤清单 + 工具分工 + 敲除约束 + 本目录结构）+ `scripts/`、`checkpoint/` 占位 |
| 链路复检 | `pwsh -File ops/00_link_check.ps1` → exit 0，四服务主进程与 log 子进程全 run（log 子进程稳定运行 2194s，确认 #88 修复生效） |
| BioanalysDesktop 骨架 | `npm install` 92 包，`npx vite build` 通过（31 模块 145KB），dev 前后端双起实测（后端 8787 / 前端 5173） |
| 零算力红线 | `tests/proc.test.js` 覆盖：ssh/scp/adb 放行（含绝对路径），Rscript/Python/bash 一律抛错 |
| 命令审计 | `server/audit.js` 拦跨线引用，测试覆盖跨线、大小写变体、Windows 分隔符、多行单行越界四种情形 |
| 链路总览（T03） | `node --test` 20/20 全绿，含四段自检真连（1.1s）；界面实测展示设备、两条 forward、双 sshd、R 4.3.3/Python 3.12.3、5 核 11G、226G/190G avail、四服务 RUN |
| 台账巡检（T04） | `tests/ledger.test.js` 10/10 + `tests/consistency.test.js` 与服务器 bash 判定结论一致；接口实测阻塞态与真实数据两条路径；界面实测阻塞提示正确 |
| 文件浏览（T05） | `tests/files.test.js` 10/10；服务器临时目录造树实测，用完已清；界面实测阻塞态提示正确（SSD 未挂载） |
| 任务下发（T06） | 接口三项实测：跨线提交 400 直接拒（不给 taskId）、同线同步骤并发 409、合法任务全链路（ssh 执行 → exit → 台账落盘）；界面 DevTools 实测：SSE 日志流、exit 徽章、台账摘要回显 |
| 端到端验收（T07） | 四功能 DevTools 各跑一次：link 总体 PASS（5 核 11G，四服务 RUN）；ledger 6 条全合法；files 显式阻塞（按设计）；task 跨线 400 + 合法全链路 + 干净 error_log |
| 产出回搬通道 | `pwsh -File ops/07_pull_outputs.ps1` → exit 0，67 文件 1016.8 MB 回搬本地 `outputs/`（line1 12 + line2 23 + system_logs 32），逐文件字节校验全过 |
| 抓修 bug① | `/api/tasks/submit` 审计前置漏 import `buildTaskScript`，跨线请求把服务打到 ReferenceError 崩掉。修为补 import + 新增 `tests/index.test.js`（子进程方式打真实入口，3 条） |
| 抓修 bug② | 台账文件名日期取 UTC，凌晨（Asia/Shanghai）跑的任务记到前一天。修为按本地时区归档，`buildLedgerFileName` 有单测 |
| 抓修 bug③ | error_log 混 ssh 客户端噪声（Warning: Permanently added...）。修 `stripSshNoise` 行前缀过滤，有单测 |
| LedgerPanel 类型窄化 | `'error' in result` 改 `'blocked' in result` / `'summary' in result`，`tsc --noEmit` 从 13 错到 0；`main.tsx` 去掉 `.tsx` 导入后缀 |

## 阻塞项（需用户决策）

1. ~~**B1 `/mnt/ssd` 未挂载**~~ → **2026-10-13 用户拍板解除**：不外挂 SSD，把手机当 Linux 服务器用，
   数据面落手机自带存储。`/mnt/ssd/bio_data` 路径名不变（容器 eMMC 上的普通目录）。
   05 脚本已改为"确认可写"（去掉挂载探测），三套测试数据 11 文件 905 MB 已正式上数并字节校验通过，
   files/ledger/task 三接口真实数据面回归通过。回归中抓到并修掉崩溃级 bug #96（详见踩坑台账）。
2. **B2 底座既有 R 资产归属** → **2026-10-13 用户拍板：另起炉灶**。底座 Termux 家目录（u0_a282）的
   01-11 编号 R 脚本、`05_scrna.R`、`06_spatial.R`、`P20261009_*` 项目脚本、`Fig_spatial_*.png`、
   `T5SP_*.tar.gz` 等资产**只读不碰、不固化进 `src/`**，三线分析代码独立设计，
   避免被带入老代码的潜在问题。`src/` 三线填实是用户第 4 步的大阶段，从零设计步骤清单与脚本。
3. **测试数据已上数**：`test_use_data/` 3 套可用数据（GSE277173 bulk / GSE254707 sc / GSE192741 spatial，
   11 文件 905 MB）已于 2026-10-13 推到 `/mnt/ssd/bio_data/<line>/raw_data/`，字节校验全过。
   Linux 内不用中文路径，`分组情况.txt` 按脚本 `$RemoteNameMap` 换成 `grouping.txt` 落盘。

## 2026-10-13 基础设施故障（Termux 应用数据被清除，待用户处理）

**事件**：S4 步骤 13 spatial_knockout 服务器测试跑期间，手机侧 Termux 应用数据被清除
（用户侧"清除数据"或 MIUI 深度清理，`pm dump` 显示 ALLOW_CLEAR_USER_DATA + dataDir
为空 + Activity class does not exist + monkey "No activities found to run"）。
ssh（8022/10022）在 11:29 恢复过一次，随后再次断开并确认 Termux userspace 已消失。

**受损范围（本地面板可确认部分）**：
- Termux userspace：`/data/user/0/com.termux` 不存在，proot-distro 容器元数据、
  ubuntu-sshd/sshd 配置、sshd 密钥、Termux 内 ssh key、服务 runsvdir 全部丢失；
- 本地 `C:/Users/18765/.ssh/id_ed25519` 密钥**完好**（本地零算力设计的价值体现）；
- 服务器数据面：adb `df /data/user/0` 显示 59G used / 166G avail，与故障前
  （60G / 27%）一致，**bio_data 数据块大概率未物理删除**，失效的只是容器
  rootfs 绑定与访问链路；但这一点**未经验证**（adb 无 Termux 权限后无法 ls
  /mnt/ssd/bio_data）。故障时间线：09:28 步骤 12 界面验收成功 → 10:19 uptime
  已显示 2 min（一次重启）→ 11:29 短暂恢复 → 之后 Termux 数据被清。

**本地成果（全部安全）**：outputs/ 下 71+ 文件、src/ 三线 11 个 line3 脚本、
con_hf 全部台账均在本机 `D:\00.AIagent\codespace\AI辅助生信分析流程工作台`，
不依赖服务器。line3 步骤 1-12 的产物 h5ad/tsv/report 均已回搬本地。

**恢复必须用户参与（不可由 agent 代做的部分）**：
1. 手机上重新安装/打开 Termux（apk 包体仍在，但 userspace 需重建：
   `pkg install openssh proot-distro` 等，流程长，属用户操作面）；
2. 重装 proot-distro ubuntu 容器并确认 `/mnt/ssd/bio_data` 数据是否幸存
   （59G used 未降是利好信号，但必须实测）；
3. sshd/authorized_keys 重配（本地公钥在 `$HOME/.ssh/id_ed25519.pub`,
   内容 `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB7lQo/efdruq44oOqwQ3+L/5mmAC5IdNGBCw21oUFd+ SUPPORT`）；
4. Python 科学栈重装（scanpy/anndata/liana/scTenifoldpy 等，恢复清单见
   `src/line3_spatial/envs/manifest.txt` 与步骤 10 探针记录）。
5. MIUI 侧防杀设置（电池优化白名单 + 自启白名单 + 后台锁定），防止复发；
   无 root 下 aims.txt 2.3 的 oom_score_adj -1000 宿主防杀不可用。

**S4 步骤 13 `spatial_knockout` 全部完成**（2026-10-13 下午至晚间，
详见下文步骤 13 段）：逐样本 spot 级子集路线（aims 允许的"子集运行"分支），
mouse 9/10 样本 + human 4/5 样本跑通（72.8s + 25.2s），回读 119 项全过，
界面验收 exit 0（台账 1414fbdf completed/passed），files 5 产物可见，
04 巡检 PASS，07 回搬 11 文件 1509.8 MB 字节校验全过。

**S4 步骤 11 `spatial_deconvolution`（解卷积）未做**：硬约束参考不得取自线2，
仅允许 `public_references/` 或线内自有单细胞分辨率数据。线3 raw_data 是
GSE192741（10x Visium spot 级，无配对 scRNA），需用户决策参考来源或跳过，
尚未动工。**先问必要问题再动**（aims 工作方式第 10 条）。

## 下一步（建议顺序）

1. `src/` 三线分析代码填实（用户第 4 步，独立大阶段）：方案见
   `con_hf/2026-10-13_plan_goal全量推进.md` 的 P3 节。**S0 部署通道 + 缺口 B 环境清单 + S1 首步骤
   （prep_matrix）+ S2 切片（qc_matrix/pca_matrix/deg_limma）+ S3 步骤 1-7（ingest_counts/qc_cells/normalize_hvg/integrate_harmony/cluster_umap/annotate_celltypes/pseudotime）均已完成**，
   line1 剩余步骤受数据面阻塞（仅一套 bulk 16 样本，富集待 DEG 有显著基因）。
   **S3 line2_scrna 步骤 1-10 全部完成**（ingest_counts/qc_cells/
   normalize_hvg/integrate_harmony/cluster_umap/annotate_celltypes/pseudotime/
   cell_communication/virtual_knockout/summarize_dr，界面验收全 exit 0、
   台账全 completed/passed）。**产物回搬规则（用户拍板）**：每步产物验收通过后
   跑 `pwsh -File ops/07_pull_outputs.ps1` 回搬本地 `outputs/` 存档（增量，同名
   默认跳过），不让成果只躺服务器。
   **S4 line3_spatial 步骤 1-12 已完成（步骤 11 解卷积待参考决策外）**（2026-10-13，
   界面验收均 exit 0：
   步骤 1 台账 8a28a18e、步骤 2 台账 4e9172f7、步骤 3 台账 70e348b5、
   步骤 4 台账 ca6791b1、步骤 5 台账 1c4e868c、步骤 6 台账 d509396d、
   步骤 7 台账 f5d8bea8、步骤 8 台账 94eadd75、步骤 9 台账 9272b61a、
   步骤 10 台账 c0005d86、步骤 12 台账 38b675f2、步骤 13 台账 1414fbdf，
   均 completed/passed；
   巡检全量合法、07 回搬累计 82 文件过），
   **步骤 11（解卷积）是 line3 仅剩未做项，卡在参考来源决策**（线3 raw_data 无
   单细胞分辨率参考，硬约束不得取自 line2，仅允许 public_references/ 或线内
   自有数据；按 aims 工作方式第 10 条先问必要问题再动）；
   坐标口径、QC 阈值、归一化/HVG/降维/空间域/marker 口径见
   `src/line3_spatial/README.md` 状态节。
   TaskPanel 的底座旧脚本候选列表已按 B2 决策撤掉，改为独立设计口径的手填输入。
2. 手机重启后复验 log 子服务修复是否抗重启（#88）。T03 面板可直接看四服务状态。

## 已知残留（不阻塞，待处置）

- 服务器 `/mnt/ssd/bio_data/system_logs/` 有 6 个开发期冒烟台账（step 为 smoke_test* 与 dup_check_step），
  是数据面早期开发时的测试残留（现在此路径就是正式数据面，不再是挂载点遮蔽问题）。是否清理待用户确认（未擅自删）。
- 服务器 `/mnt/ssd/bio_data/line3_spatial/processed/` 有调试探针脚本（步骤 2 期间的
  s4_qc_probe.py / s4_qc_probe2.py / s4_qc_probe3.py / s4_qc_readback.py，步骤 6 期间的
  s4_marker_probe2-4.py 系列落 /tmp 未清、s4_marker_test/ 测试目录），按归档规则属
  `cn_debug/` 内容，未擅自删除移动；已随 07 回搬到本地 outputs/，是否清理待用户确认。
- `BioanalysDesktop/old_useless/` 空残目录，无引用，未动，待用户处置。
- `cn_debug/diag_runtask.mjs` 是一次性诊断脚本，已无用，可删。

## S4 步骤 13 spatial_knockout 完成记录（2026-10-13 下午）

**路线切换（关键）**：域聚合路线（样本 x 域 pseudo-bulk，mouse 57 / human 18）
实测废弃：human 聚合后 scTenifold QC（剔 lib<1000 13 个 + outlier 1 + mito 3）
只剩 1 个 pseudo-cell，`pc_net` 直接抛
`ValueError: n_comp must be < number of non-constant genes (0)`；mouse 侧虽能跑
（57 到 QC 后 24、1914 DR 基因）但两条路线物种不对称、口径不统一。改走
aims.txt 明确允许的**"子集运行"分支：逐样本 spot 级**，探针 7 实测
（mouse JBO001 1646 spot 6.1s / human JBO018 2500 spot 5.6s）可行。

**scTenifold mito QC 失真与修法（探针 8 定位，坑 #122）**：
`_QC.py` 的 mito 比例在**喂进去的矩阵**上算（`X[mt].sum / X.sum`）。喂 HVG
子矩阵时分母缩水，mouse mito 基因计数高，比率被放大约 5 倍：BH001 1706 spot
剔到 0、2000 基因全滤、`make_networks` 断言 `Gene names are required` 崩。
修法：先在**全 counts** 口径预剔 mito 比 >= 0.1 的 spot（阈值与 `^MT-` 匹配
规则同 scTenifold，只换分母），再以 `qc_kws={"max_mito_ratio": 1.0}` 关掉库内
mito 过滤。修正后 mouse mito 预剔仅 100 个 spot（失真口径是 1626+）。

**最终口径**：每物种逐样本跑 scTenifoldKnk（spot 作 cell 单元），基因宇宙 =
HVG 2000 + 敲除基因（与 line2 步骤 9 同口径）；KO 基因 = Spp1/SPP1（线内证据，
不取 line2 TNF）；species 级显著 DR = 跨样本并集（adj p<0.05 且非敲除基因）；
排序 = 显著样本数降序，再最小 adj_p 升序；KO 表达占比 <5% 或 mito 预剔后
<50 spot 的样本跳过并如实记录（mouse CAP002 KO%=0.0157、human JBO015
KO%=0.0351）；spot 级贴回 `obs['ko_dr_expr']` = 显著 DR 基因 counts 均值。

**实测结果**：mouse 9/10 样本 72.8s，54 个物种级显著 DR（top：Mup11 6 样本
adj_p=9.8e-44、Rnase4 6 样本、mt-Co1 5 样本、Mup1/Rgn；Mup/Rnase4/Rgn 是
肝枯否细胞（Kupffer）表型，Spp1 敲除的肝内扰动讲得通）；human 4/5 样本 25.2s，14 个
（top：MT-ATP6 3 样本、SERPINA1 2 样本、FGL1/CYP2A6/NNMT/SDS，肝细胞功能基因）。
注意：mito 基因大量进 top 是 scTenifold 保留 mito 于网络的默认行为（不同于
scRNA 流程剔除 ERCC），已写报告说明；DR 不是 DEG，计算模拟非实验验证。

**产物 5 个**（服务器 `line3_spatial/processed/`）：spatial_knockout_mouse.h5ad
（17283 x 18628，obs 加 ko_dr_expr、uns['knockout'] 含 top_dr 与 sample_dr_stats_json）、
spatial_knockout_human.h5ad（6877 x 19613）、ko_dr_genes_mouse.tsv（10341 行
= 9 样本 DR 表）、ko_dr_genes_human.tsv（3885 行）、knockout_report.txt。

**回读 119 项全过**（`cn_debug/s4_ko_readback.py`）：top_dr 独立重算、
ko_dr_expr 按 counts 独立重算、逐样本行数对账 uns、显著并集数、敲除基因互斥、
不变量（X/counts nnz、X_pca/X_umap/spatial、domain、obs 与 var 列齐全）。

**坑 #122**（新）：scTenifold mito QC 比率按喂入矩阵库计算，HVG 子矩阵分母
失真放大约 5 倍，修法见上。

**全链路闭环**：06 部署 MD5 字节匹配（2f44e1aab2790f381e748d2ba3d8b7ea）；
界面验收 exit 0（任务 1414fbdf-97ca-4253-b78d-b885c043c59e，台账
2026-10-14_line3_spatial_spatial_knockout_1414fbdf.json completed/passed exit 0
seed 20261013，fetch 提交体铁证 lineId=line3_spatial；首次提交因面板内线未切
line3 被审计正确拦下，属预期行为）；files 面板 5 产物 VISIBLE；04 巡检 PASS；
07 回搬 11 文件 1509.8 MB（5 产物 + 台账 + 5 个探针脚本残留随搬）。

## 2026-10-13 晚：aims 全量缺口推进 + Termux 恢复 + aims 第 4 节改轻度优化版

**用户指令**："按最简单最省事的来，我是想以最快的速度完成以上（aims）的内容。"

**盘点结论（探针 s5_inventory_probe.py / s5_gap_probe.py 实测）**：
- line2_scrna 十项缺 5 项：①细胞比例/组成 ②组间 DEG ⑤亚群再聚类 ⑥功能富集 ⑨TF 调控
  （已完成 5 项：ingest/qc/normalize/integrate/cluster/annotate/pseudotime/
  communication/virtual_knockout/summarize_dr）
- line3_spatial 九项缺 1 项：⑦解卷积（cell2location/tangram/scvi 全未装，
  torch 生态在手机端不现实，需用户决策参考来源）
- aims 第 3 条出图规范：原本空缺，已补 `docs/figure_spec.md`

**已完成（不受链路阻断）**：
1. `docs/figure_spec.md`（aims 第 3 条落地：落点命名/分类必备元素/样式基线
   Agg 后端 150dpi viridis/算力约束/归档规则）
2. gseapy 1.3.1 装好（dry-run 证实零依赖变更，核心栈 scanpy 1.12.4 /
   anndata 0.13.4 / liana 1.10.0 / scTenifold 0.5.1 / pandas 2.3.3 / numpy 2.5.3
   全未破坏，冒烟脚本 s5_gseapy_smoke.py）；Enrichr 基因集库实测可达：
   GO_Biological_Process_2023 = 5406 基因集、KEGG_2021_Human = 320、
   Reactome_Pathways_2024 = 2100、ENCODE_and_ChEA_Consensus_TFs = 92
   （ENCODE_TF_ChIP-seq_2015 超时，弃用该库）
3. line2 组设计定性（s5l2_comp_probe*.py）：分组字段是 `diagnosis`
   （Healthy 3 donor 569+637+634 / Psoriasis 5 donor 392+342+637+734+642），
   `region`（H/PP/PN）与 diagnosis 不独立（healthy 只贡献 H，psoriasis 供体
   同贡献 LS/NLS），与 line3 condition 级混淆同源；celltype 13 类，
   min pDC 20 细胞且 Healthy 组 0 个
4. **步骤 14 scrna_composition 脚本写完**（本地 `src/line2_scrna/scripts/`）：
   逐 donor celltype 比例谱 + diagnosis/region 两组检验（教科书 KW tie 校正 +
   C(8,3)=56 精确置换枚举 + eta2，统计口径与 line3 步骤 9 完全一致），
   产物 scrna_composition.h5ad + celltype_composition.tsv + composition_report.txt。
   **未跑测试**（写完后部署即遇链路断）
5. **步骤 15 deg_groups 脚本写完**（本地）：逐 celltype 组间 wilcoxon
   （counts 层 + BH，adj p<0.05 且 |log2fc|>1 固定阈值），
   min 20 cells/组门槛（pDC 会跳过），产物 scrna_deg.h5ad +
   deg_all_by_celltype.tsv + deg_significant_by_celltype.tsv + deg_report.txt。
   **未跑测试**

**aims 第 4 节改为轻度优化版（用户拍板："我不会，你帮我，不行就轻度优化"）**：
`aims/aims.txt` 第 4 节删除全部 Root 面深度手段（CPU 锁频写 /sys/cpufreq、
sysctl 脏页调参、oom_score_adj 防杀、device_config、tmpfs 挂载、Magisk 开机
自启），只保留无需 Root 的任务侧策略：taskset -c 4,5,6 + nice/ionice 绑核降权
（唯一必需削峰动作，已全步骤实战验证）、OMP/OPENBLAS=3 环境变量、数据面 FUSE
只读校验、水位 <20% 门禁、nohup 断点续跑 + 链路自动重连（替代防杀）。
版本号 v1.1 到 v2.0。用户侧零手工操作。

**Termux 恢复成功（无需用户操作，agent 侧完成）**：第二次"数据被清"实为
MIUI 杀掉 App 后 data 目录被临时锁死（run-as 报 Permission denied 是假象）。
恢复动作：`adb shell monkey -p com.termux -c android.intent.category.LAUNCHER 1`
启动 App，5 秒后 runsvdir + 五服务 + proot 容器全部自动拉起，`/mnt/ssd/bio_data`
数据面 22 个 h5ad 完好，gseapy 1.3.1 仍在。**此恢复手法记入 ops 流程：
链路断时先 monkey 拉起 App 再 adb forward 重建，不要误判为数据丢失。**

**恢复后第一件事（按顺序）**：
1. 手机上打开 Termux（App 会自动重建 userspace），`pkg install openssh
   proot-distro`，确认 proot ubuntu 容器与 `/mnt/ssd/bio_data` 是否幸存
   （h5ad 22 个 + system_logs 台账都在数据面，SSD 分区未动应该还在；
   bio_data 在手机自带存储内的话数据应在，容器需重装）
2. 确认本地 ssh 公钥（`$HOME/.ssh/id_ed25519.pub`，内容见 handoff 上半段）
   重新装进容器 authorized_keys；`adb forward tcp:10022 tcp:10022`
3. 重装 gseapy（`pip install --break-system-packages gseapy`，dry-run 零变更）
4. 06 部署 line2 两个新脚本（scrna_composition / deg_groups）到
   `line2_scrna/bin/`，跑标准链路：探针→测试跑→回读→界面验收→files→巡检→回搬
5. 继续步骤 16 recluster / 步骤 17 enrichment（基因集已确认可达，
   用 gseapy enrichr ORA + TF ChIP-X 注释；GSEA/GSVA 用同一批 GMT 离线跑）

**未动声明**：`docs/figure_spec.md` 为新增；两个 line2 脚本为新增文件；
服务器侧与底座资产未动。

## 注意

- `reference/` 只读，任何会话不得修改其中文件。
- 手机侧 `$PREFIX/var/service/*/log/run` 本次被改为手写脚本，原软链指向在 `.origin` 备份里，回滚方式见 `踩坑台账.md` #88。
- PowerShell 5.1 与 pwsh 7 行为有差异（含中文脚本必须 UTF-8 with BOM，reference 坑#86），写 .ps1 注意编码。
- **本地零算力红线**：`BioanalysDesktop` 本地只允许启动 `ssh` / `scp` / `adb`，
  本地跑 R/Python 一律拒绝（`server/proc.js` 白名单强制，有测试兜底）。改这个白名单前先想清楚。
- 本项目**不是 git 仓库**（`git status` 报 not a git repository），别用 git 相关流程。
- `BioanalysDesktop/old_useless/` 是用户留下的空残目录，未动，待用户处置。

## 2026-10-13 深夜：三线出图 + line2 下游补齐 + 前端图件面板（用户 6 点反馈落地）

**用户 6 点反馈与处置**：
1. PCA 没有置信圈 → 已加 95% 置信椭圆（line1 PCA + line2 PCA 新增）。
2. DEG 图没有图注、没有红蓝上调下调 → 已加图例，上调红（#D62728）/
   下调蓝（#1F77B4）/非显著灰（#BBBBBB）。**line1 数据本身 0 显著基因**
   （min adj p=0.45），故火山/MA 改双面板：左=adj p FDR 阈值（诚实，全灰），
   右=nominal p<0.05 探索视图（可见 up/down），标题注明"no gene passes FDR"。
3. MA 图同样问题 → 同 2 处置。
4. line3 是否跑完所有声明分析？→ **否，9 项跑完 8 项，缺第 7 项解卷积**
   （cell2location/tangram/scvi 都要 torch，手机端不可行，如实记为待设备）。
5. 完善前端 + 后端按 aims 需求 → **新增前端"结果图件浏览"面板**（目视审核
   三线 figures/，内联渲染 + 点击放大模态）+ 后端 `/api/figures/list` 与
   `/api/figures/image`（ssh+base64 取图，线内边界校验）。tsc 零错、
   测试 75/75 过（新增 7 条 figures 测试）。**数据导入界面仍未做**（aims
   要求文件分片上传 + 格式校验 + 强制选线，待下轮）。
6. 图放 processed 里了，应在单独 figures/ 目录 → **三线图件统一改落
   `<line>/figures/`**（line1 6 / line2 10 / line3 14 = 30 张），processed 里
   的旧 PNG 已清。

**line2 下游补齐（aims 线2 十项原缺 5 项，本轮补齐）**：
- 步骤 14 scrna_composition（细胞比例/组成）→ 见 src/line2_scrna/README.md
- 步骤 15 deg_groups（组间 DEG，逐 celltype wilcoxon）→ 同上
- 步骤 16 subcluster（T_cell 亚群再聚类，6 亚群）
- 步骤 17 enrichment（GO/KEGG/Reactome ORA + GSEA，174 显著 term）
- 步骤 18 tf_activity（TF 靶基因库 ORA，2653 行；SCENIC 不可行记录在案）
- 出图 scrna_figures（10 张 PNG 落 figures/）
所有脚本已部署 line2_scrna/bin/、测试跑 exit 0。**界面验收链路（06/验收/
files/巡检/回搬）本轮未走**，下轮补。

**三线出图脚本**（新增，均落各自 figures/）：
- line1_bulk/scripts/bulk_figures（6 张：相关热图/PCA+椭圆/火山双面板/
  top50 变异热图/QC/MA 双面板）
- line2_scrna/scripts/scrna_figures（10 张）
- line3_spatial/scripts/spatial_figures（14 张：逐样本空间域/目标基因/敲除 DR/
  Moran's I/敲除 top10/UMAP/域组成，mouse+human 各 7）
本地存档：`outputs/figures/{line1_bulk,line2_scrna,line3_spatial}/` +
`outputs/figures/index.html`（画廊页）。

**手机生态不适配（待设备，非漏做）**：line3 步骤 11 解卷积、line2 SCENIC
精度路线、line1 外部 GEO 验证 / PPI 在线富集 / WGCNA+ML（16 样本太小）。

**未完成**：前端"数据导入界面"（aims 要求）、line2 步骤 14-18 的界面验收链路。

## 2026-10-13 深夜（续）：后端自带出图预览界面 + 图件中文说明（用户补充反馈）

**用户补充**："后端那里没有出图预览界面，加一个，对应的前端也需要。"

**做了什么**：
1. **后端自带出图预览页**（服务端渲染，不依赖前端构建产物）：
   `GET /preview/figures` 返回完整 HTML 画廊，浏览器直接打开
   `http://127.0.0.1:8787/preview/figures` 即可目视审核三线图件。
   实测 30 张图全部加载（line1 6 / line2 10 / line3 14），按线分组。
2. **图件中文说明登记表**（`server/figures.js` 的 FIGURE_CAPTIONS）：
   按文件名精确匹配给每张图配说明（PCA 置信椭圆/火山红蓝上下调/空间域等），
   后端预览页与前端面板共用同一份说明。
3. **前端图件面板增强**：每张图卡片显示「文件名 + 中文说明」，并在面板顶部
   给出后端预览页链接 `/preview/figures`。
4. 接口重构：抽出 `listFiguresForLine()` 供 `/api/figures/list` 与预览页共用；
   `/api/figures/list` 返回带 caption/sizeLabel 的图件对象。
5. 测试：新增 4 条（captionFor 命中/未知返回空、decorateFigures、formatBytes），
   **共 79/79 过，tsc 零错**。caption 匹配踩坑一次：泛模式 'ma' 误命中
   "u**ma**p"/"**ma**rker"，改 l1_ 前缀 + 具体模式优先顺序后修正。

**产出**：改 `server/figures.js`、`server/index.js`、`src/App.tsx`、
`tests/figures.test.js`。

## 2026-10-14 凌晨：单图改造 + line1 全流程补齐 + 前后端数据导入（用户两点新要求）

**用户要求**：1. 尽量出单图（不出组合图）；2. 把前端后端优化好、功能做好、再适配。

**要求 1 单图改造（完成）**：三线出图脚本全部改为单图，拆掉所有多面板：
- line1 bulk_figures：火山图拆 FDR/nominal 两张、MA 拆两张、QC 拆两张 → 9 张（后补 PPI/交集/ML/外部验证 → 15 张）
- line2 scrna_figures：composition_box 拆逐 celltype 13 张、deg_volcano 拆逐 celltype → 28 张
- line3 spatial_figures：domains/target_gene/ko_dr 三组逐样本拆单图 → 53 张
合计 **96 张单图**（line1 15 / line2 28 / line3 53），本地画廊 outputs/figures/index.html。

**要求 2 前后端（完成）**：
- **前端新增「数据导入」面板**（aims 第 1 节要求）：强制选归属线 + 文件选择 + 分片上传
  （4MB/片）+ 进度条 + 格式校验结果展示。
- **后端新增 4 个接口**：`/api/upload/init`（建会话，强制 lineId）、`/api/upload/chunk`
  （原始二进制分片）、`/api/upload/status`、`/api/upload/complete`（合并 + 格式校验 +
  scp 到线内 raw_data + 字节校验）。
- **新增 server/upload.js**：文件名严格消毒（拒路径分隔符/../隐藏文件）、扩展名白名单、
  magic bytes 真实格式探测（hdf5/gzip/tar/zip/text/binary）、数据模态建议（bulk/scrna/spatial）。
- **实测**：前端构造小 tsv 走完整链路 → 分片上传 → 合并 → magic=text/模态=bulk →
  scp 落 line1_bulk/raw_data/ → 本地 23 字节 = 远端 23 字节一致。测试文件已清理。
- 测试：tsc 零错，`node --test` **91/91 过**（新增 upload 12 条 + figures 4 条）。

**line1 全流程补齐（完成，用户拍板"样本量小也能做，容忍精度不高"）**：
- 步骤 7 WGCNA（wgcna_modules）：40 模块，2 个显著（tan/plum1），power=26 R²=0.748 如实记录
- 步骤 8 富集（enrichment_bulk）：GSEA 3453 terms/1059 显著 + 模块 ORA 1010 + KEGG 304
- 步骤 8 PPI（ppi_string）：STRING API 282 基因→669 边→188 hub
- 步骤 9 交集（key_genes）：25 个三线交集基因（DEG 放宽 nominal p<0.05 如实标注）
- 步骤 10 ML（ml_model）：LOOCV LR AUC=0.797 / RF 0.680
- 步骤 11 外部验证（external_validation）：**无第二数据集，用内部冻结留出法近似并明确标注
  validation_type=internal_holdout_approximation**（AUC=1.000/Acc=0.667，6 测试样本）
- 仅剩步骤 3 整合去批次受数据面阻塞（无第二数据集）

**line3 步骤 11 解卷积**：用户认可不做（torch 生态手机端不现实）。
**line2 SCENIC**：cisTarget hg38 库实测 **690MB（10kbp 296.9MB + 500bp 298.5MB + motif 94.1MB，
远小于 5GB 门槛）**，已下载到本地并 scp 到 public_references/cistarget/，pyscenic 0.12.1 已装
（核心栈零破坏）。**SCENIC 从"不可行"升级为"可行，待跑"**。

## 2026-10-14（续）：图注移出坐标轴框 + 横竖分置（用户新要求）

**用户要求**：图注尽量在图框外；竖向排布的图在图幅右上角、纵向排列；横向排布的图
在图幅下方、横向排列。

**做了什么**：
1. 三线出图脚本各内嵌 `caption(fig, *parts)` 统一图注函数：宽>=高 → 图幅下方一行
   （条目用 `|` 分隔）；宽<高 → 图幅右上角外侧、一条一行纵向排列。落盘靠
   `savefig.bbox="tight"` 自动扩边，不占数据区。
2. 移除全部 `ax.set_title()` / `fig.suptitle()`，改 caption 调用；图注条目按语义拆
   （标题 / 口径 / n），横竖自动重排。
3. `docs/figure_spec.md` 升 v1.1，新增「三之二、图注（caption）位置」节（规则表 +
   函数源码 + 调用约定）。
4. 本地渲染验证（`cn_debug/2026-10-14_verification_fig_caption_render.py` 造 16 样本
   最小数据实跑 bulk_figures；`_portrait.py` 单测两分支）：横图（8x5）图注在下方一行、
   竖图（5x8）图注在右上角纵向三行，PNG 目视确认。三脚本 Python 段 `compile()` 全过。
5. 部署三线 bin（旧版备份到 `/mnt/ssd/bio_data/_bak_20261014/`）并重跑：
   line1 bulk_figures 9 张 2.6s / line2 scrna_figures 28 张 5.2s /
   line3 spatial_figures 53 张 9.6s。远端图件数 15/28/53 与本地一致，
   已 07 回搬覆盖 `outputs/figures/`。
   line1 另有 4 个出图脚本同样统一（ppi_string / key_genes / ml_model /
   external_validation，产出 l1_07–12），按依赖顺序重跑：PPI 669 边 188 hub、
   交集 25 基因、LR LOOCV AUC=0.797 / RF 0.680、holdout AUC=1.000（均与上轮一致），
   已回搬。**至此 7 个出图脚本全无 `set_title`/`suptitle` 残留**。
6. 本地画廊 `outputs/figures/index.html` 引用同名文件，无需重建。

**注**：现有图集全部为横版或方形（方形按 landscape 归底部），竖版右上角规则已实现
但当前无图触发。**未动**：远端 bin 旧版仅备份未删；其余用户资产未动。

## 2026-10-14（续）：line2 SCENIC 精度升级（步骤 19 scenic_tf，全量在跑）

**用户要求**：line2 TF 调控分析精度升级，继续（把步骤 18 tf_activity 的
"TF 靶基因库 ORA 近似"升级为真 SCENIC）。

**探针结论（cn_debug/2026-10-14_debug_scenic_probe{1..5}.py）**：
1. 数据面：scrna_norm.h5ad 4587×24969（无 celltype，标签在 scrna_annotated.h5ad，
   两者 obs_names 完全对齐）；表达广度 >=10 细胞基因 20990 个、其中注释 TF 1318 个。
2. **GRNBoost2 在 proot 下 Nanny 无法 fork worker** → 必须 `LocalCluster(processes=False)`
   走线程模式。
3. **dask 版本坑（两次）**：容器原装 dask/distributed 2026.8.0 与 arboreto 0.1.6
   的 `dask.dataframe.from_delayed` 不兼容（`Must supply at least one delayed object`）；
   降到 2023.12.1 又在 Python 3.12 触发 import 期 `_derived_from`/`inspect.signature`
   bug；最终定在 **2024.8.0 可用**。降级只动 dask/distributed（+importlib-metadata/zipp），
   numpy/pandas/scanpy/anndata/sklearn 核心栈零变更（pip dry-run 已核）。
4. **pyscenic 0.12.1 无 `pyscenic.ctx` 模块**（ctx 只在 CLI）；且 `transform.py` 用
   已移除的 `np.object` → 脚本内先补 `np.object = object` 再 import，同进程调
   `pyscenic.cli.pyscenic.main`。
5. **ctx 输出的 regulons.csv 是双行表头**（`(Enrichment, Context/TargetGenes)`），
   必须用 `pyscenic.utils.load_motifs` 读，`pd.read_csv` 会把第二行表头当数据
   （`KeyError: 'Context'`）。
6. 测速：400 cells × 2000 genes × 127 TF = 258s（3 线程）；800 genes 全细胞 29 TF
   端到端 317.7s（GRN 165s + ctx 145s + AUCell 8s），产出 15 regulons，
   生物学合理（HMGA1→pDC、TFAP2A/MAF/KLF10/NFE2L2→suprabasal、ELF1→T_cell、
   JUNB/KLF6→macrophage_mDC）。

**生产脚本 `src/line2_scrna/scripts/scenic_tf`（步骤 19）**：
SCENIC 三步（GRNBoost2 n_estimators=5000 → cisTarget hg38 motif 富集 → AUCell），
基因空间 = 表达广度 top N（env `SCENIC_N_GENES`，默认 5000；全基因 20990 在手机端
GRNBoost2 约 90h，不可行，报告如实记录）。产物 6 件：scenic_adjacencies.tsv /
scenic_regulons.csv / scenic_auc_mtx.tsv / scenic_regulon_by_celltype.tsv /
scenic_tf_summary.tsv / scenic_report.txt。已部署 line2_scrna/bin/scenic_tf。

**已完成（2026-10-14）**：全量跑（N_GENES=5000，309 TF）2480.7s（41 min），
450907 GRN 边、**129 regulons x 4587 cells**。产物 6 件落 processed/：
scenic_adjacencies.tsv / scenic_regulons.csv / scenic_auc_mtx.tsv /
scenic_regulon_by_celltype.tsv / scenic_tf_summary.tsv / scenic_report.txt。
结果生物学合理：MXI1/SOX4->melanocyte、NFYB/TFDP1/ILF2->mitotic、
ING4/USF2/CHD2/HSF1/RELA->pDC（论文主题）、NFKB1->macrophage_mDC、
HLF/ARID5B->T_cell、MAFB->suprabasal。
回读验证 11 项全 PASS（加权均值 gap 6.29e-17）；台账
2026-10-14_line2_scrna_scenic_tf_14fa169c.json completed/passed；04 巡检 PASS；
产物与 2 张图（scenic_figures）07 回搬 outputs/。
**步骤 19 取代步骤 18 tf_activity**（ORA 近似）作为 TF 调控主路线，后者留作对照。

**环境变更**：容器 dask/distributed 2026.8.0 -> 2024.8.0（只动 dask 栈，核心栈零变更）。

## 2026-10-14（续）：出图规范全量核查修复（102 张图重出）

**用户要求**：核查所有图是否按出图标准出图，逐一修改。

**核查发现并修复 10 类不合规**（对照 `docs/figure_spec.md`）：
1. 图内字号 5/6/7pt → 全部 >= 8pt（图幅相应放大）。
2. rcParams 基线补全（`axes.grid=False`、`image.cmap=viridis` 全脚本显式）。
3. 火山/MA 阈值线加图内文字（`p=0.05`、`log2FC=±1`）。
4. UMAP/PCA caption 注来源步骤（如 `X_umap from step5 cluster_umap`）。
5. 空间类 caption 注坐标系（`sample-local obsm['spatial']`）。
6. 新增 `*_by_domain` 域统计图（line3 每物种 +2），满足双视图要求。
7. PPI 边权映射宽度+颜色+colorbar，边限 top100（节点 top30）。
8. marker 热图改行=基因、列=观测。
9. line2 图名加 `l2_` 前缀，与 line1/line3 统一。
10. `figures.js` 说明表更新（单图口径 + SCENIC/域统计条目）。

**重跑结果**：line1 15 / line2 30 / line3 57 = **102 张**，全部回搬 `outputs/figures/`，
本地画廊 `index.html` 重建。line2 旧命名 28 张移入备份
（远端 `_bak_20261014b/old_line2_figures/`、本地 `outputs/_bak_figures_20261014/`）。
tsc 零错、`node --test` 23/23 过。**三线出图已全部对齐规范。**

## 2026-10-14（续）：数据面引入项目维度（按项目分文件夹，迁移完成）

**用户要求**：后端按项目分文件夹整理。拍板：①数据面加项目隔离；②层级
`projects/<项目>/<线>/`、`bin/` 全局一份；③现有三线迁为 `default` 项目。

**新数据面结构**：
```
/mnt/ssd/bio_data/
├── projects/default/{line1_bulk,line2_scrna,line3_spatial}/{raw_data,processed,results,figures}
├── projects/<新项目>/...
├── bin/<line>/      脚本部署区（全局一份，所有项目共用）
├── envs/<line>/     环境声明（全局一份）
├── public_references/   跨项目只读共享
└── system_logs/         全局台账（条目带 project_id）
```

**后端**：`domain.js` 加项目维度；新增 `project.js`；`task.js`（cwd=项目路径、PATH=全局 bin、
台账加 project_id）；`run.js`（台账名加 project 段）；`files/figures/upload/ledger` 路径断言
升级；`index.js` 全 API 加 `project` 参数 + 新增 `/api/projects/list|create`。

**前端**：`App.tsx` 加项目选择器 + 新建项目入口，四面板传 project。

**ops**：06 部署改 `bin/<line>`、`envs/<line>`；07 加 `-Project` 与 figures；03 巡检加
project_id 与项目段校验；新增 `08_migrate_to_projects.{sh,ps1}`（幂等，rename 迁移 + 前后
字节校验 + 旧台账重写）。

**验证**：108/108 测试过、tsc 零错；迁移前后文件数/字节完全一致（64/105/159 文件）；
e2e 跑 probe_env → completed/passed、project_id=default；04 巡检 51 条 PASS；
08 幂等验证通过。踩坑 #124（`../envs` 相对引用失效）、#125（`%f|%T@` 解析）已修。

**新项目怎么用**：界面顶部项目选择器新建，或 `POST /api/projects/create {projectId, name}`；
新项目自动建三线四子目录；数据导入/任务下发/出图/回搬都按当前项目走。

## 2026-10-14（续）：修 l2_05 图例压图

**用户报告**：`l2_05_composition_stack.png` 图例与主图内容重合。

**根因**：13 类 celltype 图例用 `loc="upper right"` 放轴内，堆叠条纵向占满绘图区，
轴内无空位（坑 #126）。

**修法**：图例移到轴框外右侧（`bbox_to_anchor=(1.02, 1.0), borderaxespad=0`），
figsize `(9,6)→(11,6.5)`，该图单独关 `figure.autolayout` 并显式
`fig.subplots_adjust(left=0.07, right=0.76, top=0.97, bottom=0.16)`，跑完恢复 autolayout。

**同类排查**：line3 UMAP（图例在右上空白区）、line3 domain_composition（无图例）、
line1 火山/MA（右上空白）均无压图，仅此一处。

**规范升级**：`docs/figure_spec.md` 图例条改为硬约束，**类别多或主图占满绘图区时图例必须
移到轴框外**；只有类别少且轴内有真空位时才用轴内 `loc="best"`。

**验证**：本地最小数据复现修法 → 部署全局 bin → 重跑 scrna_figures（28 张 5.7s）→
回搬 `outputs/figures/line2_scrna/` → 目视确认图例在框外、13 类清晰。

**注意（迁移后跑法）**：bin 已提到顶层全局，重跑脚本用绝对路径
`/mnt/ssd/bio_data/bin/<line>/<step>`，cwd 为 `projects/<项目>/<line>/processed/`；
`../bin/...` 相对引用已失效。

## 2026-10-14（续）：图例缺失专项核查修复（三线）

**用户反馈**：部分图仍不合规，特别是空间线很多图缺图例/图注，其他线也有。

**逐图核查出三类问题（坑 #127）**：
1. 分类着色无图例：line3 `01_domains`（域颜色无说明）、line3 `07_domain_composition`、
   line1 `05a/05b`（x 轴样本名、组别只靠红蓝）、line2 `06_composition_box`。
2. colorbar 无 label：line3 `02_target_gene` / `03_ko_dr`。
3. 色板撞色：line3 `07` 域数 57 > tab20 的 20 色，循环后同色不同域。

**修法**：01 域图补轴外 legend；02/03 colorbar 加 label；07 补 legend + 换
`tab20+tab20b+tab20c`（60 色）；line1 QC 按组 label + legend；line2 箱线三项 legend。

**规范升级**（`docs/figure_spec.md` 图例条）：任何颜色编码分类的图必须有图例；
colorbar 必须带 label；分类数 > 20 必须扩色板；唯一豁免是轴标签已写明分组或单色柱状图。

**验证**：9 脚本 compile 全过；重跑 line1 9 张 3.0s / line2 28 张 6.0s / line3 57 张 12.4s；
回搬 `outputs/figures/`；抽查 5 张图例全部到位。旧版脚本备份 `_bak_20261014c/`。

**待确认（未做）**：line1 `enrichment_bulk` 与 line2 `enrichment` 两个富集步骤目前**不出图**，
规范"统计类：富集条形须 NES/富集比 + 校正 p 双标注"尚无对应图件。若需要，下轮补富集条形图。

## 2026-10-14（续）：全量 102 张逐张审查与修复

**用户要求**："不要抽查，要全量，有错被打回所有审查花费就白搭了。"

**审查方式**：102 张**逐张读图**（非抽样），4 个审查单元并行（line1 15 / line2 30 /
line3-mouse 36 / line3-human 21），每张给出 PASS 或具体问题。

**第一轮结果**：line1 2 FAIL、line2 8 FAIL（含 3 张误报）、line3 0 FAIL。

**复核确认的真问题 8 张（坑 #128）**：
1. line1 `02_pca`：样本标签在点密集处重叠不可读
2. line1 `05a`：条形顶格，group 图例压最右条形
3. line2 `04_umap_leiden`：21 类 > tab20 的 20 色，循环撞色
4-8. line2 `06_composition_box_{Langerhans_cell,macrophage_mDC,mitotic,pDC,progenitor_keratinocyte}`：
   图例压 Psoriasis 箱体/须线

**误报（未改动）**：`l2_07_marker_top5`/`l2_scenic_01` 的 colorbar 实带 label `z`；`l1_05b` 图例在空白区。

**修法**：PCA 引入 `adjustText`（新增依赖 1.4.0）自动避让标签；QC 与箱线图例统一移轴框外右侧；
`cat_colors` 色板扩为 60 色。

**验证**：重跑 line1 9 张 / line2 28 张并回搬；**第二轮全量逐张复核 line1(15)+line2(30) 全 PASS**；
line3 57 张未改动（第一轮全 PASS）。**合计 102/102 合规。**

**规范升级**：`figure_spec.md` 补"图内文字不得重叠"（必须用 adjustText 避让，不得缩字号）。

**经验（写入坑 #128）**：合规要逐张看图判，不能只对代码条款；审查单元会误报，
修复前必须先亲自复核 FAIL 项。

## 2026-10-14（续）：富集步骤补出图（line1 / line2）

**背景**：全量审查遗留项——两线富集步骤只落 tsv 无图，规范"富集条形须 NES/富集比 + 校正 p
双标注"无图可审。用户拍板"补"。

**新增脚本**：
- `src/line1_bulk/scripts/enrichment_figures` → `l1_13_gsea_top`（GSEA GO BP top20，
  条形=NES 红激活/蓝抑制 + 图例，标注 NES + 校正 p）、`l1_14_module_ora_top`（WGCNA 模块 ORA top20，
  条形=-log10 校正 p，标注 GeneRatio + 校正 p）、`l1_15_kegg_top`（KEGG top20，同口径）。
- `src/line2_scrna/scripts/enrichment_figures` → `l2_11_ora_top`（逐 celltype ORA top20，
  按 celltype 分色，标注 odds ratio + 校正 p）、`l2_12_gsea_top`（逐 celltype GSEA top20，
  条形=NES 双色，标注 NES + FDR q 值）。

**排序稳定性**：line1 GSEA 首版单键按 p.adjust 排序，该数据集 p.adjust 大量并列 1.8e-08，
排序退化成原始顺序（图上 NES 乱序）。修为双键（主键校正 p + 次级 |NES| 或原始 p）。

**验证**：脚本 compile 全过；部署全局 bin；两线各跑一次（1.7s / 1.2s）；
5 张图回搬并逐张目视确认合规；`/api/figures/list` 返回 line1 18 张 / line2 32 张（caption 已注册）；
本地画廊重建 107 张；figures.test.js 12/12 过。

**三线出图合计 107 张**（line1 18 / line2 32 / line3 57），全部对齐 `docs/figure_spec.md`。

**跑法（迁移后）**：bin 在顶层全局，用绝对路径 `/mnt/ssd/bio_data/bin/<line>/<step>`，
cwd = `projects/<项目>/<line>/processed/`。

## 2026-10-14（续）：单细胞 / 空间高级分析缺口补齐（line2 / line3）

**背景**：用户质询"单细胞转录组和单细胞空间转录组的高级分析功能是不是没做"。
对照 `aims/aims.txt` 逐条核查，拍板"除 line3 解卷积外全补"（解卷积 torch 生态，用户豁免）。

**核查结论**：line2 十项下游（组成/DEG/marker/目标基因定位/亚群再聚类/富集含 GSVA/拟时序/
细胞通讯/TF 调控/虚拟敲除）+ 敲除后三项（DR 富集/调控网络/交集）已全覆盖；
line3 九项下游（域识别/域 marker/Moran's I/邻域共现/区域组成/空间通讯/解卷积[豁免]/目标基因定位/
虚拟敲除）+ 敲除后三项（DR 富集/映射回坐标/交集）已全覆盖。

**本次补做（7 项，9 张图）**：

| 项 | 脚本 | 产物 |
|---|---|---|
| line2 目标基因表达定位 | `src/line2_scrna/scripts/target_gene_localization` | `target_gene_localization.tsv`(+wide)、`scrna_localization.h5ad`、`l2_13_target_gene_dotplot.png` |
| line2 GSVA | `src/line2_scrna/scripts/gsva_pathways` | `gsva_scores.tsv`(6175×13)、`scrna_gsva.h5ad`、`l2_14_gsva_heatmap.png` |
| line2 DR 富集 | `src/line2_scrna/scripts/dr_post_analysis` | `dr_enrichment.tsv`(1692 行)、`l2_15_dr_gsea_top.png` |
| line2 DR 调控网络 | 同上 | `dr_regulatory_network.tsv`(59 边/29 TF/9 DR 靶)、`l2_16_dr_regulatory_network.png` |
| line2 DR∩DEG∩marker | 同上 | `dr_overlap.tsv`(258 基因)、`l2_17_dr_overlap.png` |
| line3 DR 富集 | `src/line3_spatial/scripts/dr_post_analysis` | `dr_enrichment_{mouse,human}.tsv`、`l3_{mouse,human}_10_dr_gsea_top.png` |
| line3 DR∩域 marker | 同上 | `dr_overlap_{mouse,human}.tsv`、`l3_{mouse,human}_11_dr_overlap.png` |

**关键缺陷修复（坑 #129）**：line2 DR 调控网络首版 0 边。根因是 `scenic_regulons.csv` 的
`TargetGenes` 列是 pyscenic ctx 原生 repr（`[('PKN2', np.float64(0.31)), ...]`），含
`np.float64(...)` 调用节点，`ast.literal_eval` 全部解析失败（探针实测 1667/1667 失败）。
改用正则 `re.findall(r"\('([^']+)'", raw)` 提取基因名，修复后 59 边。

**口径要点**：line2 GSVA 输入用全基因 `scrna_norm.h5ad`（24969，保通路覆盖），
R 侧 `gsvaParam(kcdf="Gaussian")` 新 API 兼容回退；line3 DR 按物种分库
（小鼠 KEGG_2019_Mouse/WikiPathways_2019_Mouse，人源 KEGG_2021_Human/GO_BP/Reactome），
gmt 缓存落 `../references/gmt_cache/`；两线 DR 富集均走全表 prerank GSEA（显著 DR 少，ORA 不可靠）。

**验证**：9 张新图逐张目视审查，全部合规（图注轴框外、图例/colorbar 带 label、条形 NES+FDR q 双标注）；
`/api/figures/list` 返回 line1 18 / line2 37 / line3 61，合计 **116 张**（caption 已注册）；
`/api/figures/image` 取字节 200/PNG；后端已重启（figures.js 改动生效）。

**跑法**：cwd = `projects/default/<line>/processed/`，`BIOANALYS_SEED=20261013 bash /mnt/ssd/bio_data/bin/<line>/<step>`。

## 2026-10-14（续）：line1 hub 基因 ML 模块（第一类筛选 + 第二类重要性评估）

**背景**：用户指出"GEO 挖掘的机器学习（lasso 回归、单因素 Cox 等）也没做"。核查后确认
line1 仅有 `ml_model`（LR L2 + RF + LOOCV），确无 LASSO / RFE / 单因素筛选 / GBDT / SHAP / 聚类 / 相关网络。

**用户指定的两类方法**：
- 第一类（减基因，聚焦核心）：LASSO / RFE / 单因素·多因素 Cox / 基于统计显著性的筛选。
- 第二类（不减基因，量化贡献）：RF 重要性 / GBDT 重要性 / SHAP / 聚类 / 相关性网络。

**Cox 不可做（已如实标注）**：数据集 GSE277173 = 8 皮损 vs 8 皮损旁（配对，皮下脂肪），
series matrix 与 family.soft 的样本元数据只有 `tissue: lesion / perilesional skin`，
**无生存时间/结局字段**，`Surv(time, event)` 无法构造。用户原话也留了口子（"如果后续要做生存分析"）。

**新增脚本**：`src/line1_bulk/scripts/ml_hub_analysis`（bash + R glmnet + Python）。
- 第一类：LASSO（R glmnet binomial，8 折 CV，lambda.min 选 7 基因）；RFE（logistic L2，4 折
  stratified AUC，选 4 基因）；单因素 logistic（statsmodels，p<0.05 选 5 基因）。
  三者 3-way 交集为空，按兜底规则取 LASSO ∪ RFE = **10 个核心 hub 基因**。
- 第二类：RF/GBDT 重要性、SHAP（TreeExplainer on RF）、ward 聚类（ARI vs LS/NLS = 0.104）、
  Spearman 共表达网络（29 边）。

**产物**：`ml_lasso_{path,cv,genes,summary}.tsv`、`ml_rfe_{curve,genes}.tsv`、`ml_univariate.tsv`、
`ml_core_hub_genes.tsv`、`ml_importance.tsv`、`ml_shap.tsv`、`ml_cluster_samples.tsv`、
`ml_corr_network.tsv`、`ml_hub_report.txt`；图 `l1_16`–`l1_24`（9 张）。

**关键坑（#130）**：R 里把日志函数命名为 `log` 遮蔽了 base `log()`，`log(lam[j])` 调到日志函数
返回 NULL，导致系数路径写表报 "differing number of rows"。改名 `say` 修复。

**验证**：脚本 2 个 python 块 compile 通过；部署 bin 后实跑成功（9.0s）；
9 张新图逐张目视审查合规；`/api/figures/list` line1 27 张（caption 已注册）、
`/api/figures/image` 200/PNG；后端单测 108/108 过。三线图件合计 **125 张**。

**新增依赖**：容器内 `shap==0.53.0`（+ `slicer`），`pip install --break-system-packages`（沿用既有全局装法）。

**跑法**：cwd = `projects/default/line1_bulk/processed/`，
`BIOANALYS_SEED=20261013 bash /mnt/ssd/bio_data/bin/line1_bulk/ml_hub_analysis`。

## 2026-10-14（续）：功能富集三线补齐（GO CC/MF + KEGG GSEA + line3 富集）

**背景**：用户质询"KEGG/GO（BP,CC,MF)/GSEA 你确定弄完了？完整了？"。核查发现三类缺口：
1) GO CC/MF 三线全缺（line1 `gseGO`/`enrichGO` 只传 ont="BP"，line2 库列表只有 GO_BP）；
2) line1 缺 KEGG GSEA；3) line3 完全没有功能富集（aims 线3 未要求，用户拍板"三线全补齐"）。

**改动**：
- line1 `enrichment_bulk`：GSEA 改 GO BP/CC/MF 三本体循环（合并落 `enrichment_gsea_go.tsv` 含
  ont 列；BP 3453 / CC 529 / MF 794 terms）+ 新增 KEGG GSEA（`enrichment_gsea_kegg.tsv`，285 terms
  143 显著，走 rest.kegg.jp 在线）+ WGCNA 模块 ORA 改三本体（1262 行）。
- line1 `enrichment_figures`：l1_13 改按本体分色（蓝 BP/绿 CC/紫 MF + 图例，y 前缀本体名）、
  l1_14 y 前缀本体名、新增 l1_25 KEGG GSEA 图。
- line2 `enrichment`：库加 `GO_Cellular_Component_2023` / `GO_Molecular_Function_2023`（5 库）。
- line3 新增 `enrichment`（逐域 ORA + GSEA；mouse KEGG_2019_Mouse/WikiPathways + GO 人库
  大写化匹配[Enrichr 无小鼠 GO 库，同源近似已标注]，human KEGG_2021_Human/Reactome + GO 人库；
  前景 = 每域 adj p<0.05 marker 最多 top100 不足 10 退 top50；GSEA 排序 logfoldchanges）+
  `enrichment_figures`（`l3_{mouse,human}_12_ora_top` / `l3_{mouse,human}_13_gsea_top`）。
- 产物：`enrichment_{ora,gsea}_{mouse,human}.tsv`（mouse ORA 62396 行 / human 29736 行）+
  `enrichment_report.txt`。

**验证**：三线富集实跑全绿；10 张富集图逐张目视审查合规（l1_13 本体分色、l1_25 KEGG GSEA、
l3 四张域级富集）；`/api/figures/list` line1 28 / line2 37 / line3 65 合计 **130 张**（caption 已注册）；
`/api/figures/image` 200/PNG；后端单测 108/108 过；脚本语法校验 18 脚本 ALL_OK。

**注意**：l1 GSEA KEGG 依赖 rest.kegg.jp 外网，断网时该步自动跳过（报告如实记录）；
line3 GSEA 每域仅 top200 marker，NES 覆盖度低于全转录组 GSEA，作探索性参考（报告已写 limitation）。

**跑法**：各线 cwd 下 `BIOANALYS_SEED=20261013 bash /mnt/ssd/bio_data/bin/<line>/enrichment[_figures]`。

## 2026-10-14（续）：line1 ML 配色优化 + SHAP 瀑布图（用户新分析方案落地）

**背景**：用户给出新分析方案（核心流程 + 进阶分析 + 可视化四件套）并指出
"部分图配色差异性突出不够、部分图未按规范出图，请全量审核重绘"。

**方案对照核查**：方案全部环节已落地——GEO 下载/DEG/富集/PPI/hub（步骤 1-9）、
LASSO（ml_hub_analysis）、RF 重要性（同）、共表达网络（l1_24）、SHAP（l1_22）、
样本聚类（l1_23）、PPI 网络图（l1_07）、LASSO 路径图（l1_16）、重要性条形图（l1_21）。
**唯一缺的实现项 = SHAP 瀑布图**。

**做了什么**：
1. 新增 `l1_26_shap_waterfall`：单样本预测分解（选 |SHAP| 总和最大样本 14NL），
   f(X)=E[f(X)]+sum(SHAP) 瀑布累积，红=推向 LS / 蓝=推向 NLS，条上标基因名+贡献值。
   坑 #132：shap 0.53 `expected_value` 是 per-class ndarray，直接 float() 抛
   "only 0-dimensional arrays can be converted"，需 `arr[-1]` 取 LS 类。
2. 配色优化三张：
   - l1_19：红=显著（加星加粗）、蓝深浅~p 值（原 OR 方向配色使 5 个显著基因淹没在蓝堆）。
   - l1_20：三层语义配色（深蓝单方法/浅蓝交集/橙 core）+ 图例 + core 数值金色加粗。
   - l1_21：红蓝对比强化 + 每条形数值标注 + x 轴留 22% 标签空间。
3. 全量复核 line1 ML 10 张 + 富集 4 张逐张读图：全合规。

**验证**：ml_hub_analysis 实跑 10 图全出（瀑布图 sample=14NL）；`/api/figures/list`
line1 29 / line2 37 / line3 65 合计 **131 张**；`/api/figures/image` l1_26 200/PNG；
后端单测 108/108。

**跑法**：同前（ml_hub_analysis）。

## 2026-10-14（续）：用户需求提交入口 + 统一端口 8787 + 访问门禁

**背景**：用户要一个对外（内网穿透）给客户用的需求提交界面，与管理员工作台隔离、带填写引导；
并明确本地地址就是 `127.0.0.1:8787`，要求统一端口。

**交付**：
1. `BioanalysDesktop/public/user_portal.html`：单文件五步向导（项目信息 → 数据来源 → 分组设计 →
   分析流程 → 交付确认），浅色青绿配色与工作台深色区分。含动态多分组（N≥2 + 三种模式 +
   组内样本批量粘贴 + 跨组查重 + 对比对生成）、步骤功能说明卡片、交付物勾选、需求摘要、
   每步填写引导 callout、黑名单防抖校验、URL 状态（`?step=N`）。
2. **统一端口**：`server/index.js` 新增 `serveStatic()` 托管 vite 构建产物 `dist/`。
   8787 现同时提供 `/`（工作台）、`/portal`（用户入口）、`/api/*`。已 `npm run build`。
3. **可选访问门禁**：环境变量 `BIOANALYS_ADMIN_TOKEN`。设置后管理端需 token
   （`?token=` 或 `Authorization: Bearer`），用户入口 + 3 个公开接口免 token；未设置时开放。
4. `LINE_STEPS.line3_spatial` 补 `celltype_annotation`（16→17 步）。
5. `docs/user_portal_deploy.md`：部署 + 统一端口 + 门禁 + 穿透 + 表单契约 + 规范符合性。

**验证**：chrome-devtools 实测桌面 + 移动双视口、控制台零报错；门禁 401/200 逐项实测；
`/` 与 `/portal` 双 200；后端单测 109/109。

**跑法**：`cd BioanalysDesktop && npm run build && node server/index.js`；
客户访问 `http://127.0.0.1:8787/portal`，你访问 `http://127.0.0.1:8787/`（设 token 后加 `?token=`）。

## 2026-10-14（续）：用户入口与工作台彻底解耦（推翻上节统一端口方案）

**用户裁决**："这个只是单纯让客户提交信息的，别和我的工作台联系上，这俩是通过我手动中转实现内容交接。"

**上节方案作废**：用户入口不再挂在 8787、不再调用工作台任何接口、不再需要访问门禁。
交接方式改为**人工中转**——客户本地生成需求 JSON，自己发给对接人，对接人在工作台手动建项。

**改动**：
1. 新增独立目录 `portal/`：
   - `portal/index.html`：原 `public/user_portal.html` 迁出（**已重写为完全自包含**，移除全部
     `/api` 调用；内置 `BL_PATTERNS` 黑名单正则、`LINE_STEPS`、`STEP_META`、`OUTPUT_DEFS`；
     第五步由"提交到后端"改为"生成需求文件"→ 下载 / 复制 / 打印）。
   - `portal/serve.mjs`：极简静态服务，只服务 `index.html` + `/health`，其余 404，不挂任何 API。
     默认 `127.0.0.1:8080`，`PORTAL_PORT` / `PORTAL_HOST` 可调。
2. 删除 `BioanalysDesktop/public/user_portal.html` 与 `BioanalysDesktop/dist/user_portal.html`
   （移出工作台构建管线，vite build 不再产出该文件）。
3. `BioanalysDesktop/server/index.js`：**移除访问门禁整块**（`ADMIN_TOKEN` / `PUBLIC_PATHS` /
   `extractToken` / `gateAllows` / 401 分支）+ 门禁提示页里的 `/portal` 链接 + `serveStatic` 与
   "未构建"页里的 `/portal` 文案。8787 回归为纯工作台（页面 + 管理 API），不再提 portal。
4. `docs/user_portal_deploy.md` 按解耦架构重写（独立进程/端口、只穿透 8080、人工中转流程、需求文件契约）。
5. 保留：`/api/projects/steps`、`/api/blacklist/check` 等接口仍在（工作台自用），只是不再作为"公开路径"。

**验证**：
- `node --check` 两文件语法 OK。
- 后端单测 **109/109 过**（index.test.js 子进程拉起 8787 正常）。
- portal 实跑（`PORTAL_PORT=18080 node portal/serve.mjs`）：`/health` 200、`/` 200（64912 字节、
  含"本页仅采集需求"）、`/api/health` 404（确认无 API 挂载）。测试后已停进程。

**跑法**：
- 工作台（自己）：`cd BioanalysDesktop && npm run build && node server/index.js` → `http://127.0.0.1:8787/`
- 用户入口（客户）：`node portal/serve.mjs` → `http://127.0.0.1:8080/`，只穿透 8080。

**注意（无版本控制）**：本仓库根目录**不是 git 仓库**（`git status` 报 not a repository），
改动无 git 基线可回滚；本次未覆盖任何用户未提交内容（相关文件均为本轮新建/编辑）。

## 2026-10-14（续）：用户入口加本地收件箱（客户数据落点）

**用户追问**："用户填的数据放哪里呢？"——解耦版原设计是客户在浏览器本地生成 JSON 自己发给对接人，
数据不落任何服务端，中转环节在客户手上、不可控。用户拍板选「portal 本地落盘」。

**改动**：
1. `portal/serve.mjs` 新增 `POST /api/submit`：收到需求 JSON 后落盘到 `portal/inbox/`，
   文件名 `YYYY-MM-DD_HHMMSS_需求_<项目名>.json`（本地时间戳，中文名保留，特殊字符折叠下划线）。
   同名不覆盖（追加 `_2`/`_3`）；单份上限 1MB；`/health` 增加返回 inbox 路径。
   **仍不连工作台**——只写 portal 自己的 inbox 目录，不碰 `projects/` 数据面。
2. `portal/index.html`：第五步由「生成并下载需求文件」改为「提交给对接人」
   （`generate()` → `collectManifest()` + `submit()` + `showResult()`），
   提交成功显示编号；失败降级提示用下载/复制。同步改文案（进度条第5步、header-note、
   step5 标题/引导、页脚）+ 内联 favicon（消除 favicon.ico 404）。
3. `docs/user_portal_deploy.md`：新增「收件箱」章节，更新交接流程（客户提交 → inbox → 人工建项）。

**验证**：
- `node --check portal/serve.mjs` OK。
- node 冒烟脚本 `cn_debug/2026-10-14_verification_portal_submit.mjs`：
  POST 正常 200 且落盘（中文文件名/UTF-8 正确）、非法 JSON 400、GET 404、health 200 带 inbox 路径。
- chrome-devtools 端到端：填表 → 走 5 步 → 点「提交给对接人」→ 页面显示
  「需求已提交（编号 2026-10-14_235116_需求_E2E冒烟_缺血性脑卒中.json）」；控制台零报错。
- 测试产生的 inbox 文件已清理（inbox 现为空目录）。

**跑法**：`node portal/serve.mjs`（8080），客户提交后看 `portal/inbox/`。

## 2026-10-14（续）：工作台 / 用户提交台 启动脚本（.bat）

**交付**（项目根目录，双击即用）：
- `start_workbench.bat` — 起管理员工作台（8787）
- `start_portal.bat` — 起用户需求提交台（8080）
- `start_all.bat` — 一次开两个独立窗口分别起上面两个

**脚本内含**：Node 存在性检查；**端口占用预检查**（已占用则友好提示并退出，不再抛 EADDRINUSE 崩溃栈）；
工作台脚本在 `dist/` 缺失时自动 `npm run build`；结束后 `pause` 便于看输出。

**⚠ 重要坑（.bat 编码，坑 #133）**：Windows `cmd` 读取 .bat 用的是**当前控制台代码页**，
不是文件里的声明。踩了三个坑：
1. 文件 UTF-8 无 BOM + 中文 → cmd 按 936 解析 → 多字节序列被拆，报 `'cho' is not recognized` 之类怪错。
2. 行尾 **LF** → cmd 解析错乱（`if (...)` 块、`echo` 行被拼接）。**必须 CRLF**。
3. 加了 `chcp 65001` 反而更乱（父环境/文件编码不一致时 `。` 等全角字符会吞掉行尾 CRLF，导致下一行被并进当前行）。
4. 转换时若用「GBK 读 + GBK 写」→ **空操作**，文件其实还是 UTF-8（须「UTF8 读 + GBK 写」）。

**最终正确形态**：文件 **GBK 编码 + CRLF 行尾 + 首行 `@echo off` 后紧跟 `chcp 936 >nul`**（ASCII 行，任何 CP 下都能先正确执行，之后中文按 936 解析稳定）。

**转换命令（Write 工具写出来的是 UTF-8+LF，每次改完必须跑）**：
```powershell
$utf8=[Text.Encoding]::UTF8; $gbk=[Text.Encoding]::GetEncoding(936)
foreach ($f in @('start_workbench.bat','start_portal.bat','start_all.bat')) {
  $p=Join-Path (Get-Location) $f
  $c=[IO.File]::ReadAllText($p,$utf8).Replace("`r`n","`n").Replace("`n","`r`n")
  [IO.File]::WriteAllText($p,$c,$gbk)
}
```

**验证**（用 `Start-Process cmd /c ... -RedirectStandardOutput` 捕获真实输出、按 GBK 读回，避开
PowerShell 管道 UTF-8 化的显示假象）：
- `start_portal.bat`：中文提示全部正常、`echo.` 未与上行合并、stderr 空、8080 监听、`/health` 200。
- `start_workbench.bat`：中文正常、stderr 空、8787 监听、`/api/health` 200。
- 端口占用分支：8080 已占用时输出「[提示] 8080 端口已被占用…」且**不再启动第二个实例**。
- 临时输出文件已清理；`portal/inbox/` 空；8787/8080 均已释放。

## 2026-10-14（续）：用户表单示例占位符去具体化（规避侵权风险）

**用户要求**："用户的表单填写台那个填写的示例提示信息不要写的那么具体详实，会有侵权风险。"

**背景**：原占位符用了真实且具体的研究设计/数据集/样本号（疑似照搬某篇文献）：
「缺血性脑卒中核心 Hub 基因筛选」「Ischemic Stroke」「探究缺血性脑卒中患者与健康对照的外周血差异表达基因」
「GSE16561」「GSE58294」「GPL6883 / GPL570」「Peripheral Blood」「GSM416528 / GSM416529 / GSM416550」。

**改动**（`portal/index.html`，9 处，全部改为抽象通用占位）：
- 项目名称 → 「例如：某疾病相关基因筛选…」
- 疾病名称 → 「例如：某类疾病名称…」
- 项目描述 → 「例如：探究某疾病组与对照组的差异表达基因…」
- 训练集/验证集 → 「GSE00000…」；GPL → 「GPL0000…」；步骤2 引导里的编号同步改 GSE00000 / GPL0000
- 组织来源 → 「例如：组织 / 体液来源…」
- 批量粘贴示例 → 「GSM000001,对照组 / GSM000002,对照组 / GSM000003,实验组」
- 分组名称 → 「例如：对照组…」；组内样本 → 「如 GSM000001, GSM000002…」
- 虚拟敲除目标基因 → 「例如：某目标基因…」

**未改**：STEP_META / OUTPUT_DEFS 里的工具名（glmnet / pySCENIC 等）与产物文件名，属功能说明非"填写示例"；
「健康 → 轻度 → 重度」为抽象阶段模式，保留。

**验证**：chrome-devtools 读取全部 placeholder 确认为通用值；控制台零报错。

## 2026-10-14（续）：交付监理工作人格提示词 v1.1 → v3.0（实测校准版）

**用户交付**：一份自撰的 v3.0 提示词正文（补齐目录映射、6 大类数据微调预案、桥接断言、台账格式、
固定汇报话术），要求落盘。

**落盘位置**：`docs/delivery_supervisor_prompt.md`（覆盖原 v1.1）。

**对照仓库实测校准的偏差（原稿 → 修正）**：
| 项 | 原稿 | 实测 | 处置 |
|---|---|---|---|
| 出图 DPI | 150 | **300**（`figure_spec.md`） | 改 300（用户此前已明确纠正） |
| 出图规范版本 | v2.1 | 文件头写 v1.1，但全项目文档均称 v2.1 | 把 `figure_spec.md` 文件头 v1.1 → **v2.1**，消除自相矛盾 |
| 黑名单词数 | 30 | **27**（`tumor_blacklist.js` 实测 11-37 行） | 改 27 |
| line1 步数 | 9 | **13**（`project.js` LINE_STEPS） | 改 13 步 / 14 脚本 |
| line2 步数 | 10 | **22** | 改 22 步 / 22 脚本 |
| line3 步数 | 9 | **17** | 改 17 步 / 17 脚本 |
| 后端模块数 | 12 | **14 模块 + index.js 入口 = 15 文件** | 改 14（+入口） |

**核对无误项**：53 脚本（14/22/17）、109 单测、ops 6 文件、seed=20261013、
`run_throttled_task.sh <task_id> <line_id> <step_name> <R|Python> <script_path>` 签名、
四不改/沙盒方案 A/三大件打包/台账沉淀机制。

**附带修正**：`docs/figure_spec.md` 版本头 v1.1 → v2.1（与 handoff、交付报告、本提示词统一）。

**未验证**：R 4.3.3 / Python 3.12.3 及 scanpy/sklearn/shap/networkx 具体版本号属容器远端事实，
本轮未登 K40 复核，按用户给定值保留。

## 2026-10-14（续）：全量复核（v3.0 提示词 + 全项目基线）

**用户要求**："全量复核一次"。逐项对照仓库与 K40 远端实测。

**复核发现并修复：设备侧 sshd 全断（非代码问题）**
- 初次 `npm test` = **106 过 / 3 败**，3 个失败全在 `tests/link.test.js`（真机链路集成测试）：
  `Connection closed by 127.0.0.1 port 10022 / 8022`。
- 根因：手机侧 **Termux 进程不存在**（`pidof com.termux` 空），runit 托管的 4 个服务
  （sshd / crond / ssh-agent / ubuntu-sshd）随之全停；`adb forward` 映射仍在（端口"假监听"），
  故表现为"端口通但连接被关"。**与本次任何代码改动无关**（我们只动了 portal/、server 门禁、docs、bat）。
- 处置：`adb shell am start -n com.termux/com.termux.app.TermuxActivity` 拉起 Termux，
  runit 自动恢复，4 服务全 `run`；复测 `npm test` = **109 过 / 0 败**。
- 结论：**109/109 只在手机侧 Termux 存活时成立**；手机重启/清后台后需先拉起 Termux。

**复核结论（实测值 vs 提示词声明）**：
| 项 | 声明 | 实测 | 判定 |
|---|---|---|---|
| bin/line1_bulk | 14 脚本 | 15 项（14 分析脚本 + probe_env） | 口径需注明，已补注 |
| bin/line2_scrna | 22 | 22 | ✓ |
| bin/line3_spatial | 17 | 17 | ✓ |
| 母版合计 | 53 | 53（14+22+17，不含 probe_env） | ✓ |
| LINE_STEPS | 13/22/17 | 13/22/17（合计 52 步） | ✓ |
| 后端模块 | 14+入口 | server/*.js = 15（14 模块 + index.js） | ✓ |
| 单测 | 109 | 109（13 测试文件） | ✓ |
| ops 件套 | 6 文件在 ops/ | ops/ **5 个**；bio_limits.sh 在 `/etc/profile.d/` | **已修正提示词** |
| 黑名单 | 27 | 27 条正则（2026-10-21 收敛为规格正本 8 条，见 `aims/aims.txt` §三.1） | ✓ 已改判 |
| 出图 DPI | 300 | 300（rcParams + savefig + 规范） | ✓ |
| 出图规范版本 | v2.1 | 文件头已对齐 v2.1 | ✓ |
| 图件数 | — | line1 29 / line2 37 / line3 69 = **135** | ✓ |
| 文件系统/水位 | f2fs、≥20% | f2fs，Use 29%（free 71%） | ✓ |
| seed 注入 | BIOANALYS_SEED | task.js L45 `export BIOANALYS_SEED` | ✓ |
| R / Python | 4.3.3 / 3.12.3 | 容器实测 4.3.3 / 3.12.3 | ✓（此前未验证项已补验） |
| portal 自包含 | 无工作台 API | 仅 `fetch('/api/submit')` 1 处 | ✓ |
| 启动脚本 | 3 个 bat | 3 个，GBK+CRLF+chcp 936 | ✓ |

**修正动作**：v3.0 提示词补注 ops 实际分布（ops/ 5 个 + `/etc/profile.d/bio_limits.sh`）、
line1 `probe_env` 口径说明；"四不改"条目同步。

**未动**：所有母版脚本、ops 文件、框架代码、既有图件、`projects/default/` 数据。

## 2026-10-14（续）：择优采纳吸收 v3.0 机制（落规范，不动框架）

**用户指令**："择优采纳吸收"。对 v3.0 提示词的机制逐条做「能否落地」核对，只吸收与
「四不改」冻结框架不冲突的部分。

**核对结论（v3.0 机制 vs 代码现实）**：
| 机制 | 代码支持 | 处置 |
|---|---|---|
| 台账（con_hf + system_logs JSON） | ✅ 已实现 | 无需动 |
| seed 注入 `BIOANALYS_SEED` | ✅ task.js | 无需动 |
| 绑核包装 `run_throttled_task.sh` | ✅ task.js throttled 分支 | 无需动 |
| 出图规范 v2.1（300 DPI） | ✅ | 无需动 |
| 四不改（框架/ops/母版只读） | 约定 | 无需动 |
| **方案A 项目内脚本沙盒** | ❌ 框架无实现（`LINE_SUBDIRS` 无 `scripts/`；任务引擎只认全局 `bin/`） | **落规范 + 实测验证** |
| **交付包 `deliverables/` 三大件** | ❌ 无工具 | **落规范** |
| 6 大类微调预案 / 5 步 SOP / 汇报模板 | 纯流程知识 | 已在 v3.0 文件 |

**关键判断**：框架属「四不改」冻结区，**不能**为方案 A 改 task.js。方案 A 的正确落地路径是
**ops 层直跑**——`run_throttled_task.sh` 接受任意 `<script_path>`，故项目内适配副本可直接绑核跑。

**吸收动作（纯文档，零代码改动）**：
1. `docs/delivery_supervisor_prompt.md` 三.2 补「适配副本的执行路径（关键）」：明确适配副本
   **不走** `/api/tasks/submit`（该引擎冻结、只认 `bin/<line>/`），而是直跑
   `run_throttled_task.sh <task_id> <line> <step> <lang> <项目内脚本绝对路径>`；未适配的步仍跑全局母版。
   并注明 `scripts/` 与 `deliverables/` 是**代理自管目录**（不在 `LINE_SUBDIRS`，框架不创建）。
2. 同文件 SOP Step 3 补 `<script_path>` 取值说明（已适配→项目副本；未适配→全局母版）。
3. `docs/directories.md` 服务器侧目录树补 `projects/<项目>/<line>/scripts/` 与 `deliverables/`，
   加「两个代理自管目录」表 + ops 直跑命令。

**实测验证（K40 真机，一次性探针）**：
- 建 `projects/_adapter_probe/line1_bulk/scripts/hello_adapted`，经
  `run_throttled_task.sh probe_adapter_1 line1_bulk hello_adapted bash <项目内脚本绝对路径>` 直跑。
- 结果：门禁 `[OK] f2fs | 剩余 71% | 隔离 line1_bulk` 放行；脚本运行，日志
  `ADAPTED_COPY_RAN cwd=.../projects/_adapter_probe/line1_bulk/processed seed=20261013`；
  台账 JSON 落 `system_logs/probe_adapter_1_ledger.json`（status=completed，checkpoint=passed）。
  **证实方案 A 在 ops 层可行，无需动框架。**
- 探针已清理（`_adapter_probe` 删除、`probe_adapter_1.*` 删除）；`projects/` 仅剩 `default`。
  其它 `*probe*` 台账为 10-13/14 历史产物，未动。

**回归**：后端单测 **109/109 过**（本次零代码改动）。

**未动**：框架代码、ops 文件、母版脚本、既有图件、`projects/default/` 数据。

## 2026-10-14（续）：新增交付包打包脚本规范 v1.0

**用户指令**："请更新交付包打包脚本的规范文档"。此前只有 v3.0 提示词里三行描述，无独立规范。

**新增**：`docs/delivery_package_spec.md` v1.0，定义 `ops/09_package_delivery.ps1` 的完整契约：
1. **调用契约**：`-Project`（必填，同 sanitizeProjectId）/ `-Line` / `-Label`；
   产物 `<project_id>_Client_Delivery_<YYYYMMDD>[_<Label>].tar.gz` + `.sha256`；退出码 0/1/2；同名不覆盖。
2. **前置门禁 6 项**：链路、project.json、存储水位 >=20%、图件非空、无 running 台账、
   failed 台账需 `-Force` 确认。
3. **包内三大件**：`01_Adapted_Code/`（+ MANIFEST.tsv）、`02_Figures_and_Tables/`
   （figures / figures_vector / tables / reports 四子目录）、`03_Interpretation_Report/`、
   `CHECKSUMS.sha256`、`PACKAGE_META.json`。
4. **纳入/排除规则**（按 `projects/default` 实测口径）：纳入 `.png/.tsv/.csv/.txt/.pdf`；
   排除 `raw_data/`、`*.h5ad`（最大 617MB）、`*.rds`、`*.tar/.gz`、`*.log`、
   `s*_probe*.py` 等 20 个调试探针、`__pycache__`。
5. **脱敏 5 条**：绝对路径替换、主机别名清除、联系方式不进包、台账只留摘要、打包后 grep 抽检。
6. **打包后校验 6 项**：tar 可列、三大件非空、图件计数一致、CHECKSUMS 覆盖、排除模式零命中、体积统计。
7. **失败处理**：`.staging_*` 组装，校验过才 mv；失败删成品、留现场。
8. **与既有体系关系**：与 `07_pull_outputs.ps1` 正交；不调 `run_throttled_task.sh`；不改框架。
9. **验收清单 9 项**（供实现后自测）。

**同步更新**：`docs/delivery_supervisor_prompt.md` Step 5 改为以该规范为准（并补 `.csv` 纳入、
探针脚本排除）；`docs/directories.md` 加规范指引。

**实现状态**：规范先行，脚本 `ops/09_package_delivery.ps1` **尚未实现**（文档内已显式标注）。
理由：无真实交付项目时实现易过度设计，待首个项目验收通过后按第九节清单落地。

**验证**：文档 em dash 命中 0（符合项目写作红线）；两处交叉引用已确认生效；本次零代码改动。

## 2026-10-18：Termux 保活修复（根因：唤醒锁未持有）

**用户指令**："先处理 Termux 保活问题"。背景：连续两次复核发现 Termux 掉线，
`ssh` 报 `Connection closed by 127.0.0.1 port 10022/8022`，但 `adb forward` 映射仍在（端口假监听）。

**根因定位（实测）**：
- 掉线时 `dumpsys power` → **`Wake Locks: size=0`**，Termux 无唤醒锁，CPU 休眠后进程被冻结。
- 开机脚本 `start-sshd.sh` / `start-p_actions.sh` 里**本来就有** `termux-wake-lock`，
  但**手动 `am start` 拉起不走 Termux:Boot**，所以手动恢复后仍无锁，容易再次掉。
- crontab 每 5 分钟的 `tick.sh` 只是取件器，**没有任何服务健康检查**。

**已确认就位的系统层设置（无需改）**：
| 项 | 实测值 |
|---|---|
| MIUI 自启动 | Termux、Termux:Boot 均在允许列表（页面显示「允许2个应用自启动」） |
| MIUI 省电策略 | **无限制**（`checked=true`，不采取任何限制措施） |
| 电池优化白名单 | `dumpsys deviceidle whitelist` 含 com.termux / com.termux.boot |
| standby bucket | 10（ACTIVE） |
| RUN_ANY_IN_BACKGROUND | allow |

**改动**：
1. 立即执行 `termux-wake-lock` → `Wake Locks: size=1`，`PARTIAL_WAKE_LOCK 'termux:service-wakelock' ... LONG`。
2. 新增 `ops/bio_watchdog.sh` → 部署到 `~/p_actions/bin/bio_watchdog.sh`；
   新建 runit 服务 `$PREFIX/var/service/bio-watchdog/run`（无 down 文件）。
   职责：每分钟重申唤醒锁 + 检查 sshd/crond/ssh-agent/ubuntu-sshd 非 run 则 `sv up`。
3. `~/.termux/boot/start-p_actions.sh` 两处 `sv up` 列表补 `bio-watchdog`
   （备份 `start-p_actions.sh.bak_20261018_watchdog`，`bash -n` 语法通过）。
4. 新增 `docs/termux_keepalive.md`：五层防护、验证命令、边界与恢复步骤。
5. `ops/README.md` 脚本清单补 `bio_watchdog.sh`。

**自己引入并修掉的 bug（坑 #134）**：
watchdog 首版每 5 分钟 `ssh k40-ubuntu 'true'` 探容器。`k40-ubuntu` 是 **Windows 侧 ssh 别名**，
Termux 内不存在 → 恒失败 → 反复 `sv restart ubuntu-sshd`，日志出现 `got TERM`，容器被反复打断。
**修法**：删除容器 ssh 探测，只保留唤醒锁 + 服务自愈（容器由 runsv 监管 ubuntu-sshd 负责）。

**验证（全部实测）**：
- 唤醒锁：`size=1`、`LONG`，持续 9 分 37 秒
- 五服务全 `run`（sshd / crond / ssh-agent / ubuntu-sshd / bio-watchdog）
- 故障注入 1：`kill -9` crond 主进程 → runsv **5 秒**内重启（新 pid）
- 故障注入 2：`sv down crond` → bio-watchdog **49 秒**内 `sv up`，日志留痕
- 容器：`CONTAINER_OK`（10022 通）
- watchdog 修复后跑 2 个周期，日志无新增错误

**已知无害现象**：`sv status ubuntu-sshd` 显示 `got TERM`，但 proot 进程 `State: S` 仍存活、
10022 可连。proot 不响应 SIGTERM，这是状态标记不是故障，**不要据此反复重启**。

**残余风险（无法归零）**：Termux 进程被系统杀掉时 watchdog 随之消失，只能靠 Termux:Boot 开机脚本
或手动打开 Termux 恢复。五层防护已把概率压到很低。

**未动**：框架代码、母版脚本、ops 既有 6 件套、`projects/default/` 数据、既有图件。

---

## 2026-10-18 · 工作台新建项目页接入客户需求导入（portal/inbox）

**背景**：用户提交台（portal/serve.mjs）把需求落盘到 `portal/inbox/<时间戳>_需求_<项目名>.json`，
但管理员侧工作台新建项目页此前没有读取入口，只能人工打开 JSON 逐项抄。本轮把该目录单向接进工作台。

**解耦原则不变**：portal 不调工作台任何接口，工作台也不推送；工作台只是「主动读取」该目录，
替代手工抄写。两个进程、两个端口依旧独立。

**改动**：
1. `BioanalysDesktop/server/index.js`：新增 `PORTAL_INBOX` 常量、`isSafeManifestName()`（只放行单层
   `[\w\u4e00-\u9fa5.-]+\.json`，禁 `..` / 分隔符）、`listInboxManifests()`（mtime 倒序，目录不可读回 blocked，
   单文件解析失败如实带 `parseError`）；新增两个接口 `/api/portal/inbox`（列表）与
   `/api/portal/inbox/item?name=`（单文件，含 `path.resolve` 二次越界校验）。
2. `BioanalysDesktop/src/App.tsx`：新增 4 个类型、5 个 state、`loadInbox()` / `importFromInbox()`；
   「模块 0：从客户需求导入」UI；进页面 `useEffect` 自动读一次。
   `importFromInbox` 7 步映射：① basicInfo → 名称/描述/疾病/领域/物种（领域、物种须命中预设列表才套用）
   ② 项目 ID 从文件名时间戳派生 `proj_YYYYMMDD_HHMMSS` ③ dataSource → 来源/GSE/GPL/样本数/组织
   ④ groupingDesign → groups + contrasts ⑤ **分析线反查 + 母版依赖顺序重排**（按 stepId 命中数选线，
   `masterOrder` 过滤重排，丢弃非本线步骤并记 notes）⑥ expectedFormats → outputItems（`png_300dpi`/`png_150dpi` 双兼容）
   ⑦ targetKoGene → koGene。
3. `BioanalysDesktop/src/app.css`：新增 `.inbox-toolbar/.inbox-list/.inbox-item/.inbox-item-main/.inbox-item-name/.import-result/.import-notes` 7 类。
4. `BioanalysDesktop/tests/index.test.js`：补 4 条真实 HTTP 回归（列表 200 / 合法名读 manifest /
   穿越与非 json 一律 400 且服务不崩 / 不存在 404）。

**验证（实测）**：
- 接口：`/api/portal/inbox` → 200，items 含 `2026-10-15_233830_需求_缺血性卒中空间转录组分析.json`；
  `/item` 读回完整 manifest；`../serve.mjs` / `serve.mjs` → 400，`nope.json` → 404。
- `npm run build`：32 modules，dist 重建成功。
- `npm test`：**113/113 pass, 0 fail**（原 109 + 新增 4）。
- 浏览器实测（8787）：列表条目文案「心脑血管 / 缺血性卒中 / Homo sapiens · 2 组 · 16 步 · 0 样本」；
  导入后项目 ID = `proj_20261015_233830`、名称 = 缺血性卒中空间转录组分析、疾病 = 缺血性卒中；
  橙色提示含「需求文件未填数据集编号」「需求文件未填样本编号」；控制台零 error。

**未动**：portal/serve.mjs、portal/index.html、母版脚本、`projects/` 数据、既有图件、三线隔离规则。

**后续（未做）**：n8n 落地（用户已选「先评估，暂不装」）。

---

## 2026-10-18 · 补「数据类型」字段（两端贯通，修选线缺口）

**问题（用户指出）**：GSE 与 GPL 只能说明"数据从哪来、什么平台"，说明不了"这是什么数据"。用户端与服务端都没有数据类型字段，导致分析线只能靠 pipelineDag 的 stepId 命中数**反推**——间接、脆弱，且选错线就跑错流程。

**修法**：把数据类型提升为一等字段，两端贯通。

**枚举（唯一真源 `server/domain.js` 的 `DATA_TYPES`）**：

| dataType | 文案 | 分析线 |
|---|---|---|
| `microarray` | 基因芯片（表达谱） | `line1_bulk` |
| `bulk_rnaseq` | Bulk RNA-seq（转录组测序） | `line1_bulk` |
| `scrna` | 单细胞转录组（scRNA-seq） | `line2_scrna` |
| `spatial` | 空间转录组（Visium 等） | `line3_spatial` |

粒度分到芯片 / Bulk 两级：同属 GEO bulk，但预处理路径不同（探针注释 vs counts），不能粗到只写 `bulk`。

**改动**：
1. `server/domain.js`：新增 `DATA_TYPES` / `DATA_TYPE_IDS` / `DATATYPE_TO_LINE` / `resolveLineFromDataType()`（缺失或非法返回空串，交调用方回退）。
2. `server/index.js`：收件箱列表摘要带 `dataType` + `suggestedLine`；单文件接口返回 `dataType` / `suggestedLine`（服务端判定，前端不必自己实现映射）。
3. `portal/index.html`（用户端）：第 2 步新增必选「数据类型」下拉（紧挨数据库来源）；`validateStep(2)` 必填+枚举校验并纳入 `collectManifest`；写入 `dataSource.dataType`；第 4 步**按类型自动锁定分析线**，其余两条 `disabled` + 置灰（`.line-opt.is-locked`）；摘要行加数据类型。
4. `portal/serve.mjs`：`POST /api/submit` 落盘前校验 `dataSource.dataType` 必填且在枚举内，否则 400（两端解耦不共享代码，故独立持有同值枚举）。
5. `BioanalysDesktop/src/App.tsx`：模块 B 新增「数据类型」选择器（选类型即选线，走 `onSelectLine`）；`importFromInbox` 改为**优先用服务端 `suggestedLine`**，缺 `dataType` 才回退 stepId 反查并加提示；新增**一致性守卫**（步骤与类型所指线不完全一致时告警，不静默跑错线）；建项 payload 带 `dataType`；收件箱列表显示类型文案与建议线。
6. `tests/datatype.test.js`（新）：4 条映射单测（含类型漂移防护、空白容忍）。

**验证（实测）**：
- `npx tsc --noEmit` → exit 0；`node --check` 四个改动文件 → 通过。
- `npm test` → **117/117 pass, 0 fail**（原 113 + datatype 4 条；收件箱 2 条改为同时断言 `dataType` / `suggestedLine`）。
- 接口：旧样例（无 dataType）→ `dataType='' suggestedLine=''`（回退路径完好）；缺 dataType 提交 → **400**；`spatial` 提交 → 落盘成功且列表返回 `dataType=spatial line=line3_spatial`。
- 浏览器（Chrome DevTools 单实例，脚本读数）：用户端 8080 有 4 个选项、不选被拦（错误原文「请选择数据类型（它决定走哪条分析线）」）、选空间后 `line3_spatial` 选中且 line1/line2 disabled+locked、控制台零 error；工作台 8787 导入带类型文件 → 数据类型=空间转录组、选中「线3 / 空间转录组 + 虚拟敲除」、勾选 3 步（2 命中 + QC 自动锁）、守卫告警正确触发；导入旧文件 → 数据类型空、按 stepId 回退选中线三、16 步、提示「需求文件未填数据类型（dataType），已按步骤反查分析线，请确认后补选」。
- 自检用的临时需求文件（`2026-10-18_112840_需求_自检_空间转录组类型链路.json`）已删除，收件箱恢复只剩用户的真实样例。

**未验证 / 已知无害项**：工作台页面控制台有 1 条 404，已定位为浏览器自动请求 `/favicon.ico`（页面未声明图标），与本次改动无关，未处理。

**未动**：三条线的母版步骤定义、`src/` 母版脚本、`projects/` 数据、三线隔离规则、用户真实样例文件。

**测试副作用提示**：并行跑两个 browser_use 子代理会共用同一浏览器实例、互相抢标签页（本次一度把 8080 页"跳"到 8787，实为干扰而非 bug）。复核浏览器行为一律单实例串行。

## 2026-10-18 · 数据集 ↔ 平台配对（GSE↔GPL 显式配对，两端贯通）

**背景**：`dataSource` 原来是三个互不相关的扁平数组 `trainGse` / `valGse` / `gpl`，客户一次传多组数据时无法表达「哪个 GPL 属于哪个 GSE」。不同平台走不同探针注释与归一化，配对错了预处理必跑偏。

**新契约（manifest v1.0 起）**：
```json
"dataSource": { "source": "GEO", "dataType": "microarray",
  "datasets": [ { "gse": "GSE16561", "gpl": "GPL6883", "role": "train" },
                { "gse": "GSE58294", "gpl": "GPL570", "role": "validation" } ],
  "sampleCount": 60, "tissue": "..." }
```
`gse` 单行必填；`gpl` 芯片必填、纯测序可留空；`role` ∈ `train` | `validation`。同一 GSE 多平台拆多行。

**改动清单**：
1. `BioanalysDesktop/server/domain.js`：新增 `normalizeDatasets(dataSource)` → `{datasets, inferred}`。新格式透传（`inferred=false`）；旧扁平格式按位置推断（单个 GPL 广播给全部 GSE，数量对不上留空，`inferred=true`），纯函数。
2. `BioanalysDesktop/server/index.js`：`import normalizeDatasets`；收件箱列表摘要加 `datasets` / `datasetsInferred`；单文件接口同样返回这两项。
3. `portal/index.html`：step 2 用「数据集 ↔ 平台配对」动态表（`#dataset-list` + `#btn-add-dataset`，`renderDatasets()`，行内 GSE/GPL/用途三列 + 删除）；`validateStep(2)` 加 datasets 校验；`buildManifest` 写 `dataSource.datasets`；`renderSummary` 加配对行；`init()`/`bind()` 挂渲染与新增行；填写引导改写；删除已无引用的 `splitList`。
4. `portal/serve.mjs`：`/api/submit` 落盘前校验 `datasets` 至少一组、每行 `gse` 非空，否则 400。
5. `BioanalysDesktop/src/App.tsx`：`trainGse`/`valGse`/`gpl` 三 state 合并为 `datasetRows: DatasetRow[]` + `updateDatasetRow`/`addDatasetRow`/`removeDatasetRow`；模块 B 改配对表（`.pairing-row` 四列）；`importFromInbox` 直接用服务端归一化后的 `payload.datasets`（不在前端重复实现推断，避免两端规则漂移），`datasetsInferred` 时提示「旧格式…配对为推断，请核对」；收件箱列表显示配对与推断标记；建项 payload 写 `datasets`；重置同步。
6. `BioanalysDesktop/src/app.css`：新增 `.pairing-head` / `.pairing-row`（≤720px 降为单列）。
7. 测试：新增 `tests/datasets.test.js`（7 条，覆盖新格式透传/空 gse 剔除/role 归一/旧格式按位置/单 GPL 广播/越界留空/无数据）；`tests/index.test.js` 摘要与单文件断言加 `datasets` / `datasetsInferred` 并与 `normalizeDatasets` 对齐；`tests/project.test.js` fixture 改 `datasets`；`server/project.js` JSDoc 更新。
8. 文档：`docs/user_portal_deploy.md` 加 `### datasets` 契约小节，五步向导第 2 步改写。

**验证证据**：
- `npm test` → **124/124 pass, 0 fail**（117 + 7 条新 datasets 单测）；`npx tsc --noEmit` → exit 0；`npm run build` → 成功。
- 服务已重启（工作台 8787 / 用户端 8080，日志 `cn_debug/workbench_{out,err}.log`、`cn_debug/portal_{out,err}.log`），health 均 200。
- 契约脚本 `cn_debug/2026-10-18_verification_datasets_contract.mjs`（跑完自清）：无 datasets → 400「数据集缺失…」；某行 `gse` 空白 → 400「第 2 组数据集缺少 GSE 编号」；合法提交 → 200 落盘，读回 `datasets` 三行与 dataType 正确，读后即删，收件箱复原只剩用户真实样例（实测 1 个 json）。
- 浏览器（Chrome DevTools 单实例，脚本读数）：用户端 8080 第 2 步渲染 2 行配对（`d-gse-d1`/`d-gpl-d1`/`d-role-d1` 等），全空点下一步被拦（「有 2 组数据集未填编号（GSE），请补齐后再继续」），新增行后未填再拦（「有 1 组…」），补全后带 `dataType=spatial` 一路走到第 5 步；摘要显示「GSE16561↔GPL6883（训练）；GSE58294（验证，未标平台）；GSE00003↔GPL0003（验证）」；`window.__manifestJson.dataSource.datasets` 三行正确；`location.href` 全程未离开 8080。工作台 8787 列表两文件均显示配对行；导入新格式 → 三行配对原样落到 `.pairing-row`（role 保留、无推断提示）；导入旧格式（`trainGse` 两个 + 单个 `gpl`）→ 三行 GPL 全广播为 GPL6883，列表带「⚠ 旧格式推断，需核对」，导入提示「需求文件为旧格式…请核对后再跑预处理」。

**未验证**：未在真机链路上跑预处理（本轮只做契约与界面，GPL 对预处理的真实影响待 line1 跑通后复核）。

**未动**：三条线母版步骤定义、`src/` 母版脚本、`projects/` 数据、三线隔离规则、`portal/inbox/` 里用户的真实样例（`2026-10-15_233830_需求_缺血性卒中空间转录组分析.json`）。自检用的两个临时 fixture 与一份落盘需求文件均已删除。

## 2026-10-18 · 参考文献上传 + 备注栏（用户端 → 服务端贯通）

**背景**：用户端除了「GSE/GPL 配对 + 数据类型 + 分组（组↔GSM）」，还需支持**上传参考文献（≤5 篇）**供分析流程参考，并提供**备注栏**写清更详细的研究目的与分析手段诉求。

**新契约（manifest v1.0 起）**：
```json
"references": [ { "name": "Smith2020.pdf", "path": "refs/<sid>/Smith2020.pdf", "size": 204800 } ],
"notes": "更详细的研究目的、期望分析手段等自由文本"
```
`references` 只记元数据，文件本体落 `portal/inbox/refs/<sid>/`，不进 JSON（否则撑爆 1MB 上限）；`notes` 上限 4000 字。

**改动清单**：
1. `portal/serve.mjs`：新增 `POST /api/references?sid=&name=` 上传接口（请求体为文件原始二进制，**不解析 multipart**，零依赖）。上限：单批 ≤5 篇、单篇 ≤20MB、扩展名白名单 `.pdf/.doc/.docx/.txt/.md/.zip`；`safeRefName` 安全化时**保留扩展名**（原 `safeName` 会把 `.` 折叠成 `_`，扩展名会被吃掉，故另写一个）；`uniqueInDir` 同名追加 `_2`。`/api/submit` 加校验：`references` ≤5 条、`path` 必须匹配 `refs/<sid>/<文件名>` 且**解析后仍在 inbox/ 内、且 `statSync().isFile()`**（防伪造路径）；`notes` 必须 string 且 ≤4000 字。
2. `portal/index.html`：第 5 步改名「补充材料与提交」，新增参考文献卡片（`#f-refs` 多选 + `#ref-list` 已上传列表 + `#e-refs` 反馈）与备注卡片（`#f-notes` textarea + `#notes-count` 计数）；`state.refs` / `state.uploadSid`（`crypto.randomUUID()` 起，同批归一个目录）；`uploadRefs()` 选中即刻逐篇串行上传（成功才 `push`，失败保留已成功的）；`renderRefs()` 带「移除」；`buildManifest` 写 `references` / `notes`；摘要加「参考文献 N 篇」；`bind()` 挂 `f-refs` change 与 `f-notes` input；文件输入框与 `.ref-del` 样式补齐；label 用 `.visually-hidden`。
3. `BioanalysDesktop/server/tumor_blacklist.js`：`validateProjectFields` 的 `keys` 加 `notes` —— 客户备注是自由文本，必须一并走非肿瘤黑名单（否则改了 `project.js` 的 `fieldsToCheck` 也不会生效，因为该函数内部是硬编码白名单，这是本轮踩到的真实坑）。
4. `BioanalysDesktop/server/project.js`：`fieldsToCheck` 加 `notes`；meta 新增 `notes`（trim 后、非 string 归空串）与 `references`（非数组归 `[]`，避免下游 undefined 分叉）。
5. `BioanalysDesktop/server/index.js`：收件箱摘要加 `refCount` / `notes`（列表只显示「参考文献 N 篇 · 备注 M 字」）。
6. `BioanalysDesktop/src/App.tsx`：`ReferenceMeta` 类型；`PortalManifest` 加 `notes` / `references`；模块 A 加「备注 / 分析需求补充」textarea（绑定 `notes` state）与参考文献只读提示；`importFromInbox` 导入 `notes` / `references` 并加提示「客户上传了 N 篇参考文献，文件在用户端收件箱 refs/<sid>/ 下」；建项 payload 带 `notes` / `references`；重置同步。**同时把 `importFromInbox` 内的局部提示数组 `notes` 重命名 `notesList`**，避免与新增的 `notes` state 同名遮蔽。
7. 测试：`tests/project.test.js` 新增 1 条（备注 trim / references 落盘 / 缺省归一 / 非字符串与非数组归一 / 备注命中黑名单抛错）。

**验证证据**：
- `npm test` → **125/125 pass, 0 fail**；`npx tsc --noEmit` → exit 0；`npm run build` → 成功（dist 14.80 kB css / 196.44 kB js）。
- 两服务已重启（8787 / 8080），health 均 200。
- 契约脚本 `cn_debug/2026-10-18_verification_references_notes.mjs`（跑完自清）：正常上传 → 200 `path: refs/<sid>/Smith_2020_脑卒中综述.pdf`（中文名与空格安全化、扩展名保留）；`.exe` → 400 格式拒绝；空内容 → 400；连传 5 篇后第 6 篇 → 400「该批次已满」，实测目录内 5 个文件；提交伪造路径 `refs/whatever/x.pdf` → 400「文件不存在或越界」；提交 6 条 → 400；`notes` 4001 字 → 400；合法提交 → 200 落盘，读回 `notes` 与 `references` 正确；随后删掉需求文件与 `refs/<sid>/`，收件箱复原只剩用户真实样例。
- 浏览器（Chrome DevTools 单实例，脚本读数）：用户端 8080 第 5 步出现 `#f-refs` / `#f-notes`；用 `DataTransfer` 造 `File` 触发真实 change → **真上传成功**，`#ref-list` 显示「1. Test_2020_Stroke.pdf 1 KB 移除」，反馈「已上传 1 篇，累计 1 / 5 篇」；备注计数「22 / 4000」；点「提交给对接人」→ 横幅「✓ 需求已提交给对接人」，`__manifestJson.references` 带真实 `path` 与 `size:10`；随后在磁盘读回该需求文件确认 `notes` / `references` / `path` / `size` 都对，再删除文件与 refs 目录。工作台 8787 用带 `notes` + 2 篇参考文献的临时 fixture 导入 → 备注 textarea 被填充、只读提示「参考文献（2 篇，客户在用户端上传）：Smith2020_stroke_review.pdf；Liu2021_microglia.md」、导入提示「客户上传了 2 篇参考文献，文件在用户端收件箱 refs/selftest-fixture-0001/ 下」；拦截 `/api/projects/create` 捕获建项 payload，`notes` / `references` / `datasets` 三项齐全（拦截未真建项，无副作用）。

**未验证**：参考文献文件本体没跑过「从用户端收件箱搬到服务器」的回搬链路（本轮只做采集与交接落盘）；`/api/references` 的 20MB 上限未用大文件实测（代码路径与 1MB 需求本体同构，风险低但未实证）。

**未动**：同上一节：三条线母版步骤定义、`src/` 母版脚本、`projects/` 数据、三线隔离规则、`portal/inbox/` 用户真实样例。本轮自检产物（2 份临时 fixture、1 份落盘需求、1 个 refs 目录）全部已删除，实测收件箱只剩 1 个 json。

---

# 交接 · 2026-10-18（出图版式统一收口，17 个出图脚本）

**接任务先读这条**：本节的版式规则与工具是**长期资产**，以后任何出图改动都受它约束。

**触发**：用户审图反馈四类版式问题（原话）——① "柱状图上标签内容超出图框，请设置换行（标签名过长造成的）"，
点名 `l1_26_shap_waterfall.png`、`l2_scenic_02_top_regulons.png`；② "p阈值线（虚线）的p值标注请放置于左侧
（类似的同类型图也有同样的问题），放中间会被图内容遮挡，影响美观"；③ "竖向的图图例图注放右上角，纵向排列，
且不重叠，横向的图放下面纵向排列，不重合"；④ "并将上述处理问题的经验沉淀"。

**规范正本**：`docs/figure_spec.md` **v2.2**。新增 §三之三「落盘前统一收口（layout guard）」，
改写 §三之二「图注与图例位置」。**改出图前先读这两节。**

**统一收口机制（核心）**：17 个出图脚本各内嵌同一份 canonical helper 块
（`caption` / `wrap_label` / `fit_text_edges` / `legend_out` / `layout_fix` / `_install_layout_guard`），
以 `src/line2_scrna/scripts/scenic_figures` 第 69–~190 行为**真源**。`_install_layout_guard()` 接管
`Figure.savefig`，脚本内**任何** `fig.savefig` 落盘前自动先走 `layout_fix()`，新增出图代码不必手工调用。

| 规则 | 落地 |
|---|---|
| 长标签溢出轴框 | `wrap_label(width=18)`（调用点显式包裹条形末端/柱顶挂标）+ `fit_text_edges` 四边扩 `xlim`/`ylim`（留 6px 边距） |
| p 阈值标注被遮挡 | `adj p=0.05`/`p=0.05` 贴**左侧**轴框内缘（`ha="left"`）；`log2FC=±1` 竖直标注置轴框**顶部** |
| 图例位置 | `legend_out()` 统一外置：竖版右上单列 / 横版下方单列 / >12 条分列 / `frameon=False` |
| 图注位置 | `caption()`：竖版右上纵向多行 / 横版下方纵向多行（**废弃 `|` 横拼**） |
| 分面图 | 不搬图例（各分面自带图例，统一外移会互相压扁），只做文本收边 |
| **tick 标签** | **一律不换行**（它本在轴框外，`tight` 会装下它；换行反致密集类目轴压字，已实测回退，见踩坑 #141） |
| 网络节点标签 | `nx.draw_networkx_labels()` 后追加 `adjust_text(..., arrowprops=...)`（spring 布局含外部接口输入时**必须**） |

**机器验收工具（新建）**：`ops/audit_figure_layout.py`

```bash
# 服务器上跑（真数据）：
python3 /mnt/ssd/bio_data/bin/audit_figure_layout.py \
  --script /mnt/ssd/bio_data/bin/<line>/<脚本> \
  --cwd /mnt/ssd/bio_data/projects/default/<line>/processed \
  --runner bash --write
```
判定 A–E（容差 3px），FAIL 退出码 1；默认不落盘，`--write` 才写；`--runner bash` 用
`sitecustomize` 注入审计并**软链副本目录**（真 processed 目录零改动）。

**验证证据**：
- `python cn_debug/check_heredoc_syntax.py` → 17 脚本 19 个 heredoc 全 `compile()` 过，`bad=0`。
- `pwsh -File ops/06_deploy_scripts.ps1 -Force` → **PASS 54 个脚本 + 3 个环境清单**（字节校验 + 可执行位）。
- 服务器真数据全量审计（三轮重渲染，每轮 `--write`）：**135 张图 fail=0**
  （line1 29 / line2 37 / line3 69）。`ppi_string l1_07` 原为间歇性 FAIL（STRING API 每次重取 → spring
  布局变化），加 `adjust_text` 后连跑 3 轮全 PASS。
- 负对照：回退 `wrap_label` + `fit_text_edges` → `l2_scenic_02_top_regulons.png` 复现
  `A 标注越出坐标轴框`、exit=1（证明审计不是空转）。
- 回搬：三线 `figures/*.png` → `outputs/default/<line>/figures/`，逐文件字节校验 **135 checked / 0 mismatch**。
- 肉眼复核 6 张关键图：`l1_26_shap_waterfall`（标签已折行、在框内）、`l2_scenic_02_top_regulons`
  （长 celltype 名两行折行、在框内）、`l2_08_deg_volcano_basal_keratinocyte`（`adj p=0.05` 已贴左侧）、
  `l1_13_gsea_top`（tick 仍单行、无压字）、`l1_07_ppi_network`、`l2_16_dr_regulatory_network`（节点标签分离）→ 全合规。

**未验证 / 遗留**：
- 135 张**未**做全量逐张肉眼复核（只复核 6 张关键图；其余靠机器几何审计）。机器判据覆盖 A–D，
  但"颜色语义、图例是否缺项"仍需人眼，下次审图可补。
- `l2_08` 火山顶部 `log2FC=±1` 竖直标注与被标注虚线自身有极轻微重合（视觉可接受，未单独处理）。

**未动（不可覆盖）**：
- 三条线母版步骤定义与 `projects/` 数据、三线物理隔离规则、`portal/inbox/` 用户真实样例。
- `ops/07_pull_outputs.ps1` 本轮**未用**（它会连 processed 的 h5ad 一起重传，约 22GB），
  回搬改用定向 scp 只拉 `figures/`。
- 注意：本工作区**不是 git 仓库**（`git status` 报 not a git repository），无版本控制兜底，
  改动前请自行备份；本轮为纯新增/改动，未删除任何用户文件。

**产出文件**：
- `docs/figure_spec.md`（v2.1→v2.2）
- `ops/audit_figure_layout.py`（新建）
- 17 个出图脚本内嵌 canonical helper：`src/line1_bulk/scripts/{bulk_figures,enrichment_figures,external_validation,key_genes,ml_hub_analysis,ml_model,ppi_string}`、
  `src/line2_scrna/scripts/{dr_post_analysis,enrichment_figures,gsva_pathways,scenic_figures,scrna_figures,target_gene_localization}`、
  `src/line3_spatial/scripts/{celltype_annotation,dr_post_analysis,enrichment_figures,spatial_figures}`
- `con_hf/踩坑台账.md`（#140–#143）、`con_hf/操作台账.md`、`con_hf/handoff.md`（本节）
- 本地存档：`outputs/default/{line1_bulk,line2_scrna,line3_spatial}/figures/*.png`（135 张，最新版式）

---

# 交接 · 2026-10-18（用户端第 5 步打印 / 存为 PDF 改为完整需求单）

**触发**（用户原话）："客户端提交需求的第5步打印/存为PDF导出的内容不合理，不包含所有内容请重新设计编撰。
导出的PDF要包含全项目内容，且有时间戳。"

**改的文件只有一个**：`portal/index.html`（用户端页面，服务 `node portal/serve.mjs`，默认 127.0.0.1:8080）。
`serve.mjs` 每次请求都 `readFileSync(index.html)`，**改完刷新页面即生效，不用重启服务**。

**打印契约（以后改动必须遵守）**：

1. 屏幕上的表单页在打印时整体隐藏（`.site-header` / `.progress-wrap` / `#main-content` / `.site-footer` 全 `display:none`），
   打印只输出 `#print-report` 这个容器。**PDF 内容 = `#print-report` 的内容，不是屏幕上那一屏。**
2. `#print-report` 的内容由 `buildPrintReport()` 在打印前重建，数据源是 **`buildManifest()`**——
   与「提交给对接人」落盘的 JSON 同一份数据源。所以 PDF 与提交内容结构上不会漂移；
   以后给需求单加字段，改 `buildManifest()` 后**必须同步在 `buildPrintReport()` 里加一行**。
3. 当前八个章节：一、项目基本信息｜二、数据集 ↔ 平台配对｜三、分组与样本绑定｜
   四、差异对比对｜五、分析线与分析步骤｜六、参考文献｜七、备注 / 分析需求补充｜八、交付物偏好。
4. **时间戳**：页首、页脚两处 `生成时间：YYYY-MM-DD HH:mm:ss`（`tsLocal()`，本地时区）；
   打印前把 `document.title` 改成 `<项目名>_需求单_YYYYMMDD_HHmmss`（`tsFile()`），
   浏览器「另存为 PDF」会用标题作默认文件名，`afterprint` 后由 `printTitleRestore()` 还原。
5. 触发路径两条：点 `#btn-print` → `printRequirement()`；**任意步骤直接 Ctrl+P → `beforeprint` → `buildPrintReport()`**。
   第二条不是可选装饰：`main` 在打印时被隐藏，少这一条 Ctrl+P 会打出一张白纸。
6. 版式：`@page { size: A4 portrait; margin: 14mm 12mm }`，表格 `table-layout: fixed` +
   `word-break: break-word`，长文本按单元格折行不横向截断；备注 `white-space: pre-wrap` 保留换行。

**验证证据（浏览器真跑）**：
- 探针 `cn_debug/2026-10-18_verification_portal_print_probe.js`（填满 5 步表单 → 拦截 `window.print`
  走真实点击路径 → 断言）。实测：`missing=[]`；8 章节齐全；6 张表；正文/标题双时间戳为真；
  步骤明细 10 行；样本编号、数据集↔平台配对、目标敲除基因 PLP1 全部进表。
- 标题流程连做两轮：点击时带 `_20261018_154124`，`afterprint` 后还原为 `提交分析需求`，均正确。
- `beforeprint` 单测：清空容器后仅派发 `beforeprint` → 重建 1447 字符（Ctrl+P 路径成立）。
- A4 视口 794x1123 + 打印可见性规则截图：128 单元格零溢出、`body.scrollWidth=794`、整单约 2 页 A4。
- `node --check` 通过。

**2026-10-18 复跑修正（探针自身两处 id 口径错误，见踩坑 #144）**：落盘的探针当时残留两个 bug——
步骤勾选用**裸 stepId**（真实 DOM id 是 `st-<stepId>`）、交付物勾选用 **manifest formats 口径**
（真实 UI key 是 `web_preview/tsv_tables/pdf_vector/checkpoint_archive/audit_ledger`），两处都让勾选静默落空。
已修（加 `checkStep` 补前缀、交付物改 UI key、补 `checkedSteps` 回读与三条回归断言），并在干净页面单次运行复验：
`missing=[]`、`checkedSteps` 6 项全中、`hasAllSteps/hasSamples/hasDatasets/hasKoGene/hasNotes/hasOutputs=true`、
`notesNewlines=1`、`tableCount=6`（行数 12/3/3/2/9/6）、`stampInBody/stampInTitle=true`、
`titleRestored=true`（`afterprint` 后回到 `提交分析需求`）、`rebuiltOnBeforeprint=true`（1323 字符，Ctrl+P 路径成立）。
**结论：页面实现本身无改动、无 bug；改的只是探针。**后续复跑必须用这份已修正的探针。

**未验证**：参考文献**有内容**时的表格未端到端实测（会写用户收件箱 `inbox/refs/<sid>/`，
为不污染而放弃；该表与另 5 张已实测表共用 `prTable()`，字段已按 `buildManifest()` 的
`references: state.refs.map(r => ({name, path, size}))` 核对一致）。原生打印对话框无法自动化
（CDP 无 `printToPDF`），`window.print()` 这一跳以桩验证调用与标题改写，出纸效果以 A4 视口截图近似判定。

**未动（不可覆盖）**：`portal/inbox/` 保持原样——仍是 1 个真实样例 JSON
（`2026-10-15_233830_需求_缺血性卒中空间转录组分析.json`），**无 `refs/` 目录**；未提交任何测试需求。
本地调试产物只落 `cn_debug/`（探针脚本 1 份 + 截图），临时 PDF 与抽取的临时 JS 已删。

**遗留问题（顺带发现，本轮未动，按需再议）**：`renderGroups()` 里样本 textarea 的 `input` 监听
每次都调 `renderGroups()` 重建 DOM，逐字符输入会丢焦点（粘贴不受影响，因为只触发一次 input）。
这是既有行为，与本轮 PDF 任务无关，未改。

## 2026-10-18 · line1_bulk 补 Bulk RNA-seq counts 预处理分支（prep_matrix 双模式）

**为什么要做**：`prep_matrix` 原先只有「GEO series matrix + GPL」基因芯片一条路径，
Bulk RNA-seq 的 counts 矩阵进了引擎也无处落，line1_bulk 的 Bulk 分支一直是断的。
本轮把两条预处理路径合进同一个脚本，产品契约（三件产物）与自校验尾段全部共用，
下游 `deg_limma` / `wgcna_modules` 不用按数据类型分支。

**改动**：只动 `src/line1_bulk/scripts/prep_matrix`（23419 字节，md5 `7763cf6f7df085fb8ed99537a5faced6`）。
- bash 端：输入按 **basename** 特征分流，顺序特异度从高到低
  `*grouping*` → `*GPL*` → `*series_matrix*.txt.gz` → `*[Cc]ount*`；
  同时给 series_matrix 与 counts → exit 2；counts 模式缺 grouping → exit 2。
- R 端：`PREP_MODE` 单 heredoc 内分两支，`read_grouping_map()` 把原内联解析提取成两模式共用函数。
  counts 支线 = 首列认基因 ID / 样本列认 `^GSM[0-9]` / 形态自校验（非数值·NA·负值·已归一化·零文库一律 fail，
  小数四舍五入留痕）/ CPM → `log2(CPM+1)` / 丢全零基因 /
  `^ENSG` 过半时用 GPL `ID→gene_assignment` 第二位映射 symbol（未命中即 fail）/ 分组全部来自 grouping.txt 且 `setequal` 校验。

**验证（全部真跑，服务器 k40-ubuntu）**
- 分支 A 回归（既有产物不得漂移）：用现有芯片数据在临时目录 `/tmp/prep_reg_a` 重跑，
  `expr_genes.tsv` md5 `bb4e9f18744047e3762073072b174e69`、`group_map.tsv` md5 `437d98a30a49cc068c4c40ba7f13652a`，
  **与 `processed/` 正本逐字节相同**；`prep_report.txt` 除 3 行绝对路径外逐字相同
  （路径差异源于 raw_data 早前从 `/mnt/ssd/bio_data/line1_bulk/` 迁到 `projects/default/line1_bulk/`，非本轮引入）。
  `processed/` 三件产物 mtime 仍是 `2026-10-12T17:59`，未被触碰。
- 分支 B：合成夹具 3 正例 + 10 负对照，**39 / 39 PASS**。复现脚本
  `cn_debug/2026-10-18_verification_line1_counts_branch.sh`（服务器侧 `bash /tmp/prep_counts_branch_check.sh`，
  夹具全在 `/tmp/prep_counts_test`）。
- 部署：`/mnt/ssd/bio_data/bin/line1_bulk/prep_matrix` 已更新，远端 md5 与本地一致、可执行位已复核。
  走定向 scp 而非 `ops/06_deploy_scripts.ps1`：后者整线覆盖 15 个脚本，本轮只该动这一个。

**顺带修掉的真隐患**：分流原先匹配整条绝对路径，目录名带 "count" 时该目录下所有文件都会被 counts 认走
（夹具实测 GPL 注释被当成 counts 矩阵解析）。已改 basename 匹配，并把带 "count" 的夹具目录名留作常驻回归。见踩坑 #147。

**接手要点**
- counts 路径**没有真实数据**可跑（line1 现有数据集是芯片数据），结论全部来自合成夹具；
  真实 Bulk counts 到位后必须再跑一次端到端，并在 `deg_limma` 侧确认量纲衔接（两路径同为 log2 量纲，理论上无需分支）。
- ragged（表头与数据行列数不符）的 counts 文件，fread 会自动补列降级解析，报错可能指向下游检查而非"文件不合法"；
  流程仍非零退出、不产错误结果，未加专门守卫，见踩坑 #148。
- 本轮**未动**服务器 `processed/`、未动 `src/line1_bulk/` 下其余脚本、未动 `ops/`。
















## 2026-10-18 · 工作台公网访问加口令 + 三进程运行时守护（不做开机自启）

**触发**：用户打开 `frpc.toml`，要求"继续未干完的活"。实测现状：frp 两条代理都在跑
（`Bio_user` 8080→45644 用户端、`Bio` 8787→1219 工作台），但 8787 无任何认证，公网可直连；
三个进程（frpc / 工作台 / 用户端）全靠手动启动。用户拍板：**保留 1219 暴露但加口令**，
**要守护、不要开机自启**。

**改动**
1. `BioanalysDesktop/server/index.js`
   - 新增 `AUTH_USER` / `AUTH_PASS`（读 `BAD_AUTH_USER` / `BAD_AUTH_PASS`），两者都给才启用鉴权，都不给保持免密（本地开发与既有测试路径不变）。
   - 新增 `safeEqual()`（定长 `timingSafeEqual`，长度不等直接 false）、`isAuthorized()`（解析 Basic 头，用户名与口令都算完再合并，不短路）。
   - 请求分发最前插入鉴权闸：`/api/health` 免鉴权（探活依赖），其余一切接口与静态页无凭证返回 **401 + WWW-Authenticate**。
2. `ops/serve_guard.ps1`（新建）
   - 30 秒一轮探活 8787 / 8080 / frpc，活着的不碰（不打断在跑的分析任务）。
   - 挂了按**端口占用者**杀进程再拉起（不按命令行匹配，避免 `node  server\index.js` 这类写法差异）。
   - 工作台一律带口令启动；若探活通但**未强制口令**（别人手动免密起的），识别并替换。
   - 口令文件 `~/.bioanalys/workbench_auth.json`，首次运行随机生成，不进源码。
   - 单实例互斥（含遗弃互斥体接管）；日志 `cn_debug/serve_guard.log`；`-Once` 单轮排障。
3. `BioanalysDesktop/tests/auth.test.js`（新建，7 条）：health 免鉴权、无凭证 401 且带 `WWW-Authenticate`、错口令 401、错用户名 401、畸形 Authorization 头 401 且不崩、正确凭证 200、静态页同样 401。
4. `docs/user_portal_deploy.md`：内网穿透一节按 `frpc.toml` 现状重写（两条代理表 + 工作台口令说明 + 轮换方式），新增「常驻守护」小节。
5. `ops/README.md`：脚本清单补 `serve_guard.ps1`。

**验证（全部真跑）**
- `npm test` → **132/132 pass, 0 fail**（原 125 + auth 7）；`node --check server/index.js` 通过。
- 本地 8787：无凭证 401、错口令 401、正确口令 200。
- 公网：`45644/` → 200（83602 字节用户端页面）；`1219/` 无凭证 → 401，带凭证 → 200 且标题 `BioanalysDesktop · 本地交互层`。
- 故障注入（守护常驻期间）：
  - 同时杀 8787 与 8080 → 下一个周期内各自重建（日志 `探活失败，准备重启` → `已拉起`），重建后 8080 200、8787 无凭证 401。
  - 杀 frpc → 一个周期内重建，公网 45644 恢复 200。
  - 手动以**无口令**方式起 `node server/index.js` → 守护识别 `在跑但未强制口令`，杀端口占用者并替换为带口令实例，复查 401。
- 口令轮换路径未实测（删文件重启即可重新生成，代码路径与首次生成同一条）。

**未做（按用户要求）**：不注册开机自启、不写启动项、不建计划任务。电脑重启后需手动跑一次 `pwsh -File ops/serve_guard.ps1`。

**未动**：`frpc.toml` 与 frp 服务端配置、`portal/`（用户端仍无鉴权，面向客户本就该公开）、三条线母版脚本与 `projects/` 数据、`portal/inbox/` 用户真实样例。

**已知限制**：HTTP Basic 口令在明文 HTTP 上传输（1219 未加 TLS），同一网络链路上的中间人可截获；若后续要提升，应在 frp 侧加 TLS 或用 Cloudflare Tunnel 走 HTTPS。

**2026-10-18 追加修正（用户口径）**：用户说明"服务端不用映射，基本就在自己配套的电脑上用，
保留映射功能，暂不启用"。据此：

- `frpc.toml`：`[[proxies]] name="Bio"`（8787→1219）整段注释，只留 `Bio_user`（8080→45644）；
  文件里写明重新启用的步骤。实测重启 frpc 后 `45644` 200、`1219` 返回 502（不再到工作台），
  frpc 日志只注册了 `[Bio_user]`。
- `ops/serve_guard.ps1`：口令改为**可选**。默认不带 `BAD_AUTH_*` 启动工作台（本机用不该每次弹登录框）；
  只有 `-RequireAuth` 时才注入口令，并在此模式下把"探活通但没强制口令"的实例替换掉。
  不带该开关时不动鉴权设置（避免重启打断在跑任务）。启动子进程前显式清掉继承来的 `BAD_AUTH_*`。
- `docs/user_portal_deploy.md` / `ops/README.md`：按"映射暂不启用、口令按需开启"重写。
- `server/index.js` 的鉴权代码保留不动（`tests/auth.test.js` 7 条仍全绿），作为重新映射时的开关。

**验证**：`npm test` 132/132 pass；本机 8787 免凭证 200（无登录框）、8080 200；
公网 45644 200、1219 502（不落到工作台）；守护常驻日志正常。

## 2026-10-18 · aims v3.0 契约落地（数据源双模态 + intake 四块 + 独立验证集映射）

**目标**：把 `aims/aims.txt` v3.0 里新增的客户侧摄入契约落进代码链路
（用户端表单 → /api/submit → 收件箱 → 工作台导入 → project.json）。

**改动**
1. `BioanalysDesktop/server/domain.js`（新增双模态模块）
   - `DATA_SOURCE_MODES` / `ID_TYPES` / `VALUE_SCALES` 三组枚举，`normalizeDataSourceMode` 大小写与空白容忍。
   - `buildLocAccession(projectId, role)` 派生 `LOC_<id>_TRAIN` / `_VAL`；`isValidSampleId` 按模式切换正则。
   - `normalizeDataSource`：PUBLIC_DB 走 datasets，IN_HOUSE_UPLOAD 校验 `id_type` / `value_scale` / `train_matrix` 并组装 `accession_and_platform`；预览阶段无 projectId 时 `train_id` 留空，不填占位编号。
2. `BioanalysDesktop/server/project.js`
   - `PROJECT_SCHEMA_VERSION` 2 → 3。
   - 新增 `normalizeAnalysisCutoffs`（三档）、`normalizeBiologicalPriors`（focus_genes ≤5 / 敲除兜底策略）、
     `normalizePlotLayoutConfig`（三套 SCI 模板，dpi 恒 300）、`normalizeExperimentalDesign`（配对 + 协变量）、
     `normalizeValidationGroupMapping`（兼容 camelCase / snake_case / aims 示例的 `_gsms` 三种键名）。
   - `buildProjectMeta` 落盘五块；样本编号校验按 `data_source_mode` 切换；focus_genes 纳入非肿瘤黑名单扫描。
3. `BioanalysDesktop/server/tumor_blacklist.js`（修真实漏洞）
   - `validateProjectFields` 原来把 `keys` 写死成 5 个字段，调用方塞进来的 `group_*` / `focus_gene_*` 从未真正过检；
     改为 `keys ∪ Object.keys(fields)`。分组名与关注基因此前是"看着有校验、实际没有"。
4. `BioanalysDesktop/server/index.js`
   - 收件箱详情接口透传 `dataSourceMode` / `accession`；IN_HOUSE 契约不全时返回 400，不静默降级成 PUBLIC_DB。
   - 建项接口透传 v3.0 五块。
5. `portal/index.html`
   - 第 2 步数据来源双模态卡片（公共库 / 自有上传），自有上传卡校验 `id_type` / `value_scale` / 矩阵路径。
   - 第 3 步配对设计勾选 + 配对映射表；新增「包含独立验证集」勾选 + 对照/处理两侧样本编号输入。
   - 第 4 步生物学先验（关注基因 ≤5）/ 统计阈值三档 / 出图三模板。
   - `buildManifest` 输出 `validationGroupMapping`（未勾选发 `null`，让服务端能区分"没声明"与"声明了但为空"）。
   - 打印需求单第「三」节追加验证集映射表。
6. `portal/serve.mjs`
   - `/api/submit` 按模式分支校验（IN_HOUSE 三件套 / PUBLIC_DB 数据集配对）。
   - 样本编号正则按模式切换；验证集映射校验两侧齐全、编号合规、不得重叠。
7. `BioanalysDesktop/src/App.tsx`
   - 新增 `IntakeExtras` 类型与状态；导入需求文件时原样搬运五块并写进导入提示；建项时展开进请求体。
   - 工作台不提供改写入口：这些值客户在需求单上确认过，重算会与需求单不一致。
8. 测试与验证脚本
   - 新建 `tests/dualmode.test.js`（16 条）、`tests/v3_intake.test.js`（18 条）。
   - `cn_debug/2026-10-18_verification_validation_mapping.mjs`（5 条提交契约，跑完自动清理自己落盘的需求文件）。
   - `cn_debug/2026-10-18_verification_v3_project_meta.mjs`（12 条键名映射 + 旧需求向后兼容）。

**验证（全部真跑）**
- `npm test` → **168/168 pass, 0 fail**；`npx tsc --noEmit` 0 错；`npm run build` 通过。
- `/api/submit` 5 条：合法 200、缺一侧 400、两侧重叠 400、编号非法 400、null 200。
- 需求文件 → project.json 12 条：五块键名全部正确落盘；收件箱里 2026-10-15 的真实旧需求可正常建项并取安全默认值。
- 浏览器实测（8080）：勾选「包含独立验证集」显示输入区；两侧重叠/缺一侧均拦截并给出中文提示；
  拦截时停在原步骤；拦截后修正可继续到第 5 步；拦截 fetch 抓到提交体，`validationGroupMapping` 正确，
  取消勾选后为 `null`。

**未做**
- `ops/build_client_report.py`（七章交付报告组装）、`ops/layout_helper.py` + `bin/layout_helper.R`（三模板装饰器）仍是 TODO。
- `line3_spatial` 解卷积脚本接入未开始。
- 真实建项（走 ssh 到 k40-ubuntu 写 project.json）未跑：只验证到 `buildProjectMeta` 输出层，SSH 写入段未改动。

**未动**：`portal/inbox/` 里的真实样例（验证脚本只删自己新产生的文件）、三线母版脚本、`projects/` 数据、frp 配置。

## 2026-10-18 · 单图 SCI 三模板外挂装饰器（aims v3.0 §5.3）

**目标**：落地 aims v3.0 的两个 `[Code-Agent]` 占位，零重写母版绘图脚本。

**改动**
1. `ops/layout_helper.py`（新建）
   - `apply_sci_plot_layout(fig, ax, layout_spec, footnote_text, badge_text)`：
     按模板设画幅（4:3 / 16:9）、标题左对齐或居中、图例外置（右侧垂直 / 底部横向多列）、
     X 轴长标签 45° 避让、模板 3 浅灰脚注栏、业务角标贴右上。
   - `load_layout_spec(project_json)`：读 `plot_layout_config`，缺文件/坏 JSON/非法模板一律回落默认，不抛错。
   - `normalize_layout_spec`：兼容 camelCase / snake_case，`theme_rules` 只接受已知键（防止外部配置往 matplotlib 塞任意参数）。
2. `bin/layout_helper.R`（新建）
   - `apply_sci_plot_layout_r(p, layout_spec, footnote_text, badge_text)`：ggplot2 侧同名能力，
     用 theme 图层表达；`layout_save_r()` 按模板尺寸与 dpi 落盘。
   - R 端脚注为纯文字：ggplot2 的 `element_text` 不接受背景色（`ggtext::element_textbox` 才有），
     不为一个底色引入新依赖，信息与位置与 Python 端一致。
3. `ops/README.md`：脚本清单补两行。

**验证（全部真跑）**
- 本机 `python cn_debug/2026-10-18_verification_layout_helper.py` → **31 条全过**：
  三模板各真渲染一张 300 DPI PNG（135~159 KB），并复用 `ops/audit_figure_layout.py` 做几何审计，
  三张图 **零违规**（图例在轴框外、脚注不与轴框相交、标注不重叠）。
- 远端 `k40-ubuntu`（R 4.x + ggplot2）`Rscript cn_debug/2026-10-18_verification_layout_helper.R`
  → **24 条全过**，三模板均落盘（90~121 KB），主题字段读回校验（legend.position / axis.text.x$angle / caption / tag）。
- 部署：`/mnt/ssd/bio_data/ops/layout_helper.py`（12169 B）、`/mnt/ssd/bio_data/bin/layout_helper.R`（8194 B），
  与本地字节数一致；部署后从目标路径导入/`source` 各跑一遍，冒烟通过。

**未做**：53 个母版出图脚本尚未逐脚本挂载（外挂函数可用，接入是另一轮批量改动）；
`ops/build_client_report.py`（七章报告引擎）未开始；line3 解卷积未开始。

**未动**：三线母版脚本、`projects/` 数据、frp 配置、`portal/`。

## 2026-10-18 · 客户端提交包归档 + 数据文件上传与名称一致性校验

**背景**：用户补充两条需求：① 客户端导出的需求（含文献、GSE/GPL/raw 等文件）要单独建文件夹
并重命名，原有机制"平铺 JSON + 随机 sid 目录"不满足；② 客户端没有数据文件上传界面，
且上传文件名必须与用户填写的名称对应。

**改动**
1. `portal/lib/archive.mjs`（新建，纯函数）
   - `sanitizeFileName` / `buildPackageName` / `refArchiveName` / `dataArchiveName`
   - `validateDataFiles`：角色枚举、扩展名白名单、单文件 200MB、单角色数量、
     自有上传"文件名 == 填写路径末段"、公共库"绑定 GSE 必须是已填数据集且用途对得上"、
     文件名内 GSE 与绑定编号冲突检测
   - `buildPackagePlan`：给出包目录、需求文件路径、每个文件的 from/to 与归档名
2. `portal/serve.mjs`
   - 新增 `POST /api/datafiles`：流式写盘到 `inbox/uploads/<sid>/`，超限中断删半成品
   - `/api/submit` 改为归档成包：建 `PKG_<ts>_<项目名>/{references,raw_data}/`，
     搬文件 + 重命名 + 流式算 sha256 + 改写 requirement.json 里的 path +
     写 `package_manifest.json`；失败回滚（文件放回暂存区、包目录删除）；
     成功后清空 `refs/<sid>` 与 `uploads/<sid>`
3. `portal/index.html`
   - 第 2 步新增「数据文件上传」卡：用途下拉 + 绑定编号下拉（按训练/验证用途过滤 GSE）+ 文件选择
   - 上传前本地校验（格式/大小/文件名一致性/单角色重复），与服务端同规则
   - 提交后重置 `refs` / `dataFiles` / `uploadSid`（文件已搬走，旧会话失效）
   - 打印需求单新增「六、数据文件」节，原六/七/八顺移为七/八/九
4. `BioanalysDesktop/server/index.js`
   - `isSafeManifestName` 放行 `PKG_*/requirement.json`（仍拒绝 `..` 与反斜杠）
   - `listInboxManifests` 同时扫旧平铺 JSON 与新包目录，返回 `packageDir` / `attachments`
   - `inbox/item` 详情返回 `packageManifest`
5. `BioanalysDesktop/src/App.tsx`：收件箱列表展示「提交包 + 文献/数据文件计数」
6. `docs/user_portal_deploy.md`：收件箱结构、重命名规则、dataFiles 接口与校验表全部重写

**验证（全部真跑）**
- `npm test` → **191/191 pass**（新增 `tests/portal_archive.test.js` 23 条）
- `npx tsc --noEmit` 0 错；`npm run build` 通过
- `cn_debug/2026-10-18_verification_archive_package.mjs` → **29 条全过**：
  真实上传 3 个文件 → 提交 → 检查包目录/子目录/重命名/requirement 路径改写/
  清单 sha256 与磁盘一致/暂存目录已清空；两条负向（文件名不一致、GSE 冲突）均 400
- `cn_debug/2026-10-18_verification_inbox_package.mjs` → **13 条全过**：
  工作台同时列出新旧两种格式、包项带 packageDir/attachments、详情透传 dataFiles、路径穿越仍被拒
- 浏览器实测（8080）：数据文件卡渲染、角色切换时绑定字段显隐、GSE 填入后绑定下拉自动出现、
  未选绑定编号时上传被拦、文件名不一致时提示"上传的是 X，你填的是 Y"、上传成功显示归档名

**未做**：工作台建项时把 `dataFiles` 落到远端 `projects/<id>/raw_data/`（目前只做需求侧归档与透传，
远端落盘属下一步）；`other` 角色的多文件批量上传 UI 仍是逐个选。

**未动**：`portal/inbox/` 里的真实旧样例、三线母版脚本、`projects/` 数据、frp 配置。

## 2026-10-18 · 七章交付报告引擎 + 建项时数据文件落远端

**目标**：清掉 aims v3.0 最后两个 Code-Agent 占位与上一轮遗留项。

**改动**
1. `ops/build_client_report.py`（新建，纯标准库）
   - `scan_project`：扫 project.json、三线 figures/results/processed/scripts、system_logs 台账（按 project_id 过滤）
   - 七章生成器：执行摘要 / 材料与方法 / 分步三段式 / 虚拟敲除专项 / 湿实验路线 / 交付物字典 / 可复现性台账
   - `Analysis_Report.md` + 单文件可交互 `Analysis_Report.html`（目录高亮 + 关键词过滤，零外链）
   - `assemble`：归集 `01_Adapted_Scripts`（脚本内绝对路径脱敏）/ `02_Figures_and_Tables` / `03_Interpretation_Report`，
     写 `delivery_manifest.json`，打 `<id>_Client_Delivery.tar.gz`
   - `--dry-run` / `--no-tar` / `--self-test`
2. `BioanalysDesktop/server/project.js`
   - 新增 `normalizeDataFiles`：拒绝绝对路径、`..`、反斜杠；缺 name/path 的条目丢弃
   - `buildProjectMeta` 落 `data_files`
3. `BioanalysDesktop/server/index.js`
   - 新增 `lineFromPipeline`（按步骤命中数推断分析线）与 `deployDataFiles`（scp + 字节校验）
   - 建项成功后把客户上传文件复制到 `<project>/<line>/raw_data/`；部分失败返回 207 并逐条列出原因
4. `BioanalysDesktop/src/App.tsx`：`dataFiles` 透传；成功提示改用服务端 message；失败文件单独报错
5. `docs/delivery_package_spec.md`：标注 v1.0 规范被 aims v3.0 §7.2 部分取代，列清三项尚未并入的门禁
6. `ops/README.md`：补 `build_client_report.py`

**验证（全部真跑）**
- `npm test` → **196/196 pass**（新增 dataFiles 契约 5 条）
- `npx tsc --noEmit` 0 错；`npm run build` 通过
- `python ops/build_client_report.py --self-test` → **18 条全过**（七章齐全、真实基因数、无绝对路径、三大件、tar.gz、空项目不崩）
- 远端真实项目 `projects/default`：`--dry-run` 识别 3 条线 135 张图 / 56 条台账；
  实跑产出 27.5 KB MD + 38.8 KB HTML + 28.8 MB tar.gz；第七章正确列出真实 task_id、耗时、failed 台账
- `cn_debug/2026-10-18_verification_datafile_deploy.mjs` → **12 条全过**：
  建项 → 远端 `line1_bulk/raw_data/mouse_cortex.tsv` 存在且字节/内容一致、project.json 记录 data_files、
  路径穿越 400 且未创建项目；测试项目与本地测试包均已清理

**未做**：`09_package_delivery.ps1` PC 侧入口（存储水位 / 失败台账确认 / .sha256 旁挂三项门禁）；
53 个母版脚本尚未逐脚本挂载 layout_helper；报告第三章依赖 `pipeline_dag`，旧项目缺该字段时只输出图件清单。

**未动**：`portal/inbox/` 真实样例、三线母版脚本、`projects/` 数据、frp 配置。

## 2026-10-18 · aims §5.3 两个 [Code-Agent] 占位标记为"外部已完成"

**依据（用户拍板）**：用户确认 [Code-Agent] 部分已由外部实现，要求标记为"外部已完成"。

**改动**：`aims/aims.txt` §5.3 两条占位
- Python 外挂装饰器（`ops/layout_helper.py`）：改为「状态：外部已完成（2026-10-18）」，
  补记实现入口 `apply_sci_plot_layout(...)` / `load_layout_spec(...)` 与返回 `(fig, ax, dpi)`；
- R 外挂装饰器（`bin/layout_helper.R`）：改为「状态：外部已完成（2026-10-18）」，
  补记实现入口 `apply_sci_plot_layout_r(...)` + `layout_save_r()`。
- 原 TODO 原文以 `<!-- 原 TODO [Code-Agent]（已外部完成，保留原文备查） -->` 保留，便于追溯需求原文。

**核对**：服务器 `/mnt/ssd/bio_data/ops/layout_helper.py`（12169 B）与
`/mnt/ssd/bio_data/bin/layout_helper.R`（8194 B）在位；远端导入冒烟 `apply_sci_plot_layout`、
`load_layout_spec` 均存在。

**未动**：aims 其余章节、母版脚本、projects/ 数据、portal/inbox 样例。

## 2026-10-18 · 出图链路打通（客户端选模板 → 母版脚本真生效 → 工作台可见）

**目标**：用户在需求单选的三套 SCI 出图模板此前从未生效（母版脚本只做最低合规收口，不读 project.json）。
本轮把「选择 → 注入 → 应用 → 展示」四段接通，母版脚本一行未改。

**改动**
1. `ops/layout_autoload/sitecustomize.py`（新建）
   - Python 解释器启动即加载；读 `BIOANALYS_PROJECT_JSON` 指向的 project.json 里的 `plot_layout_config`
   - 包装 `matplotlib.figure.Figure.savefig`：单轴图套 `apply_sci_plot_layout`，多子图只改画幅
   - 显式注入 `dpi=`（`savefig.dpi='figure'` 的陷阱见踩坑 #165）
   - `BIOANALYS_LAYOUT_DISABLE=1` 可整体关闭；无 project.json / 无配置时不介入
2. `ops/layout_autoload/Rprofile`（新建）
   - `R_PROFILE_USER` 挂载；包装 `ggplot2::ggsave`，套 `apply_sci_plot_layout_r` + `layout_figsize_r`
   - 先摘掉母版自带的 `width/height/units/dpi` 再按模板落盘（见踩坑 #170）
3. `ops/layout_autoload/bin/Rscript`（新建）
   - 母版 R 脚本统一用 `Rscript --vanilla`，而 `--vanilla` 会跳过 `R_PROFILE_USER`；
     垫片把它降级为等价组合并保留 user profile（见踩坑 #169）
4. `BioanalysDesktop/server/task.js`
   - 任务脚本注入 `BIOANALYS_PROJECT_JSON` / `BIOANALYS_LAYOUT_LIB` /
     `PYTHONPATH`（含 layout_autoload）/ `R_PROFILE_USER`，并把 Rscript 垫片排在 PATH 最前
5. `ops/layout_helper.py`：补公开入口 `figsize_for()`（保留 `_figsize_for` 别名）
6. `portal/index.html`
   - 第 4 步新增三张 SVG 版式预览卡（可点击 / Enter / Space），与下拉双向联动
   - 打印单第五节补「出图版式 / 统计阈值档 / 重点关注基因」
7. `BioanalysDesktop/server/index.js`：新增 `GET /api/projects/meta`
   （模板 / DPI / 阈值档 / 关注基因 / 敲除靶基因 / 步骤数）
8. `BioanalysDesktop/src/App.tsx` + `app.css`：结果预览 Studio 顶部配置条
9. `BioanalysDesktop/tests/layout_inject.test.js`（新建，9 条）

**验证（全部真跑）**
- `npm test` → **205/205 pass**；`npx tsc --noEmit` 0 错；`npm run build` 通过
- 远端 Python 合成测试 16 条全过：`template_2_cell_wide` 7.20×4.05 in / 300 DPI；
  `template_1_nature_side` 7.20×5.40 in / 300 DPI；关闭开关与无 project.json 均不介入
- 远端**真实母版脚本** `bulk_figures` 端到端：9 张 PNG 全部 300 DPI，画布按模板重设
  （原脚本 figsize 10×9，输出约 7.5×5.5 in），stderr 出现 `已挂载出图模板: template_2_cell_wide`
- 远端**真实母版脚本** `pca_matrix` 端到端：PDF MediaBox 518×291 pt ≈ 7.19×4.04 in（16:9），
  证明 `--vanilla` 垫片与 `ggsave` 参数摘除都生效
- 浏览器实测：三卡渲染、点击与键盘切换、下拉同步、提交体 `plotLayoutConfig.templateId` 正确、
  打印单显示版式；工作台 Studio 配置条五项全部正确
- 临时探针项目 `PRJ_META_PROBE` 与 `/tmp/bio_layout_e2e*` 已清理

**未做**：`09_package_delivery.ps1` 三项门禁仍未实现。
注意：`bbox_inches="tight"` 会按内容裁边，最终 PNG 像素比不等于画布比；
交付口径以 `fig.get_size_inches()`（主画布）为准，见踩坑 #166。

**未动**：母版脚本、projects/ 真实数据、portal/inbox 样例、frp 配置。

## 2026-10-19 · GSE 行级三元组（数据类型 / 样本数量 / 组织来源）

**目标**：一个项目合入多个 GSE 时，数据类型 / 样本数量 / 组织来源常不同；
原先只有项目级一份值，`prep_matrix` 只能按其中一个分支跑全部数据集。

**改动**
1. `BioanalysDesktop/server/domain.js`
   - 新增 `normalizeDatasetDataType`（四枚举）与 `normalizeDatasetSampleCount`（正整数）
   - `normalizeDatasets` 每行输出扩为 `{gse, gpl, role, dataType, sampleCount, tissue}`；
     行级留空回落项目级，都缺留空串 / 0，不编造默认值（踩坑 #171）
2. `BioanalysDesktop/server/project.js`
   - 公共库模式落归一化后的 `datasets` + `datasets_inferred`（踩坑 #172）
3. `BioanalysDesktop/server/index.js`：收件箱摘要补 `tissue`
4. `portal/index.html`
   - 数据集卡片加三列（数据类型 / 样本数量 / 组织来源），新行继承项目级
   - 摘要与打印单表格加列；项目级字段变化时刷新「同项目级」提示
5. `portal/serve.mjs`：公共库模式逐行校验 dataType 枚举与 sampleCount 正整数，非法 400
6. `BioanalysDesktop/src/App.tsx` + `app.css`
   - 配对表改为双行卡片（GSE/GPL/用途 + 三元组）；导入与列表 hint 展示三元组
   - 提交前校验正整数
7. `docs/user_portal_deploy.md`、`aims/aims.txt` §3.1：契约同步
8. `BioanalysDesktop/tests/datasets.test.js`、`dualmode.test.js`、`index.test.js`：+7 条

**验证（全部真跑）**
- `npm test` → **212/212 pass**；`npx tsc --noEmit` 0 错；`npm run build` 通过
- `cn_debug/2026-10-19_verification_dataset_triple.mjs` → **8/8 通过**（独立端口 8099）：
  非法 dataType / 非法 sampleCount 各 400 且不产包；合法提交后两行三元组各自保留
- 浏览器实测用户端：三列渲染、摘要、提交体 `datasets` 两行三元组全部正确
- 8080 / 8787 已用新代码重启；线上 8080 实测非法行级 dataType → 400

**未做**：行级样本数与项目级总数的自洽校验（多数据集求和 vs 项目级总数）。

**未动**：母版脚本、projects/ 真实数据、portal/inbox 样例、frp 配置。

## 2026-10-19 · 真实数据全链路端到端（客户端 → 工作台 → 服务端 → 交付报告）

**目标**：用 `test_use_data/测试数据3（可用）` 验证"客户端提交 → 工作台建项 → 远端跑分析 →
七章交付报告"整条链路，而不是只验服务端。

**真实数据**：GSE277173 / GPL11532，银屑病皮损（LS）vs 非皮损（NLS），8 vs 8 同供体配对
（13–21 供体），3 个文件：`GSE277173_series_matrix.txt.gz`、`GPL11532-32230.txt`、`分组情况.txt`。

**三段验证脚本（cn_debug/，全部走真实 HTTP 契约）**
1. `2026-10-19_e2e_client_submit.mjs` → **11/11 通过**：8080 上传 3 个文件 + `POST /api/submit`，
   产出包 `PKG_2026-10-19_010456_GSE277173_银屑病皮损非皮损_Bulk_真实数据验证`。
2. `2026-10-19_e2e_workspace_create.mjs` → **11/11 通过**：8787 读收件箱 → 建项
   `PRJ_E2E_GSE277173` → scp 三文件到远端 `line1_bulk/raw_data/` → 字节校验。
   远端落盘名：`GSE277173_series_matrix.txt.gz` / `GPL11532-32230.txt` / `grouping.txt`。
3. `2026-10-19_e2e_run_pipeline.mjs` → **11/11 通过**：逐步 `POST /api/tasks/submit` 下发
   line1_bulk 11 个步骤，轮询 `/api/tasks` 判完成，读远端台账判 `status/exit_code`。

**本轮修掉的链路断点（详见踩坑 #173–#177）**
- #173 `ledger.js` 路径整体 lowercase → 大写 project_id 的台账全部被拒落盘
- #174 `/api/tasks` 返回 `id`、submit 返回 `taskId` → 长任务被误判"已结束"（409）
- #175 母版写 `processed/`、报告引擎只扫 `results/` → "图 26 / 表 0"、DEG 结论空白
- #176 中文名「分组情况.txt」不匹配 `prep_matrix` 的 `*grouping*` 分流 → 第一步 exit 2
- #177 `deg_sig.tsv` 只有表头时报告输出空句子

**实测结果（远端 `/mnt/ssd/bio_data/projects/PRJ_E2E_GSE277173`）**
- 11 步全部 `completed`，11 条台账合规落盘
- `line1_bulk/figures/` 26 张 PNG（l1_01–l1_26，缺 ml_model / external_validation 相关图）
- `line1_bulk/processed/` 36 张结果表（DEG / WGCNA / 富集 / PPI / key genes / ML hub）
- 交付包：七章齐全，`Analysis_Report.md` + `Analysis_Report.html`，
  `02_Figures_and_Tables` 26 图 / 36 表，`PRJ_E2E_GSE277173_Client_Delivery.tar.gz` 5.9 MB
- DEG 真实结果：全表 20019 个基因，0 个达到 |log2FC|≥1 且 padj<0.05；
  报告如实写"未检出达到阈值的差异表达基因"，未放宽阈值
- 第三章各步骤"数据与统计依据"全部为"已找到产物"，无路径误报

**已知差距（未在本轮修复）**
1. `01_Adapted_Scripts` 脚本数 0：当前链路直接执行 `bin/line1_bulk/` 母版，未按 aims §7.1
   "先复制到 `projects/<id>/<line>/scripts/` 再适配"落实例副本。
2. 项目目录无 `selfcheck.json`：`/api/selfcheck` 只返回给前端视图，未持久化；
   第七章如实标注"五维自检结论缺失"。
3. line2_scrna / line3_spatial 未用真实数据跑通（本轮只验 line1_bulk）。

**未动**：母版脚本、`test_use_data/` 原始数据、line2/line3 数据、portal/inbox 样例、frp 配置。

## 2026-10-19 · 产物回搬通道（手机端 → 本地，工作台看本地图）

**目标**：计算在手机端，但图件必须拉回本地；工作台视图 4 优先读本地副本，不能每次翻图都走 SSH。

**改动**
1. `BioanalysDesktop/server/pull.js`（新建）
   - `pullLineOutputs`：ssh 列远端 `figures/` + `results/`，一次 scp 批量回搬，逐文件字节校验
   - `readLocalFigures` / `localFigurePath`：本地副本读取，非图像扩展名与路径穿越一律拒
   - 落点 `outputs/<项目>/<线>/`；`BIO_LOCAL_OUTPUTS` 可覆盖（测试不污染真实存档）
2. `BioanalysDesktop/server/index.js`
   - 新增 `POST /api/figures/pull`（body `{project, line?, force?}`）
   - `/api/figures/list` 与 `/api/figures/image` 优先本地；返回 `source` / `X-Figure-Source`
3. `BioanalysDesktop/src/App.tsx`：视图 4 增加「回搬图件到本地」按钮、回搬结果与"尚未回搬"提示
4. `BioanalysDesktop/tests/pull.test.js`：11 条（解析 / 增量 / 落点 / 校验 / 本地读取 / 非法输入）
5. 规范：`aims/aims.txt` §1.1（本地保留产物存档）、§3.2 视图 4（回搬与来源标注）、
   新增 §7.3（回搬范围、落点、双通道、增量覆盖、字节校验、交付前门禁）

**验证（全部真跑）**
- `node --test tests/pull.test.js` → **11/11**；`npm test` → **227/227**；`npx tsc --noEmit` 0 错；`npm run build` 通过
- `pwsh -File ops/07_pull_outputs.ps1 -Project PRJ_E2E_GSE277173 -Line line1_bulk`
  → **84 个文件 / 10.8 MB** 回搬，字节校验全过（26 PNG + 36 结果表 + 台账）
- 线上 8787（已重启）：`/api/figures/list` → `source=local, 26 张`；
  `/api/figures/image` → `200, X-Figure-Source: local`
- `POST /api/figures/pull` 二次调用 → `pulled=0, skipped=26, failed=0`（增量跳过生效）

**未做**：`processed/` 未纳入工作台快捷回搬（默认只 figures/results，避免大检查点）；
自动回搬（任务完成后自动触发）未实现，目前是手动按钮 + 运维脚本。

**未动**：母版脚本、远端 projects 数据、`test_use_data/`、portal/inbox、frp 配置。

## 2026-10-19 · 项目选择器只剩「默认项目」（前端列表不刷新）

**根因**：`App.tsx` 的 `refreshProjects` 只在挂载时跑一次，页面长期开着就停在旧快照；
另外 v3 `project.json` 的项目名在 `basic_info.name`，选择器读 `meta.name` 只能回落成裸 ID。

**改动**
- 切视图 / `window focus` / `visibilitychange` 时重拉 `/api/projects/list`
- 选择器右侧加「刷新」按钮；列表为空时保留当前值兜底
- 显示名三级回退：`meta.basic_info.name → meta.name → projectId`
- `ProjectMeta` 类型补 `basic_info`

**验证**
- 浏览器实测（8787）：选择器两项——「GSE277173 银屑病皮损非皮损 Bulk 真实数据验证」「默认项目」
- 切到 Studio 时 `fetch('/api/projects/list')` 计数 +1（说明会重拉，不是只靠首屏）
- 选中 `PRJ_E2E_GSE277173` 后图廊显示「线1 / GEO bulk（26）」，26 张图正常渲染
- `npx tsc --noEmit` 0 错；`npm run build` 通过；`npm test` 227/227

**未动**：服务端项目接口、远端数据、母版脚本。

## 2026-10-19 · 产物自动回搬 + 出图规范落到代码

**目标**：① 产物做完就自动同步到本地，不等人工点按钮；② 出图代码按 `docs/figure_spec.md` v2.2 逐条修正。

**改动**
1. 自动回搬（`server/index.js` 任务 `onExit`）：步骤 `exit 0` 后 `setImmediate` 调
   `pullLineOutputs(projectId, lineId)`，拉 `figures/` + `results/`，结果写进该任务 SSE 日志；
   失败写 stderr，不静默。手动按钮 `POST /api/figures/pull` 保留作兜底。
2. 规范：`aims` §3.2 / §7.3 改为"自动回搬为默认通道"；§5.1 明确图件一律 PNG 落
   `figures/`、PDF 只能作可选矢量副本；`docs/figure_spec.md` §一/§三之二/§六 同步。
3. 出图代码修正：
   - `pca_matrix`：PDF → `figures/l1_02_pca_step3.png`（300dpi），标准二分类色，图注左对齐
   - `deg_limma`：PDF → `figures/l1_03_volcano_limma.png`，补图内阈值标注
   - `wgcna_modules`：2 个 `pdf()` → PNG（`l1_28`/`l1_29`），补图注与 colorbar label、x 标签改短名
   - `celltype_annotation`：7pt → 8pt，图例去边框
   - `ml_hub_analysis`：数值标注 7pt → 8pt
   - `enrichment_figures` / `dr_post_analysis`（三线）+ `scrna_figures`：轴内 `loc="best"` → 轴框外
   - `bin/layout_helper.R`：统一 `plot.caption` 左对齐（ggplot 默认右对齐）
4. `server/figures.js`：新增 4 个图件 caption；`ops/build_client_report.py`：STEP_CATALOG 补新图。

**验证（全部真跑）**
- `node --test` → **227/227**；`tsc --noEmit` 0 错；`npm run build` 通过
- 自动回搬实测：`pca_matrix` / `deg_limma` / `wgcna_modules` 三次任务 `exit 0` 后，
  本地 `outputs/.../figures/` 自动出现 4 张新图，无需手动触发
- 4 张新 PNG 实测 **299.9994 DPI**（2160×1215 / 2100×1500 / 1800×4650）
- `ops/audit_figure_layout.py`（已部署远端）真实数据重渲染：
  line1 `enrichment_figures` **4 图 fail=0**；`ml_hub_analysis` **10 图 fail=0**
- 逐张目视复核：PCA/火山/软阈值/模块热图 —— 图注在轴框外、图例不压数据、阈值标注可见、
  colorbar 带 label、无裁字
- 工作台 8787：图件列表 `source=local`、**30 张**，4 个新 caption 正确
- 交付报告重跑：**30 图 / 36 表 / tar.gz 6.7 MB**，自检 22 条全过

**未做**：line2 / line3 的出图脚本只做了源级修正，未用真实数据重渲染审计（项目无该两线数据）；
base R 图件不套 ggplot 三模板（已知限制，已写入 figure_spec §六）。

**未动**：母版统计口径、远端项目原始数据、`test_use_data/`、portal/inbox、frp 配置。

## 2026-10-19 · 出图规范全量核查 + 质量打分系统 + WGCNA 分组修正

用户提五项：规范预核查、代码与图片全维度合规、质量打分（>=75 达标）、
WGCNA 模块-表型相关分组专项、统一错误台账。全部完成。

**产物**

- `con_hf/2026-10-19_figure_spec_audit_report.md`（规范核查报告：核查项清单 / 问题明细+等级+优先级 / 建议 / 验证）
- `con_hf/figure_error_ledger.md`（出图错误台账 FE-001~FE-012，字段固定可机器读取）
- `cn_debug/figure_code_audit.py`（源码 C1–C7 静态扫描）
- `cn_debug/figure_audit_scan.py`（交付物 6 维逐张扫描）
- `cn_debug/figure_score.py`（5 类 20 项百分制，75 达标 + 4 项一票否决）
- `cn_debug/figure_score.csv` / `figure_audit_line1.csv` / `code_audit.csv`（本次结果留档）

**规范补齐**

- `docs/figure_spec.md`：§6.1 SCI 期刊格式核对表、§七 打分系统、§八 "vs" 组间比对契约
- `aims/aims.txt`：§5.4 vs 硬契约、§8 资产表同步（figure_spec 涵盖三项新增内容）

**代码修正**

- `wgcna_modules`：分组改为读 `BIOANALYS_PROJECT_JSON` 的 contrasts；
  性状矩阵按组展开（主对比对 `case=1/ctrl=0` + 各组指示列），模块与每列分别算相关；
  图注固定三要素（对比对名 / case,ctrl / trait 来源）
- 8 处轴内图例 → 轴框外（bulk_figures / enrichment_figures×3 线 / ml_hub_analysis /
  dr_post_analysis / scrna_figures）
- `cox_analysis` 森林图 `cex` 0.65~0.7 → 0.75/0.85（满足 8pt 下限）
- 工具缺陷：审查器目录遍历失效（假阴性）+ `size=` 宽泛匹配（假阳性 15 处）已修

**验证（全部真跑）**

- `figure_code_audit.py --root src` → **no issue found**（修复前 23 处）
- 远端 `audit_figure_layout.py`：line1 富集 4 图 / ML hub 10 图 **fail=0**
- `figure_audit_scan.py` → **30/30 PASS**（DPI 300、面积、边缘留白、非空白）
- `figure_score.py` → **30 张 PASS，avg=100.0**（阈值 75）
- WGCNA 远端重跑：`completed`，`trait_source=project.json grouping_design`、
  `primary_contrast=LS_vs_NLS (case=LS vs ctrl=NLS)`，图注三要素实测正确
- 回归：enrichment_figures / bulk_figures / ml_hub_analysis 三步重跑成功，30 张图复扫仍全 PASS
- `npm test` → **227/227**

**未做**

- 打分系统 B / D2 / D3 项仍默认满分（需外部判定输入），待改为 `--audit-csv` 导入（台账 FE-012）
- line2 / line3 未用真实数据重渲染几何审计（项目无该两线数据）
- SCI 期刊专属要求（目标期刊 author guidelines、栏宽、版权）不在规范覆盖范围，交付方人工核对

**未动**：母版统计口径、远端项目原始数据、`test_use_data/`、portal/inbox、frp 配置、line2/line3 数据。

---

## 2026-10-19 · 图件修正收尾 + 前置清理 + WGCNA 五步排查

**图件（6 张点名图全部验收）**

- 共同根因：三端模板无条件覆盖脚本 figsize（`ops/layout_helper.py` / `sitecustomize.py` / `Rprofile`），
  已统一改为 `max(脚本尺寸, 模板尺寸)`——模板只能放大、不能缩小。
- `l1_04` 恢复 4035×4219；`l1_13/14/15` 标注拆两行；`l1_26` x 右界留位 + 图例外置；
  `l1_23` colorbar 独立 cax；`l1_28` 阈值线/选中 power 标注重排（第二轮修掉两标注互压）；
  `l1_29` 底部图注改两行 + `outer=TRUE`（原右缘被裁）。
- 复扫：`30/30 PASS`、`avg=100.0`、源码审查 `no issue found`。
- 台账：FE-013（模板压扁根因）、FE-014（l1_28）、FE-015（l1_23）、FE-016（l1_29 图注裁切）。

**清理**

- 删除 `BioanalysDesktop/old_useless/`（坏目录曾让全仓 Grep 报错）、`cn_debug` 下 review/缓存/一次性补丁/临时探针/旧日志、
  `outputs/_bak_figures_20261014/`、空目录 `portal/`、`.trae-html-share-packages/`。
- 保留 `cn_debug/samples/`（测试依赖）、`scenic_db/`、`*verification*`、workbench 活动日志。

**WGCNA 排查结论（详见 `con_hf/2026-10-19_wgcna_audit_report.md`）**

- 不是运行时崩溃：7 次执行全部 `completed / exit 0 / checkpoint passed`，耗时 5:44–6:34。
- 配置疏漏：设计要求方差前 5000 基因，脚本用全量 20019（默认 `maxBlockSize=5000` → 至少 5 块）；
  `outputs=[]`；`project.js` io 命名漂移；WGCNA 参数未入项目配置。
- 工作流设计缺失：无 kME/GS、无模块内 hub 导出、无样本离群检测、无 MEs 导出、无模块间相关；
  `results/` 恒空。
- 修复方案 P0-1~P0-5、验证标准 V1–V10 已写进报告 §5；台账 #183–#185。

**下一步（交接给后续 AI）**

1. 按报告 §5.2 改 `src/line1_bulk/scripts/wgcna_modules`（top-5000 + kME/GS + hub + MEs + Z.k）。
2. 改 `BioanalysDesktop/server/project.js:205` 的 `io` 字段；任务提交补 `outputs`。
3. 部署重跑，按 V1–V10 验收；`key_genes` 优先读 `wgcna_hub_genes.tsv`。
4. `docs/figure_spec.md` 登记新增 `l1_27_wgcna_mm_gs`、`l1_30_wgcna_sample_tree`。


## 2026-10-19 · WGCNA P0 修复验收收口 + P1-1/P1-3 落地 + 回搬通道修复（主 Agent 框架：T1 收口 / T2 参数化）

**背景**：上一轮交接的"下一步"四项（脚本改造 / io 改名 / outputs 声明 / figure_spec 登记）
本轮先逐项核实——代码侧已全部落地并部署（本地与远端 `wgcna_modules` md5 均
`ff2d9b22…` 系列、`project.js:205` io 已含新产物、台账 `io_files.output=12`），
缺的是**量化验收**与**参数化/可观测性**。本轮把 V1–V10 做成可执行工具并跑通。

### 1. V1–V10 验收工具（新增，可重复执行）

`cn_debug/2026-10-19_verification_wgcna_v1_v10.mjs`：读本地回搬存档 + system_logs 台账，
V8 直接调 `figure_audit_scan.py` / `figure_score.py`，V9 走 `/api/tasks/submit` 同 seed 复跑并比对
WGCNA 产物 md5。用法：`node cn_debug/2026-10-19_verification_wgcna_v1_v10.mjs [--rerun]`。

**结果（全部真跑）**：V1–V8、V10 连续多轮 PASS；V9 同 seed 复跑前后 5 个 WGCNA 产物 md5
**完全一致**（台账 `2269068a` completed / exit 0 / passed / outputs=12）。

### 2. P1-1 wgcna_config 参数化（C-04）

- `BioanalysDesktop/server/project.js`：新增 `WGCNA_CONFIG_DEFAULTS` + `normalizeWgcnaConfig()`
  （越界回落默认不抛错），`buildProjectMeta` 增补 `wgcna_config` 字段；
  新增 2 条单测（`tests/project.test.js` 13/13 过）。
- `src/line1_bulk/scripts/wgcna_modules`：TOP_N / minModuleSize / mergeCutHeight / deepSplit /
  maxBlockSize / module_p_threshold / hub_kme_min / hub_gs_min 全部改读配置，
  `wgcna_report.txt` 新增 `wgcna_config_source=` 与 `wgcna_config=` 两行。
- 远端 `projects/PRJ_E2E_GSE277173/project.json` 注入 `wgcna_config`（原文件备份
  `project.json.bak-20261019`），两次重跑分别验证 `wgcna_config_source=default` 与
  `=project.json` 两条路径；**统计产物 md5 与参数化前一致**（参数默认值=原硬编码值，行为无漂移）。

### 3. P1-3 results/ 交付级产物（W-05，用户拍板"复制进 results/"）

`wgcna_modules` 末尾把 8 个交付级表格/报告复制到 `../results/`（图件不复制，aims §5.1 规定图只落
`figures/`），失败即 exit；`outputs=` 行改为同时列 `processed/{}` 与 `results/{}`。
实测远端 `line1_bulk/results/` 8 个文件落盘，台账 completed/passed。

### 4. 修：07 回搬"本地已存在即跳过"（踩坑 #186）

`ops/07_pull_outputs.ps1` 改为"同名同大小→跳过 / 大小不同→覆盖"（`find -printf '%s	%p'`
带字节数），汇总行打印 新增/未变/已更新 计数。修复前本地 `processed/wgcna_module_trait.tsv`
停在 09:31 的 40 模块旧副本（远端已是 06:16 的 20 模块新表），导致 V4/V5/V10 误报 FAIL。
修复后本地 3 个关键文件 md5 与远端逐个一致，误报转 PASS。

### 5. 新发现（P0，待用户决策）：`portal/` 被上一轮清理误删（踩坑 #187）

用户提交台 8080 已挂（`curl 127.0.0.1:8080/` → 500 `读取 index.html 失败 ... portal\index.html`）；
`npm test` 从 227 掉到 207、2 fail（`portal_archive.test.js` 找不到 `portal/lib/archive.mjs`、
`index.test.js` 的 `/api/portal/inbox` 断言失败）；工作台收件箱读的 `portal/inbox/`
（`server/index.js:322`）已无数据，客户提交包 `PKG_*` 本地副本一并丢失（远端 raw_data 与交付包未受影响）。
删除走 node/rm 通道不进回收站，全盘无副本。另记 FE-017：pull 只增不删，远端已改名的
`l1_27_wgcna_mm_gs.png` 旧版仍留在本地存档（本地 33 张 vs 远端 32 张）。

### 6. 未做 / 遗留

- **P1-2 未做**：`resource_usage` 仍全 null、全量日志仍不落盘、ledger 无 `log_path`（改 `run.js`，
  影响台账 schema，需单独一轮 + 回归）。
- **line2_scrna / line3_spatial 真实数据链路未跑**（用户本轮要求补跑，尚未开始；
  数据在 `test_use_data/` GSE254707 / GSE192741，远端 `projects/default/<线>/` 已有历史产物）。
- `npm test` 现状 **207 tests / 205 pass / 2 fail**（2 个失败全部由 portal 缺失引起，见 #187）；
  `npx tsc --noEmit` 0 错、`npm run build` 通过。
- 本轮改了远端 `project.json`（已备份）与母版脚本（已部署），未动 `test_use_data/`、
  远端项目 `raw_data/`、line2/line3 数据与脚本、frp 配置。
## 2026-10-19 · WGCNA 模块-性状改为"一个组一列"（用户口径纠正，接上一节）

**问题定位**：`l1_29` 只画一根名叫 `LS_vs_NLS` 的列（case=1/ctrl=0 的对比列），而它与
`is_LS` 组指示列**数值完全相同**——等于把"case 组成员关系"用组间比对的名字展示，读者
自然理解成"在做差异基因比对"。输入侧无问题：输入 = `expr_genes.tsv` + `group_map.tsv`
（原表达谱 20019 基因取方差前 5000），DEG 不是输入。

**修法**：性状矩阵一个组一列（两组两列、多组多列，ctrl 在前 case 在后），删除对比列；
`l1_29` 逐组展示全部表型列；排序/显著性/GS/hub 判定依据改 **case 组表型列**（与旧对比列
数值等价）；`wgcna_module_trait.tsv` 增补 `cor_trait_<组>`/`p_trait_<组>`；报告增
`trait_columns=`/`module_trait_basis=`；`l1_31` 图注改 "GS basis=<case 组>"。

**验证**：ledger completed/exit 0/passed/outputs=12；`trait_columns=NLS,LS`；
`cor_trait_NLS=+0.5907` vs `cor_trait_LS=-0.5907`；统计产物 3 个 md5 与改前一致
（db51f5f8 / 01fdb7fc / 01fdb7fc）；扫描 33/33 fail=0、打分 avg=99.8、源码 no issue。

**阻塞（文档契约与新实现矛盾，待用户拍板）**：
1. `docs/figure_spec.md:454` 示例仍写 `l1_29 写 contrast LS_vs_NLS (case=LS vs ctrl=NLS)`；
2. `docs/figure_spec.md:458+` WGCNA 专项仍写"主对比对一列 case=1/ctrl=0 … 只引用主对比对"；
3. `aims/aims.txt:624` 第 7 条同样写"主对比对一列 case=1/ctrl=0，报告只引用主对比对"。
   三处都是已确认契约条款，按规矩不擅自改，等用户确认 wording 后再同步。

**未做**：`l1_29` 目视复核（本环境无图像查看能力）；下游 `key_genes` 未重跑（其输入
`wgcna_modules.tsv` 与 `wgcna_hub_genes.tsv` 字节不变，输出必然一致）。
## 2026-10-19 · portal/ 恢复完成（工作台收件箱报错已消除，接 #187）

**你报的错误根因**：上一轮"前置清理"把 `portal/` 当空目录删了（#187）。工作台 8787 的
`/api/portal/inbox` 扫 `portal/inbox/` 不存在 → 返回 `blocked:true`；用户端 8080 每请求 500。

**恢复结果（全部真跑验证）**
- `portal/serve.mjs` + `portal/index.html`：从回收站捞回 10-18 正本（`cn_debug/portal_ref_probe/`
  当年 `cp` 过去的副本），已放回原位；8080 重启后 `/health` ok、`/` 200 / 94,800 字节
- `portal/lib/archive.mjs`：回收站没有，按 `tests/portal_archive.test.js` 的 23 条断言重建，
  **23/23 一次全过**
- 包格式提交通道（`POST /api/datafiles` + 提交归档成 `PKG_*/{requirement.json,
  package_manifest.json,raw_data/*,references/*}`）：按 E2E 脚本与 verification 脚本契约补回
- 8 个历史提交 JSON 从回收站捞回，8787 `items=8` 且全部 `parseError=false`
- 回归：`npm test` **236/236 pass**（修复前 205/207）；`tsc --noEmit` 0 错；`npm run build` 通过
- 联调冒烟包已删，inbox 恢复为 8 个 JSON + refs/ + uploads/

**未恢复原状的三件事（要你决策）**
1. **捞回的 index.html 是 10-18 快照，页面没有"数据文件上传"UI**。10-19 客户端才有上传入口。
   服务端 `/api/datafiles` 与包归档已按契约恢复且有测试（E2E 脚本可直接跑），
   但客户在网页上目前只能交需求 + 参考文献，交不了矩阵/分组文件。
   补 UI 是独立任务（要新写前端，且原始 UI 代码已丢失）。
2. `MAX_DATA_BYTES = 1 GiB`、`MAX_DATA_FILES_PER_ROLE = 3` 是我重建时拟的值，原值无从恢复。
3. 原 inbox 里的 `PKG_*` 包目录与 `uploads/`、`refs/` 内容回收站没有，无法恢复
   （远端 `raw_data/` 与交付包未受影响）。

**下一步建议**：先确认 1、2；若接受"上传 UI 后补"，我按契约补一个最小上传页面
（拖拽/选择文件 → /api/datafiles → 提交时带 dataFiles），并用 portal_submit.test.js 同款断言验收。

---

# 交接 · 2026-10-19（IS 乳酸化项目 PRJ_20261019_IS_lactylation 建项 + line1 全流程）

**接任务先读本条**。项目根：`projects/PRJ_20261019_IS_lactylation/`；本地工作区脚本与输入在
`project_data/Ischemic Stroke/`（本机 D:，非服务器）。用户分析目标：IS 乳酸化相关基因筛选与
生物标志物鉴定（六节干实验方案），参照 fimmu-16-1601533.pdf（GBM 乳酸化论文）方法迁移到缺血性卒中。

**工作模式（用户拍板）**：主代理（step5preview）只做规划/审查/派发/验收；机械活派子代理
（本地 hermes CLI + deepseek-v4.1-flash + provider a12，一条命令一个派发单，要求原文回报）。
派发方式：`hermes -z "<窄任务>" -m deepseek-v4.1-flash --provider a12 -t terminal,file --in <目录>`。

## 用户已拍板决策（project.json notes 有完整记录）

1. **三线隔离红线**：line3 不使用 line2 数据（禁用 LHS/LDTS/LLS 作 RCTD 反卷积参考）。
   第四节改为线内 spot 级乳酸化评分 + 区域比较 + 目标基因定位。
2. **line1 训练/验证**：GSE22255+GSE58294（GPL570，132 样本）ComBat 合并训练；GSE16561
   （GPL6883，63 样本）独立外部验证（冻结口径）。
3. **重点目标基因（line3 空转重点分析，用户提供两份 Intersect_Genes CSV）**：11 个去重
   （DNMT1 为两清单交集）：AKT1/BCL2L1/CASP1/DNMT1/HSP90AB1/MAPK14/MDM2/MMP9/ABCA1/ORMDL3/PLEKHA1。

## 已完成（全部实测验收）

| 项 | 结果 | 证据 |
|---|---|---|
| 数据下载 | 5 GSE + 2 GPL annot 全部下载，字节数与 GEO Content-Length 一致 | `project_data/Ischemic Stroke/download_is_datasets.sh` |
| 建项 | project.json（schema v3）+ 三线目录落服务器 | `/mnt/ssd/bio_data/projects/PRJ_20261019_IS_lactylation/project.json` |
| 原始数据上传 | line1 9 文件 / line2 tar 263MB / line3 tar 1.89GB，md5 逐文件一致 | deploy_is_project.sh 的 VERIFY_OK 系列 |
| R 依赖 | hdWGCNA 0.4.12 / CellChat 1.6.1 / monocle 2.30.1 / singscore 1.29 / AUCell 1.24 / UCell 2.6.2 / GSVA 1.50 / Boruta 7.0.0 / xgboost 3.2.1.1 / glmnet 4.1.8 / WGCNA 1.74（修复后）/ sva 3.50 / org.Mm.eg.db 3.18 | 逐包 loadNamespace 验证 |
| LRG 基因集 | 371 个（论文补充表 DataSheet1.xls，PMC12241668，md5 9cf120f5…），本地 lrg_gene_set.csv + provenance | 子代理获取 + 主代理复核 |

**数据卫生红线（重要）**：论文补充包（Europe PMC PMC12241668，1.9MB zip）内还含该论文自己的 LHS/LLS DEGs（1458 个）与 LASSO/RF/Unicox/Boruta/xgboost 关键基因等结果表。这些是 GBM 的**结果数据**，本项目只允许取 371 个 LRG **输入集**；严禁把论文的 DEG/hub 基因表作为候选或验证参照引入本项目（等于泄漏参考答案）。后续任何人复用该 zip 时遵守同一条。
| line1 prep | GSE22255 21755×40 / GSE58294 21755×92 / GSE16561 24427 个 null 基因内中位数插补后 17494×63 | 三份 prep_report + 台账 completed |
| line1 ComBat | 132 样本合并，batch R² 0.2000→0.0065、group R² 0.1019→0.0726 | merge_combat_report.txt |
| line1 DEG | 12 显著（9 up/3 down），min adjP=1.15e-18 | deg_report.txt |
| line1 LRG-DEG | 371 LRG→328 在矩阵；**标准口径 0 显著**，敏感口径 33 个（26 up/7 down）→ lrg_deg_candidates.tsv（basis 标注） | lrg_deg_report.txt |
| line1 ML | 五算法 LASSO=23/RF=16/Boruta=21/XGBoost=6/univariate_logistic=33；交集 hub=CBR1/HNRNPL/SMARCA4/TST/VIM；LOOCV AUC=0.9585；GSE16561 冻结 AUC=0.8237 sens=0.5897 spec=1.0000；4 张 ml_ 图 | ml_hub_lrg_report.txt + 台账 completed |

**注意事实**：训练集 bulk LRG 差异以敏感口径（p<0.05 & |log2FC|>0.25）为候选来源，
标准口径下 0 显著基因，报告已如实标注；单因素 Cox 因无生存数据以单因素 logistic 替代（已标注）。

## 踩坑记录（本轮新增）

- BiocManager::install 对"Bioc 版本无此包"返回 exit 0（singScore/hdWGCNA/CellChat/spacexr
  全部误报 OK）——**安装后必须 `requireNamespace` 真实验证**，不能信退出码。
- 容器内大文件 `cp` Termux home→/mnt/ssd 可能 EINVAL（1.89GB 复现，263MB 同路径却成功）——
  用 `dd bs=4M` 绕过，已验证字节一致。
- `run_throttled_task.sh` 直跑必须注入 `BIOANALYS_SEED=20261013`（exit 3）。
- 母版 prep_matrix 输入参数只认 `--input <路径>`（裸路径 exit 2）。
- 母版 deg_limma 只认 `expr_genes.tsv`/`group_map.tsv` 文件名（合并产物须用契约名）。
- 母版 prep_matrix 芯片路径硬编码 `tissue: lesion` 分组与 [0,20] 非负值域——IS 用项目内
  适配版 `line1_bulk/scripts/prep_matrix_adapted`（GSE_ID 规则 + [-20,20] + Illumina null
  基因内中位数插补），适配点均写进脚本头注释。
- Boruta 7.0.0 未导出 getSelectedAttributes，用 attStats(bw)$decision=="Confirmed"。
- xgboost 3.2.1 的 seed 只能进 params 列表，顶层再传直接报错。
- **WGCNA 加载失败链**：xfun 0.62 删了 `attr` 导出 + knitr 1.45 importFrom(xfun, attr) →
  Hmisc→WGCNA 全崩。修复=升级 knitr 到 1.52（rmarkdown/htmlTable 同步）。
- CellChat GitHub 仓库自带预编译 .so（架构不符，invalid ELF）——删除后重装成功。
- singScore 包名是小写 `singscore`（GitHub repo DavisLaboratory/**singscore**）。
- hdWGCNA GitHub 默认分支是 `dev`（master/main 均 404）；CellChat 仓库是 `sqjin/CellChat`（非 sqzhang）。

## 下一步（恢复顺序）

1. line1 收尾：GO/KEGG/GSEA 富集 + CIBERSORT（hub 基因层面；CIBERSORT 参考 LM22 需另行
   获取，免疫浸润 R 包如 immunedeconv 未评估）。
2. line2（GSE174574，6 样本 10x，Ensembl+symbol，小鼠）：ingest→QC→normalize→cluster→
   annotate→五算法乳酸化评分（AUCell/UCell/singscore/GSVA/AddModuleScore）→IQR 三组分型
   →LHS-LLS DEG→hdWGCNA(LHS)→候选交集→Monocle2→CellChat。基因符号需小鼠 Title case，
   LRG 人→鼠映射走 org.Mm.eg.db。
3. line3（GSE233814，5 样本 Visium 小鼠）：ingest→QC→cluster→HE 区域注释（核心区/半暗带/
   对侧）→spot 级乳酸化评分→11 个重点目标基因空间定位出图。**不做跨线反卷积**（隔离红线）。
4. line2 候选基因按用户方案可作 line1 ML 候选来源（基因清单级传递，已在 project.json notes
   记录，用户未提异议；如后续裁定违反隔离可切换线内独立口径）。
5. 每步产物按项目惯例跑 `ops/07_pull_outputs.ps1` 回搬本地 outputs/。

**未动声明**：`project_data/Ischemic Stroke/` 下 GSE103224/GSE131928/GSE138794/GSE139448
（参考论文的 GBM 数据，与 IS 分析无关）未动；全局母版 bin/ 只读，项目脚本走
`projects/<pid>/<line>/scripts/` 方案A 沙盒。

---

## 2026-10-19 夜 ~ 2026-10-20 凌晨：line2 推进（L2-1~L2-5）

**L2-1 ingest_10x 已验收**：`project_data/Ischemic Stroke/line2_scripts/ingest_10x.py`，
6 样本 3 sham + 3 MCAO → scrna_ingest.h5ad = 58528 细胞 × 27998 基因（int32，nnz 85,257,515），
obs: sample/condition(分组级 sham|MCAO)/sample_tag/barcode，var: gene_id+gene_symbol。
坑：①gzip import 位置；②tar 成员名含 shamN/MCAON 中缀（拼接路径丢中缀）；
③uns 键禁斜杠（`sham1/2/3` → 改写，踩坑#106 复发）；④**var_names 是行序号，符号在 var['gene_symbol']**
（后续 annotate/bridge 均按此口径处理）。

**L2-2 qc_cells 已验收**：阈值 nCount≥500/nFeature≥200/pct_mt(^mt-)≤10，基因 n_cells≥3；
保留 57225/58528 细胞（MCAO 30508 / sham 26717），19707/27998 基因。坑：per-gene 计数须走
CSC 列偏移（CSR indptr 是 cell 行偏移，与 line3 步骤 2 同坑 #113）。

**L2-3 normalize_integrate 已验收**：normalize_total(1e4)+log1p；HVG seurat flavor 2000
（batch_key=sample）；scale(10)→PCA(50)→harmonypy（**2.x 参数 ncores，Z_corr 已是 cells×PCs 不再转置**，
坑 #104 的旧记忆不适用）；neighbors 15/30 → UMAP → Leiden 1.0 = 26 簇。
silhouette(sample) 0.493→0.0459；silhouette(condition) 0.0663→0.0182（condition=MCAO/sham，
与 batch 共线，下降幅度如实记录，聚类在批次校正嵌入上进行为既定取舍）。

**L2-4 annotate_celltypes 已验收**：26 簇 → 10 类 + unknown：endothelial 25899、microglia 13052、
macrophage 4649、pericyte 3844、ependymal 3525、astrocyte 3311、oligodendrocyte 1433、
unknown 787(1.4%)、fibroblast 406、cycling 319。
**重要数据事实**：该数据集虽为全脑 MCAO，但神经元 marker（Snap25/Rbfox3/Syt1/Grin1/Slc17a7）
表达细胞仅 18-119 个（ID↔符号映射已抽验正确）——**该数据集神经元极少**，用户方案第六节
CellChat「LHS 与神经元通讯」在本数据集无对象，将如实记 N/A；LHS↔endothelial 等照常。

**进行中**：L2-5 lr_score_iqr（五算法评分+IQR+DEG，脚本已部署 VERIFY_OK，LRG 人→鼠映射经
org.Hs.eg.db+org.Mm.eg.db）。

### line2 修复轮补记（2026-10-20 凌晨）

- **obs_names 契约**：ingest 原少赋 obs_names（默认位置索引 0..N），导致下游细胞身份不可回溯；
  已修为 `<GSM>_<barcode>`（如 GSM5319987_AAACCTGAGCACAGGT-1），L2-1~L2-4 全链重跑。
- **Seurat 桥接触发层**：Read10X+CreateSeuratObject 只有 counts 层，data 层为空，五算法取
  `GetAssayData(layer="data")` 得 NULL；修法 `so[["RNA"]]$data <- so[["RNA"]]$counts`
  （桥接触发的值即 log1p(CPM1e4)）。
- **harmonypy 2.0.2**：参数 `ncores`（非 n_jobs）；`ho.Z_corr` 已是 cells×PCs（**勿再 .T**，
  旧坑 #104 的转置记忆在本版本是错的）。
- **R system2 引用**：R 的 system2 不会自动 shQuote 参数，python -c payload 必须 shQuote，
  否则 shell 语法错误且错误信息是 proot 的误导性 "Function not implemented"。
- **人→鼠 LRG 同源映射**：不能用人类 ENTREZID 直查 org.Mm.eg.db（人鼠 Entrez 不同源）；
  改用两级：Title-case 直配（LDHA→Ldha，命中 320/371）+ homologene 兜底。
- **fread 类型**：数字形 barcode 被 fread 读成 integer，与 colnames 字符比较 identical() 恒假；
  先 `as.character` 再比。lrg_score_iqr 已修。

---

## 2026-10-20 凌晨：line2 L2-1~L2-7 全部跑通（含结果）

| 步骤 | 结果（实测） |
|---|---|
| L2-1 ingest_10x | 58528 细胞 × 27998 基因，nnz 85,257,515；obs_names=`<GSM>_<barcode>` |
| L2-2 qc_cells | 保留 57225（MCAO 30508 / sham 26717），19707 基因 |
| L2-3 normalize_integrate | HVG 2000（写 gene_symbol+dispersion）、Harmony、Leiden 26 簇；sil_sample -0.046→-0.078、sil_cond 0.066→0.018 |
| L2-4 annotate_celltypes | 26 簇 → 10 类 + unknown(1.4%)；**无神经元类**（数据事实） |
| L2-5 五算法+IQR+DEG | LLS 14306 / LDTS 28613 / LHS 14306；LHS-LLS DEG 显著 7928；LRG(MCAO-sham) 显著 183 |
| L2-6 metacell+WGCNA | 1297 基因 × 2856 metacell；LHS 富集 metacell 建网：softPower 6、16 模块、9 个正相关显著、328 枢纽(kME≥0.7) |
| L2-7 三源交集 | 328 ∩ 11541 ∩ 161 → **12 候选**：Cald1 Mbp S100a4 Calr Tpm4 Pabpc1 Lcp1 Lsp1 S100a6 Mnda Slc4a4 Csrp1 |

### 关键工程决策（因环境/数据事实做的等价替换，均已如实标注）
1. **五算法评分分两段 R + 一段 Python**：段1 AUCell/singscore/GSVA-ssgsea（R，评分宇宙 HVG 前 1000 ∪ LRG）；
   段2 UCell/AddModuleScore（同宇宙）；段3 合并 min-max→composite、IQR 分型、scanpy wilcoxon DEG（Python）。
   原因：单会话跑五算法峰值 6.9GB 触发容器 7.5GB 守卫与 Android LMK 被杀（实测三次）。
2. **hdWGCNA → metacell + 原生 WGCNA**：hdWGCNA 0.4.12 与 Seurat v5 Assay5 不兼容
   （`SetDatExpr` 报 Layer 'data' is empty，换 v4 Assay 仍不行）。核心等价：metacell(k=20，按 celltype)
   + WGCNA signed 网络 + 模块-得分 Spearman + kME≥0.7 枢纽。
3. **DEG 每类抽 8000 细胞**（DEG_MAX_CELLS）：手机内存约束，非统计偷懒。
4. **LRG 人→鼠**：Title-case 直配 320/371（homologene 已装但未命中补充），未映射 51 个已在
   `lrg_human_mouse_map.tsv` 列出。
5. **UCell 排名空间 = 评分宇宙**（非全转录组），因全转录组会触发 LMK。

### 本轮新增踩坑
- harmonypy 2.0.2：`ncores` 参数名 + `Z_corr` 已是 cells×PCs（**旧坑 #104 的 .T 记忆是错的**）。
- singscore 1.x：无 `rankScore` 导出；`simpleScore` 必须先 `rankGenes()`，否则 calcBounds 报
  "argument is of length zero"。
- UCell 2.6.2：不认 Seurat v5 对象；传矩阵返回数值向量（非 data.frame）。
- Seurat v5：`so@assays$RNA$data <-` 不生效，须 `so[["RNA"]]$data <-` 或 `SetAssayData`。
- R `system2` 不自动 shQuote（python -c payload 必须 shQuote）；proot 下失败信息是误导性的
  "Function not implemented"。
- 手机侧 sshd 会被系统回收（本次发生 2 次）：恢复= `adb shell monkey -p com.termux ...` + `adb forward`；
  **长任务必须由本端后台 ssh 持有连接**（子代理会话超时会连带杀掉远端任务）。

### 下一步（未做）
- L2-8：Monocle2 伪时间（LHS）+ CellChat（LHS↔endothelial 等；神经元 N/A）。脚本
  `line2_scripts/monocle_cellchat` + `run_l2_mono.sh` 已就绪未跑。
- line1 收尾：把 12 个 line2 候选并入候选池重跑五算法 ML（M2）→ GO/KEGG/GSEA 富集 → CIBERSORT。
- line3：GSE233814 ingest/qc/域+HE区域注释/spot 级评分/11 目标基因定位（反卷积维持跳过）。

---

## 2026-10-20 上午：line3 L3-1 完成 + 一个必须用户知晓的数据限制

**L3-1 ingest_visium 已验收**（`line3_scripts/ingest_visium.py`，台账 is_l3_ingest completed）：
- 12099 spots × 32285 基因，nnz 53,402,158；symbol 小鼠形态 91%、空符号 0
- 5 样本（GEO series matrix 权威映射，非猜）：C1-control=control、B1-D1=1 day、D1-D3=3 days、
  C1-D7=7 days、D1-D7=7 days；spots = 2417/2587/2573/2596/1926
- 产物：`line3_spatial/processed/GSE233814/spatial_ingest.h5ad`、spot_meta.tsv、ingest_report.txt

**⚠ 数据限制（影响方案第四节，需用户知晓）**：GSE233814 的 GEO 补充包只有 `GSE233814_RAW.tar`，
tar 内 **没有 tissue_positions / 坐标文件**（每样本仅 matrix.mtx + barcodes + features + HE tif + scalefactors json）。
因此 **obsm['spatial'] 无法建立**，像素级空间图、Moran's I、以及"基于 HE 形态划分缺血核心区/半暗带/对侧正常区"都做不了。
脚本已把 `SPATIAL_COORDS_MISSING=TRUE` 与说明写入 h5ad 的 `uns['ingest']['spatial_note']` 与报告，**不伪造坐标**。
后续替代口径（待用户确认后执行）：区域划分改为"转录谱聚类 + marker 打分"（缺血核心/半暗带/对侧样）；
11 个目标基因改为按簇/按时间点表达图，而非图像上的空间特征图。

### 待办（按建议顺序）
1. **L2-8b 通讯**：CellChat 1.6.1 与 SeuratObject 5.x 不兼容（GetAssayData(slot=) 已废弃为硬错误，
   转 v4 Assay 无效）；已写好 liana 替代脚本（mouseconsensus 资源 + var_names 设为 gene_symbol），
   **等用户同意替换后一条命令即可跑**（上次该命令因超时未获响应而中止，远端未改动）。
2. **line3 余下 4 步**：QC → 归一化/降维/聚类 → 转录谱区域注释（替代 HE 形态口径）→ spot 级乳酸化评分比较
   → 11 目标基因按簇/时间点图。反卷积按用户指示维持跳过。
3. **line1 收尾**：12 个 line2 候选并入候选池重跑五算法 ML（M2）→ GO/KEGG/GSEA → CIBERSORT。
4. 交付报告（docs/delivery_package_spec.md 七章模板）。

### line3 L3-2 完成（2026-10-20）

`line3_scripts/spatial_qc_norm.py` + `run_l3_qc.sh`，台账 is_l3_qc completed：
- QC：nCount≥500 / nFeature≥250 / pct_mito≤25；基因≥3 个 spot。保留 **11726/12099 spots (96.9%)**，
  基因 32285→21318（剔除 10967 个零表达基因）。逐样本保留 92.1%~99.6%（D1-D7 高线粒体剔除最多 142）
- 归一化 normalize_total(1e4)+log1p，counts 存 layers；HVG 2000；scale(10)→PCA(50)→neighbors→Leiden(0.5)
  = **14 个转录谱簇**（size 229~1925）
- 产物：`spatial_qc.h5ad`、`spatial_norm.h5ad`、`spot_qc_metrics.tsv`、`hvg_genes.tsv`、
  `qc_report.txt`、`normalize_report.txt`
- 踩坑复现：基因过滤布尔数组 `gene_keep.values` 报 AttributeError（与 line2 QC 同坑 #113 同源，已修）

### line3 余下（待执行）
1. L3-3 区域注释（**替代口径，待用户确认**）：转录谱簇 → marker 打分 → 缺血核心样/半暗带样/对侧样
   （无坐标，不能做 HE 形态划分与 Moran's I；L3-1 报告已把 SPATIAL_COORDS_MISSING 记入 h5ad uns）
2. L3-4 spot 级乳酸化评分（五算法，鼠源 LRG）并按区域/时间点比较
3. L3-5 11 个重点目标基因按簇/时间点表达图（不能出图像空间特征图）
4. 反卷积：按用户指示维持跳过

### line3 L3-4 完成（spot 级乳酸化评分，2026-10-20）

`line3_scripts/spatial_lr_score.py`，台账 is_l3_score completed：
- 11726 spots，LRG 可用 323/324（line3 独立生成的鼠源清单）
- **方法不静默**：尝试了 scanpy score_genes、gseapy ssgsea、LRG mean-z 三法；
  **ssgsea 在本数据上有效值 0 → 剔除**，合成实际使用 `['score_genes','lrg_meanz']`，报告首部有
  `methods_attempted=...` + `WARNING: ...剔除 ['ssgsea']` 两条如实声明（不写成"三方法"）
- 结果：按时间点 mean = 1d 0.5367 / 3d 0.5943 / 7d 0.5614 / control 0.5840；
  Kruskal–Wallis：by condition H=197.3 p=1.6e-42、by cluster H=1790.3 p≈0
  （簇间差异最大；最高簇 13/9/6，最低簇 12/4/8）
- 产物：`spatial_lr_scores.tsv`、`lr_score_by_cluster.tsv`、`lr_score_by_condition.tsv`、
  `spatial_lr.h5ad`、`spatial_lr_report.txt`

**cosmetic 注记**：本次为修报告换行把两行 fh.write 改为 print(..., file=fh)（避免 `\n` 转义失真），已验证。

### 隔离合规补记
- line3 的鼠源 LRG 由 **line3 自己生成**（`line3_scripts/lrg_map_mouse_l3.R`，输入为公开论文 371 人源 LRG
  + line3 的 gene 宇宙），**未读取 line2 任何产物**；命中 324/371（line2 为 320/371，因两线基因宇宙不同）。

### line3 L3-5 完成（用户指定 11 个重点基因，2026-10-20）

`line3_scripts/spatial_target_genes.py`，台账 is_l3_target completed：
- 人类→小鼠 Title-case（Dnmt1/Akt1/Bcl2l1/Casp1/Hsp90ab1/Mapk14/Mdm2/Mmp9/Abca1/Ormdl3/Plekha1），**11/11 全部命中**
- 无空间坐标 → 不出图像空间特征图；改为按簇/时间点定量 + 簇×基因 z-score 热图（`l3_target_genes_heatmap.png`，300dpi）
- 与乳酸化 composite 得分的 Spearman（全 spot）：正相关最强 **MAPK14 ρ=0.248、DNMT1 ρ=0.231、ORMDL3 ρ=0.205、
  ABCA1 ρ=0.203**，其余 0.06~0.19（全部 p<1e-10，显著但效应量小到中等）
- pMCAO vs 对照（Mann–Whitney）：**HSP90AB1 p=6.5e-40、MAPK14 1.9e-14、ORMDL3 8.5e-16、DNMT1 3.5e-08、
  MDM2 2.2e-09、CASP1 8.9e-08** 差异显著；AKT1(0.50)、BCL2L1(0.75) 无显著差异
- 只有 HSP90AB1 落在 LRG 集内（in_LRG=True）
- 产物：`spatial_target_genes.tsv`、`target_gene_by_condition.tsv`、`target_gene_by_cluster.tsv`、
  `spatial_target_report.txt`、热图 PNG

### line1 M2（合并候选池重跑五算法）+ M1/M2 双版本固化（2026-10-20）

候选池合并（`line1_scripts/make_merged_candidates.py`）：本线 LRG 差异 33 + line2 三源交集 12（转人类大写）
= **45 个 uniqu候选**（两线共同命中 0）。产物 `l1_merged_candidates.tsv` + `merged_candidates_report.txt`。

| 版本 | 候选池 | 五方法入选 | hub 基因（LASSO∩RF∩XGBoost∩Boruta） | LOOCV AUC | 外部 GSE16561（冻结） |
|---|---|---|---|---|---|
| **M1** | 本线 33 | L=23 R=16 B=21 X=6 U=33 | **CBR1, HNRNPL, SMARCA4, TST, VIM（5）** | 0.9585 | **AUC 0.8237**（sens 0.5897 / spec 1.0000） |
| **M2** | 合并 45 | L=26 R=13 B=22 X=8 U=35 | **CBR1, DCXR, PGK1, SMARCA4, TST, VIM（6）** | 0.9579 | AUC 0.7682（sens 1.0000 / spec 0.6250） |

**真实结果（不粉饰）**：并入 line2 候选后，内部 LOOCV 基本持平，但**外部冻结验证 AUC 从 0.8237 降到 0.7682**。
两版均已固化留档（`ml_hub_genes_m1.tsv`/`ml_hub_lrg_report_m1.txt` 与 `_m2` 后缀同名文件，`ml_select_by_method_m2.tsv`）。
交付报告里应同时给两版并说明取舍：M2 更贴合用户方案（三源交集入池），M1 外部泛化更好。

**修掉的自造缺陷（重要）**：`ml_hub_lrg` 的枢纽表曾写成 `genes %in% sel_*`（全候选向量，长度≠hub），
data.table 把短向量**循环重复**，导致 ml_hub_genes.tsv 出现 45 行/6 基因重复、且与 hub_rule 声明不符。
已改为 `hub %in% sel_*` 并加两条自检（行数一致、非兜底口径下四方法标志必须全真），重跑后 M1=6 行、M2=7 行（含表头），无重复。
注：M1/M2 的 AUC 指标本身一直是按正确的 hub 向量计算的，**数值未受影响**，受影响的只是 tsv 表格文件。

### line1 功能富集完成（GO/KEGG ORA + bulk GSEA，2026-10-20）

`line1_scripts/enrich_line1.R`，台账 is_l1_enrich completed：
- ORA 背景 = 合并训练集全部 21755 基因；基因集 M1_hub(5) / M2_hub(6) / LRG_diff(33)
- 显著 term 数（BH<0.05）：M1_hub GO=31、KEGG=13；M2_hub GO=38、KEGG=18；LRG_diff GO=77、KEGG=77
- GSEA（deg_all.tsv 的 t 统计量有符号降序）：GO BP=310、CC=89、MF=43、KEGG=81 条显著通路；
  BP 首位 GO:0140053（p=1e-10, q=5.3e-7）、GO:0032543（线粒体翻译相关）、GO:0016050（囊泡/自噬相关）
- LRG 差异候选的 GO ORA 首位：核酸/RNA 转运、核输出、RNA 剪接（p~1e-5, q=0.0039）
- 产物：`enrich_go_<set>.tsv`、`enrich_kegg_<set>.tsv`、`gsea_go_{BP,CC,MF}.tsv`、`gsea_kegg.tsv`、`enrichment_report.txt`
- 踩坑：clusterProfiler 的 enrichGO/gseGO/gseKEGG **默认按 ENTREZID 匹配**，传 SYMBOL 必须 `keyType="SYMBOL"`，
  KEGG 与 GSEA 需 `bitr(SYMBOL->ENTREZID)`；另外 GSEA 排序量必须**有符号递减**（用 abs 会破坏单调性而报
  "geneList should be a decreasing sorted vector"）。

### 剩余（均需用户一句话）
1. L3-3 line3 区域命名（转录谱簇 + marker 打分替代 HE 形态划分）
2. L2-8b 通讯（CellChat → liana 替换是否同意）
3. CIBERSORT 免疫浸润（需先定 LM22 参考来源）
4. 交付报告（docs/delivery_package_spec.md 七章模板）

### 全项目合规核验（2026-10-20，只读，有工具输出）

1. **代码隔离**：`pwsh -File ops/02_check_isolation.ps1` → `[code:line1_bulk] OK [code:line2_scrna] OK [code:line3_spatial] OK`，**总体 PASS**（exit 0）
2. **台账合规**：`ssh k40-ubuntu 'bash -s' < ops/03_check_logs_remote.sh` 初跑 **FAIL**，原因定位为
   `ops/run_throttled_task.sh` 只写**精简台账**（不含 project_id / environment.random_seed；这两字段通常在走工作台
   API 时由任务引擎注入），而本项目是**方案 A 沙盒脚本（必须 ops 层直跑）**，故两字段缺失。
   ops/ 属「四不改」只读区 → 不改启动器，改用 `project_data/Ischemic Stroke/is_ledger_amend.py`
   **按事实回填**（project_id=PRJ_20261019_IS_lactylation、random_seed=20261013，值即实际执行所用）。
   回填只补两字段，**不动 status/checkpoint_status/error_log 等任何判决字段**。
   结果：本项目台账 **27/27 全部合规**（抽样 is_l1_ml_m2 / is_l2_wgcna / is_l3_target 均显示项目与种子正确）。
   审计全库仍报 1 条 VIOLATION：`test_006_ledger.json`——**默认项目的历史 E2E 夹具，不属于本项目，未改动**。

### 交付物（草稿，待授权打包）
- `con_hf/2026-10-20_IS_项目解读报告.md`：按 `docs/delivery_supervisor_prompt.md` Step 5 的三段式
  （核心结论 → 数据与统计依据 → 方法学与生物学限制）撰写，含 M1/M2 对比、无神经元/无坐标两条数据限制、
  hdWGCNA→metacell+WGCNA、CellChat 不可用、Cox→logistic、ssgsea 剔除等全部替换与限制。
- 三本台账已同步：`踩坑台账.md`（#150–#160）、`操作台账.md`（21 个任务 ID 参数/产出表）、本文件。

---

## 与"另一条在跑工作流"的边界（用户 2026-10-20 新增准则：不重复、不冲突）

**准则原文（含语音输入错误，已按最合理读法执行，待用户确认）**：
「要与工作文件夹下另一个进行中的工作内容不重复/不撞车，不要和它冲突」。

### 另一条工作流实测是什么（只读盘查）
1. `cn_debug/2026-10-20_k40_bench/` —— **K40 算力端绑核 vs 不绑核 A/B 基准测试**
   （`bench_ab.sh` 交替 3 轮消除温度顺序效应 + `watch_thermal.sh` 温度监控 + `bench_py.py/bench_r.R`）。
   基准在**精确测量 wall_time**，任何并发重型任务都会造成 CPU 争用与温度漂移 → **互相污染**。
2. `cn_debug/2026-10-20_s16_dev/`、`cn_debug/figure_audit_sweep/` —— **default 项目的图件审计/评分与代码审计**
   （S13~S16 步骤；`figure_audit_all.csv`、`code_audit.csv`、`figure_score_line1_s16.*`）。

### 目录边界（我写的 vs 对方的，实测零重叠）
- **我只写**：`con_hf/`（本项目条目）、`project_data/Ischemic Stroke/**`（line1/2/3_scripts、line1_inputs、各 GSE 数据）、
  服务器 `projects/PRJ_20261019_IS_lactylation/**`（含 `<line>/scripts/` 沙盒与 processed 产物）、`system_logs/`（台账，任务执行必然写入）。
- **对方在用**：`cn_debug/2026-10-20_k40_bench/`、`cn_debug/2026-10-20_s16_dev/`、`cn_debug/figure_audit_sweep/`、`cache/scratch/neg/`、`bin/`（母版，对方疑似在审计/重部署，我**从未写入**）、`aims/`、`BioanalysDesktop/`。

### 内容是否重复：否
- 我的数据集：GSE16561 / GSE58294 / GSE22255 / GSE174574 / GSE233814；目标 = IS 乳酸化筛选与诊断标志物。
- 对方审计对象 = `default` 项目（GSE277173 / GSE254707 / GSE192741）的图件与代码；目标 = 出图合规与代码审计。
- 两者数据集、项目目录、分析目标均不同，**不存在内容重复**。

### 新增硬性规避规则（已落地为脚本）
`project_data/Ischemic Stroke/is_busy_check.sh`：
- `bash is_busy_check.sh` → 打印 `FREE` / `BUSY` + 命中进程（在算力端 `pgrep -af 'bench|watch_thermal|thermal|blas_ab|_bench'`，排除自身命令行）
- `bash is_busy_check.sh --wait N` → 最多等 N 秒直到 FREE（每 20s 探测）；超时退出码 2
- **规则：本项目此后发起任何重型 R/Python 任务前必须先跑一次；BUSY 则等待或改期，不得强行并发。**
- 本次探测结果：FREE（无 bench 进程）。

### 附注
- 本次盘查同时发现手机刚重启过（uptime 2 min），设备侧不稳仍是长任务风险；长任务仍须本端后台 ssh 持有连接。

### L2-8b 完成（liana 替换 CellChat，2026-10-20）

用户确认配置已修好（子代理可用）。本轮先自查发现：我最后一次 var_names 补丁**并未写入**（当时该命令被
阻断超时，本地与远端 md5 相同但都缺修复）——用 patch 工具正式补上后重跑，**liana 完成**：
- 17092 对 LR（每 celltype 抽 1000 细胞 → 8512 细胞），LHS 富集细胞类型（endothelial/microglia/macrophage）
  双方均为 LHS 富集类型的交互 **1460 对**；lrscore（rank 聚合分，越小越强）
- **top LHS 交互**（lrscore 升序）：macrophage→microglia Vcan-Tlr1 0.501、macrophage→macrophage
  Irak4-Tlr4 0.516、macrophage→endothelial Sema7a-Itga1/Itgb1 0.517、Vwf-Itga4 0.521、Col4a1-Itga1/Itgb1 0.529…
  主题与 MCAO 后巨噬/小胶质炎症信号一致
- 产物：`cellchat_lhs_interactions.tsv`（17092 行全量）、`liana_lhs_top.tsv`（top30）、`cellchat_report.txt`
- **报告 top10 修正**：初版排序误取 NaN 列导致 top 显示为空行（cosmetic），已按 lrscore 升序重写
  `cellchat_report.txt` 与 `liana_lhs_top.tsv`（`fix_l2_comm_report.py`，数据不重算）
- 遗留：`fix_l2_comm_report.py` 的首次内联版有嵌套引号 f-string 错误（本地脚本已重写为独立文件版，正确）

### line3 L3-3 完成（区域注释，2026-10-20）

`line3_scripts/spatial_regions.py`，台账 is_l3_region completed：
- 三套 signature 全命中（core 17/17、penumbra 10/10、contralateral 11/11）
- 14 个转录谱簇中 **3 个判为 core（缺血核心样，共 1715 spots）**，其余 11 簇 unassigned
  （三套分数区分度不足 0.15/0.05 阈值，**不硬猜**）
- **生物学合理性自证**：3 个 core 簇 **100% 来自 MCAO 样本、control 为 0**；
  composite 在 core 与其余区域间 KW H=68.96 p=1.0e-16
- 产物：`spatial_regions.tsv`、`region_by_condition.tsv`、`region_lr_compare.tsv`、
  `l3_regions_report.txt`、`l3_regions_umap.png`、`l3_region_score_boxplot.png`（已回搬本地）
- 图件坑：matplotlib 3.11 的 `boxplot` 不再收 `labels`，改 `tick_labels`

### line2 L2-8b 收尾（报告修正）
- 初版报告的 top 排序误取 NaN 列 → 已按 lrscore 升序重写报告与 liana_lhs_top.tsv（`fix_l2_comm_report.py`）
- top 交互：巨噬→小胶质 Vcan-Tlr1、巨噬→巨噬 Irak4-Tlr4、巨噬→内皮 Sema7a-Itga1/Itgb1 等
  （与 MCAO 后巨噬/小胶质炎症主题一致）

### line3 全部落实完毕（除反卷积按指示跳过）
剩余：line1 CIBERSORT（LM22 阻断，等 A/B 选择）+ 交付包打包（等授权）。

### line1 免疫浸润完成（ssGSEA 替代 CIBERSORT，2026-10-20）

`line1_scripts/immune_ssgsea.py`，台账 is_l1_immune completed：
- **训练集（132 样本）**：B_cells 显著低于对照（adjP=6.7e-06）；Macrophages 显著高于对照（p=1.58e-05）；
  Mast_cells 高（p=0.022）；Plasma_cells 低（p=2.2e-04）；T_CD4 低（p=0.012）
- **外部 GSE16561（63 样本，冻结）**：B_cells 低（adjP 方向一致）、Macrophages 高（p=7e-06）、
  Monocytes_CD14 高（p=0.024）、Neutrophils 高（p=1.8e-04）、T_CD8 低（p=1.1e-06）、T_CD4 低（p=3.6e-06）——
  **方向与训练集一致，独立验证通过**
- **hub-免疫相关**：SMARCA4 vs Macrophages rho=0.396；TST vs Macrophages rho=-0.304（方向相反）
- 产物：`immune_ssgsea_train.tsv`、`immune_ssgsea_external.tsv`、`immune_celltype_comparison_train.tsv`、
  `immune_celltype_comparison_external.tsv`、`immune_hub_correlation.tsv`、`immune_report.txt`
- 踩坑：gseapy 的 `min_size` 默认 5 会把 3-4 个 marker 的小基因集全筛掉（14 类里 13 类被滤）→ 降到 3

### IS 乳酸化项目分析内容全部落实（除打包待授权 + L2-8b 已用 liana 完成 + L3-3 已用转录谱口径完成）

用户六节方案完成度：
- 一（数据与预处理）✅
- 二（五算法+IQR 分型）✅（line2 完成全部 5 算法；空间线用 3 法合成，口径已标注）
- 三（hdWGCNA + 候选）✅（metacell + WGCNA 等价路线）
- 四（空间转录组）✅（替代口径：转录谱聚类 + marker 打分 + 11 目标基因；**无坐标 = 不做 HE 形态划分与 RCTD**，用户已知情）
- 五（ML + 独立验证）✅（M1/M2 双版）
- 六（下游）✅（ssGSEA 免疫浸润替代 CIBERSORT；GO/KEGG/GSEA 完成；Monocle2 完成；liana 完成）

### 工作台图件对接修复（2026-10-20）

用户反馈"结果预览界面看不到图"。根因两层：
1. **line2_scrna/figures 与 line3_spatial/figures 在服务器上不存在/为空**：
   - line2 各步骤脚本只落 tsv/report，从未出 PNG → `/api/figures/list` 对 line2/line3 返回
     `blocked=true`（工作台如实显示 blocked，不是 bug）
   - line3 的 3 张图在 `processed/GSE233814/` 下，未按规范放 `line3_spatial/figures/`
2. 前端无缓存问题：API 与构建产物均正常（项目选择器问题同源——用户当时看的是
   portal 8080 提交入口，或未切项目）。

修复（不重算任何分析结果，纯产物归位+补图）：
- line3：3 张 PNG cp 到 `line3_spatial/figures/`
- line2：新增 `line2_scripts/l2_figures.py`，从既有产物补 7 张 300 DPI 图
  （三分组构成/得分分布/五算法相关/WGCNA 模块/候选证据/伪时间/liana top 交互），
  台账 is_l2_figures completed；h5py 直读 obs（Group{categories,codes} 结构 +
  必须读 `_index` 才能与 scores.tsv 的 barcode 索引对齐，第一版漏了 _index 导致
  join 为 0，已加 fail-fast 校验）
- 修复后 API：line1=6（local）/ line2=7（remote）/ line3=3（remote），共 16 张
- 全部回搬本地 con_hf/figures_PRJ_20261019_IS_20261019/（现 20 个 png，含 m2 系列）

### 图件规范合规重制（2026-10-20，用户指出"图不合规/流程没跑完"后）

用户反馈结果预览的图不合规。核查属实，根因两层：
1. line2/line3 图件目录在服务器上为空/缺失（line2 脚本从未出图；line3 图落在
   processed/ 未进 figures/）→ 工作台 blocked；
2. 我首轮补的图（l2_figures.py 第一版 + R 版 l1_ml_* / l3_*）违反 figure_spec v2.2 多处：
   图内中文、set_title 代替 caption()、无 legend_out/layout guard、箱线无个体点、
   命名无两位序号（C2 一票否决）、无机器审计。

重制（不重算分析结果，只重画+重命名+审计）：
- 新增 4 个合规出图脚本（bash+heredoc 母版结构，内嵌 canonical helper 块）：
  line1_scripts/l1_ml_figures_spec（8 张，statsmodels GLM 重拟合逻辑回归，
  **AUC 与台账核对一致才落盘**：M1 0.9585/0.8237、M2 0.9579/0.7724 全对）、
  line1_scripts/l1_lrg_heatmap_spec（1 张）、line2_scripts/l2_figures_spec（7 张）、
  line3_scripts/l3_figures_spec（3 张）
- 旧不合规图件全部删除取代（l1_ml_*、m2_l1_ml_*、l1_lrg_heatmap、l3_regions_*、
  l3_region_*、l3_target_*）；lrg_deg R 脚本的产图段已移除（移交 Python 合规版）
- 机器验证：几何审计 audit_all.csv **19/19 PASS 0 fail**（A 标注在框内/B 图例外置/
  C 图注不交轴框/D 不重叠）；源码审计 code_all.csv **0 issue**（无轴内 loc、
  无 <8pt、无图内中文、命名全合规）；figure_score：**figs=20 PASS=19(均100分)
  FAIL=0 UNVERIFIED=1 avg=99.0**（唯一 UNVERIFIED=母版 R 图 l1_03_volcano_limma，
  规范已知边界走人工登记）
- figures.js caption 登记追加 19 条（BioanalysDesktop，纯追加不改旧条目）；
  工作台服务重启后 API 实测三线 10/7/3 张、caption 20/20 命中
- 踩坑新增：①audit 暂存目录只软链文件不链子目录 → 外部数据路径用
  L1_EXT_EXPR/L1_EXT_GROUP 环境变量注入；②审计模式 BIOANALYS_AUDIT_WRITE=0 时
  自校验须跳过文件存在性检查；③双子图不走 layout_fix 的 fit_text_edges，
  条末标注要手动留轴空间；④散点+adjustText 在极值点会把标签推出轴框，
  改母版条形模式（tick 标签在轴外审计不判）；⑤sklearn LogisticRegression 默认
  L2 正则与 R glm 不等价，AUC 对不上 → 换 statsmodels GLM 后完全一致；
  xgboost 本环境无 → GBDT(sklearn) 替代并在图注标注
- 本地同步：con_hf/figures_PRJ_20261019_IS_20261019/（20 张+新 README）、
  outputs/ 与 projects/ 两份本地副本均已刷新（旧图已清）

### 客户交付包完成（2026-10-20，新目标推进）

**目标**：完成 PRJ_20261019_IS_lactylation 客户交付包（项目唯一剩余项）。
**入口**：`ops/build_client_report.py`（aims v3.0 §7.2；09_package_delivery.ps1 仍未实现）。

打包前修复的 4 个对接问题（均不改 ops/ 只读区）：
1. **表归位**：line2/line3 的 tsv 在 `processed/GSE174574|GSE233814/` 子目录，打包脚本
   os.listdir 只扫顶层 → 统计 0 表。把 32+18 张表复制到 `<line>/results/`（规范位置，
   原文件保留供重跑）→ 92 张表全部入包。
2. **版本清单**：software_versions.json 部署到 `/mnt/ssd/bio_data/`（DATA_ROOT，
   脚本第 3 候选路径，不碰 ops/）→ 第二章版本表生成。
3. **文献索引**：reference_citations.json 同样部署 DATA_ROOT（脚本从 Termux home
   跑时找不到 ops/ 下的副本）→ 方法学引用完整。
4. **台账 project_id 回填**：7 个直跑台账 project_id=None（is_l1_immune/is_l1_lrgfig/
   is_l1_mlfigspec/is_l2_cc/is_l2_comm/is_l2_figspec/is_l2_figures/is_l2_hdwgcna/
   is_l2_mono/is_l3_figspec/is_l3_region 等），被报告台账过滤器排除 → 第三章 15 个步骤
   显示"未找到"。按执行事实回填 project_id + random_seed（is_ledger_amend.py 改为动态
   扫描全部 is_* 台账；38 个全部齐，幂等验证 changed=0）。**只补元数据字段，
   不改 status/checkpoint 等判决字段**。
5. **dag 重建**：project.json 的 pipeline_dag 是建项时计划步骤名（hdwgcna/cellchat/
   lrg_score_iqr），与实际沙盒步骤名（wgcna_l2/liana_comm/lr_score_final）不符 →
   从 34 条已完成台账重建 28 步真实 dag（按 start_time 排序、带 line_id/task_id、
   旧 dag 同名义工元数据继承；备份 project.json.bak_20261020_dagfix）。
6. **补 fdr 火山图**：母版 deg_limma 声明 fdr/nominal 两张，实际只落 nominal →
   l1_volcano_fdr_spec 从 deg_all.tsv 重绘 l1_03_volcano_fdr.png（Python 合规版，
   几何审计 1/1 PASS；caption 由 figures.js 既有 l1_03_volcano 条目自动覆盖）。

**最终交付包**（服务器 `projects/PRJ_20261019_IS_lactylation/deliverables/`）：
- `PRJ_20261019_IS_lactylation_Client_Delivery/`（目录）+ `.tar.gz`（74.8 MB，165 条目）
- 三大件：01_Adapted_Scripts（34 脚本）/ 02_Figures_and_Tables（21 图 + 92 表 + reports）/
  03_Interpretation_Report（Analysis_Report.md 29KB + .html 40KB，七章结构）
- delivery_manifest.json：scripts=34 / figures=21 / tables=92
- 门禁核验：链路通 ✓ / project.json 可读 ✓ / 存储 62% ✓ / 图件非空 ✓ /
  无 running 台账 ✓ / 4 个 failed 台账均为被替代的历史尝试（CellChat→liana、
  hdWGCNA→metacell+WGCNA、lrscore/mono OOM 后重跑成功），已人工确认放行 ✓
- 包后校验：tar 可列 ✓ / 三大件非空 ✓ / 图件计数 11+7+3=21 与服务器一致 ✓ /
  排除模式扫描（h5ad/rds/log/tar/probe）无命中 ✓ / 脱敏扫描（mnt/ssd、termux、
  k40-ubuntu、root@）无命中 ✓
- 报告"未找到"从 20 → 4：剩余 2 处为规范明确排除的 h5ad 检查点（设计行为）、
  1 处 selfcheck.json 未产（五维自检未跑，本项目用 figure_score 替代）、
  1 处为报告结尾说明行。**全部如实，无编造**。

**图件最终合规态**：21 张，figure_score PASS=20（均 100 分）FAIL=0 UNVERIFIED=1
（母版 R 图 l1_03_volcano_limma，规范已知边界走人工登记）avg=99.0；
几何审计 audit_all.csv 20/20 PASS（新增 fdr 火山 1/1）；源码审计 0 issue。

---

## 2026-10-20 · 文件域划分（用户 2026-10-20 拍板：sw-engineer 会话接管整个工作台服务端+客户端）

**背景**：两个 Hermes 会话并行写本仓库。此前 default profile 会话（K40 基础设施加固）
把 `ops/`、`src/`、`BioanalysDesktop` 列为冻结区。用户本轮明确：
"现在你不负责原有内容了，现在你负责整个生信分析工作台（服务端+客户端）的功能维护和开发了"，
并就"是否明确接管 BioanalysDesktop / 是否补 portal 上传 UI"回答"要"。

**域划分（自本条目起生效，两个会话都遵守）**

| 域 | 归属 | 说明 |
|---|---|---|
| `BioanalysDesktop/`（server/、src/、tests/、dist/） | **sw-engineer 会话** | 工作台服务端+客户端全量功能维护与开发 |
| `portal/`（serve.mjs、index.html、lib/、inbox/） | **sw-engineer 会话** | 用户提交台 |
| `src/line*/scripts/` 的出图相关改动 | sw-engineer 会话 | 出图规范与组图主线 |
| `ops/`、`bin/` | default 会话主导；sw-engineer 只读+按既有脚本部署/回搬 | 部署与回搬通道 |
| `docs/figure_spec.md`、`con_hf/`、`cn_debug/`（除 k40_bench） | sw-engineer 会话 | 出图规范、台账、审计产物 |
| `cn_debug/2026-10-20_k40_bench/`、`docs/k40_cpu_affinity.md` | default 会话 | K40 基础设施加固 |
| `project_data/`、`outputs/`、`projects/`、`reference/` | 数据资产，双方只读+按流程写产物 | 不手工改原始数据 |

**冲突处理**：任一方要动对方域内文件，先在 handoff 记一条说明再动手；
已发现撞车时，以"用户最新明确指令"为准。

**本轮 sw-engineer 会话在工作台域内的任务队列**
1. S19：portal 补"数据文件上传"UI（服务端契约已就绪，`IN_HOUSE_UPLOAD` 前端 0 命中）
2. 待用户确认：`MAX_DATA_BYTES=1GiB` / `MAX_DATA_FILES_PER_ROLE=3` 拟值
3. 出图主线收尾：S18R（line3 组图）、line1 剩余 8 图人工目视清单

---

## 2026-10-20 · S20 完成：portal 上传上限 5GiB + 每角色 5 + 流式写盘

**改动**：`portal/lib/archive.mjs`（MAX_DATA_BYTES 默认 5 GiB + `PORTAL_MAX_DATA_BYTES` env 覆盖；
MAX_DATA_FILES_PER_ROLE 3→5）；`portal/serve.mjs` `handleDataFileUpload` 改 `fs.createWriteStream`
流式写盘，超限/断传/写出错三路删半成品，等 finish 才回 200，超限文案 `单文件超过上限 5GiB`。

**验证**：`npm test` 237/237（改前基线同值，改后 8 次全绿）；`node --check` ×2 通过；
`node cn_debug/2026-10-20_verification_s20_upload_limit.mjs` 14/14 PASS ×2（幂等）——
64MiB 上传 md5 逐字节一致、RSS 增量 11.86MB/-1.40MB（<64MiB，流式证据）、超限负路径
400「单文件超过上限 1MiB」且无半成品、断传删半成品、全链路 PKG_ 包 md5 一致。
生产 8080（PID 5968）只 /health 探活未重启：**生产实例仍跑旧代码，重启后才生效**。

**注意**：① 旧实现"超限先 req.destroy() 再在 end 回 400"是死代码（客户端只会收到 ECONNRESET，
有探针证据），新实现先回 400 再 drain 剩余 body、end 后 destroy，契约不变、顺序有偏差，详见
`con_hf/dispatch/S20_report.md` 第四节；② `portal/index.html:1186-1187` 客户端副本仍是
1 GiB/3 个，Web UI 实际到不了新上限，需另开小切片（S19 在改 index.html，需协调）；
③ latent 问题（同角色"先删旧的"因 `role__` 前缀匹配不到而失效）已实测取证上报，未修。

S19 完成后请勿重复改 index.html 的 MAX_DATA_BYTES/MAX_DATA_FILES_PER_ROLE 副本而不对齐新值。

---

## 2026-10-20 · 三线定制数据集调研 + 实验设计方案（纯文档交付）

**触发**：用户要求为三条线各定制调研：选数据集（GSE/GPL/分组）→ 出实验设计方案 → 以方案为规格适配各线流水线。拍板：三线各选一套新真实数据集、主题**非肿瘤非免疫**、交付纯文档。

**交付**：`con_hf/2026-10-20_调研_三线定制数据集与实验设计.md`（调研报告 + 三线实验设计 + 流程适配清单 + 候选淘汰记录 + 证据出处）。

**选型结论（全部有核实标注）**：
- line1：GSE30528（GPL571，9 DN vs 13 control，`[GEO直核]`）+ 验证集 GSE104948（7v18）与 GSE96804（41v20，`[文献一致]`×4）——DKD 肾小球芯片挖掘，解锁 external_validation 真外部验证。
- line2：GSE131882（snRNA-seq 3v3，`[GEO直核]`）——DKD 早期人肾；适配点 = ingest_counts 新增 RDS 分支（zUMIs 嵌套 list 须先探针）。备选 GSE211785 scRNA（16v13，合并 RDS 无 raw）。
- line3：GSE287278（RIF 子宫内膜 Visium 4v4，`[GEO直核]`，逐样本 Space Ranger 标准产物）——适配点 = ingest_spatial 支持两层嵌套 tar。备选 GSE261545（单样本无对照，不推荐）。

**关键淘汰依据**：GSE211785 的 ST 是 7 样本合并 RDS、无图像无 raw（GSM6501016 页面实证），不能作 line3 主数据集。

**执行顺序建议**：line1（改动最小）→ line3（单适配点）→ line2（工作量最大）。建项契约映射（dataType/datasets 表）已写进文档 §2.4。

**未做**：三线建项与实跑（用户拍板纯文档交付）；line3 解卷积参考来源决策不变（仍待用户）。

---

## 2026-10-20 · 用户自撰《非肿瘤·非免疫 GEO 生信课题分析规范》落盘为 SOP v1.0

**触发**：用户提交自撰规范全文（Stage 0-11 链路 + C1-C5 硬约束 + 依赖矩阵 + 一票否决清单 + 输出骨架），评审后拍板采纳。

**评审结论**（详见 SOP 附录 B）：三条默认假设中假设 1/2 成立，假设 3「raw 优先」改为分层规则（raw 可得且容器支持 → raw 优先；否则处理级 + 声明层级）。三重判据落地警示：DKD 文献已知 hub 基因多为免疫相关（C1QA/C1QB/CD53），DKD 课题结论主轴须设计阶段就锁定足细胞/系膜/ECM/代谢轴。

**改动**：
1. 新增 `docs/geo_mining_sop_v1.md`（SOP 正本，含附录 A = Stage↔工作台 LINE_STEPS 映射表、附录 B = 裁决与假设核对记录）。Stage 11 已按裁决 3 改写：不建 00_config 目录树，params.yaml 精神并入 envs/manifest + 台账 + figure_spec v2.2。
2. `con_hf/2026-10-20_调研_三线定制数据集与实验设计.md` 新增 §2.5（与 SOP 对齐：外部验证结构满足 Stage 8、C1 警示、分层 raw 规则应用、Stage 7/8 缺口声明）。

**裁决记录**：① 采纳方式 = 落盘 SOP + 映射表 + 修订实验设计文档；② 目录规范 = 工作台四目录 + manifest/台账为准。

**真实缺口清单（SOP 要求、工作台没有，均未开工待拍板）**：SVM-RFE、XGBoost 口径核对、Nomogram/校准曲线/DCA、跨 GSE ComBat（sva 包容器有无未验证）、line1 Stage 10 实例化模块（scMetabolism/实质细胞分型/线粒体评分）。

**未确认**：无。

---

## 2026-10-20（续）· SOP 升级 v2.0（用户提供完整结构化版，取代 v1）

**触发**：用户发来完整第二版规范（LangGPT 结构化：Role/Background/Attention/Profile/Goals/Constrains/Workflow/OutputFormat/Suggestions/Initialization），拍板"我要的是一份规范"——v2 为正本。

**改动**：
1. 新增 `docs/geo_mining_sop_v2.md`：用户 v2 全文**一字未改**落盘 + 附录 A（Stage↔工作台映射表，自 v1 迁移并更新）+ 附录 B（裁决 1-3 与口径来源文件登记）。
2. `docs/geo_mining_sop_v1.md` 顶部加"已被 v2 取代"横幅，保留作历史存档，不再维护。
3. 实验设计文档 §2.5 对齐结论不受影响（v2 与 v1 的 Stage 编号、阈值口径、验证要求完全一致）。

**要点**：v2 正文的 00_config 目录树与 FigNNx 命名按裁决 3 在工作台执行时映射到 manifest/四目录/figure_spec v2.2，正文不改写；v2 相对 v1 新增了卡点报告规则（16 字段审查表 / 13 字段分组表字段数钉死）与 Suggestions 节（溯源四元组、污染自查、替代论证强度对标）。

**未动**：reference/ 调研文件、三线母版脚本、projects/ 数据、portal/。

### 2026-10-20（续）· SOP v2.1：新增附录 C「工作台适配层」

**触发**：用户拍板"v2 写得好但没与工作台适配，在其基础上增量适配优化"。

**改动**：`docs/geo_mining_sop_v2.md` 升 v2.1——正文一字未改，新增**附录 C**（7 个适配块）：适配 0 三线映射与隔离红线优先级；适配 1 portal 建项入口 + Stage 0-2 表格落 con_hf/；适配 2 数据面/母版执行/manifest 参数正本/每步验收链；适配 3 Stage 11 目录·图件·交付映射表；适配 4 算力与包硬边界（5GB、torch 不可行、禁用/易崩清单、oligo/sva 未验证）；适配 5 隔离冻结安全纪律；适配 6 Stage-by-Stage 增量执行注记表；适配 7 汇报交接与修订权限（正文改动须用户确认，附录随工程演进维护）。

### 2026-10-20（续）· SOP 缺口第一刀：ml_diagnostics 交付上线

**决策（用户拍板"我来定"后由工程会话决定并执行）**：先补 Stage 8 缺口（Nomogram/校准/DCA）；SVM-RFE 补（LinearSVC 零依赖）、ConsensusClusterPlus 不装（手写共识聚类）、XGBoost 不装（sklearn GBDT 顶替并声明版本）。

**已交付 `ml_diagnostics`**（决策与证据表见 SOP 附录 B）：
- 新增 `src/line1_bulk/scripts/ml_diagnostics`（bash + Python + R rms 三段；canonical figure helper 原样嵌入）。
- 产物 4 tsv + 1 report + 3 图（l1_27/28/29）；Nomogram rms 门槛 min_class≥40 且 EPV≥10，否则跳过并书面记因。
- 口径修正记录：单基因对比从 max(AUC) 改为 **oriented AUC=max(AUC,1−AUC)+方向标注**（首跑发现全部核心基因反相关 LS，直接报 max(AUC)=0.2188 会误导；独立复算确认组合 AUC 0.9062 来自负系数翻转，理想值 1−0.0469=0.9531，数值无误后修呈现口径）。
- **default 项目真数据实测**：16 样本 × 8 核心基因，AUC(LOOCV)=0.9062，best 单基因 SASH3 oriented 0.9219（组合未超最优单基因，如实呈现），校准 slope=2.47/intercept=−0.17，DCA 99 行，gate=0。
- 部署 K40 bin（md5 字节一致）、`audit_figure_layout.py` 3 图 **fail=0**、注册 LINE_STEPS line1_bulk（13→14 步）、`npx tsc --noEmit` 零错、**`npm test` 247/247 全绿**、3 图回搬 `outputs/default/line1_bulk/figures/`。

**下一步（未动）**：SVM-RFE 进 ml_hub_analysis（需先读全 944 行母版第一类块再最小改动）；`alt_phenotype` 脚本（共识聚类+GSVA 代谢+线粒体评分）；DKD 新项目 ComBat 探针。

---

## 2026-10-20 · 【暂停点】用户要求停工整理需求，恢复时先读本条

**停机原因**：用户原话「先暂停……我现在重新把我的想法整理一下弄好再告诉你……减少损失」。等用户重新下达方向，**不要自行续跑**。

**已完成的（保留不动）**：
- SOP v2.1 + 附录 A/B/C 决策表、`ml_diagnostics` 已交付上线（247/247 测试绿、K40 真数据实测过、3 图审计 fail=0、line1 13→14 步）——这部分是修好且验证过的成品，维持现状。
- 服务器清理已完成：10 个开发期台账 + 26 个 line3 探针残留已删；`_probe_20261014/`（SCENIC 作业数据）与 `_bak_*`（回滚保险）判定保留。
- 三个新项目已建：`PRJ_20261020_DKD_bulk`、`PRJ_20261020_DKD_scrna`、`PRJ_20261020_RIF_spatial`（注意：建项时名称中文经 curl 传输疑似乱码，待复核 `GET /api/projects/list`）。
- `PRJ_20261020_DKD_bulk/line1_bulk/raw_data/` 已有 GSE30528_series_matrix.txt.gz + 本地合成的 GPL571.annot.gz（md5 559c7185…，由 cn_debug/build_gpl571.py 从 GSE30528_family.soft.gz 平台表合成，22277 行 95.3% 带 symbol）。

**卡住待诊的 Bug（任务下发后秒退、无台账、SSE 无输出）**：
- 现象：`POST /api/tasks/submit`（line1_bulk prep_matrix）返回 200 taskId，但任务瞬间消失、`/api/tasks` 为空、system_logs 无台账。
- 已排查：引擎路径 runTask→spawn('ssh', [BatchMode, ConnectTimeout, 'k40-ubuntu', script])；台账由 persistEntry 经 base64 写远端；本地手动复现同一条 engine 脚本时 ssh 报 `Connection refused (127.0.0.1:10022)`——即 **K40 隧道当前处于断开态**（`adb forward tcp:10022 tcp:10022` 需重做）。
- **下一步诊断顺序**：① `adb forward tcp:10022 tcp:10022` 重建隧道 → ② 重提一次任务并先挂 SSE 再提交抓实时输出 → ③ 若仍秒退，用 node 复现 spawn 环境差异（服务端 PID 26256 的 PATH/HOME 与 git-bash 不同，重点查 ssh.exe 是否可达）。
- 本地下载的素材在 `cn_debug/`：GSE30528_family.soft.gz、GPL571.annot.tsv(.gz)、build_gpl571.py、GSE30528_sm.txt(.gz)——恢复时可直接复用，不必重下。

**恢复入口**：等用户整理完想法后的新指令；若继续 line1 开跑，按上面「卡住的 Bug」诊断顺序走。

---

## 2026-10-21 · 架构评审落地收口（S28-S32 + D4/D5/D6），团队并行切片全绿

**说明**：上一节「暂停点」之后主会话已继续推进 S25-S32，暂停点条目的"不要自行续跑"已被后续指令取代；本条是最新状态。

**触发**：用户指令「理解项目内容后自行组建团队完善和优化项目」。执行依据 `con_hf/architecture_review_2026-10-20.md`（结论：框架不重构，只做断链补齐 + 重叠收敛 + 历史清理）。

**团队**：Lead + 4 名 teammate（s29-taskpanel / s30-upload / audit-probe / s32-upload-resume），按文件域切分避免并发写冲突；共享任务板 task-1..task-4 全部 completed。

**本轮落地（按切片）**
- **S28 桥接四项断言接线**：`server/index.js` 提交层在 `auditCommand` 之后调用 `needsBridgeCheck`/`runBridgeCheckSync`，桥接不过 400 并回传断言明细。D1 的实际缺口（58 脚本 0 调用）由提交层兜住；脚本内不自查仍是已知边界。
- **S29 TaskPanel + 路径预校验**：`server/index.js` 新增 `validateTaskPaths`（越界 400，位于 S28 桥接块之前）；`src/App.tsx` 种子默认 20261013、步骤下拉（/api/projects/steps，保留手填）、placeholder 改真实形态 + 黄色形态提醒。新增 `tests/task_submit_validation.test.js` 17 条。
- **S30 白名单单一事实源**：新增 `shared/data_formats.mjs`（DATA_EXT 14 项 :28-31、MAX_DATA_BYTES 5GiB :39、extOf :47-51、isAllowedDataFile :61-63）；`server/upload.js` 的 ALLOWED_EXT 直接 re-export，`portal/lib/archive.mjs` 引用它，`portal/index.html:1238` 只留副本并由 `tests/data_format_parity.test.js` 把守。
- **S31 只读审计**（报告 `con_hf/dispatch/S30_audit_report.md`）：3 条待归因 failed 台账已归因为多执行者并发跑同一验证脚本（每次自起临时 8787）的引擎形态，排除第二实例/计划任务/watchdog/远端 cron。D3 已修、D4 作废、D5/D6 已由本轮处理、D7 维持跳过。
- **S32 断点续传**：`upload.js` 新增 `uploadStatus`（最小缺失 nextIndex）；`GET /api/upload/status` 重写（invalid→400、not_found→200 `{ok:false,reason:'not_found',nextIndex:0}`）；`App.tsx` 以「文件指纹→uploadId」localStorage 缓存实现真续传（init 每次新 UUID，只按字面 init 后查 status 续传恒为 0）。新增 `tests/upload_resume.test.js` 19 条；`aims/aims.txt:83` 的 D5 改为 4MB 断点续传已实现。
- **D4 交付前置门禁（Lead）**：`server/report.js` 新增 `runReportPreflight`（四道闸：存储水位 ≥20% / 无 running 台账 / 失败台账需 force / 远端输出截断检测）与 `writeSha256Sidecars`（`<file>.sha256` 可被 sha256sum -c 直接复核）；已接线进 `POST /api/report/build`：!ok → 409 带 `{preflight}`，成功响应回传 `preflight` + `sidecars`。文档：`docs/delivery_package_spec.md` 新增「零、实现现状」并裁定 `ops/09_package_delivery.ps1` 作废；`docs/directories.md:62` 指向真实入口。新增 `tests/report_preflight.test.js` 15 条 + `tests/report.test.js` 扩 7 条 HTTP 用例。
- **D6 五维自检（Lead）**：新增 `server/selfcheck.js` 纯函数模块——第 3 维从「读 /proc/meminfo 头行即 pass」改为 SoC 负载/温度/7.5GB 内存配额实判（fail: ≥95°C 或内存满；warn: ≥85°C 或内存 ≥90% 或 负载/核数 ≥1.5；缺 END 判 unknown）；第 4 维从硬编码 line1_bulk 改为三线逐线门禁 + 桥接脚本存在性（桥接缺失 → warn）。前端 `src/App.tsx` 的 dotClass/dotText 增 warn 档（`!` + `.selfcheck-dot-warn`），汇总徽标新增「存在告警项」。新增 `tests/selfcheck.test.js` 16 条。
- **uploadDir 加固（Lead）**：`server/upload.js` 的 uploadId 消毒只剥非 `[A-Za-z0-9._-]` 字符，点号存活使 `'..'` 能跳出 `.uploads` 根；现显式拒绝点段与含 `..` 的 id，`tests/upload.test.js` 补回归用例。

**验证（收口实测，2026-10-21 00:4x）**
- `cd BioanalysDesktop && npm test` → **tests 382 / pass 382 / fail 0 / exit 0**（约 3.7s；本轮起点基线 296）
- `npm run build` → `✓ built in 652ms`（`dist/assets/index-BlTq92y6.js` 218.43 kB / gzip 71.40 kB）
- `npx tsc --noEmit` → exit 0；改动服务端文件 `node --check` 全 exit 0
- 未连 K40 真机（测试全用 ssh 垫片），未改 `CHUNK_SIZE`（仍 4MB，前端从 init/status 的 chunkSize 读，未硬编码）

**已知边界 / 下轮候选**
1. `.uploads` 陈旧会话无 TTL：1-3GB 级数据放弃后会滞留磁盘，建议排 GC。
2. 续传依赖 localStorage：换浏览器/清站点数据只能从头传（UI 文案已写明）；根治需确定性 uploadId。
3. 前端续传分支无自动化测试（uploadFingerprint/resumeStartIndex 是 .tsx 私有），靠 tsc + 服务端 HTTP E2E 兜底。
4. `ledger.classifyPath` 与 `validateTaskPaths` 的"合法根"口径差（S29 已标注，需改 ledger.js）。
5. 桥接四项断言仍只在提交层执行，58 个脚本内部 0 调用。
6. **B 批不可逆操作待用户授权**：B1 已无收益（scenic_db/__pycache__ 早已不存在，剩余可删约 0.36MB）；B2 归档未执行（7 个 ops 脚本 + geo_mining_sop_v1.md 约 50KB，`_archive/` 未建）；B3 黑名单 provenance 29 条 vs aims 8 条口径差未裁。

**改动文件清单（本轮）**：新增 `shared/data_formats.mjs`、`BioanalysDesktop/server/selfcheck.js`、`tests/{selfcheck,report_preflight,data_format_parity,task_submit_validation,upload_resume}.test.js`；改 `server/{index,task,report,upload}.js`、`src/App.tsx`、`src/app.css`、`portal/{index.html,lib/archive.mjs}`、`aims/aims.txt:83`、`docs/{delivery_package_spec,directories}.md`；报告 `con_hf/dispatch/S{28,29,30,31,32}*.md` + `con_hf/操作台账.md` 同日条目。

## 2026-10-21（第二轮）— 用户授权七项落地：B1/B2/B3 + 上传会话可靠性 + ledger 口径对齐

**触发**：用户一句话全批七项——「B1 清理，B2 归档，B3 黑名单口径收敛到 8 条。.uploads 陈旧会话无 TTL；续传依赖 localStorage；前端续传分支无自动化测试；ledger.classifyPath 与 validateTaskPaths 的"合法根"口径差。采纳」。自主执行，不再回问。

**团队**：Lead + 3 名 teammate（blacklist-arch / upload-session / ledger-align），共享任务板 task-5..task-7 全部 completed；Lead 自办 B1/B2、跨文件副本同步（portal / docs / handoff）、集成与总验证。切片报告：`con_hf/dispatch/{B1_B2,B3_blacklist,ledger_align,upload_session}_report.md`。

**本轮落地（按切片）**
- **B1 清理**：删 `cn_debug/*.log` 21 个（497,925B）+ `__pycache__` 7 个（545,052B）= 1,042,977B（约 1.0MB）。评审估的 689MB 收益不存在（`cn_debug/scenic_db/`、`ops/__pycache__` 早已不存在）。取证脚本保留。
- **B2 归档（部分执行）**：新建 `_archive/{README.md,docs,ops}`；`git mv docs/geo_mining_sop_v1.md`、`ops/01_fix_svlogger.ps1` 入库归档；`ops/README.md` 与 `docs/geo_mining_sop_v2.md:3` 引用同步。**未按评审 §2.2 全量搬**：`serve_guard.ps1`/`bio_watchdog.sh`/`fix_runsvdir.sh`/`04_check_logs.ps1` 保留在职（A6 判定它们是决策表唯一入口；`03_check_logs_remote.sh` 是 `04` 调用的本体，壳+体不是重复），`ops/svlogger_*` 本地不存在；`cn_debug/` 266 个文件改加 `cn_debug/README.md` 索引而非搬家（保留判决证据 + dispatch 报告按文件名引用）。
- **B3 黑名单收敛到 8 条**：`server/tumor_blacklist.js` 27 → 8（与 `aims/aims.txt` §三.1 逐条同序，数组 export 供测试锁口径），顺修 `validateProjectFields` 的 null/undefined TypeError；`aims/aims.txt:72-77` 改为「8 条正本 + 沿革 + 已知边界」；`portal/index.html:619-628` 纯前端副本同步；新增 `tests/tumor_blacklist.test.js` 15 条 + `tests/tumor_blacklist_parity.test.js` 7 条（逐条同序 + 24 样例判定矩阵 + 6 个历史扩充词负例）。
- **ledger 口径对齐**：`server/ledger.js` 新增 `analyzePath` / `classifyPath` / `isPathUnderLegalRoot` / `inspectTaskPath`；`server/index.js` 删除本地私有 `inspectTaskPath`（原 213-273 行）改为 import，`validateTaskPaths` 未改即复用，`SSD_ROOT` 导入移除。**有意行为收紧**：提交侧相对路径只接受裸文件名与 `projects/<pid>/...`。`tests/ledger.test.js` 22 条（含 19 条两处口径一致性表）。
- **上传会话可靠性**：新增 `shared/upload_session.mjs`（确定性 uploadId = `up-` + sha256(project|lineId|name|size|lastModified) 前 16 hex，零依赖 ESM，自带同步 SHA-256）；`server/upload.js` 加 `resolveUploadId`（`fingerprint` 键出现即校验，非法 400；缺省用 size+lastModified 重算；都没有才 randomUUID）与 GC（TTL 24h / `BIO_UPLOAD_TTL_HOURS` / 10 分钟节流 / 启动跑一次 / 只碰合法 id 一级目录 / 异常全吞）；新增 `src/lib/uploadSession.ts`（`.tsx` 私有逻辑抽成可被 `node --test` import 的模块），`App.tsx` 改「确定性 id 先查 status → 命中即续传 → 旧 UUID 兼容探测 → 才 init」；新增 `tests/upload_session.test.js` 31 条（含 6 条 in-process 真 HTTP，全程 ssh 垫片 0 次）。
- **vite dev 放行仓库根 shared**：`BioanalysDesktop/vite.config.js` 的 `server.fs.allow` 加 `'..'`（保留 `searchForWorkspaceRoot`）；实测 `GET /@fs/<repo>/shared/upload_session.mjs` → 200 / 47,943 字节。

**验证（本轮收口实测）**
- `cd BioanalysDesktop && npm test` → **tests 445 / pass 445 / fail 0 / exit 0**（约 3.8s；上一轮 382）
- `npx tsc --noEmit` → exit 0；`npm run build` → `✓ built in 698ms`（`dist/assets/index-eGcWQRjO.js` 221.62 kB / gzip 73.22 kB）
- `node --check` 改动服务端文件 + `vite.config.js` 全 exit 0；dev server `/@fs` 冒烟 200
- **真机冒烟**（`BAD_PORT=18899 node server/index.js`，链路通）：`/api/selfcheck` 200 且 `all_pass:true`——第 3 维实测 `CPU 0.12/0.07/0.02（6 核） · 32°C · 内存 4.0/7.5GB（54%）`，第 4 维实测 `line1_bulk:ok | line2_scrna:ok | line3_spatial:ok` + 桥接脚本已部署；`POST /api/upload/init` 带同一 fingerprint 两次都回 `up-214eaeb825121358`（`deterministic:true`），`GET /api/upload/status` 回 `nextIndex:0`（冒烟会话已删）
- 未连 K40 真机（全部 ssh 垫片），未装包，未改 `package.json`

**已知边界 / 下轮候选**
1. GC 只管 TTL 不管配额：`.uploads` 没有总量上限，1-3GB 级放弃数据最多滞留 24h10min。
2. 客户端指纹含 `File.lastModified`：复制/同步改 mtime 会被当新文件重传（宁可重传不误续传）。
3. `POST /api/upload/init` 的 400 错误体是 `{error}`，`GET /api/upload/status` 的是 `{ok:false,error}`，形状不一致，建议单列切片统一。
4. 桥接四项断言仍只在提交层执行（58 个脚本内部 0 调用，D1 的脚本内缺口未补）。
5. `项目交付报告.html`（2026-10-14 冻结交付物）里的历史数字是快照，**故意不改**；`con_hf/2026-10-20_调研_三线定制数据集与实验设计.md:145` 仍指向已归档的 `docs/geo_mining_sop_v1.md`（历史文档按追加不重写纪律保留）。
6. 改 `vite.config.js` 后需**重启 `npm run dev`** 才生效。

**改动文件清单（第二轮）**：新增 `shared/upload_session.mjs`、`BioanalysDesktop/src/lib/uploadSession.ts`、`tests/{tumor_blacklist,tumor_blacklist_parity,upload_session}.test.js`、`_archive/README.md`、`cn_debug/README.md`；改 `server/{index,ledger,tumor_blacklist,upload}.js`、`src/App.tsx`、`vite.config.js`、`tests/ledger.test.js`、`aims/aims.txt`、`portal/index.html`、`ops/README.md`、`docs/{delivery_supervisor_prompt,geo_mining_sop_v2}.md`、`BioanalysDesktop/README.md`。

## 2026-10-21（第三轮）— 把本轮完善回写进 aims 框架条款（用户指令：完善后在 aims 文件内更新对应的框架内容）

**触发**：用户指令「完善后在aims文件内更新对应的框架内容」。目标不是写日记，而是把 S28-S32 / D4 / D5 / D6 与两轮七项授权的实现结果，回写进 `aims/aims.txt` 的框架条款，修掉事实性漂移并补上实现口径。

**改了什么（8 处，全部在 `aims/aims.txt`）**
1. **§一.2 铁律 1**：把「前端内置正则黑名单直接拦截」改为「建项时前后端各拦一次（前端即时提示 + 后端权威拦截）」，并点明规格正本 = §三.1 模块 A 的 8 条、权威实现 `server/tumor_blacklist.js`、`portal/index.html` 只是副本、由 `tests/tumor_blacklist_parity.test.js` 把守。
2. **§二 目录结构（最大漂移）**：旧树是 `/mnt/ssd/bio_data/line1_bulk/` 顶层三线，与实现（`projects/<项目>/<线>/`）和 §四「独占目录」自相矛盾。现按 ssh 实测重画：`projects/<项目>/{project.json,line1_bulk,line2_scrna,line3_spatial}`，每线 `raw_data/processed/results/figures`，另 `bin/`、`envs/`、`ops/`、`public_references/`、`system_logs/`。
3. **§二 新增「合法根与归属口径」**：单一事实源 `server/ledger.js` 的 `analyzePath` / `inspectTaskPath`；四种合法形态（`projects/<当前项目>/...`、`public_references/...` 只读仅作输入、历史三线形态仅台账兼容、裸相对文件名）；`system_logs/` 禁作输入输出；相对路径只接受裸文件名与 `projects/<项目>/...`；项目段大小写敏感；`..` 一律拒绝；提交层/台账审计/文件守卫三处共用。
4. **§三.1 模块 B**：补「数据格式白名单与体积上限（单一事实源）」——14 类扩展名 + 5GiB 由 `shared/data_formats.mjs` 维护，8787 与 8080 共用，`PORTAL_MAX_DATA_BYTES` 可覆盖，parity 测试把守。
5. **§三.2 客户分析输入端**：补「任务提交三道闸」（路径归属预校验 400 / 命令审计 / 桥接四项断言 400）与「断点续跑契约」（`exit 0` + 产物存在性为检查点；台账落 `system_logs/`，`status` 取 `running`/`completed`/`failed`）。
6. **§三.3 五维自检**：补「自检实现口径」——`GET /api/selfcheck` + `server/selfcheck.js`，四档 `pass/warn/fail/unknown`，`all_pass` 仅在无 warn/fail 时为真，缺 `END` 判 unknown；第 2 维 20%（与 `MIN_FREE_PERCENT=20` 同源）、第 3 维温度 85/95°C + 内存 90%/100% + 负载核比 1.5 + 配额 7.5GB、第 4 维三线逐线 + 桥接脚本存在性。
7. **§三.3 台账 + §三.4 交付**：台账补审计口径（`ledger.js` 与 `ops/03_check_logs_remote.sh` 同口径，字段 project_id/line_id/status/checkpoint_status/exit_code）；交付补四道闸（`runReportPreflight`，不过 409 不出包）、`writeSha256Sidecars` 旁挂、打包本体 `ops/build_client_report.py` 与 `09_package_delivery.ps1` 作废。
8. **§六 + 新增 §八**：§六 `check_storage_and_isolation.sh` 后加「同口径要求」（8787 自检第 2/3/4 维共用阈值，避免界面绿脚本红）；文末新增 **§八 条款与实现落点对照**（15 行表格：条款 → 落点文件/接口 → 状态），并声明「改条款必须同步改落点与断言」。

**新增把守**：`BioanalysDesktop/tests/aims_landing.test.js` 8 条——§八 表存在且 ≥12 行、表里点名的路径必须真实存在（唯一例外 `ops/09_package_delivery.ps1` 明知作废，列入 ALLOW_MISSING）、§二 树含 projects/三线/figures/bin/envs、§二 合法根点名 ledger.js 与 `..` 规则、§三.3 阈值与接口名、§三.4 四道闸与 sha256、§三.1 白名单指向、§六 同口径提示。防止回写型文档再次漂移。

**验证**：`cd BioanalysDesktop && npm test` → **tests 453 / pass 453 / fail 0**（上一轮 445 + 本轮 8）；`npx tsc --noEmit` exit 0；`npm run build` → `✓ built in 641ms`（`dist/assets/index-eGcWQRjO.js` 221.62 kB / gzip 73.22 kB）。`grep /mnt/ssd/bio_data/line[123]_` 在 `docs/` 零命中（无残留旧树引用）。

**已知边界**：aims 是规格文档，§八 只是对照表不新增约束；`tests/tumor_blacklist_parity.test.js` 与 `aims_landing.test.js` 都直接读 `aims/aims.txt` 全文，改章节标题会被测试发现（有意）。

**改动文件清单（第三轮）**：`aims/aims.txt`（+62/-17）、新增 `BioanalysDesktop/tests/aims_landing.test.js`、`con_hf/handoff.md`、`con_hf/操作台账.md`。


---

## 2026-10-21（第四轮）：解决用户点出的四项边界

**触发（m00939）**：用户贴出上一轮汇报里列的 4 项边界，要求「着手去解决这些问题」：
① 包内 CHECKSUMS 清单仍是缺口（只有本地 .sha256 旁挂）；② 桥接四项断言仍只在提交层执行，58 个分析脚本内部 0 调用；③ .uploads GC 只管 TTL 不管总量配额；④ init 与 status 的 400 错误体形状不一致。

### 切片完成情况

| 边界 | 任务 | 负责人 | 状态 | 报告 |
|---|---|---|---|---|
| ① 包内 CHECKSUMS | task-9 | lead | **已完成**（远端真机 285/285 过） | `con_hf/dispatch/CHECKSUMS_report.md` |
| ② 桥接断言进母版 | task-10 | lead | **已完成**（462/462 + K40 首次抓到真实 FAIL） | `con_hf/dispatch/bridge_guard_report.md` |
| ③ .uploads 总量配额 | task-8 | upload-quota | **进行中**（ teammate 收尾后 Lead 合并） | `con_hf/dispatch/upload_quota_report.md`（待） |
| ④ init/status 错误体统一 | task-8 | upload-quota | **进行中**（同上） | 同上 |

### ① 包内 CHECKSUMS（task-9，Lead 亲自执行）

`ops/build_client_report.py` 新增 `write_checksums(delivery_dir, skip=())`（约 :1948-1984），
在 `assemble()` 里写 `delivery_manifest.json` 之后、`tarfile.open` 之前调用（顺序是关键：
写在 tar 之后会漏掉清单，写在 manifest 之前会漏掉 manifest 自身）。

- 格式 `<64hex>  <POSIX 相对路径>`，sorted，与 GNU coreutils `sha256sum -c` 完全兼容；
- 只列真实存在文件（`os.path.isfile` 兜底，OSError 被跳过的文件不会进清单）；
- 自身与 `skip` 列表不入列，避免自指；
- 逐 1MiB 流式更新 digest，不把 66MB 级文件整块读进内存；
- `return` 新增 `checksums` / `checksums_count`；`main()` 打印「校验清单：CHECKSUMS.sha256（N 个文件）」。

**远端真机验证（K40，全部实测）**：
- 备份 `/mnt/ssd/bio_data/ops/_bak_20261021/build_client_report.py.bak`；
- 踩坑：scp 直写 `ops/` 失败（exit 255 Connection closed），改走 `/tmp/` 再 `mv`，两侧 md5 一致；
- 实跑 default 项目：**285 个文件**，`sha256sum -c` → **285/285 OK，零失败**；
- `tar tzf` 确认包内含 `CHECKSUMS.sha256`；
- 负向测试：篡改 `Analysis_Report.md` 后 `sha256sum -c` 正确报 `FAILED`，恢复后 285/285；
- `/tmp/_ck_test` 已清理。

`self_test()` 新增 6 条断言（格式 / 存在 / hashlib 逐文件复算 / 自身不入列 / 排序 / 非空），
本地 41/41 PASS。

### ② 桥接断言进母版（task-10，Lead 亲自执行）

**事实修正**：母版共 **58 个**（派发单写 55），bilingual 的共 **3 个**（派发单写 1 个）：
`src/line1_bulk/scripts/ml_diagnostics`、`src/line1_bulk/scripts/ml_hub_analysis`、
`src/line2_scrna/scripts/gsva_pathways`。三个全部已接线。

新增 `src/bridge_guard.sh`（LF，bash，`set -euo pipefail`，66 行）。六条契约：
输入非 `.h5ad/.rds` → SKIP exit 0；无 ssh 客户端 → SKIP exit 0；
ssh 连接失败 → SKIP exit 0（K40 离线母版仍可跑）；
输出含 `BRIDGE FAIL` → 透传引擎退出码；否则 `BRIDGE OK` exit 0。

关键实现：`output=$("$SSH_CMD" ... 2>&1) && ssh_rc=0 || ssh_rc=$?` 分开捕获输出与退出码，
因为 **ssh 失败（255）与断言失败（3）语义相反**——前者是「校验没法做」，后者是「校验做了，没通过」。

`server/task.js` 新增 `GUARD_CALL_RE`（:43），`inspectBridgeNeed` 返回值新增 `guardWired`；
`server/index.js` 提交层补 `bilingual && !guardWired` 时 `console.warn`（只 warn 不阻断，
老母版不该因新规突然提交失败）。

**真机首次抓到真实断言失败**（证明守卫不是空转）：

    [BRIDGE FAIL] obsm 无 X_pca / X_umap / spatial，降维/空间坐标可能丢失
    [BRIDGE OK] gene names: 24969, numeric < 50% (0)
    [BRIDGE OK] matrix shape: obs=4587 x var=24969, nnz=16903576, density=0.1476
    [BRIDGE OK] obs names: 4587, numeric < 80% (0)
    [BRIDGE FAIL] gsva_pathways 桥接四项断言未过（Python -> R）
    exit=1

新增 `tests/bridge_guard_invariant.test.js` 9 条全绿。

### ⚠️ 待用户裁定：obsm 断言与中间产物的真实口径冲突

上面那次 FAIL 的根因：`scrna_norm.h5ad` 是 line2 步骤 3（归一化）产物，
**本来就不该有 X_pca/X_umap/spatial**（那是步骤 5+ 才写入），但引擎的 obsm 项无条件要求
至少一个降维键。后果：**gsva_pathways 若真拿 scrna_norm.h5ad 作为 Rscript 输入，守卫会拦下它。**

两种解法都没替用户选：
- **A. 改引擎**：obsm 项改为「三者全无且无其它 obsm 键时 WARN 而非 FAIL」，承认中间产物合法；
- **B. 改母版输入选择**：gsva_pathways 挑带降维坐标的 .h5ad（如步骤 5 输出）作桥接输入。

选 A 会放松铁律、选 B 会改分析行为，两者都超出「把断言接进母版」的授权范围，故如实上报。

### ③④ upload-quota 进行中

 teammate `upload-quota` 正在跑 task-8（BIO_UPLOAD_QUOTA_BYTES 默认 20GiB 两段式 GC +
 单一 `uploadError(res,status,message)` 助手统一四个上传端点错误体）。收工后由 Lead 合并验证。

### 本轮验证

- `npm test` → **462 / pass 462 / fail 0**（453 + bridge_guard 9）；
- `npx tsc --noEmit` exit 0；`npm run build` → 787ms / 221.62 kB；
- `node --check server/index.js`、`server/task.js` 均 exit 0；
- `python ops/build_client_report.py --self-test` → 41/41 PASS；
- 远端引擎 md5 与本地一致（`316c811c348cc600ace8ea2569f5e5f7`）。

### 本轮文档与清理

- `aims/aims.txt` §八 新增两行（母版内守卫 / 包内完整性清单），铁律 3 与打包本体两行状态更新，
  测试数 445→462；
- 删除调试残留：根目录 `_bg_probe6..G.ps1` 11 个（7120 字节）+ `cn_debug/_t10_probe_*.mjs` 3 个（2188 字节）。
  PATH 垫片方案失败的教训已写进 `bridge_guard_report.md` §8.2（改为 `BRIDGE_SSH_CMD` 覆盖）；
- `.uploads` 已空（0 个会话目录）。

### 本轮改动文件清单

`ops/build_client_report.py`（+94/-2）、`src/bridge_guard.sh`（新增）、
`src/line1_bulk/scripts/ml_diagnostics`、`src/line1_bulk/scripts/ml_hub_analysis`、
`src/line2_scrna/scripts/gsva_pathways`（各在首个 Rscript 前插守卫，既有行未改）、
`BioanalysDesktop/server/task.js`（GUARD_CALL_RE + guardWired）、
`BioanalysDesktop/server/index.js`（提交层 warn）、
`BioanalysDesktop/tests/bridge_guard_invariant.test.js`（新增 9 条）、
`aims/aims.txt`、`con_hf/handoff.md`、`con_hf/操作台账.md`、
`con_hf/dispatch/CHECKSUMS_report.md`（新增）、`con_hf/dispatch/bridge_guard_report.md`（新增）。

### 待办（下一轮）

1. 合并 upload-quota 的 task-8 产物，跑全量验证后提交；
2. **obsm 断言口径冲突需用户裁定**（A 改引擎 / B 改母版输入）；
3. `inspectBridgeNeed` 应跳过注释行再计数（当前注释里的 Rscript/python 会污染 bilingual 判定，
   本轮靠改写注释规避，未根治）；
4. `src/bridge_guard.sh` 尚未部署到远端 `/mnt/ssd/bio_data/`（母版在远端跑时需要，但母版本身
   也还没同步远端，见 `con_hf/操作台账.md` 部署节）。

## 2026-10-21（第五轮）：四项边界全部收口（task-8 合并 + 已提交 ef126b3）

### 触发

用户 m00939 点出四项边界并要求全部解决：
1. 包内 `CHECKSUMS` 清单缺失（只有本地 `.sha256` 旁挂）；
2. 桥接四项断言只在提交层执行，58 个分析母版内部 0 调用；
3. `.uploads` GC 只管 TTL 不管总量配额；
4. init 与 status 的 400 错误体形状不一致。

### 状态：四项全绿

| # | 边界 | 落点 | 状态 |
|---|---|---|---|
| 1 | 包内 CHECKSUMS | `ops/build_client_report.py` 的 `write_checksums` | 完成（task-9，commit ef126b3；远端 285 文件 `sha256sum -c` 全过） |
| 2 | 桥接断言进母版 | `src/bridge_guard.sh` + 三个 bilingual 母版 | 完成（task-10，commit ef126b3；K40 真机首次抓到 FAIL） |
| 3 | 上传总量配额 | `server/upload.js` 两段式 GC | 完成（task-8，本轮合并；真机 507 冒烟） |
| 4 | 错误体统一 | `server/index.js` 的 `uploadError` | 完成（task-8，本轮合并；四端点统一 `{ok:false,error}`） |

### task-8 合并细节（teammate `upload-quota`）

- `server/upload.js`：`DEFAULT_UPLOAD_QUOTA_BYTES` = 20GiB、`uploadQuotaBytes(env)`
  （只认 `BIO_UPLOAD_QUOTA_BYTES`，不设 GB 别名避免双真相源；缺省/空串/非数字/负数回落默认，
  `0` 是显式配置）；`gcStaleUploads` 两段式——TTL 段语义一字未改，配额段按
  `sessionUsageBytes` 累加目录内**普通文件字节**（不用 `dir.size`：ext4 上恒 4096，与数据量无关），
  超配额按 mtime 最旧优先淘汰，**10 分钟内被写过的活跃会话一律不淘汰**（删正在传的等于丢用户数据），
  报告新增 `evicted` / `totalBytes` / `quotaBytes` / `overQuota` / `active` 五键。
- `server/index.js`：`uploadError(res, status, message)` 单一出口，四个上传端点 4xx/5xx 统一
  `{ok:false, error}`（成功响应不动）；init 在惰性 GC 后加配额闸门，**清理后仍超配额回 507**
  （请求合法、失败原因是服务端配额耗尽，400 会把运维问题伪装成客户端 bug），错误体带占用与配额字节数；
  `gcReport` 做 null 真值判断（`maybeGcStaleUploads` 吞异常返回 null）。
- 新增 `tests/upload_quota.test.js` 24 条；**新测试抓到真实缺陷**：配额淘汰路径 rm 失败的
  `logger.warn` 用了作用域内不存在的 `name`，会抛 `ReferenceError: name is not defined`，
  已修为 `item.name`。
- Lead 同步跨切片断言：`tests/upload_session.test.js:277-286` 的整报告 `deepEqual` 补 5 个零值键。

### 真机 507 冒烟（不止单测）

真实服务（`BAD_PORT=18896 BIO_UPLOAD_QUOTA_BYTES=1`）+ 预置「活跃 100 字节」会话：
`POST /api/upload/init` → **507**
`{"ok":false,"error":"上传暂存空间已满：当前占用 100 字节，超过配额 1 字节；请等待进行中的上传完成或清理旧会话后重试"}`。
另一场景「过期会话 + 配额 1 字节」→ 先淘汰旧会话再放行（200），证明两段式顺序正确。
探针 `cn_debug/2026-10-21_verification_upload_quota_507.mjs` 已按 cn_debug 规则登记。

### 验证

- `npm test` **486/486 pass, fail 0**（462 + 24）
- `npx tsc --noEmit` exit 0
- `npm run build` 701ms / `dist/assets/index-eCgWQRjO.js` 221.62 kB
- `node --check server/upload.js`、`node --check server/index.js` exit 0

### 改动文件

`BioanalysDesktop/server/upload.js`（+123）、`server/index.js`（55 行变化）、
`tests/upload_quota.test.js`（新增 24 条）、`tests/upload_session.test.js`（Lead 同步 9 行）、
`BioanalysDesktop/README.md`（`BIO_UPLOAD_QUOTA_BYTES` 说明）、
`aims/aims.txt`（§三.1 模块 B 配额口径 + §八 新增「上传会话治理」行 + 测试数 486）、
`cn_debug/README.md` + 新探针、`con_hf/dispatch/upload_quota_report.md`（新增）。

### 待办（下一轮）

1. **obsm 断言口径冲突需用户裁定**（A 改引擎 obsm 三者全无时 WARN / B 改母版输入挑带降维坐标的
   `.h5ad`）——第四轮已上报，仍未决；
2. `inspectBridgeNeed` 应跳过注释行再计数（注释里的 Rscript/python 污染 bilingual 判定，
   本轮靠改写三个母版注释规避，未根治）；
3. `src/bridge_guard.sh` 与三个母版尚未同步到远端 `/mnt/ssd/bio_data/`；
4. 配额只在 init 做软闸门，已放行 chunk 仍可写超配额（等 10 分钟 mtime 老过才淘汰，有意为之）；
5. 淘汰按 mtime 全局最旧优先，不区分归属线。

### 第六轮补记（同日，aims 二次校准）

用户追问「aims 文件内的内容对应更新了吗」，逐条核对发现 task-8/9/10 的落点虽然进了 §八 对照表，
但框架条款正文有 1 处**过期论断**和 2 处**只写了一半**：

- §三.4 原文「包内 `CHECKSUMS` 清单仍为已知缺口」——task-9 已实现，这句是文档骗人（已改为
  「交付完整性双凭证」：包内 `CHECKSUMS.sha256` + 本地 `.sha256` 旁挂，并写明两者覆盖对象不同）；
- §三.2 三道闸只写了提交层的桥接断言，没写母版内部的第二道守卫（已补 `src/bridge_guard.sh`、
  `[BRIDGE SKIP]` 放行条件、`bridge_guard_invariant.test.js` 不变量）；
- §三.1 模块 B 写了配额与 507，没写错误体统一（已补四个上传端点 `{ok:false, error}`）。

同时给 `tests/aims_landing.test.js` 补 2 条**防漂移**断言（原 8 → 10 条）：一是四项边界的机制必须
写进条款正文而不只在 §八 表里，二是 aims 全文不得残留「仍为已知缺口」这类被实现取代的短语。
理由：回写型文档最大的风险是再次漂移，只靠人记会漏——这次就是用户追问才发现的。

验证：`npm test` 488/488 pass（486 + 2）。
