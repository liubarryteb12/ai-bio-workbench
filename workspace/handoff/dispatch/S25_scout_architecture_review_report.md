# S25-scout · 全工作目录架构/框架/设计深度评审报告

> 切片性质：**纯只读评审**。除本报告外未修改、未创建、未删除任何仓库文件；未起服务、未打写接口、未动远端 K40。
>
> ⚠️ **路径冲突报告（需主 Agent 知晓）**：派发单指定输出路径 `con_hf/dispatch/S25_scout_architecture_review.md`
> 已被派发单文本本身占用（该路径现存的就是派发单原文）。项目根不是 git 仓库（`git status` 报
> `fatal: not a git repository`，2026-10-20 实测），覆盖即永久丢失派发单。故本报告落在
> `con_hf/dispatch/S25_scout_architecture_review_report.md`（加 `_report` 后缀）。
> 处置建议：主 Agent 核收后可把派发单移入归档、把本报告改名顶替原路径。
>
> 评审基准：`con_hf/dispatch/SUBAGENT_CONTRACT.md` + `aims/aims.txt`（v2.4，417 行）+
> `con_hf/dispatch/S21_scout_workbench_gaps.md`（8787 工作台层盘点，本报告在其上覆盖整个工作目录）。
> 所有行号对应 2026-10-20 读取时的文件状态。没读过/没测过的一律标「未验证」。

---

## 0. 结论摘要（给小白的三句话）

1. **这套系统的"骨架"是好的，但它是"每出一次故障就补一层"长出来的**：三线隔离、种子强制、
   链路自检这些关键防线都是真的在起作用；代价是同一种能力长出了两三份实现（上传、回搬、链路检查
   各有两套），还有一批"故障修完就没用了"的一次性工具混在常用脚本里，让人分不清哪些每天在用、
   哪些早该收进抽屉。

2. **最占地方的是放错位置的 690MB，最费人的是 5 个必须动手的断点**：`cn_debug/`（调试目录）里
   95% 的体积是一个 SCENIC 分析用的参考数据库，它不是调试产物，放错了地方；从"客户提交需求"到
   "拿到交付报告"中间还有 5 处必须人工 ssh 或手工填写的环节，这就是"感觉效率没那么高"的落地原因。

3. **规格书（aims）和实际代码已经漂移，需要"对表"而不是继续加功能**：规格声明的一些关键承诺——
   R/Python 切换次数、每次跨语言必须过的四项断言检查点、台账里记种子——在代码里要么与实际不符、
   要么根本没人调用。规格里的种子值还自己跟自己打架（20261013 vs 2026）。先把规格和现实对齐，
   再谈新增功能。

---

## 1. 架构总评（设计 vs 现状）

> 每条格式：**【用户能感受到什么】→ 证据 → 判断**。

### 1.1 三线隔离（aims §一.2 / §二）：设计基本落地，防线有四层

- 【感受】三条分析线的数据互不串门，这是客户拿到结果时"可信"的根基。
- 证据：`src/line1_bulk|line2_scrna|line3_spatial/` 三线物理分目录（各 17/23/18 个文件，实测清点）；
  防线有四层——`ops/02_check_isolation.ps1`（静态扫源码）、`ops/check_storage_and_isolation.sh:285-293`
  （运行时扫脚本）、`BioanalysDesktop/server/audit.js:38-66`（提交命令审计）、
  `server/ledger.js`（台账落盘前复核）。
- 判断：**真实落地**。四层各有职责面（源码/运行时/提交/落盘），不算重复；但没有任何一处文档把
  "四层各管什么"讲清，新人只能靠读四个文件自己悟。

### 1.2 R/Python 语言分工（aims §一.3）：声明与实测大面积不符（详见 §4 漂移 1/2）

- 【感受】平时无感，但照着规格书排查问题会走错方向；规格书作为"排错地图"已经失效。
- 证据（逐脚本统计 Rscript/python3 调用次数，2026-10-20 实测）：
  - 线2：aims 声明"下游 1-8 全 R（Seurat/speckle/Monocle3/CellChat）"（aims.txt:192-199），
    实测 23 个脚本里 22 个纯 Python，只有 `gsva_pathways` 混用 R+Python。
  - 线1：aims 声明 PPI 是 R+STRING（aims.txt:175）、外部验证是 R+pROC（aims.txt:180），
    实测 `ppi_string`、`external_validation` 都是纯 Python。
  - 线1 还有三个脚本在单个脚本内部混用两种语言：`ml_diagnostics`(R=1,Py=1)、
    `ml_hub_analysis`(R=1,Py=2)、`probe_env`(R=1,Py=1)。
- 判断：**漂移是历史演进的结果**（ARM64 容器装不上 R 版工具，Python 方案实测可行，见
  aims.txt:168、212 自己也承认），但 aims 正文从未改口。需要一次规格修订而不是改代码。

### 1.3 桥接四项断言检查点（aims §一.3 声明"必须自动执行"）：实际零调用

- 【感受】规格承诺"每次跨语言转换都过安检"，实际这台安检机造好了但从来没通电。
- 证据：`grep -rn "verify_bridge_checkpoint"` 全仓（src/ops/BioanalysDesktop/docs）只命中
  `ops/verify_bridge_checkpoint.py` 自己的文档字符串（:2、:5），无任何调用方。
- 判断：**规格漂移**。要么把检查点接进任务链（在语言切换的脚本对之间调用），
  要么在 aims 里降级为"可选工具"。二选一，不能继续挂着"强制"的名义。

### 1.4 固定种子 20261013（aims §一.3）：脚本侧渗透极好，台账侧断裂

- 【感受】"结果可复现"的承诺在脚本里做到了，但审计台账里查不到种子，等于档案袋里没有存根。
- 证据：
  - 好的一面：全部三线脚本开头都有 `BIOANALYS_SEED` 未注入即 `exit 3` 的强制 guard
    （逐脚本统计 SEED 引用 2-8 次/脚本，无一漏网，2026-10-20 实测）。
  - 断的一面：`ops/run_throttled_task.sh:84-90` 写的台账 JSON 字段只有
    `task_id/line_id/step_name/status/时间/environment(language,wrapper,memory_limit)`，
    **没有 project_id 和 seed**；而 `ops/03_check_logs_remote.sh` 的校验恰恰要查这两项
    （README"缺种子检查"），所以走 ops 直跑的项目台账必被判违规（此问题此前审计已确认存在实例）。
  - 加一条自相矛盾：aims.txt:28 说 `seed = 20261013`，aims.txt:398 的 R 头模板却写
    `set.seed(2026)`——规格书自己跟自己打架。
- 判断：补台账字段（小改），修 aims:398（一字改），两处都该进第一批整改。

### 1.5 云-端解耦拓扑（aims §一.1）：形态符合设计，守护机制 6 件套各有故障实证，不是过度设计，但缺分层索引

- 【感受】手机是服务器、电脑只是遥控器——这个设计在工作；链路断了有工具告诉你断在哪一环。
- 证据（守护/自愈机制清点，全部有出处）：
  | 机制 | 位置 | 性质 | 实证 |
  |---|---|---|---|
  | `serve_guard.ps1`（214 行） | PC | 常驻守护 8787/8080/frpc | 故障注入实测（ops/README.md 表格） |
  | `bio_watchdog.sh`（56 行） | 手机 | runit 看护+wake-lock | 2026-10-18 实测自愈 |
  | `00_link_check.ps1` | PC | 四段链路自检 | 日常热路径 |
  | `fix_runsvdir.sh`（65 行） | 手机 | 双 runsvdir 抢锁修复 | 2026-10-20 reboot 实战用过 |
  | `01_fix_svlogger.ps1` + `svlogger_*`×3 | PC→手机 | 修 log 子服务 crash-loop（坑#88） | **修复已完成**，属一次性 |
  | `run_throttled_task.sh` | 服务器 | 任务降权+台账包装 | 每个任务都在用 |
- 判断：**不是过度设计**——每件都有踩坑台账编号或实测记录背书；真正的问题是"一次性修复件"
  与"天天用的热路径"混在同一个目录、README 只有一张平铺表格，没有"哪些是热路径/哪些可归档"的分层。

### 1.6 目录规范（aims §二）：设计图已过时

- 【感受】无直接感受，但照 aims 画的目录图找文件会找不到。
- 证据：aims §二（aims.txt:36-60）画的是"顶层三线 `line1_bulk/...`"结构；实际经
  `ops/08_migrate_to_projects`（:1-6 自述"顶层三线 → projects/<项目>/"）迁移后，
  数据面是 `projects/<项目>/<line>/` + 顶层 `bin/`、`envs/` 全局共用
  （`ops/06_deploy_scripts.ps1:5-7` 自述）。aims 未随之更新。
- 判断：**规格漂移**。aims §二需重画。连带影响：8787 TaskPanel 的输入路径占位提示还是旧形态
  （S21 R10），新用户照提示填路径必错。

### 1.7 三个控制平面（portal / 8787 工作台 / ops 运维脚本）：能力重叠清单

- 【感受】"同一个动作有两个入口"是"功能越做越烦"的直接来源之一。
- 证据（重复能力实测清点）：
  | 能力 | 实现 A | 实现 B | 差异 |
  |---|---|---|---|
  | 上传 | portal `/api/datafiles`（整文件，5GiB 上限，白名单 9 种扩展名，`portal/lib/archive.mjs:23`） | 8787 `/api/upload/*`（4MB 分片，白名单 16 种，`server/upload.js:24-26`） | **同一份数据走不同入口，校验结论不同**（.h5 在 8787 合法、portal 拒收） |
  | 产物回搬 | `ops/07_pull_outputs.ps1`（165 行） | `server/pull.js`（+10 个测试） | 两套独立逻辑做同一件事 |
  | 链路检查 | `ops/00_link_check.ps1` | `server/link.js`（+4 个测试） | 同上 |
  | 台账检查 | `ops/03+04`（bash，服务器全量） | `server/ledger.js`（Node，本地） | **有意双实现**，`consistency.test.js` 固化口径一致，`ledger.js:3-7` 注释写明理由 |
  | 隔离检查 | 共 4 层（见 1.1） | — | 各有职责面 |
- 判断：台账双实现**保留**（有测试固化+注释说理）；上传白名单**必须统一**（真实的不一致）；
  回搬与链路检查双轨**待裁决**（收敛方向明确但涉及两域文件）。

### 1.8 portal 无鉴权（aims:10 承诺 Token 鉴权）

- 【感受】客户提交页如果内网穿透到公网，任何人都能往里传 5GiB 文件、投毒需求单。
- 证据：`grep -c "auth|token|Authorization" portal/serve.mjs` = **0**；文件头（:5-8）自述
  "可单独内网穿透给客户"。
- 判断：安全缺口（S21 R1 已列 P0），需主 Agent 派切片。

### 1.9 文档体系：aims 之外长出了"第二真源"，且互相引用打架

- 【感受】同一件事在三份文档里有三种说法，改一处忘两处。
- 证据：
  1. `docs/figure_spec.md`（495 行，v2.2）是图件规范的**实际正本**，aims §五（4 条）只是摘要——
     但 12+ 个 src 脚本头注释仍写"口径：docs/figure_spec.md（**Agg/150dpi****）"
     （如 `src/line1_bulk/scripts/bulk_figures:10`），引用的是旧版规范；实际 DPI 由
     `ops/layout_autoload/sitecustomize.py` 强制 300，脚本注释与现实脱节。
  2. `docs/delivery_package_spec.md`（172 行）自述"脚本尚未实现"（:6）、又自述"部分内容已被
     aims v3.0 §7.2 取代"（:8）、引用的入口 `ops/09_package_delivery.ps1` **在仓库中不存在**
     （ops/ 目录实测无 09 文件）。一份 spec，三处互相矛盾。
  3. `docs/geo_mining_sop_v1.md` 已打"被 v2 取代"横幅（:3-5）但 283 行仍留在 docs/ 正编位置。
  4. `docs/directories.md`（v1，2026-10-12）说"本地只放代码+交接台账"，与现实
     `outputs/` 18G + `project_data/` 3.8G 在本地不符（文档没跟上数据面迁移）。
- 判断：需要一个"规格索引"（哪份文件管什么、谁是正本），并归档废弃文档。

### 1.10 非肿瘤铁律的边界：黑名单超配 + cox 生存分析待定界

- 【感受】拦截词表比规格写的多（防得宽），同时线1里挂着一个"生存分析"脚本——规格明文说
  不主动做临床生存预后，这两件事需要用户给一句准话。
- 证据：黑名单 29 条 vs aims:71 列举 8 条（S21 疑点 h 详证）；`src/line1_bulk/scripts/cox_analysis`
  是单因素/多因素 Cox + LASSO-Cox + 森林图，头注释（:2-4）自称"aims 线1 步骤 5 附加项
  （v2.3 方案'如果后续要做生存分析'）"，无生存数据时自动跳过——**但现行 aims v2.4 全文已无此
  附加项条款**（grep "生存" aims.txt 仅命中铁律 1 的"不主动加入"）。
- 判断：两处都需要主 Agent 找用户裁定（收编进规格 or 收敛）。

### 1.11 无版本控制：所有治理动作的前置风险

- 【感受】任何"清理/归档/合并"一旦做错，没有撤销键。
- 证据：`git status` → `fatal: not a git repository`（2026-10-20 实测）；仓库内有 633K 台账、
  18G 产物、全部代码。
- 判断：在动任何臃肿清单之前，建议先 `git init` + `.gitignore`（排除 outputs/project_data/
  cn_debug 大文件），给后续所有整改装上保险。这是本报告全部建议里性价比最高的一条。

---

## 2. 臃肿清单（按"删 / 归档 / 合并 / 抽公共 / 保留"五分类）

> 每项：位置、体积或行数（实测）、处置建议、风险。

### 2.1 删（无保留价值）

| 项 | 位置与体积 | 建议 | 风险 |
|---|---|---|---|
| Python 缓存目录 | `ops/__pycache__/`（编译缓存，可再生） | 删除 | 无 |
| GEO 测试数据残留 | `cn_debug/GSE30528_family.soft.gz` 9.7M、`GSE30528_sm.txt` 5.7M + `.gz` 2.4M、`GPL571.annot.tsv` 1.9M + `.gz` 560K（合计约 20M） | 删除（原始数据随时可从 GEO 重取；正式测试数据在 `test_use_data/`） | 极低；删前列清单报备一次即可 |
| 前端死代码 | `BioanalysDesktop/src/App.tsx:2455-2549` FiguresPanel（约 95 行，全文件检索仅定义处一行命中，从未被挂载渲染） | 删除（或接入 Console，二选一，不得维持两可状态） | 无功能风险；有 S21 R14 背书 |

### 2.2 归档（有历史价值但不在热路径）

| 项 | 位置与体积 | 建议 | 风险 |
|---|---|---|---|
| SCENIC 参考数据库 | `cn_debug/scenic_db/` 690MB（3 个文件：两个 hg38 rankings feather 各约 312M + motifs tbl 99M，2026-10-14 落盘） | **移出调试目录**——它是 pySCENIC 的运行依赖参考数据，不是调试产物；建议移 `reference/`（或标注"分析依赖数据"单独目录）。cn_debug 727MB 中 95% 是它，移走后调试目录回到正常体量 | 注意：若远端任务按旧路径引用它，移动会断链——移前先 grep 远端脚本引用（未验证远端引用情况） |
| 一次性修复工具 | `ops/01_fix_svlogger.ps1`（89 行）+ `svlogger_sshd/crond/ssh-agent`×3（各 4 行）+ `fix_runsvdir.sh`（65 行） | 移入 `ops/archive/`（坑#88、R15 修复均已完成，README 有完整记录可查） | 若同类故障复发，从归档取回即可；README 表格保留索引行 |
| 一次性迁移脚本 | `ops/08_migrate_to_projects.ps1`（68 行）+ `.sh` | 同上归档（迁移已完成，src 下已无顶层三线数据面） | 极低 |
| 废弃 SOP | `docs/geo_mining_sop_v1.md`（283 行，:3-5 已自标"被 v2 取代，不要基于本文件修订"） | 移入 `docs/archive/` | 极低 |
| 切片开发日志 | `cn_debug/2026-10-20_s16/s17/s18r_dev` 约 9M + `subagent_s*.log` 约 3M | 判决结论已进台账的（S16-S24 report 均在 `con_hf/dispatch/`）可归档；与现行审计相关的保留 | 低；逐个确认后再动 |

### 2.3 合并（同一能力多套实现，收敛为一套）

| 项 | 位置 | 建议 | 风险 |
|---|---|---|---|
| 上传白名单 | `server/upload.js:24-26`（16 种）vs `portal/lib/archive.mjs:23`（9 种） | 两套入口可暂时共存（客户/管理员用途不同），但**白名单必须同源**：抽一份共享常量或各自引用同一 JSON | 低 |
| 产物回搬 | `ops/07_pull_outputs.ps1`（165 行）vs `server/pull.js` | 8787 已有 API+测试+自动回搬钩子（index.js:1292-1303），PS 版可降级为"应急通道"并标注，长期收敛到 pull.js | 中：涉及 default 会话域（ops/），须跨域报备 |
| 链路检查 | `ops/00_link_check.ps1` vs `server/link.js` | 同上：link.js 已有 4 测试且被 selfcheck 消费；PS 版保留为"服务起不来时的自救工具"并明确分工写进 README | 低 |
| 台账三大本 | `con_hf/handoff.md` 3076 行/240K、`操作台账.md` 3160 行/224K、`踩坑台账.md` 1243 行/144K（合计 7479 行） | 拆"当前态"与"历史态"：handoff 只留最近 2-3 周 + 一个"恢复指针"；历史按月切块入 `con_hf/archive/`。不改记录纪律，只改存放方式 | 低；切块时保留原文不删改 |

### 2.4 抽公共库（需要重新斟酌的项）

- **三线脚本级公共库：不建议抽。** 判据：八组疑似重复脚本两两 diff 全部在 186-531 行
  （`enrichment` 392 行差、`normalize_hvg` 383 行差、`dr_post_analysis` 531 行差、
  `enrichment_figures` 240/186/291 行差，2026-10-20 实测）——所谓"重复"早已深度分叉，
  硬抽公共库等于重写三遍再合并，风险远大于收益。且铁律防的是**数据**跨线互取，代码共享本不违规
  （图件主题层 `ops/fig_theme.*` + `layout_autoload/` 就是合法的跨线共享先例），
  但工程上此时抽库没有正收益。
- **可抽的（如果要做）**：脚本头部那段 `BIOANALYS_SEED` guard（每脚本 4-6 行重复 60+ 次）
  与 `--input` 解析段——但收益只是省行数，脚本已稳定运行，**维持现状亦可**。

### 2.5 保留（看着臃肿但应维持）

| 项 | 证据 | 理由 |
|---|---|---|
| 台账双实现 | `server/ledger.js:3-7` 注释 + `consistency.test.js` | 有意设计、有测试固化口径一致 |
| 隔离四层防线 | 见 1.1 | 各有职责面（源码/运行时/提交/落盘），纵深防御 |
| 守护 6 件套 | ops/README.md 实测状态列 | 每件有故障实证；归档一次性件后即清爽 |
| `outputs/default` 18G | `du -sh outputs/*` 实测 18G | **处置前必须问用户**：用户曾有意清理过本地 projects/，此目录是否有意保留未知，不可擅动 |
| 三线各自 README | `src/line*/README.md` ×3 | 名字重复、内容各管一线，属正常结构 |

---

## 3. 效率瓶颈（链路图 + 手工断点）

### 3.1 完整链路图（客户提交 → 拿到报告）

```
客户                     管理员(8787)                  服务器(K40)
 │                        │                            │
 │ 1.填需求单+传文件        │                            │
 ├─→ portal(8080) ──归档──→ inbox/PKG_*                  │
 │                        │ 2.【手工断点①】收件箱导入建项 │
 │                        ├─→ project.json 落盘          │
 │                        │   数据文件自动部署 ✓          │
 │                        │ 3.【手工断点②】新改的分析脚本  │
 │                        │   要手动跑 ops/06_deploy_     │
 │                        │   scripts.ps1 才上服务器      │
 │                        │ 4.【手工断点③】TaskPanel 手工 │
 │                        │   填步骤名/输入/输出(自由文本, │
 │                        │   无下拉无存在性校验)          │
 │                        ├─→ ssh 执行 ────────────────→ │ 跑线(自动降权+台账)
 │                        │ 5.图件自动回搬 ✓              │
 │                        │ 6.【手工断点④】TSV 表格预览    │
 │                        │   是占位文字,看不了           │
 │                        │ 7.【手工断点⑤】交付报告要人工  │
 │                        │   ssh 跑 build_client_report  │
 │                        │   .py;打包入口 ops/09 不存在  │
 │←──────── 报告文件手工流转 ────────────────┤            │
```

### 3.2 手工断点清单（按痛感排序）

| # | 断点 | 证据 | 用户感受 |
|---|---|---|---|
| ⑤ | 交付报告全链路无入口 | S21 疑点 a：`build_client_report.py` 2206 行引擎在、8787 零集成、`ops/09` 不存在 | 交付一个项目要人 ssh 上服务器敲命令，最容易忘、最不像"产品"的一步 |
| ③ | 任务下发全手工填参数 | S21 疑点 e：step/inputs/outputs 自由文本（App.tsx:2266-2294），placeholder 还是旧路径形态 | 要背命令名、背路径，填错要等跑完才被台账发现 |
| ② | 脚本部署独立于建项 | `ops/06_deploy_scripts.ps1` 是唯一通道（8787 无对应能力） | 改一行脚本就要手动跑一次部署，忘了就是 command not found |
| ④ | TSV 预览缺失 | App.tsx:2041-2045 占位文字 | 客户问"表格里到底什么数"时只能去翻文件 |
| ① | 收件箱导入是唯一带全参数的建项路径 | S21 R2：手工建项丢 intake 四块、自有数据建不成 | 不走收件箱导入，参数就得丢 |

### 3.3 契约统一度（任务项 12 抽查结论）

- **统一的**：种子（全脚本 `BIOANALYS_SEED` 强制 guard，无一漏网）；输入位置（统一 CLI `--input`，
  `deg_limma:26`、`ingest_counts:36`、`qc_spots:46` 三脚本同构）。
- **不统一的**：`project.json` 的"1:1 契约"实际只覆盖排版与分组——全 src 只有 3 个脚本读
  `BIOANALYS_PROJECT_JSON`（`bulk_figures`、`wgcna_modules`、`scrna_figures`，grep 实测），
  其余 60+ 脚本的阈值/物种/文件名等口径靠各自的 env 默认值（如 `cox_analysis:37-40`
  `EXPR_FILE="${EXPR_FILE:-expr_genes.tsv}"`）。即：建项契约与执行脚本之间是"软约定"。
- 三条生产链规范：图件链最完整（figure_spec 495 行 + fig_theme + layout_autoload +
  audit_figure_layout 四件套）；台账链有 schema（ledger-schema.md 71 行）但 run_throttled_task
  不写全字段（见 1.4）；报告链规范（delivery_package_spec 172 行）引用不存在的入口（见 1.9）。
  **三条链规范齐度：图件 > 台账 > 报告，报告链是短板。**

---

## 4. 规格漂移（aims 声明 vs 实测不符，逐条）

| # | aims 声明（出处） | 实测现状 | 漂移性质 |
|---|---|---|---|
| D1 | 语言切换：线1 切 1 次、线2 切 2 次、**线3 切 1 次**（aims.txt:28） | **aims 自己矛盾**：§四线3 标题写"0 次跨语言切换"（aims.txt:209）。实测线3 全 Python = 0 次，与 §四 一致、与 §一.3 不符 | 规格内部矛盾 |
| D2 | 线2 下游 1-8 用 R（Seurat/speckle/Monocle3/CellChat，aims.txt:192-199） | 23 脚本中 22 个纯 Python，仅 `gsva_pathways` 混 R | 与容器现实脱节（aims.txt:187 自己也写了 R 装不上的理由），正文未改口 |
| D3 | 线1 步骤 4 PPI 用 R+STRING（aims.txt:175）、步骤 9 用 R+pROC（aims.txt:180） | `ppi_string`、`external_validation` 均纯 Python（grep Rscript=0） | 同上 |
| D4 | 桥接四项断言"由 `ops/verify_bridge_checkpoint.py` 自动执行"（aims.txt:28） | 该脚本全仓零调用方（grep 仅命中自身 docstring） | 承诺的强制安检不存在 |
| D5 | seed = 20261013（aims.txt:28） | ①aims.txt:398 R 头模板写 `set.seed(2026)`，自相矛盾；②台账 JSON 不含 seed/project_id（`run_throttled_task.sh:84-90`），审计链断在档案 | 内部矛盾 + 台账缺字段 |
| D6 | 目录规范：顶层三线独占（aims.txt:36-60） | 已迁移为 `projects/<项目>/<line>/` + 顶层 `bin/envs/`（ops/08 迁移后；06 头注释 :5-7） | 设计图过时；连带 TaskPanel placeholder 旧路径（S21 R10） |
| D7 | 分片上传 5MB + 断点续传（aims.txt:77） | 4MB（upload.js:21）且无续传（status 端点在、客户端不调，S21 R5） | 数值+能力双漂移 |
| D8 | 完成项目要写 HTML 报告（aims.txt:413） | 引擎在（`build_client_report.py` 2206 行）但 8787 零集成、`ops/09` 打包入口不存在、spec 引用该入口并自称"部分被取代"（delivery_package_spec.md:6-8） | 有引擎无入口 |
| D9 | 出图 300 DPI（aims §五.2） | 实际由 layout_autoload 强制 300 ✓，但 12+ 脚本头注释仍写"Agg/150dpi"引用旧版 figure_spec | 注释层文档漂移（实际行为正确） |
| D10 | Token 鉴权支持外网（aims.txt:10） | portal/serve.mjs 全文 0 命中 auth/token | 安全缺口（S21 R1 P0） |
| D11 | 不主动加入临床生存预后（aims.txt:20） | `src/line1_bulk/scripts/cox_analysis` 存在（Cox+森林图），自称 v2.3 方案附加项，**v2.4 全文已无该附加项条款** | 铁律边界待用户裁定：收编 or 下线 |
| D12 | 黑名单词表：aims 列举 8 条 | tumor_blacklist.js 实装 29 条（S21 疑点 h） | 超配待确认（防得宽，误伤风险低但 provenance 不合规） |

> 以上 12 条全部有文件:行号证据。其中 D1/D5 是规格内部矛盾，D4/D8 是"承诺-实现"断裂，
> 其余是"实现演进领先于规格"——**修规格比修代码便宜**。

---

## 5. 建议的整改顺序（三批，每条有目标文件）

### 第一批：无争议，可直接派实现切片（不碰跨域、不删数据）

| 序 | 动作 | 目标文件 | 验收 |
|---|---|---|---|
| 1.1 | `git init` + `.gitignore`（排除 outputs/project_data/cn_debug/*.feather 等） | 仓库根 | `git status` 能列出代码与台账、不列大文件 |
| 1.2 | 删 `ops/__pycache__/`；列清单报备后删 cn_debug 的 GEO 残留（约 20M） | ops/__pycache__、cn_debug/GSE30528*、GPL571* | du 前后对比 |
| 1.3 | src 头注释 150dpi → 300 修正（12+ 处） | `src/*/scripts/*`（grep "150dpi" 命中文件） | grep 150dpi 零命中 |
| 1.4 | TaskPanel 种子默认 42 → 20261013 | `BioanalysDesktop/src/App.tsx:2141` | S21 R8 关闭 |
| 1.5 | Studio 模板标签映射更新 + FiguresPanel 处置 | App.tsx:203-207、:2455-2549 | S21 R13/R14 关闭 |
| 1.6 | 台账补 seed/project_id 字段 | `ops/run_throttled_task.sh`（**ops 归 default 会话域，动前跨域报备**） | 新台账 JSON 含两字段且 03 校验通过 |
| 1.7 | 上传白名单同源化 | `server/upload.js` + `portal/lib/archive.mjs` | 同一份数据两入口校验结论一致 + 测试 |

### 第二批：需主 Agent（部分需用户）裁决后另派

| 序 | 事项 | 裁决点 |
|---|---|---|
| 2.1 | aims 修订一轮：修 D1/D5 内部矛盾、语言分工按实测改写（D2/D3）、目录图重画（D6）、桥接检查点接链或降级（D4）、cox 生存分析定界（D11）、黑名单清单定稿（D12） | D11/D12 需用户一句话；其余主 Agent 可定 |
| 2.2 | `cn_debug/scenic_db` 690MB 迁 `reference/`（先 grep 远端脚本引用确认不断链） | 移动方向；涉及远端引用未验证 |
| 2.3 | `outputs/default` 18G 处置 | **必须问用户**（曾有意清理过本地项目目录，此目录去留未知） |
| 2.4 | ops 一次性工具归档（svlogger 系 + fix_runsvdir + 08 迁移件）+ README 加热路径/归档分层 | ops 域跨域报备 |
| 2.5 | 三大台账拆"当前态/历史态"（handoff 只留近 2-3 周） | 涉及两会话共用的台账纪律，需对齐 |
| 2.6 | 交付报告工作台入口（S21 建议切片 S23 方案可直接复用） | 主 Agent 排期 |
| 2.7 | portal 鉴权 + 上传断点续传（S21 R1/R5） | 主 Agent 排期 |
| 2.8 | 回搬/链路检查双轨收敛方向 | 跨域（ops vs 8787），主 Agent 定归属 |

### 第三批：建议保持现状（有证据支持不动的）

1. 台账 Node/bash 双实现——有 consistency.test.js 固化、注释写明分工（ledger.js:3-7）。
2. 隔离四层防线——纵深防御，各管一段。
3. 三线脚本**不抽公共库**——分叉已深（diff 186-531 行），抽库=重写；代码共享不违反铁律但此时无正收益。
4. 守护 6 件套主体——每件有故障实证；仅按 2.4 归档一次性件。
5. 名字相近的 `deg_limma/deg_groups`、`qc_matrix/qc_cells/qc_spots`、`ingest_counts/ingest_spatial`
   ——**不是重复**：语言/对象/模态全不同（R bulk vs Python scRNA vs Python spatial），
   属"同族命名"而非重复实现，维持独立。
6. `project.json` 与脚本 env 默认值的"软约定"——改造成强契约需要动 60+ 脚本，风险大收益薄；
   建议只在**新增脚本**时要求读 project.json，存量不动。

---

## 附：本切片验证记录

- 实际执行的只读命令：`ls/find/du/wc/diff/grep/head/git status`（2026-10-20，输出均已在上文引用）。
- 未验证项：①远端 K40 脚本是否引用 `cn_debug/scenic_db` 旧路径（本切片未做远端 ssh）；②
  `docs/isolation.md` 与 aims §一.2 的逐条比对（只读了头 8 行，未发现矛盾但不算逐条核过）；
  ③` BioanalysDesktop` 22 个测试文件是否全部通过（本切片未运行任何测试，沿用 S21 "存在但未运行"的口径）。
- 未改动任何文件（本报告除外）；未运行任何写操作；未触碰 ops/、src/ 等他域文件内容。

