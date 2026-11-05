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
