# 生信分析代码专项审核报告

审核范围：line1_bulk / line2_scrna / line3_spatial 三线共 50 个分析脚本（约 1.4 万行）+ 出图参考代码库。
审核方法：逐个脚本读源码 + 实测产物契约 + 与参考库对比。所有结论都带可复跑的取证命令。

## 一、审核结论摘要

| 审核项 | 结论 | 严重度 |
|---|---|---|
| ①分析逻辑正确性 | 主流程逻辑成立，但 L1 存在队列效应未在代码层强制拦截 | 高 |
| ②分析代码实现正确性 | 发现 3 处实现缺陷（详见第三节） | 高 |
| ③上下游依赖关系 | **成立**，产物契约对齐 | 无 |
| ④出图代码规范 | 配色/字号/DPI 基本合规，但存在中文字体渲染缺陷（已修） | 中 |
| ⑤真实代码出图合规性 | 出图可复现，但 L2 未出图 | 中 |
| ⑥参考库可参考性与价值 | 参考库 772 条 catalog，仅 30 条 ready，其余多为待拆分/依赖缺失 | 中 |
| ⑦**是否参考了参考库** | **否。这是最重要的发现** | **高** |
| ⑧按审核改码美化 | 已修 1 项（L3 中文方框），余项待办 | 中 |

## 二、最重要发现：出图代码没有参考参考库

### 2.1 证据

注册表 `src/figure_templates.json` 里 30 条 ready 模板**都登记了 source 指向参考库**：

```
fig_l1_groupedbar      -> reference/05.可参考出图代码/_meta/R453_compat/L1_rest_code.R
fig_l1_bubble          -> reference/05.可参考出图代码/_meta/R453_compat/L1_p0_gallery_code.R
fig_l1_connectedscatter-> reference/05.可参考出图代码/L2_组学常用图/L2p_cellcomm_autocorr_code.py
```

但**五个真实出图脚本一处都没引用参考库**：

```
line1_bulk/bulk_figures          : NO_REFERENCE
line1_bulk/enrichment_figures    : NO_REFERENCE
line2_scrna/scrna_figures        : NO_REFERENCE
line2_scrna/enrichment_figures   : NO_REFERENCE
line3_spatial/enrichment_figures : NO_REFERENCE
```

复跑命令：`Select-String -Path src/line1_bulk/scripts/bulk_figures -Pattern '05.可参考出图代码|R453|figure_library'`（无命中）。

### 2.2 这意味着什么

参考库被当作**登记元数据**（source 路径 + sha256 用于溯源），而不是**编写依据**。
出图代码是独立手写的 matplotlib/ggplot 实现，风格上与参考库接近（说明作者读过），但
没有基于参考库的源码改写。

后果：
1. **溯源链是名义上的**：注册表说「这个模板来自 R453_compat/L1_rest_code.R」，
   但实际产物并非该源码的改编，两者只是同名同用途；
2. **参考库的价值没有被吃透**：772 条 catalog 里的优质实现（配色、布局、统计标注手法）
   没有被系统性地转化进出图代码；
3. **门禁无法察觉**：`figure_templates_parity` 校验的是「注册表字段齐全 + source 文件哈希存在」，
   校验不了「出图代码是否真的源自该文件」。

### 2.3 建议处置（待裁定）

- **方案 A（默认）**：把 source 语义改成「参考来源」而非「派生来源」，注册表字段改名为
  `reference_source`，并在报告里如实声明「出图代码为独立实现，参考库仅供风格与手法借鉴」。
  成本低，一周内可完成，且诚实。
- **方案 B**：真的按参考库改编。选 3-5 个高价值模板（如 L2 热图、L3 桑基图），
  把参考库源码移植进出图脚本，建立「派生来源」的真实溯源。
  成本高（每个约 2-4 小时），但价值大。
- **方案 C**：两者并行——先做 A 诚实声明，再对 TopN 模板做 B。

## 三、分析代码实现缺陷（已发现 3 处）

### 3.1 L3 出图标题中文字体缺失（已修复）

**症状**：9 张空间定位图标题全部渲染成方框（`ATM / A_Ctrl□>0 □字 68 spot□`）。
**根因**：标题硬编码中文括号与中文，K40 容器 matplotlib 无中文字体。
**修复**：改纯英文 `ATM / A_Ctrl | >0 expression: 68 spots`（符合 figure_spec 英文标签口径）。
**状态**：已重跑 9 张图并目视确认（提交 `f57088b`）。

### 3.2 L1 队列效应未在代码层拦截（未修）

**症状**：`deg_limma` 只按阈值筛选显著基因，不检查「该基因是否在一组中 ≥95% 为零」。
**后果**：11,841/43,098（27%）单侧沉默基因混入显著列表，导致 AUC=1.000 的队列分类器假象。
**现状**：已在**报告层**用三张表（原始/性别校正/队列过滤）缓解，但代码层没有硬闸门。
**建议**：在 `deg_limma` 增加可选的 `--cohort-filter` 开关，默认输出诊断列
`is_single_side_silent`，让下游可以自己过滤而不必依赖报告说明。

### 3.3 L2 未产出任何图（未修）

**症状**：`figures/line2_scrna/` 目录不存在，单细胞线跑到 DEG/签名就停了。
**后果**：跨线报告里 L2 没有任何可视化证据（UMAP、marker 热图、细胞比例图都缺）。
**建议**：在 K40 上补跑 `scrna_figures`（768 行，最大出图脚本），产出 UMAP/点图/热图。

## 四、上下游依赖关系（审核通过）

三线各阶段产物契约对齐，实测：

```
line1:  prep_matrix  -> expr_genes.tsv + group_map.tsv
        qc_matrix    <- 上述两件（脚本内显式检查存在性）
        deg_limma    <- 同上
        enrichment_bulk <- deg_sig.tsv
        wgcna_modules   <- expr_genes.tsv
```

每条线的 QC 都在下游入口校验必需输入，缺失即非零退出（不是静默跳过）。

## 五、出图参考代码库的可参考性与筛选建议

### 5.1 库的现状（772 条 catalog）

| status | 数量 | 可用性 |
|---|---|---|
| k40_verified | 16 | **高价值，可直接参考** |
| split_materialized | 23 | 高价值，已拆分可直接用 |
| split_code_ready | 59 | 可用，需少量适配 |
| generic_candidate | 426 | 低价值，通用候选，需筛选 |
| needs_split | 178 | 需拆分才能用 |
| blocked_* (dependency/code/network) | 29 | 不可用 |
| image_missing | 28 | 缺图，参考价值下降 |

### 5.2 筛选建议

**第一梯队（值得优先参考，39 条）**：`k40_verified` + `split_materialized`。
这些既有真机验证又有拆分产物，是转化进母版的最佳来源。

**第二梯队（按需参考，59 条）**：`split_code_ready`。

**不建议参考（633 条）**：`generic_candidate` + `needs_split` + `blocked_*` + `image_missing`。
理由：要么没有可用产物，要么只是通用候选、与本研究场景无关。

**具体做法**：先按 `bio_level`（L1/L2/L3）与 `plot_type` 建索引，把第一梯队 39 条映射到
现有出图步骤，逐条评估「现有实现 vs 参考实现」的差距，只移植确有改进的部分（配色、标注、布局）。

## 六、待办清单（按优先级）

1. **P0**：裁定「参考库语义」（方案 A/B/C），决定是否真的按库改编；
2. **P1**：`deg_limma` 增加队列效应诊断列（可选过滤开关）；
3. **P1**：补跑 L2 出图，让跨线报告有单细胞可视化证据；
4. **P2**：按第一梯队 39 条逐条对比现有出图实现，移植有价值的改进；
5. **P2**：出图规范专项复查（字号/DPI/配色/图注位置逐图核对）。

## 七、复跑与取证入口

```powershell
# 验证出图脚本未引用参考库
Select-String -Path src/line1_bulk/scripts/bulk_figures -Pattern '05.可参考出图代码|R453'
# 查看参考库状态分布
node ops/figure_ready_matrix.mjs
# 三线脚本规模
Get-ChildItem src/line1_bulk/scripts,src/line2_scrna/scripts,src/line3_spatial/scripts -File
```
