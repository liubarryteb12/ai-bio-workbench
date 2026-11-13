# GSE233814 双项目立项设计与现状（2026-11-06）

> 需求单来源：`portal/inbox/L3_线粒体能量-脂质代谢_空间转录组探索需求.json`、
> `portal/inbox/L3_乳酸化-焦亡_5基因空间筛选需求.json`（用户 2026-11-06 点名立项）。
> 正本口径：三线隔离（`docs/isolation.md`）、文件落点（`docs/directories.md`）、
> 出图规范（`docs/figure_spec.md`）、提示词（`docs/AI_FIGURE_PROMPT.md`）。

## 一、两个项目

| 项 | P1 | P2 |
|---|---|---|
| projectId | `PRJ_STROKE_P1_SPATIAL_ABCA1` | `PRJ_STROKE_P2_SPATIAL_LACTPYRO_5GENES` |
| 线 | line3_spatial | line3_spatial |
| 步骤数 | 17（含 spatial_knockout / dr_post_analysis） | 15（无 knockout） |
| KO 基因 | `Abca1` | 空（本需求不执行虚拟敲除） |
| focus 基因 | Abca1 / Akt1 / Sox9 / Adipor2 / Dpm1 | Myh9 / Egr1 / Gstp1 / Epha4 / Tjp1 |
| 分组 | Control(1) vs Disease(4)，对照 `Disease_vs_Control` | 同左 |
| 阈值 | standard / adj_p 0.05 / log2FC 1 / max_mt 20 | 同左 |

数据源两项目相同：**GSE233814**（小鼠 pMCAO 10x Visium，GPL24247，5 样本）。

## 二、数据现状（测绘结论）

GEO 上 `GSE233814_RAW.tar` = **1,889,648,640 字节（1.89 GB）**，来源
`https://ftp.ncbi.nlm.nih.gov/geo/series/GSE233nnn/GSE233814/suppl/`。包内 5 样本：

| GSM | 角色 | 组 | 文件形态 |
|---|---|---|---|
| GSM7437221 | Control（Sham） | Control | barcodes / features / matrix.mtx + json + tif |
| GSM7437222 | Day1 lesion | Disease | 同上 |
| GSM7437223 | Day3 lesion | Disease | 同上 |
| GSM7437224 | Day7 lesion | Disease | 同上 |
| GSM7437225 | Day7 full | Disease | 同上 |

体积构成：矩阵三件套合计约 150 MB，其余约 1.7 GB 是 `*.tif.gz` 全分辨率组织图。

**运行面约束**：分析环境 实测下载 17 KB/s（1.89 GB 需约 29 小时，不可行）；
本地 PC 实测 450 KB/s，走「本地下载 → 传算力节点」。算力节点侧剩余空间 153 GB、可用内存 7.8 GB，够用。

## 三、已解决的阻塞：ingest_spatial 格式适配（提交 c4c4222）

原母版按 GSE192741 的 Space Ranger **v1 h5** 写死，对 GSE233814 会 exit 2。已改：

| 改动 | 判据 |
|---|---|
| 形态自识别 | 扫 tar 成员名统计 mtx/h5 命中，`format_kind` 由命中数决定；混合形态拒绝猜测 |
| mtx 装配分支 | 解压 barcodes/features/matrix 三件套，COO→CSR，barcode 来自文件真实内容 |
| 坐标来源 | mtx 形态从 `*.json.gz` 的 `tissue_positions` 取，归一成与 h5 同构的 positions 字典 |
| 缩放因子 | mtx 形态从同一 json 的 `scalefactors` 子对象取，缺键即 fail |
| 单物种 soft | bash 段从「必须两份」改为「至少一份」，物种由 soft 的 organism 判定 |
| 底图降级 | mtx 只带 tif.gz，无法做 lowres 时降级为占位并 WARN，不伪造图、不阻断装配 |

契约测试 `BioanalysDesktop/tests/ingest_spatial_format_contract.test.js` 7 条；
变异反证 3/3 红（退回双 soft / 强制 h5 / 清空 mtx barcode 读取）。
**首版测试 2 条变异存活**（只查关键词出现），已改为锚定具体语句后转红。

## 四、立项执行顺序

1. 下载 1.89 GB 到 `.tmp/gse233814/`（分片 64 MB + 逐片长度校验 + 拼接后总长校验）
2. 解包，只推需要的文件到 分析环境 `projects/<pid>/line3_spatial/raw_data/`（跳过 tif.gz，约 150 MB）
3. 同步 GPL24247 soft（GEO 系列页可下，约几十 MB）
4. `node init_project_scaffold.py` 建两个项目骨架
5. 写 `project.json`（含 `grouping_design`，按线分区不是必需，因两项目都只跑 line3）
6. 按 pipelineDag 逐步下发 17 / 15 步，每步走 `run_throttled_task.sh`
7. 回搬产物、跑出图规范门禁、组装交付报告

## 五、诚实边界（写进报告，不粉饰）

- `*.tif.gz` 全分辨率图不入 h5ad：1.7 GB 传输在算力节点面不划算，且 `figure_spec` 的空间图只用坐标。
  底图降级为占位并 WARN，报告须写明「无组织底图叠加」。
- GSE233814 的 5 样本中 Control 只有 1 例，两组比较的统计功效有限，
  对比结论须标注 n 并提示这是探索性结果。
- P2 无 KO 基因，`spatial_knockout` 不在其 15 步内，报告不得出现 KO 相关图。
