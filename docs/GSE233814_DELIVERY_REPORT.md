# GSE233814 双项目交付报告（2026-11-06）

> 数据：GSE233814（小鼠 pMCAO 10x Visium，GPL24247，5 样本；Control=Sham 1 例，Disease=pMCAO 4 例 Day1/3/3/7）。
> 运行面：K40 proot Ubuntu（aarch64），`nice -n 10` 降权，seed=20261013 全程一致。
> 出图：47 张 PNG 实测 **300 DPI** 合规，已纳入 `ops/figure_spec_gate.mjs` 强制名单。

## 一、执行结果

| 项 | P1 `PRJ_STROKE_P1_SPATIAL_ABCA1` | P2 `PRJ_STROKE_P2_SPATIAL_LACTPYRO_5GENES` |
|---|---|---|
| 步骤 | 17 / 17 全通过（`P1_ALL_DONE`） | 15 / 15 全通过（`P2_ALL_DONE`） |
| 图件 | 28 PNG（+ manifest / report） | 19 PNG |
| 中间表 | 16 TSV、13 h5ad | 13 TSV、12 h5ad |
| KO 扰动 | `ko_gene=Abca1`（读自 project.json），48 个显著 DR | 不适用（需求未含敲除） |
| 溯源 | `input_sha256=...sampled:2d523a5b...`、逐图 render_ms 22 条 | 同（render_ms 15 条） |

空间域：两项目共用同一份数据，均为 **52 域**（逐样本 8–12 域），
Leiden res=0.5（探针双跑比 1.0 连贯性更高且碎片域更少）。

## 二、核心发现（focus 基因按先验定位，非 de-novo marker）

先说明口径：10 个 focus 基因**都不在各域 top200 de-novo marker 里**。
这是预期结果而非缺陷：它们来自前期机器学习筛选，属「先验基因在空间上的验证」，
正确判据是组间差异与域内富集，下表即按此给出。

### P1 线粒体能量-脂质代谢（Abca1 / Akt1 / Sox9 / Adipor2 / Dpm1）

| 基因 | Control | Disease | log2FC | 最高富集域 |
|---|---|---|---|---|
| **Abca1** | 0.127 | 0.214 | **+0.709** | C1-D7_d6=0.877、D1-D7_d6=0.681 |
| Adipor2 | 0.264 | 0.325 | +0.291 | C1-D7_d4=0.870、B1-D1_d3=0.784 |
| Sox9 | 0.111 | 0.125 | +0.167 | B1-D1_d11=0.467 |
| Akt1 | 0.492 | 0.502 | +0.029 | B1-D1_d2=0.733 |
| Dpm1 | 0.626 | 0.479 | **−0.378** | C1-control_d2=0.737（对照侧高） |

支持性通路富集（域级 ORA）：
`D1-D7_d2 Oxidative phosphorylation adj p=1.3e-26`、
`B1-D1_d9 Oxidative phosphorylation adj p=7.4e-21`、
`D1-D7_d2 Mitochondrial ATP Synthesis Coupled Electron Transport adj p=3.2e-20`。

解读：Abca1（胆固醇外流）与 Adipor2（脂联素受体）在**Day 7 修复期**域内高表达，
与氧化磷酸化通路同步上调，方向与「半暗带能量-脂质稳态重建」一致；
Dpm1 反向下降。Abca1 敲除扰动给出 48 个显著 DR 基因（含 Apoe、Plp1 等脂质相关）。

### P2 乳酸化-焦亡（Myh9 / Egr1 / Gstp1 / Epha4 / Tjp1）

| 基因 | Control | Disease | log2FC | 最高富集域 |
|---|---|---|---|---|
| **Gstp1** | 0.095 | 0.340 | **+1.734** | B1-D1_d3=0.938、C1-D7_d4=0.867 |
| Myh9 | 0.082 | 0.168 | +0.959 | D1-D3_d4=0.825、C1-D7_d6=0.520 |
| Tjp1 | 0.193 | 0.213 | +0.135 | C1-control_d11=0.440 |
| Egr1 | 0.587 | 0.497 | −0.237 | C1-D7_d5=1.258 |
| Epha4 | 0.434 | 0.348 | −0.309 | C1-control_d7=1.045 |

解读：**Gstp1**（氧化应激/谷胱甘肽代谢，乳酸化修饰候选靶）疾病侧近 3.6 倍，
是本次两项目中最强的单基因信号；Myh9 近 2 倍，与内皮/屏障相关。
Tjp1（紧密连接）仅微升，提示屏障结构损伤可能以蛋白定位而非转录上调体现。

## 三、诚实边界（必须写进交付）

1. **Control 只有 1 个样本**（n=1 vs n=4）。所有组间 log2FC 是**探索性**观察，
   不构成统计推断结论，不得用于宣称效应量。域级富集的 adj p 反映的是
   域间 marker 集合差异，不是疾病-对照差异检验。
2. **坐标来自跨数据集的 Visium v1 全局布局表**（`reference/06.Visium_v1_载玻片布局/`）。
   已验证：GSE233814 的 `oligo` 序列与 GSE218759 的 `tissue_positions` 逐条一致
   （mismatch=0），5 样本 barcode 100% 命中。但这是**同规格载玻片假设**，
   若上游曾换过芯片批次需复核。
3. **无组织底图叠加**：GSE233814 只给 1.7 GB 全分辨率 TIFF，未提供 lowres PNG。
   空间图仅用坐标绘制，不叠加 H&E/荧光底图。
4. **sanity 基因降级为 WARN**：`Cd5l`（肝库普弗细胞标记）等按肝脏数据集选定的
   sanity 基因在脑组织中本就不高表达，已改为「全缺席才判失败」，
   面板实测值如实写入报告供人工判读。
5. P2 的 `Lact`/「Pyropt」相关 term 命中数分别为 8 与 7，
   远少于线粒体相关（1104），**乳酸化-焦亡轴在本数据上的转录层证据弱于代谢轴**。

## 四、产物位置

| 位置 | 内容 |
|---|---|
| K40 `/mnt/ssd/bio_data/projects/<PID>/line3_spatial/{processed,figures,results}` | 全部中间产物与图件 |
| 本地 `local_projects/<PID>/figures/line3_spatial/` | 图件回搬（P1 30 文件 / P2 21 文件） |
| `figures_manifest.txt` | 逐图 size + render_ms + input_sha256 |

## 五、本轮为跑通这两个项目所做的代码修复

| 提交 | 内容 |
|---|---|
| `c4c4222` | ingest 支持 mtx 三件套与单物种 soft |
| `f597f1e` | 单物种时 uns `source_soft_*` 写空串占位（保 11 母版 REQUIRED_UNS） |
| `8ca775d` | 9 个步骤双物种硬要求改为「至少一份」 |
| `81a6d78` | 4 个下游步骤按实际产物推导物种集合 |
| `f6a5d22` | 正则适配真实 tar 命名（kind 在末尾、短名含连字符、双套短名） |
| `3a9bad4` | 固化 Visium v1 载玻片布局表（4992 spots） |
| `b0662c8` | ingest 无条件写 `uns["warnings"]` |
| `e0f2572` | 补 2 处缺失的 `fail` 定义 + 辅助符号契约测 |
| `23604ea` | sanity 断言降为「全缺席才 fail」 |
| `58c3104` | autocorr 肝分区断言换成 I 分布富尾不变量 |
| `b49ce79` | 补 line3 两份母版的 input_sha256，B4 契约改动态发现 |
| `38ee16f` | 两项目纳入 300 DPI 强制名单 |

## 六、门禁与测试

- 全量测试：**1690 tests / 1689 pass / 0 fail / 1 skipped**（须串行独跑，与 P1/P2 并发跑会出现假失败）
- 总门禁：17 道全绿
- `FIGURE_READY_MATRIX_OK` 30 条 Ready 证据链完整
- `FIGURE_SPEC_OK` 全部图件符合 300 DPI

## 七、用户复核后的问题修复（2026-11-06 上午）

### 7.1 图例与图注位置不合规（用户指出 l3_mouse_01_domains_* 等）

**问题**：图例与图注没有落在主图框外的右侧。

**根因**：`01_domains` 声明 `figsize=(6.8, 5.5)`（宽>高，横版），
但 `ax.set_aspect("equal")` 把数据区锁成方形，配合 `savefig.bbox="tight"`
实际落盘是 1287x1695 的**竖版** PNG。于是 `legend_out()` 与 `caption()`
按「横版」分支把图例放到轴框下方、图注放到左下角，与真实图幅错位。

**修复过程（三版）**：

| 版本 | 做法 | 结果 |
|---|---|---|
| 一版 | 图幅改竖版声明 `(6.0, 7.6)` | 锚点对了，但方形数据区在竖版画布里留大片空白 |
| 二版 | 横向画布 `(9.6, 5.8)` + `subplots_adjust` 预留右栏 | 图例被 `layout_fix` 守卫按横版规则搬回下方，再次错位 |
| 三版 | 加 `ax._manual_legend = True` 豁免守卫，图例与图注都用轴坐标锚右栏 | 图例在图框右上、图注紧接其下，均在图框外右侧 |

同法统一了 `02_target_gene` 与 `03_ko_dr` 的版式（横向画布，colorbar 与图注在右栏）。

**契约测**：`BioanalysDesktop/tests/figure_portrait_layout_contract.test.js`（5 条），
变异反证 4/4 变红：改回横版 figsize、图注锚点改左下、删除右栏 `subplots_adjust`、删图例锚点。

### 7.2 分析模块缺配图（用户指出「出图少一部分」）

**取证**：逐模块比对「有产物表」与「有图件」，确认 4 个模块跑了分析、落了表，但没有配图。

| 模块 | 产物表 | 修复前 | 修复后图号 |
|---|---|---|---|
| `celltype_annotation` | `celltype_annotation_<sp>.tsv` | 无图 | `17_celltype_composition` |
| `spatial_cooccurrence` | `domain_cooccurrence_<sp>.tsv` | 无图 | `18_cooccur_domain_coherence` |
| `spatial_communication` | `sample_communication_<sp>.tsv` | 无图 | `19_communication` |
| `spatial_localization` | `gene_localization_<sp>.tsv` | 无图 | `20_localization` |

**关键教训（两处自己踩的坑）**：

1. 首版把这 4 个模块的代码写在物种循环**之外**，`species` 残留循环最后一轮的 `human`，
   结果四个模块在两个项目上全部 `skip`（日志可见 `缺 celltype_scores_human.tsv`）。
   移入循环后正常。
2. 首版按「矩阵」假设写图：`celltype_scores` 实为 **12097 spots × 52 域**，
   直接 `imshow` 渲染 12097 行耗时 **136 秒**（超 60 秒硬上限）；
   `domain_cooccurrence` 实为**长表** 52 行 7 列，不是方阵，`imshow` 直接报
   `Image data of dtype object cannot be converted to float`。
   改按真实形状重写（域×细胞类型交叉表、连贯性条形、通讯条形、定位条形）后，
   四张图耗时降到 **0.2 至 0.7 秒**。

**契约测**：`BioanalysDesktop/tests/figure_module_coverage_contract.test.js`（5 条），
变异反证 2/2 变红（删 celltype 配图、删 cooccurrence 配图）。

### 7.3 回归与验证

- 全量测试：**1700 tests / 1699 pass / 0 fail**
- 总门禁：`GATE_ALL_OK` 17 道全绿
- `FIGURE_SPEC_OK` 全部图件 300 DPI
- `FIGURE_READY_MATRIX_OK` readyCount 恒 30
- 图件数：P1 **32** 张、P2 **23** 张（原 28 / 19，各补 4 张）

**过程中契约测抓到一次真回归**：替换 17-20 代码块时把 B4 的 `input_sha256`
辅助函数一并删除，`figure_manifest_input_hash` 与 `master_symbol_defined`
两条测试立即变红，已补回（`52f04ba`）。

## 八、HTML 综合报告

| 项目 | 文件 | 大小 | 图件 | 章节 | 表格 |
|---|---|---|---|---|---|
| P1 | `local_projects/PRJ_STROKE_P1_SPATIAL_ABCA1/report/综合报告.html` | 7.2 MB | 32（全部内嵌） | 14 | 11 |
| P2 | `local_projects/PRJ_STROKE_P2_SPATIAL_LACTPYRO_5GENES/report/综合报告.html` | 5.0 MB | 23（全部内嵌） | 13 | 10 |

报告为**自包含单文件**：图片以 base64 内嵌，可直接分发或归档，
不依赖外部目录。所有统计量由脚本从 K40 真机产物抽取后注入，
HTML 里没有手写数字。

生成脚本已固化到 `ops/`，可复现：

```
# 1) 在 K40 上抽取数据
/root/venvs/bio-py/bin/python3 ops/report_extract_data.py <PID> > report_data.json
# 2) 在本地渲染（需 Pillow）
python ops/report_render_html.py report_data.json <figures目录> "<时间>" <输出.html>
```

报告结构：执行概览、空间域识别、细胞类型反卷积、空间自相关、域空间连贯性、
细胞通讯、域级功能富集、先验 focus 基因验证、虚拟敲除扰动（P1）、
基因定位广度、综合分析、诚实边界、其余图件、图件总览。

## 九、渲染时间预算口径调整（2026-11-06 用户裁定）

用户原话：「部份生图慢可以容忍，单图生成不超 5min 不算问题。」

据此把 `docs/figure_spec.md` 第四节的单图预算从 **60s 放宽到 300s**。

**放宽的边界**：放宽的是**时间**，不是**信息量底线**。

| 条款 | 变化 | 理由 |
|---|---|---|
| 单图渲染超 300s 视为异常 | 60s 改为 300s | 用户裁定 |
| 大矩阵图禁止，只画 top N | **不变** | 可读性条款，与耗时无关 |

实践含义：遇到慢图先看 `render_ms` 判读，**确属结构错误才改画法**；
只为提速而删减图件内容不算合规优化。

### 9.1 对 17 号图的说明（重要澄清）

17 号图从 136 秒降到 0.55 秒，**主因不是提速，而是原写法在语义上就不成立**：

- 原写法读 `celltype_scores_<sp>.tsv`（实测 **12097 spots × 52 域**）后直接 `imshow`，
  画出来是一张 12097 行的图。它的行是 spot、列是域签名分数，
  **根本不是「细胞类型」图**，只是一张不可读的大矩阵。
- 现写法读 `celltype_annotation_<sp>.tsv` 做「域 × primary_celltype」交叉表，
  行归一化为组成比例，才真正回答「每个空间域主要由什么细胞类型构成」。

所以这次改动属于**修正结构错误**，不是「为了快而砍内容」。
若后续想补 spot 级细胞类型空间分布图（每样本一张，按 primary_celltype 着色），
按新预算完全放得开，属可选增强，本轮未做。

### 9.2 契约测与变异反证

`BioanalysDesktop/tests/figure_render_budget_contract.test.js` 新增一条：
规范必须写 300s、不得残留 60s、且「大矩阵图禁止」条目行必须仍在。

变异反证 **2/2 变红**：MUT-A 预算改回 60s 变红；MUT-B 删掉规则条目行变红。

**MUT-B 首轮曾假存活**：首版断言用全文正则查「大矩阵图禁止」字样，
而我在同一节新写的说明文字里也含这句，删掉规则行后散文仍命中。
改成「必须存在以 `- 大矩阵图` 开头的条目行且该行含禁止」后才真红。
这与项目此前记过的 B3 注释替规则作证属同一类假绿。


