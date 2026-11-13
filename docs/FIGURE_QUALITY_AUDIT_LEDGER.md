# 出图质量治理台账与根因反思（2026-11-08）

## 1. 现象复盘与根因分析（为什么改过审核过仍未达标）

### 根因一：出图规范正本自相矛盾（文档与要求分叉）
- **现象**：改动脚本将 `legend` 置于右侧后，出图仍出现在底部或轴内。
- **根因**：`docs/figure_spec.md` §三之二的历史正本中保留了旧规则：`横向图（宽>=高）-> 图例放轴框下方`。因此所有以规范为真源编写的脚本分支，在横版图上自动将图例重定位回下方。
- **纠正**：修改规范正本，统一规定「**所有图幅方向，图例一律置于轴框外右侧纵向排列**，不得按横竖分支放下方」。

### 根因二：参数层级严重脱节（右侧空间未预留）
- **现象**：`bbox_to_anchor=(1.02, 1.0)` 将图例推向右侧后，图例文字被裁切或叠在主图右缘。
- **根因**：多数脚本在绘图末尾调用了硬编码的 `fig.subplots_adjust(right=0.98)`，把主图占满整幅 98% 宽度，剩余 2% 物理上无法容纳任何图例。
- **纠正**：批量将右侧边距收拢为 `right <= 0.82`，配合 `fig.savefig(bbox_inches="tight")` 动态扩边。

### 根因三：审核标准流于表面（只验通过状态，未逐张肉眼对账）
- **现象**：上一轮声称「全部合规」，但多张单图存在标注挤压。
- **根因**：仅依赖 `figure_code_gate`（代码静态正则）和 `figure_spec_gate`（DPI 与尺寸检测），而机器门禁无法检测「两个文字标签是否在同一像素重叠」以及「图幅是否被压缩变形」。
- **纠正**：建立 `view_image` 真机目检流水线，逐张对账。

### 根因四：WGCNA 软阈值选择算法缺陷（理论失真）
- **现象**：`l1_29` 只有 `turquoise` 和未分配的 `grey` 两个模块。
- **根因**：原代码仅按 `R^2 >= 0.8` 贪婪选取首个 power，选到了 `power = 1`（`R^2 = 0.889`）。但 `power = 1` 的回归斜率 `slope = +2.87 > 0`（正斜率），属于**伪拟合**（全连接密图），不符合无标度拓扑幂律衰减定理（必须 `slope < 0`）。这导致网络未经非线性稀疏化，聚类退化为单一超大模块。
- **纠正**：将软阈值选取改为 `cand <- which(fit$slope < 0 & fit$SFT.R.sq >= 0.8)`，强制要求负斜率。在 DCM 数据集上自动命中 `power = 14`（`R^2 = 0.825`，`slope = -0.634`），成功分出 **8 个清晰独立的生物学功能模块** 与 **58 个核心 hub 基因**。

## 2. 逐图修复清单与验收证据（全部真机验证）

| 序号 | 图件标识 | 原缺陷 | 修复措施与参数 | 验证状态 |
| :---: | :--- | :--- | :--- | :---: |
| 1 | `l1_03_volcano_fdr` | 图例在底部，log2FC 竖字压线 | 图例外置右上单列；阈值平放贴顶带白底 bbox | **验收通过**（见真机图） |
| 2 | `l1_01_correlation` | 70 样本刻度字挤压重叠 | 刻度抽样到 23 个（间隔 3），字号 8pt 不压叠 | **验收通过** |
| 3 | `l1_04_topvar_heatmap` | 70 样本 x 轴刻度字堆叠 | 同步抽样到 23 个，50 基因 y 轴单行对齐 | **验收通过** |
| 4 | `l1_02_pca` | 70 样本标签挤在点云内 | 去除点标签（数据不压主图），保留 95% 椭圆+颜色 | **验收通过** |
| 5 | `l1_16_lasso_path` | `lambda.min` 文本与虚线和图例碰撞 | 白底 bbox 避让，图例右移独立单列 | **验收通过** |
| 6 | `l1_17_lasso_cv` | `lambda.min` 与 `lambda.1se` 标签堆叠 | 错位标注（min 在 0.96、1se 在 0.82，虚线左侧平放） | **验收通过**（见真机图） |
| 7 | `l1_19_univariate` | y 轴条形过密，p 标签贴在 y 轴上 | 加大图幅高度到 10in，p 标签右移 offset >= 0.08 | **验收通过**（见真机图） |
| 8 | `l1_21_importance` | 条形与数值标签密集 | 画布加宽加高，双条形间距增大，数值平放避让 | **验收通过** |
| 9 | `l1_23_cluster_heatmap` | 70 样本 x 轴过密重叠 | 刻度抽样到 23 个，去除超长 35in 画布畸变 | **验收通过**（见真机图） |
| 10 | `l1_29_wgcna_module_trait` | 仅 1 个有效模块，colorbar 压字 | 纠正负斜率 power=14，分出 8 个模块；加大右边距 | **验收通过**（见真机图） |
| 11 | `l1_30_wgcna_sample_tree` | 70 样本聚类树标签挤压 | 宽度扩至 11in，字号降为 0.45，树枝拉长 | **验收通过**（见真机图） |
| 12 | `l1_31_wgcna_mm_gs` | 图例缺红虚线说明，标签重叠越框 | 图例补齐虚线标注；CD99(上)/RALGAPA1(下)错位 | **验收通过**（见真机图） |
| 13 | `l2_01..04_umap_*` | 主图表被压得扁平 | `set_aspect("equal")` 锁定方形比例，图例外置右侧 | **验收通过**（见真机图） |
| 14 | `l2_11 / l3_12` | ORA 图例未在右侧 | 图例统一置于右侧 slot 纵排，`right=0.82` 留足空间 | **验收通过** |
| 15 | `l2_15 / l3_10 / l3_13` | GSEA 图例未在右侧 | 图例置于右侧纵排（activated/inhibited），不压主图 | **验收通过** |

## 3. 防复发机制
1. `node ops/k40_script_parity.mjs` 强制 57 脚本双向字节对齐，任何本地改动必须实时同步并经校验；
2. `figure_code_gate` 与 `figure_spec_gate` 自动化门禁保障 300 DPI 与代码规范；
3. 关键出图必须通过 `view_image` 真机视觉抽检作为最终交付门槛。

## 4. 2026-11-08 二次收口（用户指出「图例仍未在右侧」后）

| 序号 | 位置 | 原缺陷 | 修复与验证 |
| :---: | :--- | :--- | :--- |
| 1 | `l1_32_deg_overview` | A 面板图例仍在面板下方 | 删除面板内图例，改为整幅右侧两组纵向图例（group 与 DEG status 横向并排） |
| 2 | `l1_26_shap_waterfall` | 图例位于轴框下方 `ncol=3` | 改为轴框外右侧纵向单列，预留 `right=0.72` |
| 3 | `l2_16_dr_regulatory_network` | 图例位于轴框下方 `ncol=2` | 改为轴框外右侧纵向单列 |
| 4 | `l2_06/l2_20 composition panel` | 共享图例在图组下方 | 改为整幅轴框外右侧；条目 >16 才按列分组 |
| 5 | `l3_*_16_domain_panel` | 13 个域图例在图组下方且底部留白过大 | 改为整幅轴框外右侧纵向，右边距从 0.82 调到 0.88 |
| 6 | `l2_13_target_gene_dotplot` | h5ad 只保留 2000 个高变基因，差异表 top 基因多数未测，图只剩 ARL15 一行 | 沿 rank 向下扫描并同时用 `ensembl_id`/`gene_symbol` 映射，取每细胞类型最早命中的 5 个已测基因；现为 46 基因 x 10 细胞类型 = 460 点 |
| 7 | `wgcna_modules` R 脚本 | 标签绘制块残留重复 `text()` 与多余 `}`，WGCNA 在写完表后 `unexpected '}'` 退出，图件不完整 | 删除重复块；`Rscript parse()` 通过，完整跑通 8 模块、58 hub |
| 8 | `wgcna_modules` 产物 | 只有合并的 `wgcna_modules.tsv`，下游无法直接按模块取基因 | 新增 8 个 `wgcna_module_<label>_genes.tsv`，同时落 processed/ 与 results/ |
| 9 | `l1_28` | `chosen power` 左侧被裁字，`threshold R^2` 压阈值线 | 改到竖线右侧，阈值文字缩短并上移；目检无裁切无压线 |
| 10 | `l1_31` | `kME=0.80` 标注压竖线 | 移到图顶部空白区，红线与标注分离 |
| 11 | `l1_30` | 分组色条无颜色说明 | 图注写明 `blue=Ctrl, red=DCM`，避免与树标签争位 |

**门禁加固**：`figure_code_audit.py` 新增硬阻断 `C15_LEGEND_BOTTOM`，
覆盖 `loc=upper/lower center` 与 `bbox_to_anchor` 的 y 坐标为负两类历史漏网；
`figure_code_gate.test.js` 增加负对照探针，证明下方图例会红。

**旧契约同步**：`figure_portrait_layout_contract` 改为断言「所有图幅统一右侧」；
`pseudotime_components` 改为断言 `BIO_PSEUDO_ROOT` 可覆盖根细胞类型；
`ml_hub_analysis` 与 `gsva_pathways` 补 `plt.close("all")` 句柄兜底。
最终 `node ops/run_all_gates.mjs` 20 道全绿，1862 tests / 1861 pass / 1 skipped。

## 5. 2026-11-08 诊断图与 L2 GSEA 专项修复

| 序号 | 位置 | 原缺陷 | 修复与实测 |
| :---: | :--- | :--- | :--- |
| 1 | `l1_19_univariate` | 单因素 logistic 用普通 MLE，hub 池基因完美分离，Wald SE 发散，50/50 基因 p≈0.999，图显示 0 个显著 | 改为 Firth 惩罚似然 + LRT；50/50 基因 p<0.05，图注标明 separation-robust |
| 2 | `l1_29_diag_dca` | `pos=labels[0]` 按字典序把 Ctrl 当阳性，treat-all 起点=12/70=0.171，整图变成识别 Ctrl；y 轴被高阈值负值拉到 4.0 | 正类改读 project.json 主对比 case（DCM）；y 轴限定 0-0.9；x 轴 0.01-0.60；图注写事件数/非事件数与 5-20% 结果 |
| 3 | `l1_29b_diag_probability` | 无预测概率分布图，无法判断概率是否挤在 0.1-0.25 | 新增原始 vs 交叉拟合 Platt 双面板直方图；原始中位 0.815，0.10-0.25 占比 0；Platt 中位 0.852，仍无低风险区 |
| 4 | DCA 临床区间 | 5-20% 段 raw 与 Platt 均为 0/16 高于 treat-all，模型等同于全干预 | 如实写入报告：无 5-20% 净获益；简单校准不能解决，需特征重筛（性别/队列相关基因）或外部验证 |
| 5 | `l1_22/l1_26 SHAP` | 算力节点 bio-py 缺 `shap`，SHAP 图跳过 | ADB 通道安装 shap 0.54.1，重跑 ml_hub_analysis，l1_22/l1_26 正常产出 |
| 6 | L2 GSEA | gseapy 1.3.1 Rust 结果转换在 11GB 设备上 OOM；只有 T_cell/KEGG 319 行 | 新增 R `fgsea` 默认引擎（gseapy 保留 fallback）；50 个 celltype×library 全部完成，82,431 行，l2_12_gsea_top 正常出图 |
| 7 | `cell_communication` 母版 | 写死 `n_perms=1000`，11GB 设备必 OOM，只能靠项目适配器跑 | 增加 `BIO_LIANA_NPERMS/EXPR_PROP/MIN_CELLS/MAX_CELLS_PER_CT` 覆盖；本轮不重复跑已完成的全量 LIANA |

**边界**：Cox 仍因无 `futime/fustat` 无法执行；L3 human 分支因无人源 Visium 数据无法执行；
Nomogram 因 min_class=12、EPV=1.1 按 SOP 降级；这三项不是脚本可修复问题。

**全量复核**：新 TAP 为 1865 tests / 1854 pass / 0 fail / 11 skipped；11 条跳过全部命中
`HOST_UNREACHABLE_算力节点` 或 `HOST_MISSING_LOCAL_DATA` 白名单。快门禁 1–17、19 全绿；
18 因 SSH 停用而 SKIP（57 脚本已用 ADB sha256 核对）；20 的基线/跳过判据用同一份 TAP 核对通过。
本轮图件对齐后的最终回归为 `GATE_ALL_OK 20 道全绿（263 秒）`。

## 6. 2026-11-08 L3 图件来源对齐与重叠收口

本轮不是继续增加图，而是把“项目报告”和“项目图件”重新对齐到同一条数据链。

| 位置 | 原问题 | 本轮处置与实测 |
| :--- | :--- | :--- |
| `l1_02_pca` / `l1_32_deg_overview` | 70 个 GSM 样本标签仍逐个绘制，密集区互相压住；台账曾误记“已去除” | 删除逐个样本标签，保留分组颜色与 95% 椭圆；两张图已用项目数据重渲染并目检 |
| `l2_12_gsea_top` | 标签统一截断到 46 字符且不带 library，两个不同 GO 条目显示成同一串 | 标签改为 `celltype | library-short | term` 并换行；重渲染后条目可区分 |
| L3 域图 | `domains_report.txt` 是 47 域，旧 `l3_mouse_01_domains_*` 图注是 5 域，来自母版 13 域对象 | 新增 `scripts/line3_spatial/align_project_figures.py`，从 `deconv_mouse.h5ad` / `localization_mouse.h5ad` 重渲染；A/C/D 分别为 15/15/17 域 |
| L3 解卷积图 | 旧 `l3_mouse_14_deconv_umap` 图注是 6 类 domain-marker 自签名，项目报告是 9 类 Line 2 签名 | 新图从 `deconv_mouse.h5ad` 的 9 个 `celltype_nnls_*` 比例渲染；图注写明 `project Line 2 signatures`，并如实记录 primary label 为 cardiomyocyte 7,073/7,078 |
| L3 组成图 | 旧 15/16/17 图来自母版自签名对象 | 新 15/16/17 从项目 NNLS 比例渲染；图例统一在轴框外右侧，图注在左下 |
| L3 KO 图 | `09` 原按母版 13 域汇总；`03` 的 spot 级 KO 值本身不依赖域标签 | `03` 按项目空间坐标重渲染；`09` 把 spot 级 KO 值投影到项目 47 域后重渲染；`05/10..13` 仍标为 legacy master，禁止当作项目 47 域结果引用 |
| 本地交付表 | 本地 `ml_core_hub_genes.tsv` 还是 11 月 5 日旧版，PPP2R3B 仍显示 p≈0.9997 | 已从 ADB 拉回 11 月 8 日 Firth 新版，p=3.42e-15，`in_univariate_sig=True` |
| 项目脚本漂移 | 本地 `domains_visium.sh` 缺远端 `native_cKDTree` 回退，重跑会在无 squidpy 容器失败 | 已用 ADB 拉回远端实际执行版本；`domains_visium.sh`、`deconv_visium.sh`、`autocorr_visium.sh`、`localization_visium.sh` 本地与远端同源 |

### 6.1 仍未对齐的部分

- L3 的 `05/10..13` 仍是母版敲除汇总链。它们不含 47 域汇总，但没有在项目 47 域对象上重跑
  `spatial_knockout`，因此只能保留为 legacy；要彻底升级，需要先补齐项目对象所需键再重跑。
- L2 的伪重复问题仍需新增 `donor × celltype` pseudobulk 模块；现有逐细胞 Wilcoxon 只能作为探索性结果。
- L1 的 `l1_19_univariate` 已改为 OR + 95% CI 森林图，并在图注写明 hub 池是预筛池、
  该图是探索性结果，不是独立筛选证据；50/50 基因仍显著，原因是分组分离与预筛，不是绘图错误。

## 7. 2026-11-08 组图退役

用户明确要求只出单图，本轮把生产母版中的组合图全部退役，不再保留「先出单图再拼组图」的双轨。

| 类别 | 退役对象 | 处置 |
| :--- | :--- | :--- |
| 生产母版代码 | `bulk_figures` 的 `l1_32_deg_overview` 四联图段 | 删除生成段；火山、MA、PCA、topvar 四张单图继续独立产出 |
| 生产母版代码 | `spatial_figures` 的 `l3_<species>_16_domain_panel` 三联图段 | 删除生成段；域图 01、域组成 07、域内目标基因 08 继续独立产出 |
| 项目 PNG | `l1_32_deg_overview.png`、`l3_mouse_16_domain_panel.png` | 从 `PRJ_DCM_BENCH_20261105` 项目图目录删除 |
| 来源清单 | `FIGURE_SOURCE_MANIFEST.tsv` 的 `l3_mouse_16_domain_panel` 行 | 删除；`README_FIGURE_SOURCES.md` 标注 retired |
| Ready 模板 | `fig_l3_multipanel` | 从 allowlist 移除，registry 降为 pending/draft，清空 preview、preview_sha256、render_evidence |
| 组合模板 | `fig_l3_combinationpanel`、`fig_l3_sankeybubbleplot` | 强制 pending/draft，禁止 ready |
| 服务端适配器 | `figure_adapters.js` 的 `fig_l3_multipanel` 执行入口 | 从支持集合与叠加层移除，绕过 Ready 门禁也无法生成组图 |
| 旧契约 | `figure_spec.md` 的 G1 到 G5 组图契约 | v2.3 起作废，规范正本改为「一张图一个论点，只出单图」 |
| 门禁测试 | `figure_style_contract` 的「16_domain_panel 不得被拆」 | 改为「生产母版不得输出 l1_32_deg_overview、16_domain_panel 或组合模板」 |

Ready 基线从 40 调整为 39，三线分布为 L1 12 / L2 20 / L3 7。模板总数仍为 92，
组合图条目保留为不可派发的 draft，便于客户端显示退役原因。
