# 项目目录盘点与整理方案（2026-11-03，第二版）

> 触发：用户要求「清理项目目录、按专业角度分类归纳、删掉没用的重复的冗杂的长时用不着的，
> 参考台账，再与 4argon 讨论优化，最终把项目包装成一个软件」。
>
> 第一版把 `con_hf/` 与 `cn_debug/` 判成「历史归档、建议移出仓库」。**这个判断是错的**，
> 第二版按全仓引用取证改写：两者都是「运行必需 + 历史留档」的混合体，移走会让 13 个测试文件、
> 2 个服务端模块（台账写入面）与 7 处 ops 脚本默认路径立刻失败。版本二的核心修正是把
> 「磁盘体积」与「git 跟踪体积」分开算，
> 因为 6.8 GB 里 99% 是 gitignore 的运行时产物，删它们不需要动任何代码。

## 一、总量：仓库很小，产物很大

| 指标 | 值 |
|---|---|
| 磁盘合计 | **6.80 GB** / 约 42,000 个文件 |
| git 跟踪文件 | **1,388 个**（含待删 1 个） |
| 跟踪内容的实际体积 | **约 60 MB** |
| gitignore 覆盖的产物 | 约 6.74 GB（99%） |

结论：清理的九成功夫在「删产物」，一成在「收敛跟踪内容」。仓库本身不臃肿。

## 二、四类划分（专业视角）

| 类别 | 判据 | 代表目录 | 处置 |
|---|---|---|---|
| **A. 软件核心** | 入库、被测试/运行引用 | `BioanalysDesktop/`(server,src,tests)、`ops/`、`src/`、`portal/`、`shared/`、`bin/`、`docs/` | 保留，是打包对象 |
| **B. 真源资产** | 台账追踪或证据链依赖 | `reference/05.可参考出图代码/`、`src/workflows.json`、`src/figure_templates.json`、`ops/k40/env_lock/` | 保留，随软件走 |
| **C. 台账与取证** | 入库，**运行期或测试期真被读写** | `con_hf/`(410 文件 3.9 MB)、`cn_debug/`(258 文件 8.5 MB) | **只可裁剪不可移走**，见第三节 |
| **D. 运行时产物** | 全部 gitignore，可再生成 | `project_data/`(3.77 GB)、`outputs/`(184 MB)、`.tmp/`(128 MB)、`vendor/`(128 MB)、`con_hf/runs/*/delivery_extract`、`cn_debug/scenic_db` | 按需清理；`scenic_db` 例外保留 |

第一版把 C 类写成「历史归档、建议移出仓库或归入 docs/history/」，是只看了目录名和年代，
没做引用取证。第三节给出逐条证据。

## 三、逐项体检结果

### 3.1 已执行的删除（本地动作，删除前逐个核对绝对路径必须落在仓库内）

| 项 | 体积 | 证据 |
|---|---|---|
| `%SystemDrive%/` | 966 KB | 入库 0 个文件；名为环境变量的畸形目录，是脚本展开 `%SystemDrive%` 失败的产物 |
| `referenceL3TMP/` | 0 | 空目录，入库 0 |
| `referenceL3TMPinput_data.csv` | 69 B | 入库 1 个（加入于 5b16d66），文件名是 `L3TMP` + `input_data.csv` 粘连事故；`git grep` 全仓零引用 |
| `.tmp_full_all_slices.log` | 90 KB | 未跟踪的临时日志 |
| `BioanalysDesktop/Python/` | 167.1 MB | 与根 `Python/` 完全同版本 3.15.2 的重复副本，两份入库均为 0；`项目情况汇总2026-11-01.md:305` 已记录「5.10 便携 Python 未处置，待裁定删除或 ignore，不建议入库」，本轮删除后 `.gitignore:207-210` 已把两处都声明为忽略区 |

### 3.2 重复内容（同一资产两份）

| 项 | 体积 | 结论 |
|---|---|---|
| `Python/` 与 `BioanalysDesktop/Python/` | 167 MB × 2 | 已删后者，保留根 `Python/` 一份；两处路径都已进 `.gitignore`，不再污染 `git status` 与全仓扫描 |

### 3.3 `con_hf/` 与 `cn_debug/`：体积构成与引用取证（第一版的核心错误）

**两个数字必须先分开**：磁盘体积里几乎全是未跟踪产物，跟踪内容只有 12.4 MB。

| 目录 | 磁盘 | 其中跟踪 | 未跟踪 |
|---|---|---|---|
| `con_hf/` | 271.3 MB / 2,108 文件 | **3.9 MB / 410 文件** | 265.6 MB / 1,698 文件 |
| `cn_debug/` | 721.2 MB / 366 文件 | **8.5 MB / 258 文件** | 712.7 MB / 108 文件 |

`con_hf/` 跟踪体积按子目录：顶层 33 文件 1.3 MB、`runs` 262 文件 1.2 MB、`dispatch` 101 文件 1.0 MB、
`ledger` 5 文件 0.2 MB、`topic_survey` 6 文件 0.03 MB。
`cn_debug/` 跟踪体积按扩展名：`.py` 129 个 0.46 MB、`.mjs` 30 个 0.21 MB、`.csv` 38 个 0.03 MB、
单个 `GSE30528_sm.txt` 5.65 MB 与 `GPL571.annot.tsv` 1.84 MB 占了 88%。

**运行与测试期真被读写的（保留，不可移走）**

| 路径 | 引用点 |
|---|---|
| `con_hf/ledger/actions.jsonl` | `BioanalysDesktop/server/task.js:31`、`server/pi_agent_routes.js:62` 运行期追加；`ops/init_project_scaffold.py:261-266` 与 `ops/local_project_workspace.py:102` 创建；`tests/project_scaffold.test.js:109-115`、`tests/pi_agent_routes.test.js:157/190/262/372` 断言 |
| `con_hf/sync/{inbox,outbox,daemon.log}` | `ops/init_project_scaffold.py:270-281`、`ops/sync_daemon.ps1:32`、`tests/project_scaffold.test.js:113-115` |
| `con_hf/CONTEXT.md` | 术语唯一权威：`server/domain.js:4`、`src/line1_bulk/README.md:3`、`src/line2_scrna/README.md:3,47`、`src/line3_spatial/README.md:3`、`src/line2_scrna/scripts/summarize_dr:265` |
| `con_hf/SPEC_DECISIONS.md` | `tests/gmt_cache_env.test.js:79` 读取并断言、`tests/aims_drift_guard.test.js:103` |
| `con_hf/pitfalls_ledger.md` | `tests/proot_probe_guard.test.js:100,110,124,154,178` 读取并断言、`ops/migrate_to_local_projects.py:26` |
| `con_hf/ops_ledger.md` | `ops/sync_and_verify_remote.ps1:48`、`ops/migrate_to_local_projects.py:27`、`tests/sync_script_guard.test.js:82` |
| `con_hf/踩坑台账.md` | `server/routes/diagnostics.routes.js:158`、`server/tumor_blacklist.js:77`、`portal/index.html:1033` |
| `con_hf/runs/2026-10-27_figure_catalog_adaptation` | 默认路径：`ops/figure_catalog_r_adapter.py:664`、`ops/verify_figure_catalog.py:682` |
| `con_hf/runs/2026-10-31_phase3_delivery_drill` | `tests/delivery_acceptance.test.js:135,192`；目录缺失时测试不主张（`if (!fs.existsSync(...)) return`） |
| `cn_debug/lib/chain_runner.mjs` | `server/workflow_graph.js:5`、`tests/chain_runner_lib.test.js:21`、`tests/chain_runner_seed.test.js:13`、`tests/p29_ssh_flow_guard.test.js:24`、`tests/wp13_runner_guards.test.js:15`、`tests/workflow_graph.test.js:200` |
| `cn_debug/2026-10-21_m1_line{1,2,3}_chain.mjs`、`2026-10-22_m1_line2_rest.mjs` | `tests/chain_runner_lib.test.js:25-28,65`、`tests/chain_runner_seed.test.js:10-12`、`tests/proot_probe_guard.test.js:91` |
| `cn_debug/samples/system_logs` | `tests/consistency.test.js:44`、`tests/ledger.test.js:16` |
| `cn_debug/**/*.{mjs,sh,ps1}` 全量扫描 | `tests/proot_probe_guard.test.js:62-64`（要求扫到 >5 个）、`143`、`164` |
| `cn_debug/scenic_db/`（689.5 MB，0 跟踪） | `ops/README.md:330`：不可逆参考数据默认保留，重下需要网络 |

**零代码引用、纯留档（可裁剪）**

| 项 | 规模 | 判据 |
|---|---|---|
| `con_hf/runs/*/delivery_extract/` | **145.7 MB** / 332 文件 | 交付包解包副本，可从 `Client_Delivery.tar.gz` 重解，零引用 |
| `con_hf/runs/*/unpacked/` | **60.0 MB** / 115 文件 | 同上 |
| `con_hf/runs/*/plot_matrix_20261027_*/` | 12.0 MB / 305 文件 | 出图矩阵中间产物，零引用 |
| `con_hf/dispatch/` | 1.0 MB / 101 文件 | 派发留档，仅在注释里被提到 |
| `con_hf` 顶层 17 个 `2026-10-1x_*.md` / `2026-11-01_*.md` | 约 1.0 MB | 计划与汇报快照，被结项报告取代 |
| `cn_debug` 根 41 个零引用 `.py` 探针 | 0.15 MB | `git grep -F <文件名>` 在 `cn_debug/` 之外零命中；余 88 个被 `src/line*/scripts` 当「口径定稿依据」在注释里点名，属证据链，保留 |

**这里有一条要注意的既成事实**：`.gitignore` 第 28 行已写 `con_hf/runs/`、第 160 行已写 `cn_debug/`，
但历史上先入库后加规则，所以这两处共有 **520 个文件仍在跟踪态**。gitignore 不会自动取消跟踪，
要真收敛仓库体积得显式 `git rm --cached`，这是有风险的决策（会让新克隆缺测试夹具），
挂到第五节 Q1 由 4 Argon 裁定。

### 3.4 真正的大体积来源（未跟踪，可安全清理）

| 项 | 体积 | 说明 |
|---|---|---|
| `project_data/` | 3.77 GB / 121 文件 | 原始数据与中间矩阵，全部 gitignore |
| `outputs/` | 0.18 GB / 905 文件 | 分析输出 |
| `reference/` | 0.64 GB / 2,693 文件（入库 71 文件 6.6 MB） | 只保留 `05.可参考出图代码/`，外部参考库移出 |
| `local_projects/` | 0.32 GB / 1,488 文件（入库 69 文件 5.4 MB） | 只留证据件，其余产物清掉 |
| `.tmp/` | 0.13 GB / 6,475 文件 | 临时与演练目录 |
| `vendor/` | 0.12 GB / 81 文件（入库 0） | 本轮为「自包含」新增，见 Q2 |
| `cn_debug/scenic_db/` | 689.5 MB / 3 文件（入库 0） | **例外：不可逆参考数据，保留** |

### 3.5 必须保留但应收敛的

| 项 | 问题 | 建议 |
|---|---|---|
| `local_projects/` | 0.32 GB / 1,488 文件，只有 69 个入库（36 张 PNG 是模板示例图证据链） | 保留证据图，其余产物清掉 |
| `BioanalysDesktop/` | 0.20 GB / 13,782 文件，入库仅 214 文件 2.0 MB，其余是 `node_modules/` 与 `dist/` | `node_modules` 不入库，`npm ci` 重建 |
| `vendor/` | 128 MB，本轮新加 | 见 Q2 |
| `con_hf/runs/` | 跟踪 262 文件但 `.gitignore` 已声明整目录忽略 | 见 Q1，需显式决策 |

## 四、清理后的预期形态（给「做成软件」打基础）

```
项目根/
  BioanalysDesktop/      软件本体（server / src / tests / tools）
  ops/                   运维与门禁脚本（含 toolchain / gate:all）
  src/                   真源（workflows.json / figure_templates.json）
  reference/05.../       图件母版与证据（只留这一层）
  docs/                  规格与手册
  portal/ shared/ bin/   配套件
  con_hf/                台账：ledger / sync / CONTEXT / 三本 ledger（不给客户）
  cn_debug/              取证探针与 runner 库（不给客户）
  vendor/tools/          自包含运行时（待裁定）
  local_projects/        示例项目证据（只留入库部分）
  ---  以下全部 gitignore，不进仓库  ---
  .tmp/ outputs/ projects/ artifacts/ Python/ node_modules/ project_data/
```

预期磁盘：约 **1 GB**（主要是 `reference` 与 `scenic_db`），仓库仍约 60 MB。
关键：**`con_hf/` 与 `cn_debug/` 留在仓库里但排除在客户包外**，这是「运行需要」与
「客户不需要」两个约束同时满足的唯一排法。

## 五、需要 4 Argon 裁定的问题

**Q1** `con_hf/`(410) 与 `cn_debug/`(258) 共 668 个跟踪文件怎么处置？
    第一版说「整体移出」，取证后不可行：12 个测试文件、6 个服务端模块、5 个 ops 脚本直接读它们。
    现建议三选一：① 全部保留（仓库 60 MB，代价可接受，客户包排除即可）；
    ② 只 `git rm --cached` 3.3 节『零引用、纯留档』那 5 类（约 5 MB），保留运行必需；
    ③ 连运行必需的也搬，改造 `init_project_scaffold` 让台账目录可配置（改造面最大，风险最高）。

**Q2** `vendor/tools/`(127.6 MB) 要不要进仓库？这是「自包含」与「仓库轻量」的取舍。
    折中方案：仓库只存下载清单与校验和（`ops/toolchain_manifest.json`），首次运行脚本自取。

**Q3** 「做成软件」的目标形态：Electron 桌面安装包、绿色解压即用便携包、还是服务端部署包？
    用户已口头选定**绿色便携包**，需要确认边界：是否必须做到「无 node/git/ssh 的干净机器也能跑」。

**Q4** 清理的验收判据：删完后必须 `gate:all` 七道全绿 + 测试 `fail=0`。
    这条要不要作为硬门槛（即清理 PR 必须同时证明没删坏东西）？

**Q5** 客户包里 `con_hf/` 与 `cn_debug/` 的排除方式：靠打包脚本白名单，还是靠 `.gitattributes export-ignore`？
    前者已在 `ops/build_client_report.py` 生效，后者能覆盖 `git archive` 场景但要多维护一份清单。

## 六、落地记录（2026-11-04，本目标执行后回填）

**第一、二节的清单已按取证执行，全部动作有提交号可查：**

| 动作 | 结果 | 提交 |
|---|---|---|
| .npmcache 取消跟踪（55 MB / 48 blob，零引用） | 跟踪内容 62 MB -> 约 7 MB，文件留盘 | `5f46660` |
| 垃圾四项删除（%SystemDrive%、referenceL3TMP、拼接事故 csv、临时日志） | 全清，其中 csv 属误入库（5b16d66 引入） | `dd7067c` |
| BioanalysDesktop/Python 重复副本（167 MB） | 删除，保留根 Python/ 一份 | 本目标轮 |
| cn_debug/lib 被 .gitignore 整目录规则吞掉（6 个测试 import 的真源没入库） | 取消忽略并入库；chain_runner_lib 的第 4 个输入同补 | `1b159b7` `ef490c9` |
| con_hf/cn_debug 归类修正 | 历史归档 -> 运行必需+历史混合，只裁剪不移走；Q1 未再触发（保留跟踪） | `dd7067c` |
| portal/inbox 运行目录缺失（新克隆/包内必炸） | 服务端加载时 recursive 建目录 | `ed59aba` |
| 净化环境测试自适应（git 工作树根 / PowerShell / 执行策略 / 设备 / 图录数据） | 白名单加 HOST_MISSING_SHELL、HOST_MISSING_GIT 两标签 | `488c838` `4586a5c` |
| 四层收敛构建器 ops/build_portable_package.mjs | L1 核心+测试依赖闭包 / L2 真源台账 / L3 runtime / L4 全排除；MANIFEST.sha256 覆盖 1526 文件 | `994ed09` |
| BASELINE_RE 贪婪吞行导致 README 基线累积 6 层尾巴 | 修正则 + 重置基线行 | `2797696` |
| metrics check 要求 pass/skipped 分配 | 只留 cases 与 fail 两个跨机器不变量；漂移由 # SKIP 白名单 + fail=0 兜底 | `2797696` |

**双环境终验（2026-11-04 01:05 实测）：**

| 环境 | gate:all | 交付四关 |
|---|---|---|
| 开发机（node/git/ssh/设备全在） | GATE_ALL_OK 7 道全绿 78 秒（1354 tests / 1336 pass / 0 fail / 18 skipped） | 演练包 0.7s 全绿（VERIFIED 112） |
| 包内净化环境（PATH 仅 runtime+System32，无 node/git/ssh） | GATE_ALL_OK 7 道全绿 11 秒（同 1354 用例，63 条带白名单原因跳过，0 fail） | DELIVERY_ACCEPTANCE_OK 四道关全绿（本节上方实测） |

**Q2 的临时决定（待 Argon 确认）**：vendor/ 先进 .gitignore 不入库；
便携包构建时从本机 vendor/tools 复制。目标机不需要 git，构建机需要。
若要求「克隆即可打包」，再把 vendor 入库或改为下载清单方案（第二节折中案）。
