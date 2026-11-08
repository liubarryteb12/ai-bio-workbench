# 参考代码与生信代码整理台账（2026-11-06）

> 触发：用户要求「把没有用的无效的生信代码（R/Python）与参考代码单独整理出去」。
> 原则：先取证再动手，只做**可逆**动作（移入归档区，不物理删除），每一笔留哈希与去向。
> 基线：HEAD `1fd1cb3`（B1 溯源门禁收口）。B1 证明「按名字信人」会漏审，本轮同法用于整理。

## 一、判定口径（机器可复现）

| 类别 | 判据 | 处置 |
|---|---|---|
| 嵌套版本库 | reference/ 下出现 `.git` 目录（第三方仓库内嵌） | 移入 `_archive/nested_git_20261106/` |
| 未声明母版 | `src/<line>/scripts/*` 不在 `workflows.json` 的 `series[].stages[].mods[].script` | 逐份甄别，有效则补声明，无效才归档 |
| 重复副本 | 与 `src/` 真源 sha256 完全相同 | 归档并登记来源 |
| 参考资产 | `reference/09.待整理/` 与主力区无同哈希重叠 | 保留（是独有内容，非重复） |

## 二、本轮实际执行

### 2.1 已归档：5 个嵌套 .git（1583 文件 / 12.65 MB）

| 原路径 | 去向 | 文件数 | 体积 |
|---|---|---|---|
| `reference/00a.可参考代码库/geo-normal-pipeline-skill/.git` | `_archive/nested_git_20261106/` | 276 | 1.87 MB |
| `reference/00a.可参考代码库/scrna-pipeline-skill/.git` | 同上 | 954 | 4.83 MB |
| `reference/00a.可参考代码库/spatial-pipeline-skill/.git` | 同上 | 280 | 2.16 MB |
| `reference/01.工程规范/mattpocock-skills/.git` | 同上 | 29 | 0.36 MB |
| `reference/05.可参考出图代码/FigureYa_CodeMap/repo/.git` | 同上 | 44 | 3.43 MB |

判定依据：这些是上游第三方仓库的完整版本库，被整体拷进参考区；
`git ls-files` 实测跟踪数为 **0**（reference 除 `05` 外全在 .gitignore），
它们对主仓无任何版本关系，只制造「嵌套仓库」告警与全仓文本搜索噪音。
归档后实测 `reference/` 下剩余嵌套 .git = **0**。

### 2.2 甄别后判定为「有效，不整理」的项

| 项 | 证据 | 结论 |
|---|---|---|
| `src/line1_bulk/scripts/probe_env` | 唯一未被 workflows.json 声明的母版；`src/line1_bulk/README.md:75` 明确写「环境自检冒烟脚本（S0 部署通道验证桩），不计入线内步骤」；`BioanalysDesktop/tests/deploy_and_parity_guard.test.js:114` 断言部署豁免必须含它 | **有效**，保留。它不是死代码，是部署通道的验证桩 |
| `reference/09.待整理/` | **本行原结论已被推翻**（见 2.4）：旧比对只查了 `00a_migrated_20261025` vs `00a` 与 `encoding_backup_20261024` vs `05` 两对，漏掉 encoding_backup 对 `00a/01/02/03` 的比较，因而误判「重复 = 0」 | 实测有 118 个纯重复文件，已于 2026-11-06 归档（见 2.4） |
| `reference/05.可参考出图代码/FigureYa_CodeMap`（2105 文件 / 14.1 MB） | 是上游出图代码地图；`library/` 被 10 处代码引用 | **有效**，保留（仅其内嵌 .git 已归档） |
| `reference/05.可参考出图代码/图码对应库_交付包`（230 文件 / 62.7 MB） | 有 1 处引用 | **有效**，保留 |
| `cn_debug/`（366 文件） | 260 个已被 git 跟踪，是取证留痕区 | **有效**，保留 |

### 2.4 第二批归档：118 个与主力区字节级重复的参考代码（2026-11-06）

| 项 | 值 |
|---|---|
| 来源 | `reference/09.待整理/encoding_backup_20261024/` |
| 判据 | sha256 与 `00a/01/02/03/05` 全部主力区逐一比对，**同哈希即纯重复** |
| 数量 | 118 个文件 / 2.5 MB（.py 32、.mjs 30、.md 17、.R 17、.yml 14、.sh 3、.mplstyle 2、.txt 2） |
| 去向 | `_archive/dup_reference_20261106/`（保持原相对路径），逐条映射写入 `MOVED_MANIFEST.txt` |
| 归档后复核 | `09.待整理` 内与主力区同哈希文件 = **0**；该备份区剩 76 个独有文件，继续保留 |
| gitignore | 补 `_archive/dup_reference_*/`，归档区不入库 |

**方法学教训（与本节第一版结论直接相关）**：判重复必须把所有候选源区一次性放进同一张哈希表比对。
本台账 2.2 节最初写「09 区与主力区重复 = 0」，正是因为我做了**两两局部比对**（00a_migrated vs 00a、
encoding_backup vs 05），漏掉了 encoding_backup 对其余三个主力区的关系，把一个真实存在的
118 文件重复集误判为独有内容。结论被自己的窄口径测例"验证"通过，属典型的取证范围不足。

### 2.3 未做物理删除的理由

用户要「整理出去」，不是「删掉」。所有动作都是 `Move-Item` 到 `_archive/`：
可逆、可回溯、不破坏任何既有引用。真删需单独授权，且要先跑全量门禁证明零引用。

## 三、复现命令

```powershell
# 复现嵌套 .git 探测（期望 0）
node .tmp/probe_nested_git.mjs

# 复现孤儿母版探测（期望只剩 probe_env，且它是 A 级有效桩）
node .tmp/probe_dead2.mjs

# 复现参考区重复副本探测（期望同哈希重复 = 0）
node .tmp/probe_ref_dup.mjs
```

## 四、后续（不再本轮扩面）

- `reference/09.待整理/` 的 234 MB 是否清出，需用户单独裁定（它不与主仓重复，删了不可逆）。
- `FigureYa_CodeMap` 的 2105 文件是否保留全量，需按「实际被引用到的图型」二次甄别后再定。

---

## 五、2026-11-07 批：新编号体系收尾（盘点、去重、引用同步）

> 触发：用户要求「结合项目现状，整理 reference 文件夹下的内容」。
> 背景：参考区已被重组为新编号体系（01 工程规范、02 文献、03 出图规范、04 正式使用生信代码(预留空位)、
> 05 可参考生信代码、06 测试用原始数据、07 Visium 布局、09 待整理），但收尾未完成：
> 旧 `05.可参考出图代码` 的 72 个 git 跟踪文件在新位置被 gitignore 吞掉、
> 注册表 / 门禁 / portal / 测试仍指旧路径、`项目分组表.tsv` 与 `docs/directories.md` 编号表过期。
> 本批原则不变：内容只读、结构可整理、动作可逆、每笔留痕。

### 5.1 盘点（动作前）

- 全量逐文件快照：`reference/09.待整理/inventory_20261107.tsv`，5514 行（路径、字节数、时间）。
- 新建导航正本 `reference/README.md`，重写 `reference/项目分组表.tsv` 与
  `docs/directories.md` 的编号表，三处同步。

### 5.2 去重：FigureYa_CodeMap 整树重复副本

- 取证：`05.可参考生信代码/可用代码预筛选/源码/FigureYa_CodeMap`（A）与
  `源码/05.可参考出图代码/FigureYa_CodeMap`（B）各 2061 文件，
  逐文件 sha256 比对：hash-mismatch=0、B-only=0、A-only=0，判纯重复。
- 处置：保留 A（与 L1/L2/L3 同层的扁平位置），B 连同包装目录整体
  `Move-Item` 至 `reference/09.待整理/05.可参考生信代码/可用代码预筛选/源码/05.可参考出图代码/`，
  保留原始相对路径。移入件逐文件哈希清单：`reference/09.待整理/dup_figureya_20261107_manifest.tsv`（2061 行）。
- 复核：源位置不存在，目标 2061 文件齐。
- 另确认 `03.出图规范/sci.md` 与 `可用/出图规范/sci.md` 同哈希，后者属自包含可用包的随包副本，
  被索引表就地引用，判有意副本保留，03 区为规范正本。

### 5.3 引用同步（旧前缀 → 新前缀）

映射：`reference/05.可参考出图代码/library` → `reference/05.可参考生信代码/library`；
其余 `reference/05.可参考出图代码` → `reference/05.可参考生信代码/可用代码预筛选/源码`。

改动 21 个活跃文件：
`src/figure_templates.json`、`portal/serve.mjs`、
`BioanalysDesktop/server/{figure_catalog,figure_graph,task}.js`、
`BioanalysDesktop/tests/{aims_drift_guard,figure_adapters,figure_catalog,figure_master_single_source,figure_templates_parity,wp33_figure_adapt}.test.js`、
`ops/{build_figure_catalog.py,build_figure_templates.cjs,dist_parity_gate.mjs,figure_catalog_r_adapter.py,figure_preview_provenance.mjs,figure_ready_matrix.json,figure_source_provenance.mjs,verify_figure_catalog.py,verify_plot_matrix.py}`、
`.gitignore`。

- `figure_source_provenance.mjs` 的 marker 列表增补新路径 token，旧 token 保留：
  生产母版头部 PROVENANCE 注释属历史出处描述，保留不改（避免破坏部署字节一致性）。
  `figure_provenance.test.js` 的夹具模拟旧注释，合法保留。
- `.gitignore` 白名单整体迁到新路径并补目录放行链；顺带修正四行历史损坏的放行条目
  （`input_data.csvL3_multipanel_code.R` 等，缺斜杠导致 L3 multipanel/sankey 四件从未被白名单覆盖）；
  新增放行 `reference/README.md`、`reference/项目分组表.tsv`、`07.Visium_v1_载玻片布局/`。
  `git check-ignore` 逐点验证：白名单 10 例全部符合预期（证据文件放行、导入现场数据与隔离区仍忽略）。
- git 索引：`git add -A -- reference` 后识别 72 个 R（重命名）+ 14 个 A（新增），
  跟踪数 72 → 86。**未提交**，提交由用户裁定。

### 5.4 验证（全绿）

| 检查 | 结果 |
|---|---|
| `node ops/figure_preview_provenance.mjs` | exit 0，ready 40，矩阵证据相等 12 / 分叉 0 / 漂移 0 |
| `node ops/figure_source_provenance.mjs` | exit 0，22 个产图母版溯源声明诚实 |
| 7 个受影响测试文件（node --test） | 59 tests，58 pass / 0 fail / 1 skip（缺导入现场数据的合法跳过） |
| 4 个 portal 契约测试文件 | 31 tests 全过 |
| 间接相关兜底（figure_ready_matrix / preview_provenance_gate / figure_graph_contract） | 27 tests 全过 |
| 4 个改动 Python 工具 `py_compile` | exit 0 |

### 5.5 遗留（待用户裁定）

1. 原 `04.RedmiK40_liunx_container`（64 文件）在本仓无迁移留痕，盘点时已不存在，去向待确认。
2. `04.正式使用生信代码/` 为预留空目录，入驻内容待用户定义。
3. `dist/portable/` 内旧路径引用属构建产物，下次重建自然消除，本轮未动。
4. `ingest_spatial` 母版注释与历史交付报告中的 `reference/06.Visium_v1_载玻片布局` 为历史描述，
   现行为 `07.Visium_v1_载玻片布局`，注释保留不改（部署字节一致性优先）。
5. `09.待整理/` 现 2204 文件 243.7 MB（含本批移入的 2061 件），清出仍需单独授权。

### 5.6 06 区测试用原始数据盘点更新（2026-11-07）

- 现状校准：`reference/06.测试用原始数据/` 在役为 4 套核心测试集（总计 22 个文件，1,834.5 MB）：
  - `L1_Bulk_RNAseq_GSE245825`（5 文件 / 45.52 MB）
  - `L1_Microarray_GSE42955`（6 文件 / 143.44 MB）
  - `L2_scRNA_snRNAseq_GSE185100`（5 文件 / 830.22 MB）
  - `L3_Spatial_Visium_GSE218759`（5 文件 / 815.32 MB）
  - `README.md`（1 文件 / 6.9 KB）
- 历史消融数据集 `GSE316126`（NanoString 782 基因，用于验证队列效应诊断列假阳性率 0.13%）实验已完成，处理矩阵与结果已持久化收口于 `local_projects/PRJ_GSE316126_SANITY/` 与 `docs/ABLATION_COHORT_DIAGNOSTICS.md`，不再占用在役测试区空间。
- 同步更新：
  - `reference/06.测试用原始数据/README.md` 升至 v2.0，修正矩阵与文件清单，增补消融实验去向与 GSE233814 交付线数据集说明。
  - `reference/README.md`、`reference/项目分组表.tsv`、`docs/directories.md` 同步修正为 22 文件 / 4 套数据集。
