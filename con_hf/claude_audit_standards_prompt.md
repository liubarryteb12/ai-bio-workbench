You are a read-only Standards reviewer. Review the git diff master...HEAD for runtime behavior code and tests. Do not propose unrelated refactors.

Report:
(a) Hard violations of repository standards, citing the standard file and rule.
(b) Only these Fowler 12 smells as judgement calls, citing hunks: Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest.
Ignore issues already enforced by tooling.

Focus files: figure_adapters.js, figure_graph.js, workflow_graph.js, task.js, server/index.js, portal/serve.mjs, sync_daemon.ps1, serve_guard.ps1.
Max 400 words. For each finding give file/hunk evidence and a minimal fix direction.

=== REPO STANDARDS ===# AI 辅助生信分析流程工作台 · Agent 指引

本文件每轮都进上下文，所以只放**导航指针**和少量硬规则。
流程与规范正文在 `docs/` 下，按下面的表去够，不要把正文抄进来。

## 先读这些

| 当你 | 读 |
|---|---|
| 动 `src/` 下任何分析代码前 | [docs/coding-standards.md](docs/coding-standards.md)（Linux 运行面、seed 契约、退出码） |
| 跨线搬数据、定文件放哪 | [docs/isolation.md](docs/isolation.md)（三线隔离）、[docs/directories.md](docs/directories.md)（文件放哪） |
| 开始一项功能、改架构、写 spec 或票 | [docs/mattpocock-workflow-spec.md](docs/mattpocock-workflow-spec.md) |
| 写或改 skill、`AGENTS.md`、任何 agent 会读的文档 | [docs/mattpocock-writing-spec.md](docs/mattpocock-writing-spec.md) |
| 跑 K40 / 部署 / 台账相关 | [docs/isolation.md](docs/isolation.md) 起手，再看 `ops/` 与具体线文档 |
| 做课题设计、选题准入判定、筛数据 | [docs/topic_sieve_spec.md](docs/topic_sieve_spec.md)（规则正本：L0 到 L4 与 T1 到 T9） |
| 派「按方向调研数据」的活 | [docs/topic_survey_sop.md](docs/topic_survey_sop.md)（模式 A 执行规程） |

隔离红线优先于上面任何一份。

## 硬规则

- 分析代码跑在 k40-ubuntu 容器，按 Linux 面写：shebang + `set -euo pipefail`、LF 行尾、
  POSIX 路径、纯英文路径与文件名、脚本 755。`ops/` 下的 PowerShell 只做本地运维，不受此约束。
- 中文可进注释与报告正文。文档里不用 em dash，用逗号、冒号、句号、括号。
- 展示任何命令、输出、捕获产物前先打码：secret 一律写 `<REDACTED>`，别打印凭证或 key。
- 一个含义一个真源。别在文档里复述 `package.json`、配置或 `--help` 能给的东西；
  该缓存的是查不到的东西：不成文的约定、选择背后的理由、配置不肯招的坑。
- 多行代码与长字符串一律落盘成 `.cjs` / `.ps1` / `.md` 文件再执行，不塞进行命令参数。
  超二十行的内容用 here-string `@'` 与 `'@` 包裹（两者各自单独占一行），不用双引号拼接。
  短字符串默认单引号，只有确定要展开变量时才用双引号。
- 动词不用否定式禁令（"不要 X"），写正面目标行为。
- 每句话都当 no-op 审一遍：相对默认行为改变了什么？没变就删。

## 做事方式

按 [docs/mattpocock-workflow-spec.md](docs/mattpocock-workflow-spec.md) 走，要点是：

- 动手前先对齐。需求模糊时先把问题问清，别猜着做。查事实是你的活，做决策是用户的活。
- 每一步终于一个**说得清做完没做完**的判据。模糊边界会招来提前收尾。
- 有测试可跑就 test-first，一个垂直切块一个切块地推，先红后绿。
- 卡住时先造一条对**这个**问题会变红的反馈环，再造理论。没有环之前别靠读代码建假设。
- 做完自己 review 一遍再交付。

=== coding-standards ===
# 工程规范 : 分析代码规范（Linux 运行面）

> version 1 | 2026-10-13
> 本规范规定 `src/` 下三条线分析代码怎么写。新步骤动工前先读本文件。
> 与 [isolation.md](isolation.md)（三线隔离）、[directories.md](directories.md)（文件放哪）配套；
> 隔离红线优先于本规范任何条目。

## 第一条铁律：代码在 Linux 上跑

**所有分析代码（`src/<line_id>/scripts/` 下的步骤脚本）运行环境是服务器 Ubuntu 容器
（k40-ubuntu，proot-distro），不是 Windows，也不是本地 PC。**

因此一切按 Linux 运行面规范写，Windows 习惯一律不带进来：

- **shebang + 严格模式**：`#!/usr/bin/env bash` + `set -euo pipefail`，不许缺。
- **换行必须是 LF**，不许出现 CRLF：CRLF 会让 awk 的数值比较退化成字符串比较，
  统计结果全错（坑 #103）。本地编辑后先确认行尾再部署。
- **不写任何 Windows 专有语法**：无 PowerShell/cmd 语义、无 `\` 路径分隔符、
  无盘符、无 `C:/` 路径。路径一律 `/` 分隔的 POSIX 绝对路径。
- **路径与文件名纯英文**：Linux 系统内不出现中文字符（directories.md 命名红线，
  含"Linux 系统内一律英文路径与文件名"条）。中文只允许进注释与报告正文。
- **可执行位**：脚本部署后必须 755（`ops/06_deploy_scripts.ps1` 已带 chmod + `test -x` 复核）。
- **不用 em dash（:）**：注释与报告用逗号、冒号、句号、括号。

ops/ 下的 PowerShell 脚本跑在本地 PC 侧，只做链路运维与部署传输入口，
**不是分析代码**，不受本条约束；但它们下发的远端命令整体用单引号包裹，
避免 `$var` 被 PowerShell 本地展开（坑 #98）。

## 步骤脚本结构（生产模式）

每个步骤一个自包含可执行文件，bash 包装 + python3 heredoc：

```
scripts/<step_name>
├── bash 段：seed 契约检查、参数解析、输入分流
└── python3 - <<'PYSCRIPT' ... PYSCRIPT   # 计算与自校验， heredoc 用引号防变量展开
```

- **seed 契约**：`BIOANALYS_SEED` 必须由引擎注入，缺失即 exit 3，不设默认值。
- **参数解析**：只认 `--input`（可多个）/ `--output` / `--seed`，其余参数 exit 2；
  未知参数立即报错退出，不静默忽略。
- **输入分流**：按 `case` 模式匹配时模式**前后都带 `*`**：引擎传进来的是绝对路径，
  前缀匹配永远不中（坑 #99）。
- **计算段**：环境隔离用 `H5AD_FILE` 等环境变量传路径，不拼命令行。
- **自校验内建**：输入契约（obs/var/uns/layers/obsm 逐项核对）、核心数值口径
  （如库大小归一化后精确等于 target_sum）、产物结构（shape/稀疏性/dtype/对账），
  任一不过 `fail()` 非零退出。**自校验不过不许落盘。**
- **报告**：每步产 `*_report.txt`，口径、阈值、诊断量、计时、产物清单全部如实记录，
  包括"如实报告"类数字（如 mito 入选 HVG 数），不粉饰。

## 壳层书写纪律（写母版与运维脚本时同样适用）

三条来自 2026-10-25 实测的约定：同一难度的活，违反时三次失败，遵守后一次通过。
完整提示词见 `con_hf/2026-10-25_shell_discipline_prompt.md`，可整段贴给新 agent。

1. **多行内容落盘成文件再执行。** 超二十行的代码写进 `.cjs` / `.ps1` / `.md` / `.json`，
   再用 `node 文件` / `pwsh -File 文件` 跑。命令行里出现 `${...}`、`$_`、`$env:`、
   反引号、嵌套花括号任意一种，即改为落盘：PowerShell 双引号先做变量展开，
   这些字符会被提前吃掉，到目标程序时已是残串。
2. **here-string 包裹字面量。** 需要原文义不变地交一段内容给程序时用 `@'` 与 `'@`，
   两者各自单独占一行，闭定界符顶格。单引号定界不展开变量，双引号定界 `@"` 仍会展开。
3. **短字符串默认单引号。** 只有确定要展开变量时才用双引号。

shell 母版写完用 `bash -n <脚本>` 查语法（bash 位于 `D:\Git\bin\bash.exe`，
该目录需在 PATH 中）。母版契约由 `BioanalysDesktop/tests/master_conventions.test.js` 兜底，
本地没有 bash 时靠它间接验证。

## 退出码约定

| 码 | 含义 |
|---|---|
| 0 | 成功，产物与台账齐 |
| 2 | 参数错误 / 输入契约不满足（缺输入、文件不存在、无法识别） |
| 3 | `BIOANALYS_SEED` 未注入（引擎契约破坏） |
| 1 | 自校验失败（计算或产物不合口径） |

## Python 侧约定

- 栈：anndata / scanpy / numpy / scipy（线3 空间分析按需 squidpy，装前先 dry-run，
  确认不连带降级既有依赖，坑 #107）。**不新增依赖**，除非已写入该线 `envs/manifest.txt`
  并在报告注明版本。
- `ad.settings.allow_write_nullable_strings = False` 每个 python 段开头显式关掉
  （pandas 3 与 2 默认值不同，不关会在写 obs 字符串列时崩，坑 #107）。
- 随机性只来自 `BIOANALYS_SEED`（PCA/neighbors/UMAP/采样的 `random_state` 全部传入），
  保证同 seed 可复现；诊断用采样固定 seed。
- 数值口径写常量不放裸字面量（`TARGET_SUM = 1e4`、`N_TOP_GENES = 2000`），
  跨步骤共享口径先在上游报告里定稿，下游引用不改动。
- 注释只解释"为什么"：口径决策、绕过某库 bug 的写法、与论文/等价工具的对应关系。
  不写"这是什么"。

## 与台账、隔离的接口

- 台账由引擎（BioanalysDesktop server）落 `system_logs/`，脚本只管 stdout/stderr 与退出码；
  但脚本输出必须包含可解析的关键行（`step_executed=<step>` 开头，关键节点 flush 输出），
  供 SSE 日志流与巡检解析。
- 跨线引用（输入/输出路径指向本线目录外）由审计前置拒绝，脚本自身不绕过：
  输入路径出现他线字符串即非零退出并说明，不"帮忙"找文件。

=== isolation ===
# 三线隔离约束

> version 1 | 2026-10-12
> 术语定义见 `con_hf/CONTEXT.md`，本文件讲"约束是什么 + 怎么执行"。

## 约束内容

三条分析线：`line1_bulk`、`line2_scrna`、`line3_spatial`。

**互不交叉**（架构级硬约束，不是工作习惯）：

1. 不互相取参考。线3 做解卷积时，参考只能来自 `public_references/` 或线3 自有单细胞分辨率数据，
   **不得从线2 提取参考给线3**。
2. 不合并数据集。三条线的 `raw_data/`、`processed/`、`results/` 物理分离。
3. 不跨线验证。线1 的外部验证用独立 GEO 数据集，不拿线2/线3 的结果当验证集。

**虚拟敲除不是第四条线**：它是线2 和线3 各自的末端模块，产出 DR genes。

**R/Python 混用只发生在线内**：同一条线内部可以按工具分工换语言，
例如线2 用 Scanpy 做 QC 聚类、用 scTenifoldKnk 做虚拟敲除。这是工具层混用，不是分析线交叉。

## 目录层怎么保证

物理隔离靠目录边界，不靠人记得：

```
/mnt/ssd/bio_data/
├── projects/
│   ├── default/
│   │   ├── line1_bulk/{raw_data,processed,results,figures}/
│   │   ├── line2_scrna/{raw_data,processed,results,figures}/
│   │   └── line3_spatial/{raw_data,processed,results,figures}/
│   └── <新项目>/...          ← 项目之间同样物理隔离
├── bin/<line>/              ← 脚本部署区（全局一份）
├── envs/<line>/             ← 环境声明（全局一份）
└── public_references/       ← 跨项目唯一合法共享读入口
```

每条线的分析代码工作时，工作目录必须设在该项目该线的 `processed/` 内；
脚本的输入输出路径只允许出现：本项目本线目录、`public_references/`、`system_logs/`。

**两层隔离**：项目之间（不同 `<项目>` 目录互不引用）与线之间（同项目内三条线互不引用）都是硬约束。

## 执行层校验

约束不能只写在文档里，由两个脚本分管执行：

1. **代码静态检查**（PC 侧，`ops/02_check_isolation.ps1`）：
   `src/<line>/` 下的脚本，路径字符串中不得出现其他两条线的目录名或 line_id。
2. **台账检查**（服务器侧，`ops/03_check_logs_remote.sh`，PC 侧一键入口 `ops/04_check_logs.ps1`）：
   `system_logs/` 下任务台账 JSON 的 `line_id` 必须是三个合法值之一，`project_id` 必须合法
   （缺省视为 `default`，兼容迁移前的历史台账）；`io_files` 中的路径必须属于该 line_id 或
   `public_references/` 或 `system_logs/`，且路径中的项目段（`/projects/<项目>/`）必须与
   `project_id` 一致（跨项目引用一律判违规）。
3. **运行时路径断言**（后端 `server/files.js` / `figures.js` / `upload.js`）：
   所有浏览、出图、上传路径都必须落在 `projects/<项目>/<线>/` 或 `public_references/` 之内，
   别的项目、别的线、`..` 穿越一律拒绝。

## 桥接检查点（线内混用时必过）

跨语言传文件（如 Python 出 `.h5ad` 给 R 读）后，必须校验四项，任一不符即停：

- 基因名（symbol 是否一致、有没有带版本号后缀）
- 矩阵方向（基因×细胞 还是 细胞×基因）
- 细胞名是否保留
- embedding 是否保留

校验脚本放 `src/<line>/` 下，命名为 `checkpoint_*.R` 或 `checkpoint_*.py`。

## bulk 线的外部验证冻结

独立 GEO 验证集只做冻结评估：不重新筛基因、不重新调参。
验证集内部可以去批次，但**禁止把训练集和验证集合并校正后再评估**。
多外部数据集、跨平台必须分开报告，关注表达方向一致性。

=== directories ===
# 工程规范: 目录结构

> version 3.0 | 2026-10-26
> 本规范规定"文件放哪"。新会话接手先读本文件，不要猜。

## 一句话原则

**本地控制面保留代码、治理台账与轻量回搬的项目产物；原始大数据、运行环境和计算都在服务器侧。**
单个项目的数据、图件、调试、交付与台账统一收口在 `local_projects/<项目>/`。

## 本地工程目录（本仓库）

```
AI辅助生信分析流程工作台/
├── local_projects/          # 本地项目唯一根，结构与远端项目语义对应
│   ├── INDEX.md             # 全项目机读摘要入口
│   └── <项目>/              # 自包含项目目录，见下节
├── outputs/
│   └── system_logs/         # 仅存回搬的机器执行台账，与 JSONL 台账独立
├── reference/               # 参考资料唯一存放地，内容只读，结构可整理（约定见下）
├── con_hf/                  # 全局治理与同步根
│   ├── CONTEXT.md           # 领域术语表（唯一权威，改词先改这里）
│   ├── SPEC.md              # 阶段规格
│   ├── handoff.md           # 跨会话交接快照（接活先读它）
│   ├── ledger/              # 全局五类 JSONL 追加式台账
│   └── sync/                # inbox、outbox、daemon.log
├── docs/                    # 工程规范与架构文档
│   ├── directories.md       # 本文件
│   ├── coding-standards.md  # 分析代码规范（Linux 运行面，src/ 动工前必读）
│   ├── isolation.md         # 三线隔离约束与校验
│   └── ledger-schema.md     # 任务台账 JSON schema
├── ops/                     # 链路运维脚本（PC 侧 PowerShell 入口 + 手机/容器侧执行体）
└── src/                     # 三条线分析代码
    ├── line1_bulk/
    ├── line2_scrna/
    └── line3_spatial/
```

## 服务器侧目录

```
/mnt/ssd/bio_data/                      # 红米手机自带储存根
├── projects/                           # 项目根：一个项目一套三线，项目之间物理隔离
│   ├── default/                        # 默认项目（历史三线数据迁入处）
│   │   ├── line1_bulk/                 # GEO bulk 线
│   │   ├── line2_scrna/                # 单细胞 + 虚拟敲除线
│   │   ├── line3_spatial/              # 单细胞空间 + 虚拟敲除线
│   │   └── project.json                # 项目元数据（名称 / 描述 / 创建时间）
│   └── <新项目>/...
│       ├── <line>/scripts/             # 【代理自管】本项目适配后的脚本副本（方案A，框架不创建）
│       └── deliverables/               # 【代理自管】客户交付包三大件（框架不创建）
├── bin/<line>/                         # 脚本部署区（代码本体，全局一份，所有项目共用）
├── envs/<line>/                        # 环境声明（跟代码走，全局一份）
├── public_references/                  # 公共参考（跨项目唯一合法共享读入口）
└── system_logs/                        # 全局台账 JSON（条目带 project_id 区分归属）
```

每条线内部数据子目录固定为 `raw_data/`、`processed/`、`results/`、`figures/`；
脚本 `bin/` 与环境声明 `envs/` 在顶层全局一份，不随项目复制（同一线的所有项目共用同一份代码与环境）。

**两个代理自管目录（不在框架 `LINE_SUBDIRS` 内，工作台不创建、不感知）**：

| 目录 | 用途 | 谁创建 |
|---|---|---|
| `projects/<项目>/<line>/scripts/` | 客户数据需适配时，从 `bin/<line>/` 复制母版到此改，跑通后留档；不改母版 | 代理 `mkdir -p` |
| `projects/<项目>/deliverables/` | 客户交付包三大件（适配代码 / 图表与表格 / 解读报告） | 代理 `mkdir -p` |

交付包结构与打包规则见 `docs/delivery_package_spec.md`（v1.0，**实现现状见该文「零」节**）：打包由服务器侧 `ops/build_client_report.py` 承担，工作台入口是 `POST /api/report/build`（`BioanalysDesktop/server/report.js`，含存储水位 / 进行中任务 / 失败台账三道前置门禁与 `.sha256` 旁挂）；原规划的 `ops/09_package_delivery.ps1` 已作废，不再实现。

适配副本不经工作台任务引擎（它只认全局 `bin/<line>/`），而是直跑 ops 包装器：
`bash /mnt/ssd/bio_data/ops/run_throttled_task.sh <task_id> <line> <step> <R|Python> <项目内脚本绝对路径>`。

本地回搬入口（`ops/07_pull_outputs.ps1`）按项目写入
`local_projects/<项目>/data/<line>/{processed,results}` 与
`local_projects/<项目>/figures/<line>/`；机器执行台账独立落 `outputs/system_logs/`。

## 本地项目存档与 sync 运行态

`local_projects/` 是本地项目唯一根，只接轻量回传与项目台账，不替代算力面工作目录。
每个项目由 `ops/init_project_scaffold.py` 幂等创建：

```text
local_projects/<项目>/
├── project.json
├── handoff.md
├── README.md
├── INDEX.json
├── data/<line>/{processed,results}
├── figures/<line>
├── figures/adapt
├── deliverables/
├── debug/
└── ledger/{actions,changes,errors,fixes,pitfalls}.jsonl
```

建项命令：

```powershell
python ops/init_project_scaffold.py --root . --project <项目> --line <line> [--ticket <id>]
```

`figures/<line>/` 收真实结果图，`figures/adapt/` 收项目内模板派生副本，两者不得混用。
脚手架重复运行只补缺失项，不覆盖项目元数据、README、交接文档或已有台账内容。

全局 `con_hf/ledger/` 与项目级 `ledger/` 分离：前者只收跨项目结论和全局动作，
后者只收本项目事实。`outputs/system_logs/` 或服务器侧 `system_logs/` 是独立机器台账，
不与 JSONL 台账合并。

`con_hf/sync/` 是工作区内的 sync 运行态，只放 `inbox/`、`outbox/`、`daemon.log`。
它是 spool，不是数据仓库。

存量 `default`、`PRJ_20261019_IS_lactylation` 及分散项目资产由 `WP-2.1` 执行零损迁移。
迁移完成前，旧 `outputs/` 项目产物只作兼容存量，新任务一律按 `local_projects/<项目>/`
落盘并单独记录迁移前后的文件数与 SHA256。

## 归档分类（写文件前先判断类别）

| 类别 | 落点 |
|---|---|
| 交接上下文 | `con_hf/` |
| 工程规范、架构文档 | `docs/` |
| 运维脚本 | `ops/` |
| 分析代码 | `src/<line_id>/` |
| 项目专属调试与日志 | `local_projects/<项目>/debug/` |
| 跨项目临时探针 | `cn_debug/` |
| 运行记录、验证报告 | `con_hf/runs/` |

运行记录命名：`YYYY-MM-DD_[类型]_[简短说明]`，类型 ∈ `initial` 基线 / `debug` 调试 / `failed` 失败现场 / `verification` 验证 / `formal` 正式产物。

参考资料是唯一例外：它按内容只读，按结构可整理。

## reference/ 的读写规则

`reference/` 是参考资料唯一存放地，分两层对待：

内容层只读：已入库的参考文件（实测经验、规范摘录、可用文献、出图代码）正文不改写、
不删除。要改先复制到工作副本，改完作为新文件入库，原文件留痕。

结构层可整理：目录归类、可用性判定、把无用件移到待整理区，这类动作合法，
是维护动作不是破坏。整理前先出盘点清单，整理后留台账。

待整理区固定为 `reference/09.待整理/`，存放判定为无用或暂不可用的文件。
移入时保留原始相对路径，便于回溯。待整理区内的文件不参与分析，不引用，定期清。

命名沿用参考区既有风格：`NN.中文主题名`。新增顶类目时编号顺延，不重排已有编号。

### reference/ 子目录编号与用途

| 编号 | 中文名 | 文件数 | 用途 |
|---|---:|---:|---|
| `00a` | 可参考代码库 | 1711 | 待整理源代码库，可用件迁入 `05.可参考出图代码`，无用件迁入 `09.待整理` |
| `01` | 工程规范 | 217 | 工程规范参考 |
| `02` | 分析流水线构建参考与可用参考文献 | 49 | 分析流水线构建与文献参考 |
| `03` | 出图规范 | 5 | 投稿图尺寸、字号与 dpi 等出图规范 |
| `04` | RedmiK40_liunx_container | 64 | K40 Linux 容器参考 |
| `05` | 可参考出图代码 | 103 | 已验收可参考出图代码，含 16+1 图型 demo |
| `09` | 待整理 | 229 | 待整理区，存放无用或暂不可用文件 |
| 无 | 分析流水线构建参考 | 0 | 空目录，待确认是否冗余 |

新增顶类目编号顺延，不重排已有编号。

项目分组及对应目录维护在 `reference/项目分组表.tsv`。

## 命名与写法红线

- 标识符、路径用英文；面向用户的说明用中文。
- **Linux 系统内（服务器侧）一律英文路径与文件名**，不出现中文字符：本地既有中文名的
  用户资产（如 `test_use_data/` 下的目录与 `分组情况.txt`）推到服务器前必须换成英文名，
  映射关系集中在引用处（当前在 `ops/05_push_testdata.ps1` 的 `$RemoteNameMap`）。
- 注释只解释"为什么"，不写"这是什么"。
- 注释和文档不用破折号，用逗号、冒号、句号替代。
- 变量命名不用单字母（数学符号和循环计数除外）。
- 不自动重命名、移动或覆盖用户原有文件。
- linux上运行的代码必须符合linux的命名规范。

## 服务器侧执行面

| 面 | 别名 | 用途 | 不该做什么 |
|---|---|---|---|
| Termux 底座 | `k40` | 文件传输、隧道、服务管理、runsv 看护 | 不跑分析计算 |
| Ubuntu 容器 | `k40-ubuntu` | R/Python 科学计算执行 | 不作为文件长期存放地 |

## 环境隔离

- 容器内 R/Python 环境按线固定：每条线一个独立 conda env 或独立 R 库路径，记录主语言与版本到该线 `envs/`。
- 版本、随机种子写进该线 `envs/manifest.txt`，分析中途不更换。
- 跨线不共用编译产物、不共用 conda env。

=== workflow-spec ===
# Matt Pocock 工程规范（Codex 工作流版）

> version 1 | 2026-10-23
> 提取自 `reference/01.工程规范/mattpocock-skills`（Matt Pocock 的 agent skills 仓库）。
> 本文件是可执行口径，不是仓库说明：原仓库各 `SKILL.md` 保留完整步骤，这里只留判定、门槛与不变量。
> 配套 [mattpocock-writing-spec.md](mattpocock-writing-spec.md)（写 agent 文档的规范）；
> 与 [coding-standards.md](coding-standards.md) 分工：那份管代码怎么写，本文件管活怎么干。

## 定位：这套规范在对抗什么

上游的出发点不是流程托管（GSD / BMAD / Spec-Kit 那一类接管流程的方案），而是四个具体失效模式，
每个对应一个修法。技能被刻意做成小、可改、可组合，换模型照样跑。

| 失效模式 | 症状 | 修法 |
|---|---|---|
| 没对齐 | 你以为他要 A，做出来是 B | grilling：动手前先盘问 |
| 太啰嗦 | agent 用 20 个字说 1 个字能说清的事 | 共享词汇：`GLOSSARY.md` |
| 跑不起来 | 对齐了还是产出烂代码 | 反馈闭环 + TDD 红绿循环 |
| 烂泥球 | agent 提速的同时也在加速软件腐化 | 每天投设计：deep module |

## 一、调用约定（元规范）

先定"谁能触发谁"，否则后面全是空话。分界只看一件事：谁能触发。

- **user-invoked**：只有人打字能触发。frontmatter 加 `disable-model-invocation: true`，
  Codex 侧在 `agents/openai.yaml` 配 `policy.allow_implicit_invocation: false`。
  此时 `description` 是给人扫的一行摘要，删掉 "Use when the user says..." 那类触发词表。
  代价是认知负载：你得自己记得有这门技能。
- **model-invoked**：人和模型都能触发，默认形态。`description` 是给模型看的顶层
  context pointer，必须常驻，保留触发短语。换来可发现性，也换来常驻的上下文成本。

三条硬规则：

1. user-invoked 技能**永远不能被另一个技能调到**，包括用 Skill tool 点名。
2. user-invoked 可以调 model-invoked；model-invoked 之间也可以互相调。
3. 依赖写成显式指令：`Call the Skill tool with "tdd"`。不写 `../other-skill/FILE.md` 深链，
   不写裸 `/tdd` 让模型自己猜。一次调用只带一个技能名；要两个就写成"调用两次"。

前置条件本身是 user-invoked 技能时（如 `setup-matt-pocock-skills`），措辞只能是
"让用户去跑 `/xxx`"，不能是让 agent 去调它。

## 二、主链：idea 到 ship

大多数活走这条路，三个分支点逐条问。

1. **grill-with-docs**：有工作目录就用它。它跑 `grilling` 加 `domain-modeling` 两个
   model-invoked 技能，边盘问边把 `GLOSSARY.md` 和 ADR 写下来。没有工作目录才用 `grill-me`；
   两者跑同一个盘问原语，区别只在于留不留纸迹。
2. **分支：这个问题能不能全靠对话解决？** 需要可运行的答案（状态模型、业务逻辑、
   必须亲眼看的 UI）就绕去 `prototype`，两端都用 `handoff` 桥接，因为原型活在独立目录里。
3. **分支：这是多会话的活吗？**
   - 是：`to-spec`（把线程综合成 spec，不再面试）接 `to-tickets`（切成 tracer-bullet 票，
     每票声明阻塞边），然后二选一：
     - `implement` 逐票做，**每票之间清上下文**；
     - `implement-spec` 一把梭，把票当 task graph，子代理并行跑 frontier，全落一条集成分支。
   - 否：直接 `implement`，就在当前窗口做。

   两条路都靠 `tdd` 一块红绿切片一块红绿切片地推，都以 `code-review` 收尾。
   上 PR 时用 `pr` 模板塑身。
4. **retro**：收口。回看这一会话，提议改**环境**（导航指针、自动检查、编码标准、
   steering 文件、工具）。机械失误变成确定性检查，判断题变成编码标准。

**上下文卫生**：步骤 1 到 3 保持在一个不中断的窗口里，`/to-tickets` 之前不要 compact 或 clear，
盘问、spec、票要共享同一套思考。上限是 smart zone（约 150k token）；
到界了就在最近的相位边界 compact，别带着降级的脑子硬推。

## 三、上匝道：产生活的三条入口

- **issue 堆起来了**：`triage`。只处理**不是你提的** issue：bug 报告、别人提的需求。
  `to-tickets` 产出的票本身已经 agent-ready，不要再 triage 一遍。
- **有东西坏了**：`diagnosing-bugs`。留给硬 bug：看一眼看不出的、间歇性的、
  两个已知良好状态之间溜进来的回归。修完在同一个会话里跑 `retro` 问"什么能防住它"；
  如果真正的发现是"没有好的 seam 能把它锁死"，那是 `improve-codebase-architecture` 的活。
- **大到装不进一个会话**：`wayfinder`。这里到目的地的路还看不清楚，它在 tracker 上画一张
  决策票地图，一次解一张票，**产出决策，不产出交付物**。地图清了之后从 `to-spec` 并回主链，
  不要直接跳 `implement`，那会把地图里的关联细节全丢掉。

## 四、相位边界：什么时候换上下文

**相位**是一个会话里的一块活（盘问、实现、QA）。**相位边界**是两块之间的缝，
这个决策只属于边界；中途没有这个决策可做，继续或者把剩下的拆给子代理。

五个选项，按序问，第一个 yes 就赢：

1. **这个会话能继续吗？** 下一相位需要本相位当**主源**，或者 smart zone 还够，
   就 **Continue**。继续不花钱也不丢东西，所以第一个排除它。
2. **上下文对接下来的活毫无关系吗？** 探索、决策、死路全都可弃，就 **`/clear`**。
   棋盘上最便宜的一步，且不清空历史，旧会话还能恢复。
   判错的代价是单向的：清了相关上下文，"为什么这么做"就没了，把 diff 读回来也要不回来。
3. **需要交接吗？** 只有四种情况：换 harness、换目录或仓库、交给同事、
   或者中途分叉一个支线任务。`/handoff` 买的是**可移植性**，一个能带着走的文件。
   没什么在走，就不需要它。
4. **这活能 AFK 干完吗？** 范围够紧、不需要你盯着，就 **subagent**。自动评审是标准场景。
5. **否则 `/compact`**。上下文相关、同 harness、同目录、你还要在场，树就落在这儿，
   而且经常落在这儿。给它一句指令（`/compact we're going to QA this area`），
   让摘要留下下一相位要的东西。

除 Continue 之外，每一步都在把**主源**换成**次源**：真实发生的会话被一份摘要取代。
主源信息全、噪声多、没什么腾挪空间；次源有损、干净、腾挪空间大。
所以第 1 问排第一：只有"留着比省下贵"的时候才付那份有损。
compact 是**默认，不是首选**；一上来就 compact 的失效模式是新会话对某个被摘要压平的决策
信心满满地搞错。

## 五、每门技能的硬门槛

摘要只用于定向。要动真格，或要判断某一步能不能跳，去读原 `SKILL.md` 全文。

### grilling（盘问）

把设计看成一棵 **design tree**：每个决策分出挂在它下面的决策。按 **rounds** 推进，
**frontier** 是前置已定的那批决策，也就是现在就能问、不用猜没听到的答案的问题。
一轮把整个 frontier 一次问完，编号，每题附推荐答案，然后等回答再进下一轮。
措辞让 "yes" 等于接受你的推荐答案。

查**事实**是 agent 的活，永远不是用户的：需要环境里的事实就派子代理，
别问用户你本来能自己查的东西，也别被它堵住，只让下游问题等它报告。
做**决策**是用户的。frontier 空了才叫聊完，且用户确认达成共识之前不动手。

### tdd

- **只测约定好的 seam。** 写任何测试之前，先把要测的 seam 写下来并和用户确认；
  没有在未确认的 seam 上写的测试。测不完所有东西，事前约定 seam 就是让测试精力
  落在关键路径和复杂逻辑上，而不是每个边界情况。
- **红先于绿。** 先写失败测试，再写刚好让它过的代码。不预判后续测试，不加投机功能。
- **一次一个垂直切片。** 一个 seam、一个测试、一个最小实现。
- **重构不属于这个循环**，归 review 阶段。
- 三类反模式：**实现耦合**（mock 内部协作者、测私有方法、走侧信道验证）；
  **同义反复**（期望值按代码的方式重算一遍，构造上就不可能失败；
  期望值必须来自独立真源，已知正确的字面量、算好的例子、spec）；
  **水平切片**（先写完所有测试再写所有实现，测的是想象中的行为）。
- mock 只 mock 系统边界（外部 API、数据库、时间与随机、文件系统），
  自己的类和内部协作者不 mock。可测性靠**接住依赖而非自己造**：依赖注入、
  SDK 式细粒度接口、返回结果而不是改副作用。

### diagnosing-bugs

**Phase 1 就是这个技能本身**，其余都是机械操作。有一条对**这个** bug 会变红的
**tight** 信号，你就会找到原因；二分、假设检验、插桩都只是在消费它。
没有它，盯着代码看再久也白搭。这一步要花不成比例的功夫，要 aggressive，要有创意，不许放弃。

构造反馈环的办法，大致按优先级：失败测试，curl 打 dev server，CLI 喂固件 diff stdout，
无头浏览器脚本，回放捕获的 trace，一次性 harness，属性或模糊循环
（"有时输出错"就跑 1000 个随机输入看失效模式），二分 harness（能 `git bisect run`），
差分循环（新旧版本或两种配置喂同一输入再 diff 输出），HITL 脚本（最后手段，
用模板把人也纳入结构化循环）。

有了环就**收紧**它：更快（缓存 setup、跳过无关初始化、收窄范围）、
信号更锐（断言具体症状，不是"没崩"）、更确定（钉住时间、种子 RNG、隔离文件系统、冻住网络）。
30 秒的 flaky 环跟没有差不多，2 秒的确定性环才是调试超能力。
非确定性 bug 的目标不是干净复现，是**更高复现率**：循环触发 100 次、并行、加压、收窄时序窗口。
50% 的 flake 可调试，1% 不可调试。

**Phase 1 完成判据**，四条全中才算完：一条你**已经至少跑过一次**（贴出调用和打码输出）、
命名得出来的**一条命令**，并且 red-capable（驱动真实 bug 路径、断言用户的原话症状，
能因这个 bug 变红，不是"跑没错"）、deterministic、fast（秒级）、agent-runnable。
**在 Phase 2 之前不许靠读代码建立理论。**

后续相位：Phase 2 复现并最小化，一次砍一个元素、砍完重跑，直到每个剩下元素都是承重的；
Phase 3 先出 3 到 5 个**可证伪**的排序假设（"如果 X 是原因，那么改 Y 会让 bug 消失"），
给用户看过再验；Phase 4 一次只动一个变量，日志打唯一前缀（`[DEBUG-a4f2]`），
性能回归走基线测量再二分，不打"什么都记然后 grep"；
Phase 5 先写回归测试再修，但先确认存在**正确的 seam**，
seam 太浅给出的回归测试是假信心，**没有正确 seam 本身就是发现**，要记下来；
Phase 6 清理：原复现不再复现、回归测试过、`[DEBUG-...]` 全清、
一次性原型删掉或挪到明确标记处、正确的假设写进 commit 或 PR 让下一个 debugger 学到。

### code-review

两个轴并行跑子代理，互不污染，报告**不合并、不重排**：
**Standards**（代码符不符合本仓库成文标准，加 Fowler 气味基线）和
**Spec**（有没有忠实实现来源 issue 或 spec）。分开报是因为一个轴会掩盖另一个：
全守标准但做错了东西，是 Standards 过 Spec 挂；照 issue 做了但破了约定，反过来。

气味基线 12 条，永远标注为判断题：Mysterious Name、Duplicated Code、Feature Envy、
Data Clumps、Primitive Obsession、Repeated Switches、Shotgun Surgery、Divergent Change、
Speculative Generality、Message Chains、Middle Man、Refused Bequest。
两条绑定规则：**仓库规范优先**（成文标准背书的东西，压掉对应气味）；
**永远是判断题**（写成 "possible Feature Envy" 这种带标签的启发式，不是硬违规）。
工具已经管的一律跳过。

### codebase-design（词汇层）

术语固定用，不许换成 component / service / API / boundary。
**module** 是有接口和实现的任何东西，尺度不限；
**interface** 是调用方正确使用它必须知道的一切，签名、不变量、顺序约束、错误模式、
必填配置、性能特征；**implementation** 是模块内部的代码体；
**adapter** 是在 seam 上满足接口的具体东西，说的是角色不是内容；
**depth** 是接口处的杠杆，每学一点接口能驱动多少行为；
**seam** 是能不在此处编辑就改掉行为的地方，模块接口所在的位置；
**leverage** 是调用方从深度得到的东西，**locality** 是维护者得到的。

原则：**接口就是测试面**（调用方和测试过同一个 seam，想测到接口外面去，
说明模块形状不对）；**删除测试**（删掉它复杂度是消失了，还是在 N 个调用方处复活，
前者是穿针引线，后者才是在干活）；**一个 adapter 是假想 seam，两个才是真的**
（没有东西真的在变，就别开 seam）。可测性三招：接住依赖、返回结果而非改副作用、缩小接口面。

### to-spec、to-tickets、implement

- `to-spec` **不面试**，只综合已知。动手前先草拟要在哪些 seam 上测，
  **已有 seam 优先于新 seam，用尽可能高的那个，理想数量是一个**，然后和用户核对。
- `to-tickets` 切 **tracer bullet** 垂直切片：窄但**完整**穿过每一层
  （schema、API、UI、tests），做完本身可演示可验证，大小塞进一个全新上下文窗口。
  每票声明阻塞边，先出阻塞者。**宽重构是例外**：机械改动、爆炸半径铺满全库、
  一刀下去几千个调用点同时红、没有垂直切片能独自绿。别硬塞进 tracer bullet，
  排成 **expand-contract**：先 expand（新旧并存，什么都不破），
  再按爆炸半径分批迁移（每批一票，被 expand 阻塞，逐批保持 CI 绿），
  最后 contract（没有调用方了才删旧形，被每一批阻塞）。
- `implement` 在约定好的 seam 上调 `tdd`，规律地跑类型检查、单测文件、整跑一遍测试，
  完了调 `code-review`，然后提交到当前分支。
- `implement-spec` 把票当 task graph，子代理各自在自己 worktree 和分支上做，
  报告前把集成分支尖端合进自己；完成一个就由一个 merger 子代理合回来，
  frontier 变了就再放新的 implementer。与子代理的沟通要**稀疏**，
  主要走 **context pointer**（指向 spec、票、研究笔记、此前的 commit），
  不重复指针已经能给的东西。

### pr

Summary 用**最小的那个视图**把关键处讲清楚（伪代码、调用树、组件树、文件树、
mermaid、diff，按主题选，别堆）；Evidence 给**能用的前后证据**，
截图是 S 级，执行类（测试结果、控制台输出）是 A 级；
Merge Danger 判**单向门还是双向门**（能回退的是双向门，破坏性、难回退的是单向门），
外加一句话的 blast radius。

### retro

改**环境**不改代码。候选按严重度排：导航（找文件花了多久、要不要加 navigation pointer）；
自动检查（agent 犯的错有没有检查能接住，**先读仓库自己的 check 命令**，
已经存在但没接上或静默坏掉的检查才是发现，不是重新造一个，
没有 guardrail 本身就是发现）；编码标准（先分类违规，**机械类**包括固定语法模式、
禁用 API、import 形状、文件位置，一律上确定性检查，默认做检查而不是写规则，
`CODING_STANDARDS.md` 只留给真正的判断题）；全局 `AGENTS.md`
（steering 指令是不是该挪去编码标准或自动检查）；工具经济；no-op 指令；信息可达性。

分工依据：实现 agent 上下文压力最大，要探索、写码、调试；
评审 agent 压力最小，只收到一个 diff。**所以编码标准该由评审 agent 执行，不是实现 agent。**

## 六、贯穿全链的不变量

- `GLOSSARY.md` 保持**纯净**：只有术语，不含实现细节。不当 spec 用、不当草稿本用、
  不当实现决策库用。多上下文仓库用 `GLOSSARY-MAP.md` 指向各处。
- **ADR 三条件全中才写**：难回退、没有上下文未来读者会问"为什么这么干"、
  是一次真权衡的结果。少一条就跳过。ADR 可以只有一个段落，
  价值在于记下"做了这个决定以及为什么"，不在于把章节填满。
- **一个含义一个真源。** 文档重复环境（`package.json` scripts、配置、目录布局、`--help` 输出）
  就是缓存，只在查找很贵时才配花这个负载：缓存 agent 查不到的东西，
  不成文的约定、选择背后的理由、配置不肯招的坑。
- **逐句过相关性检查**：它还管不管这份文档干的事。不修剪的默认结局是 **sediment**：
  因为"加着安全、删着危险"而沉积的过期层，直到你得钻透它找还活着的东西。
- **每条都当 no-op 审一遍**：相对模型默认行为改变了什么？没改变就整句删掉，不要抠字眼。
- **先打码再展示**。所有命令、输出、捕获产物里的 secret 写成 `<REDACTED>`。
  环要建在环境变量上，别建在你展示的东西里。

## 怎么用起来

三条路，按要不要自动更新选一条：

1. **Codex 插件市场**（自动更新，推荐）：

   ```bash
   codex plugin marketplace add mattpocock/skills
   codex plugin add mattpocock-skills@mattpocock
   ```

2. **skills.sh**（复制可编辑文件进项目，自己改自己更新）：

   ```bash
   npx skills@latest add mattpocock/skills -a codex
   ```

3. **只取规范不取技能**：就用本目录这两份文档，把该动的手动纪律搬进 `AGENTS.md`
   和 `CODING_STANDARDS.md`。注意 `AGENTS.md` 每轮都进上下文，
   按上游规范只放**导航指针**，别把流程抄进去；流程放 skill 或参考文档，用指针指过去。

装完先跑一次 `/setup-matt-pocock-skills`，把 issue tracker、triage 标签、文档布局定下来，
其余工程技能都假设这三样已经配好。其中 `to-tickets`、`to-spec`、`triage` 是**硬依赖**：
没有映射，产出是错的，不只是糙；`tdd`、`diagnosing-bugs`、
`improve-codebase-architecture` 是**软依赖**，只是输出不够锐。

=== DIFF ===
diff --git a/BioanalysDesktop/server/figure_adapters.js b/BioanalysDesktop/server/figure_adapters.js
new file mode 100644
index 0000000..8dd4e1a
--- /dev/null
+++ b/BioanalysDesktop/server/figure_adapters.js
@@ -0,0 +1,409 @@
+import path from 'node:path';
+
+const LINES = ['line1_bulk', 'line2_scrna', 'line3_spatial'];
+const REMOTE_PROJECTS_ROOT = '/mnt/ssd/bio_data/projects';
+
+const SUPPORTED_TEMPLATE_IDS = new Set([
+  'fig_l2_pca',
+  'fig_l2_heatmap',
+  'fig_l2_volcano',
+  'fig_l2p_dotplot',
+  'fig_l2p_volcano',
+  'fig_l2p_umap',
+]);
+
+function normalizeRelativePath(value, fieldName) {
+  const normalized = String(value || '').trim().split('\\').join('/').replace(/^\.\/+/, '');
+  if (!normalized) throw new Error(`${fieldName} 缺失`);
+  if (!/^[A-Za-z0-9._/-]+$/.test(normalized)) {
+    throw new Error(`${fieldName} 含非法字符`);
+  }
+  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
+    throw new Error(`${fieldName} 必须是项目相对路径`);
+  }
+  if (normalized.split('/').includes('..')) {
+    throw new Error(`${fieldName} 禁止跨项目路径`);
+  }
+  return normalized;
+}
+
+function validateCanonicalOutput(value) {
+  const normalized = String(value || '').trim().split('\\').join('/');
+  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
+    || normalized.split('/').includes('..') || !/^[A-Za-z0-9._/-]+$/.test(normalized)) {
+    throw new Error(`canonical_output 非法: ${value}`);
+  }
+  return normalized;
+}
+
+function validateBoundaries({ projectId, lineId, inputPath, template }) {
+  if (!/^[A-Za-z0-9._-]+$/.test(String(projectId || ''))) {
+    throw new Error(`projectId 非法: ${projectId}`);
+  }
+  if (!LINES.includes(lineId)) throw new Error(`lineId 非法: ${lineId}`);
+  if (!Array.isArray(template?.lines) || !template.lines.includes(lineId)) {
+    throw new Error(`lineId 与模板跨线: ${lineId} 不在 ${template?.id || 'unknown'}.lines`);
+  }
+
+  const segments = inputPath.split('/').filter(Boolean);
+  const localProjectsIndex = segments.indexOf('local_projects');
+  if (localProjectsIndex >= 0 && segments[localProjectsIndex + 1] !== projectId) {
+    throw new Error(`inputPath 跨项目: 期望 ${projectId}，收到 ${segments[localProjectsIndex + 1] || 'unknown'}`);
+  }
+  const foreignLine = LINES.find((candidate) => candidate !== lineId && inputPath.includes(candidate));
+  if (foreignLine) throw new Error(`inputPath 跨线: ${lineId} 出现 ${foreignLine}`);
+  if (!segments.includes(lineId)) {
+    throw new Error(`inputPath 必须位于 ${lineId} 数据目录`);
+  }
+}
+
+function resolveRemoteInput(inputPath, projectId, lineId) {
+  const prefixes = [
+    `data/${lineId}/`,
+    'processed/',
+    'results/',
+  ];
+  const prefix = prefixes.find((item) => inputPath.startsWith(item));
+  if (!prefix) {
+    throw new Error(`inputPath 必须位于 data/${lineId}/、processed/ 或 results/`);
+  }
+  const suffix = prefix === `data/${lineId}/`
+    ? inputPath.slice(prefix.length)
+    : `${prefix}${inputPath.slice(prefix.length)}`;
+  return path.posix.join(REMOTE_PROJECTS_ROOT, projectId, lineId, suffix);
+}
+
+function literalValue(value, language) {
+  if (value === null || value === undefined) return language === 'python' ? 'None' : 'NULL';
+  if (Array.isArray(value)) {
+    const items = value.map((item) => literalValue(item, language));
+    return language === 'python' ? `[${items.join(', ')}]` : `c(${items.join(', ')})`;
+  }
+  if (typeof value === 'boolean') return language === 'python' ? (value ? 'True' : 'False') : String(value).toUpperCase();
+  if (typeof value === 'number') return String(value);
+  const escaped = String(value).replace(/\\/g, '\\\\').replace(/'/g, String.raw`\'`);
+  return language === 'python'
+    ? `"${escaped.replace(/"/g, '\\"')}"`
+    : `'${escaped}'`;
+}
+
+function renderAdaptDeclaration(template, adaptVars) {
+  const language = template.language;
+  const keys = Object.keys(template.adapt_vars || {});
+  const lines = keys.map((key) => {
+    const value = adaptVars?.[key] ?? null;
+    return language === 'python'
+      ? `  "${key}": ${literalValue(value, language)},`
+      : `  ${key} = ${literalValue(value, language)},`;
+  });
+  const declarations = lines.join('\n').replace(/,$/, '');
+  if (language === 'python') {
+    return `ADAPT_VARS = {\n${declarations}\n}\n`;
+  }
+  return `adapt_vars <- list(\n${declarations}\n)\n`;
+}
+
+function rPrelude(template, inputPath, remoteInput) {
+  return `# Real-Data-Adapter: v1
+# Project-Input: ${inputPath}
+seed_value <- Sys.getenv("BIOANALYS_SEED", unset = "")
+if (nchar(seed_value) == 0) quit(status = 3)
+set.seed(as.integer(seed_value))
+input_data <- "${remoteInput}"
+output_file <- "${template.canonical_output}"
+if (!file.exists(input_data)) stop(paste("real input missing:", input_data))
+dir.create(dirname(output_file), recursive = TRUE, showWarnings = FALSE)
+`;
+}
+
+function pythonPrelude(template, inputPath, remoteInput) {
+  return `# Real-Data-Adapter: v1
+# Project-Input: ${inputPath}
+import os
+from pathlib import Path
+import numpy as np
+import pandas as pd
+import matplotlib
+matplotlib.use("Agg")
+import matplotlib.pyplot as plt
+
+seed_value = os.environ.get("BIOANALYS_SEED", "")
+if not seed_value:
+    raise SystemExit(3)
+seed = int(seed_value)
+np.random.seed(seed)
+input_data = "${remoteInput}"
+output_file = "${template.canonical_output}"
+if not Path(input_data).exists():
+    raise FileNotFoundError(f"real input missing: {input_data}")
+Path(output_file).parent.mkdir(parents=True, exist_ok=True)
+`;
+}
+
+const R_OVERLAYS = {
+  fig_l2_pca: `# Real-data PCA overlay
+suppressPackageStartupMessages({library(ggplot2)})
+pca_df <- read.delim(input_data, check.names = FALSE)
+group_name <- if (is.null(adapt_vars$group_col) || !nzchar(adapt_vars$group_col)) "group" else adapt_vars$group_col
+if (!all(c("PC1", "PC2", group_name) %in% names(pca_df))) {
+  stop(paste("PCA input columns missing:", group_name, "PC1", "PC2"))
+}
+pca_df[[group_name]] <- factor(pca_df[[group_name]])
+group_sizes <- table(pca_df[[group_name]])
+pca_plot <- ggplot(pca_df, aes(x = PC1, y = PC2, colour = .data[[group_name]])) +
+  geom_point(size = 1.8, alpha = 0.9) +
+  labs(colour = group_name, x = "PC1", y = "PC2") +
+  theme_classic(base_size = 8)
+if (length(group_sizes) > 1 && all(group_sizes >= 3)) {
+  pca_plot <- pca_plot + stat_ellipse(linewidth = 0.45, level = 0.95)
+}
+ggsave(output_file, pca_plot, width = 89, height = 80, units = "mm", dpi = 300,
+       device = png, type = "cairo", bg = "white")
+cat("ADAPT_REAL_INPUT_OK pca rows=", nrow(pca_df), "\n", sep = "")
+`,
+  fig_l2_heatmap: `# Real-data expression heatmap overlay
+suppressPackageStartupMessages({library(ComplexHeatmap); library(viridis); library(circlize)})
+expr_df <- read.delim(input_data, check.names = FALSE)
+if (ncol(expr_df) < 3 || nrow(expr_df) < 2) stop("heatmap input has insufficient dimensions")
+expr_matrix <- as.matrix(expr_df[, -1, drop = FALSE])
+rownames(expr_matrix) <- make.unique(as.character(expr_df[[1]]))
+storage.mode(expr_matrix) <- "numeric"
+if (anyNA(expr_matrix)) stop("heatmap input contains non-numeric or missing values")
+var_top <- order(apply(expr_matrix, 1, var), decreasing = TRUE)
+expr_matrix <- expr_matrix[head(var_top, min(50, length(var_top))), , drop = FALSE]
+expr_z <- t(scale(t(expr_matrix)))
+expr_z[!is.finite(expr_z)] <- 0
+heat <- Heatmap(
+  expr_z,
+  name = "Z-score",
+  col = viridis(100),
+  cluster_rows = TRUE,
+  cluster_columns = ncol(expr_z) >= 3,
+  show_row_names = nrow(expr_z) <= 40,
+  row_title = NULL,
+  column_title = NULL,
+  heatmap_legend_param = list(title = "Z-score")
+)
+png(output_file, width = 183, height = 120, units = "mm", res = 300, type = "cairo")
+draw(heat)
+dev.off()
+cat("ADAPT_REAL_INPUT_OK heatmap genes=", nrow(expr_z), " samples=", ncol(expr_z), "\n", sep = "")
+`,
+  fig_l2_volcano: `# Real-data differential-expression volcano overlay
+suppressPackageStartupMessages({library(ggplot2); library(ggrepel)})
+deg_df <- read.delim(input_data, check.names = FALSE)
+pick_column <- function(candidates) {
+  hit <- candidates[candidates %in% names(deg_df)]
+  if (!length(hit)) stop(paste("volcano input columns missing:", paste(candidates, collapse = " / ")))
+  hit[[1]]
+}
+gene_col <- pick_column(c("gene", "gene_symbol", "symbol"))
+fc_col <- pick_column(c("log2FC", "log2fc", "logFC"))
+p_col <- pick_column(c("P_Value", "pvalue", "p_value", "P.Value"))
+padj_col <- pick_column(c("adj_P_Val", "padj", "pvals_adj", "adj.P.Val"))
+volcano_df <- data.frame(
+  gene = as.character(deg_df[[gene_col]]),
+  log2fc = as.numeric(deg_df[[fc_col]]),
+  pvalue = as.numeric(deg_df[[p_col]]),
+  padj = as.numeric(deg_df[[padj_col]])
+)
+volcano_df <- volcano_df[is.finite(volcano_df$log2fc) & is.finite(volcano_df$pvalue) & volcano_df$pvalue > 0, ]
+volcano_df$sig <- ifelse(volcano_df$padj < 0.05 & volcano_df$log2fc > 1, "Up",
+                  ifelse(volcano_df$padj < 0.05 & volcano_df$log2fc < -1, "Down", "NS"))
+labels <- unique(c(as.character(adapt_vars$label_genes), head(volcano_df$gene[order(volcano_df$padj)], 8)))
+label_df <- volcano_df[volcano_df$gene %in% labels, ]
+volcano <- ggplot(volcano_df, aes(x = log2fc, y = -log10(pvalue), colour = sig)) +
+  geom_point(size = 0.8, alpha = 0.72) +
+  scale_colour_manual(values = c(Up = "#D55E00", Down = "#0072B2", NS = "grey72")) +
+  geom_vline(xintercept = c(-1, 1), linetype = "dashed", linewidth = 0.35, colour = "grey35") +
+  geom_hline(yintercept = -log10(0.05), linetype = "dashed", linewidth = 0.35, colour = "grey35") +
+  geom_text_repel(data = label_df, aes(label = gene), size = 2.2, max.overlaps = 30) +
+  labs(x = "log2(Fold Change)", y = "-log10(P)", colour = NULL) +
+  theme_classic(base_size = 7) +
+  theme(legend.position = "top")
+ggsave(output_file, volcano, width = 89, height = 75, units = "mm", dpi = 300,
+       device = png, type = "cairo", bg = "white")
+cat("ADAPT_REAL_INPUT_OK volcano rows=", nrow(volcano_df), "\n", sep = "")
+`,
+};
+
+const PYTHON_OVERLAYS = {
+  fig_l2p_dotplot: `# Real-data target localization dot plot overlay
+loc = pd.read_csv(input_data, sep = "\\t")
+required = {"gene", "celltype", "mean_expr_lognorm", "pct_expressing"}
+missing = sorted(required.difference(loc.columns))
+if missing:
+    raise ValueError(f"dotplot input columns missing: {missing}")
+group_col = str(ADAPT_VARS.get("group_col") or "celltype")
+if group_col not in loc.columns or group_col == "celltype":
+    group_col = "celltype"
+genes = (
+    loc.groupby("gene", observed=True)["specificity_vs_global"]
+    .max()
+    .sort_values(ascending=False)
+    .head(20)
+    .index
+)
+plot_df = loc[loc["gene"].isin(genes)].copy()
+gene_order = list(genes)
+plot_df["gene"] = pd.Categorical(plot_df["gene"], categories=gene_order, ordered=True)
+celltypes = list(plot_df["celltype"].drop_duplicates())
+plot_df["celltype"] = pd.Categorical(plot_df["celltype"], categories=celltypes, ordered=True)
+fig, ax = plt.subplots(figsize=(max(5.0, len(celltypes) * 0.45), max(4.0, len(genes) * 0.24)))
+scatter = ax.scatter(
+    plot_df[group_col].astype(str),
+    plot_df["gene"].astype(str),
+    s=np.clip(plot_df["pct_expressing"].to_numpy() * 42, 5, 42),
+    c=plot_df["mean_expr_lognorm"].to_numpy(),
+    cmap="viridis",
+    linewidths=0,
+    alpha=0.9,
+)
+ax.set_xlabel(group_col)
+ax.set_ylabel("gene")
+ax.tick_params(axis="x", rotation=45, labelsize=6)
+ax.tick_params(axis="y", labelsize=6)
+for spine in ("top", "right"):
+    ax.spines[spine].set_visible(False)
+fig.colorbar(scatter, ax=ax, label="mean expression")
+fig.tight_layout()
+fig.savefig(output_file, dpi=300, bbox_inches="tight")
+plt.close(fig)
+print(f"ADAPT_REAL_INPUT_OK dotplot rows={len(plot_df)}")
+`,
+  fig_l2p_volcano: `# Real-data cell-type differential-expression volcano overlay
+deg = pd.read_csv(input_data, sep = "\\t")
+required = {"celltype", "gene_symbol", "log2fc", "pvals_adj"}
+missing = sorted(required.difference(deg.columns))
+if missing:
+    raise ValueError(f"volcano input columns missing: {missing}")
+deg = deg.replace([np.inf, -np.inf], np.nan).dropna(subset=["gene_symbol", "log2fc", "pvals_adj"])
+deg["neglog10"] = -np.log10(np.clip(deg["pvals_adj"].astype(float), 1e-300, 1.0))
+deg["sig"] = np.where(
+    (deg["pvals_adj"].astype(float) < 0.05) & (deg["log2fc"].astype(float) > 1), "Up",
+    np.where((deg["pvals_adj"].astype(float) < 0.05) & (deg["log2fc"].astype(float) < -1), "Down", "NS"),
+)
+group_col = str(ADAPT_VARS.get("group_col") or "celltype")
+if group_col not in deg.columns:
+    group_col = "celltype"
+top_groups = (
+    deg.groupby(group_col, observed=True)["pvals_adj"].min()
+    .sort_values().head(8).index
+)
+plot_df = deg[deg[group_col].isin(top_groups)].copy()
+if len(plot_df) > 5000:
+    plot_df = plot_df.nsmallest(5000, "pvals_adj")
+fig, ax = plt.subplots(figsize=(89 / 25.4, 75 / 25.4))
+palette = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#F0E442", "#999999"]
+for index, group in enumerate(top_groups):
+    part = plot_df[plot_df[group_col] == group]
+    ax.scatter(part["log2fc"], part["neglog10"], s=2.4, alpha=0.72,
+               color=palette[index % len(palette)], label=str(group), linewidths=0)
+ax.axvline(-1, ls="--", lw=0.45, color="#555555")
+ax.axvline(1, ls="--", lw=0.45, color="#555555")
+ax.axhline(-np.log10(0.05), ls="--", lw=0.45, color="#555555")
+label_genes = set(ADAPT_VARS.get("label_genes") or [])
+top_labels = plot_df.nsmallest(8, "pvals_adj")["gene_symbol"].astype(str).tolist()
+for gene in list(label_genes.union(top_labels))[:12]:
+    row = plot_df[plot_df["gene_symbol"].astype(str) == gene].nsmallest(1, "pvals_adj")
+    if not row.empty:
+        ax.annotate(gene, (float(row.iloc[0]["log2fc"]), float(row.iloc[0]["neglog10"])),
+                    fontsize=4.2, xytext=(2, 2), textcoords="offset points")
+ax.set_xlabel("log2 fold change")
+ax.set_ylabel("-log10(adjusted P)")
+ax.legend(frameon=False, fontsize=4.5, loc="upper right", ncol=2)
+for spine in ("top", "right"):
+    ax.spines[spine].set_visible(False)
+fig.tight_layout()
+fig.savefig(output_file, dpi=300, bbox_inches="tight")
+plt.close(fig)
+print(f"ADAPT_REAL_INPUT_OK volcano rows={len(plot_df)}")
+`,
+  fig_l2p_umap: `# Real-data spatial UMAP overlay
+import scanpy as sc
+adata = sc.read_h5ad(input_data)
+if "X_umap" not in adata.obsm:
+    raise ValueError("spatial h5ad missing obsm['X_umap']")
+umap = np.asarray(adata.obsm["X_umap"])[:, :2]
+group_col = str(ADAPT_VARS.get("group_col") or "group")
+if group_col not in adata.obs.columns:
+    group_col = next((key for key in ("group", "condition", "celltype", "leiden") if key in adata.obs.columns), None)
+if group_col is None:
+    groups = pd.Series(["all"] * adata.n_obs)
+    group_col = "all"
+else:
+    groups = adata.obs[group_col].astype(str).reset_index(drop=True)
+fig, ax = plt.subplots(figsize=(183 / 25.4, 90 / 25.4))
+labels = list(pd.unique(groups))
+palette = plt.get_cmap("tab20")(np.linspace(0, 1, max(len(labels), 2)))
+for index, label in enumerate(labels):
+    mask = (groups == label).to_numpy()
+    ax.scatter(umap[mask, 0], umap[mask, 1], s=4, alpha=0.8,
+               color=palette[index % len(palette)], label=str(label), linewidths=0)
+ax.set_xlabel("UMAP 1")
+ax.set_ylabel("UMAP 2")
+if len(labels) <= 12:
+    ax.legend(frameon=False, fontsize=5, markerscale=2, loc="best")
+for spine in ("top", "right"):
+    ax.spines[spine].set_visible(False)
+fig.tight_layout()
+fig.savefig(output_file, dpi=300, bbox_inches="tight")
+plt.close(fig)
+print(f"ADAPT_REAL_INPUT_OK umap cells={adata.n_obs} groups={len(labels)}")
+`,
+};
+
+export function buildAdaptedFigureSource({
+  template,
+  masterSource,
+  inputPath,
+  projectId,
+  lineId,
+  adaptVars = {},
+}) {
+  if (!template || !SUPPORTED_TEMPLATE_IDS.has(template.id)) {
+    throw new Error(`未知 ready 图模板: ${template?.id || 'missing'}`);
+  }
+  if (typeof masterSource !== 'string' || !masterSource) {
+    throw new Error('masterSource 缺失');
+  }
+  if (!['r', 'python'].includes(template.language)) {
+    throw new Error(`模板语言非法: ${template.language}`);
+  }
+  const canonicalOutput = validateCanonicalOutput(template.canonical_output);
+  const normalizedInput = normalizeRelativePath(inputPath, 'inputPath');
+  validateBoundaries({ projectId, lineId, inputPath: normalizedInput, template });
+  const declaredInput = normalizeRelativePath(adaptVars.input_data, 'adaptVars.input_data');
+  validateBoundaries({ projectId, lineId, inputPath: declaredInput, template });
+  if (declaredInput !== normalizedInput) {
+    throw new Error('inputPath 与 adaptVars.input_data 不一致');
+  }
+
+  const remoteInput = resolveRemoteInput(normalizedInput, projectId, lineId);
+  const commentLines = [
+    `# Master-Source: ${String(template.source || '').replace(/\\/g, '/')} | Master-SHA256: ${template.source_sha256 || ''}`,
+    `# Adapted-Project: ${projectId}`,
+    `# Adapted-Line: ${lineId}`,
+    ...Object.entries(template.adapt_vars || {}).map(
+      ([key, description]) => `# Adapt-Variable ${key}: ${description}`,
+    ),
+  ];
+  const prelude = template.language === 'r'
+    ? rPrelude({ ...template, canonical_output: canonicalOutput }, normalizedInput, remoteInput)
+    : pythonPrelude({ ...template, canonical_output: canonicalOutput }, normalizedInput, remoteInput);
+  const overlay = template.language === 'r'
+    ? R_OVERLAYS[template.id]
+    : PYTHON_OVERLAYS[template.id];
+  const realRunExit = template.language === 'r'
+    ? 'quit(status = 0)'
+    : 'raise SystemExit(0)';
+  return [
+    ...commentLines,
+    renderAdaptDeclaration(template, adaptVars),
+    prelude,
+    overlay,
+    realRunExit,
+    '# Retained master source for byte-level audit; unreachable after successful real-data render.',
+    masterSource.replace(/\r\n/g, '\n'),
+  ].join('\n').replace(/\r\n/g, '\n');
+}
diff --git a/BioanalysDesktop/server/figure_graph.js b/BioanalysDesktop/server/figure_graph.js
new file mode 100644
index 0000000..cdfda89
--- /dev/null
+++ b/BioanalysDesktop/server/figure_graph.js
@@ -0,0 +1,386 @@
+import fs from 'node:fs';
+import crypto from 'node:crypto';
+import path from 'node:path';
+import { fileURLToPath } from 'node:url';
+
+import { indexMods } from './workflow_graph.js';
+
+const HERE = path.dirname(fileURLToPath(import.meta.url));
+const REPO = path.resolve(HERE, '..', '..');
+const REGISTRY = path.join(REPO, 'src', 'figure_templates.json');
+const FIGURE_ROOT = 'reference/05.可参考出图代码';
+const PROJECTS_ROOT = '/mnt/ssd/bio_data/projects';
+const LINES = ['line1_bulk', 'line2_scrna', 'line3_spatial'];
+
+let cache = null;
+
+function indexModsByBareId() {
+  const indexed = new Map();
+  for (const [, entry] of indexMods()) indexed.set(entry.mod.id, entry);
+  return indexed;
+}
+
+export function loadFigureTemplates() {
+  if (cache) return cache;
+  cache = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
+  return cache;
+}
+
+export function reloadFigureTemplates() {
+  cache = null;
+  return loadFigureTemplates();
+}
+
+function isPathInsideFigureRoot(relative) {
+  const normalized = relative.split('\\').join('/');
+  return normalized === FIGURE_ROOT || normalized.startsWith(`${FIGURE_ROOT}/`);
+}
+
+function validateReadyPath(item, pathKey, hashKey, errors) {
+  const relative = item[pathKey];
+  if (typeof relative !== 'string' || relative.length === 0 || !isPathInsideFigureRoot(relative)) {
+    errors.push(`${item.id}: ${pathKey} 必须位于 ${FIGURE_ROOT}`);
+    return;
+  }
+  const target = path.join(REPO, relative);
+  if (!fs.existsSync(target)) {
+    errors.push(`${item.id}: ${pathKey} 磁盘缺失`);
+  } else {
+    const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
+    if (item[hashKey] !== actual) {
+      errors.push(`${item.id}: ${hashKey} 与磁盘文件不一致`);
+    }
+  }
+}
+
+function validateAdaptDeclaration(item, errors) {
+  if (!item.adapt_vars || Array.isArray(item.adapt_vars) || typeof item.adapt_vars !== 'object') {
+    errors.push(`${item.id}: adapt_vars 必须是字段声明对象`);
+    return;
+  }
+  const keys = Object.keys(item.adapt_vars);
+  if (keys.length === 0) {
+    errors.push(`${item.id}: adapt_vars 至少声明一个可变字段`);
+    return;
+  }
+  for (const key of keys) {
+    const value = item.adapt_vars[key];
+    if (typeof value !== 'string' || value.trim().length === 0) {
+      errors.push(`${item.id}: adapt_vars.${key} 缺少说明`);
+    }
+  }
+}
+
+export function validateFigureStepInputs(item, modEntry) {
+  if (!modEntry) return [`${item.id}: analysis_step 引用的 mod 不存在`];
+  const declaredOutputs = new Set(modEntry.mod.produces || []);
+  const errors = [];
+  for (const inputTable of item.input_tables || []) {
+    if (!declaredOutputs.has(inputTable)) {
+      errors.push(`${item.id}: input_tables.${inputTable} 不是 ${item.analysis_step} 的 produces`);
+    }
+  }
+  return errors;
+}
+
+function validateReadyMapping(item, mods, errors) {
+  if (!Array.isArray(item.lines) || item.lines.length === 0) {
+    errors.push(`${item.id}: ready 模板 lines 必须为非空数组`);
+  } else if (item.lines.some((line) => !LINES.includes(line))) {
+    errors.push(`${item.id}: ready 模板 lines 含非法分析线`);
+  }
+  if (typeof item.analysis_step !== 'string' || !item.analysis_step) {
+    errors.push(`${item.id}: ready 模板 analysis_step 缺失`);
+  } else if (!mods.has(item.analysis_step)) {
+    errors.push(`${item.id}: analysis_step 引用不存在的 mod '${item.analysis_step}'`);
+  } else {
+    errors.push(...validateFigureStepInputs(item, mods.get(item.analysis_step)));
+  }
+  for (const key of ['input_tables', 'produces']) {
+    if (!Array.isArray(item[key]) || item[key].length === 0) {
+      errors.push(`${item.id}: ready 模板 ${key} 必须为非空数组`);
+    }
+  }
+  if (typeof item.output_glob !== 'string' || !item.output_glob) {
+    errors.push(`${item.id}: ready 模板 output_glob 缺失`);
+  }
+  if (typeof item.canonical_output !== 'string' || !item.canonical_output) {
+    errors.push(`${item.id}: ready 模板 canonical_output 缺失`);
+  }
+  if (typeof item.sample_project_output !== 'string' || !item.sample_project_output.startsWith('local_projects/')) {
+    errors.push(`${item.id}: ready 模板 sample_project_output 必须指向 local_projects`);
+  } else if (!fs.existsSync(path.join(REPO, item.sample_project_output))) {
+    errors.push(`${item.id}: sample_project_output 磁盘缺失`);
+  }
+}
+
+export function validateRegistry() {
+  const registry = loadFigureTemplates();
+  const errors = [];
+  const mods = indexModsByBareId();
+  const seen = new Set();
+  const counts = { ready: 0, pending: 0, pending_mapping: 0, blocked: 0 };
+
+  if (registry.schema_version !== 1) errors.push('schema_version 必须为 1');
+  if (!Array.isArray(registry.templates)) errors.push('templates 必须是数组');
+
+  for (const item of Array.isArray(registry.templates) ? registry.templates : []) {
+    if (typeof item.id !== 'string' || item.id.length === 0) {
+      errors.push('模板 id 缺失');
+      continue;
+    }
+    if (seen.has(item.id)) errors.push(`${item.id}: id 重复`);
+    seen.add(item.id);
+
+    const required = [
+      'name', 'level', 'category', 'language', 'source', 'source_sha256', 'preview',
+      'preview_sha256', 'verified', 'deps_status', 'linked_mods', 'adapt_vars', 'deprecated',
+      'lines', 'analysis_step', 'input_tables', 'produces', 'output_glob',
+      'canonical_output', 'sample_project_output',
+    ];
+    for (const key of required) {
+      if (!(key in item)) errors.push(`${item.id}: 缺 ${key}`);
+    }
+
+    if (item.deps_status === 'ready' && item.verified) counts.ready += 1;
+    else if (item.deps_status === 'pending_mapping') counts.pending_mapping += 1;
+    else if (item.deps_status === 'blocked_r453') counts.blocked += 1;
+    else counts.pending += 1;
+
+    if (!['L1', 'L2', 'L3'].includes(item.level)) errors.push(`${item.id}: level 非法`);
+    if (!['r', 'python'].includes(item.language)) errors.push(`${item.id}: language 非法`);
+    if (!['ready', 'pending', 'pending_mapping', 'blocked_r453'].includes(item.deps_status)) {
+      errors.push(`${item.id}: deps_status 非法`);
+    }
+    if (typeof item.deprecated !== 'boolean') errors.push(`${item.id}: deprecated 必须是布尔值`);
+
+    validateAdaptDeclaration(item, errors);
+
+    if (item.deps_status === 'ready' && item.verified) {
+      validateReadyPath(item, 'source', 'source_sha256', errors);
+      validateReadyPath(item, 'preview', 'preview_sha256', errors);
+      validateReadyMapping(item, mods, errors);
+    } else if (item.deps_status === 'ready' && !item.verified) {
+      errors.push(`${item.id}: deps_status=ready 必须先通过验证`);
+    } else if (item.deps_status !== 'ready' && !item.verified) {
+      const nullable = ['source', 'source_sha256', 'preview', 'preview_sha256'];
+      for (const key of nullable) {
+        if (item[key] !== null) errors.push(`${item.id}: 未验证模板的 ${key} 必须为 null`);
+      }
+    } else if (item.deps_status !== 'ready' && item.verified) {
+      errors.push(`${item.id}: 未 ready 模板不得标 verified=true`);
+    }
+
+    if (!Array.isArray(item.linked_mods) || item.linked_mods.length === 0) {
+      errors.push(`${item.id}: linked_mods 必须至少关联一个 mod`);
+    }
+    for (const modId of item.linked_mods || []) {
+      const entry = mods.get(modId);
+      if (!entry) {
+        errors.push(`${item.id}: linked_mods 引用不存在的 mod '${modId}'`);
+        continue;
+      }
+      if (entry.mod.language.toLowerCase() !== item.language) {
+        errors.push(`${item.id}: linked_mods 语言不匹配，模板 ${item.language} 与 ${modId} ${entry.mod.language}`);
+      }
+    }
+  }
+
+  return {
+    ok: errors.length === 0,
+    errors,
+    stats: {
+      templates: seen.size,
+      ready: counts.ready,
+      pending: counts.pending,
+      pending_mapping: counts.pending_mapping,
+      blocked: counts.blocked,
+    },
+  };
+}
+
+function normalizePathLike(value) {
+  return String(value).split('\\').join('/').toLowerCase();
+}
+
+function isPathLike(value) {
+  return typeof value === 'string' && /[/\\]|\.[a-z0-9]+$/i.test(value);
+}
+
+function validateAdaptValue(value, lineId, projectId, context, errors) {
+  if (Array.isArray(value)) {
+    for (const child of value) validateAdaptValue(child, lineId, projectId, context, errors);
+    return;
+  }
+  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
+  if (typeof value !== 'string') {
+    errors.push(`${context}: adapt_vars 值必须是标量或字符串数组`);
+    return;
+  }
+  if (!isPathLike(value)) return;
+  const normalized = normalizePathLike(value);
+  if (/^[a-z]:[\\\/]/.test(normalized) || normalized.startsWith('/')) {
+    errors.push(`${context}: adapt_vars 路径必须使用本项目相对路径`);
+  }
+  if (normalized.includes('../') || normalized.endsWith('/..')) {
+    errors.push(`${context}: adapt_vars 路径禁止跨项目`);
+  }
+  for (const foreign of LINES.filter((line) => line !== lineId)) {
+    if (normalized.includes(foreign.toLowerCase())) {
+      errors.push(`${context}: adapt_vars 路径禁止跨线取值，发现 ${foreign}`);
+    }
+  }
+  if (normalized.includes('local_projects/')) {
+    const after = normalized.slice(normalized.indexOf('local_projects/') + 'local_projects/'.length);
+    const segment = after.split('/')[0];
+    if (segment !== projectId.toLowerCase()) {
+      errors.push(`${context}: adapt_vars 路径禁止跨项目，发现 ${segment || 'unknown'}`);
+    }
+  }
+  const segments = normalized.replace(/^\.\/+/, '').split('/').filter(Boolean);
+  const allowedRoots = new Set(['data', 'figures', 'processed', 'results', 'local_projects']);
+  if (segments.length > 1 && !allowedRoots.has(segments[0])) {
+    errors.push(`${context}: adapt_vars 路径必须位于本项目 data、figures、processed、results 或 local_projects 下`);
+  }
+}
+
+export function resolveFigure(templateId, lineId, projectId, adaptVars = {}, selectedModIds = []) {
+  const validation = validateRegistry();
+  const errors = [...validation.errors];
+  if (!validation.ok) return { ok: false, errors, template: null, selected_mods: [], master_path: null };
+
+  const template = loadFigureTemplates().templates.find((item) => item.id === templateId);
+  if (!template) {
+    errors.push(`未知图模板 '${templateId}'`);
+    return { ok: false, errors, template: null, selected_mods: [], master_path: null };
+  }
+  if (!LINES.includes(lineId)) {
+    errors.push(`未知分析线 ${lineId}`);
+  }
+  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
+    errors.push('projectId 缺失');
+  }
+  if (template.deps_status !== 'ready') {
+    errors.push(`${templateId}: deps_status=${template.deps_status}，当前不可派发`);
+  }
+
+  const mods = indexModsByBareId();
+  const lineLinked = (template.linked_mods || []).filter((modId) => {
+    const entry = mods.get(modId);
+    return entry && entry.series.id === lineId;
+  });
+  if (!LINES.includes(lineId) || lineLinked.length === 0) {
+    errors.push(`图模板 ${templateId} 与 ${lineId} 跨线，无本线 linked_mods`);
+  }
+
+  const requested = selectedModIds.length > 0 ? selectedModIds : lineLinked;
+  const selectedMods = [];
+  for (const modId of requested) {
+    const entry = mods.get(modId);
+    if (!entry) {
+      errors.push(`linked_mods 引用不存在的 mod '${modId}'`);
+      continue;
+    }
+    if (entry.series.id !== lineId) {
+      errors.push(`跨线选中：${modId} 属于 ${entry.series.id}，不是 ${lineId}`);
+      continue;
+    }
+    if (!(template.linked_mods || []).includes(modId)) {
+      errors.push(`${modId} 未关联该图模板（linked_mods）`);
+      continue;
+    }
+    if (entry.mod.language.toLowerCase() !== template.language) {
+      errors.push(`语言不匹配：模板 ${template.language} 与 mod ${modId} ${entry.mod.language}`);
+      continue;
+    }
+    selectedMods.push(modId);
+  }
+
+  const declared = Object.keys(template.adapt_vars || {});
+  for (const key of declared) {
+    if (!(key in adaptVars)) errors.push(`adapt_vars 缺必填字段 ${key}`);
+  }
+  for (const [key, value] of Object.entries(adaptVars)) {
+    validateAdaptValue(value, lineId, projectId, `${templateId}.${key}`, errors);
+  }
+
+  return {
+    ok: errors.length === 0,
+    errors,
+    template,
+    selected_mods: selectedMods,
+    master_path: template.source ? path.join(REPO, template.source) : null,
+  };
+}
+
+export function buildAdaptedFigureTasks({
+  projectId,
+  lineId,
+  selectedFigures = [],
+  templatesRegistry = [],
+}) {
+  const errors = [];
+  const tasks = [];
+  if (!LINES.includes(lineId)) errors.push(`未知分析线 ${lineId}`);
+  if (!selectedFigures.length) errors.push('未选择图模板');
+  for (const selection of selectedFigures) {
+    const templateId = String(selection.template_id || selection.id || '');
+    const template = templatesRegistry.find((item) => item.id === templateId);
+    if (!template) {
+      errors.push(`未知图模板 '${templateId}'`);
+      continue;
+    }
+    if (template.deps_status !== 'ready' || template.verified !== true) {
+      errors.push(`${templateId}: 模板不是 ready，禁止派发`);
+      continue;
+    }
+    if (!Array.isArray(template.lines) || !template.lines.includes(lineId)) {
+      errors.push(`${templateId}: 不支持分析线 ${lineId}`);
+      continue;
+    }
+    if (!template.analysis_step) errors.push(`${templateId}: analysis_step 缺失`);
+    const adaptVars = selection.adapt_vars && typeof selection.adapt_vars === 'object'
+      ? selection.adapt_vars : {};
+    for (const [key, value] of Object.entries(adaptVars)) {
+      validateAdaptValue(value, lineId, projectId, `${templateId}.${key}`, errors);
+    }
+    const extension = template.language === 'python' ? '.py' : '.R';
+    const localScript = `local_projects/${projectId}/figures/adapt/adapt_${templateId}${extension}`;
+    const remoteScript = `${PROJECTS_ROOT}/${projectId}/${lineId}/scripts/adapt_${templateId}${extension}`;
+    const customOutput = (template.produces || [`custom_${templateId}.png`])[0];
+    tasks.push({
+      task_id: `task_adapt_${templateId}`,
+      depends_on_step: template.analysis_step,
+      step: `adapt_${templateId}`,
+      language: template.language,
+      script_path: remoteScript,
+      local_script: localScript,
+      remote_script: remoteScript,
+      canonical_output: template.canonical_output,
+      custom_output: customOutput,
+      outputs: [`${PROJECTS_ROOT}/${projectId}/${lineId}/figures/${customOutput}`],
+      env_vars: {
+        BIO_PROJECT_ID: projectId,
+        BIO_LINE_ID: lineId,
+        BIO_ADAPT_VARS: JSON.stringify(adaptVars),
+      },
+      selected_template: templateId,
+    });
+  }
+  return { ok: errors.length === 0, errors, tasks };
+}
+
+export function authorizeOverwrite({ projectId, templateId, overwrite, references = [] }) {
+  if (!overwrite) return { ok: true, reason: '新增派生副本，不覆写母版' };
+  const projectIds = references.map((item) => (
+    typeof item === 'object' && item !== null ? item.projectId : item
+  )).filter(Boolean);
+  const impact = new Set(projectIds).size;
+  if (impact > 3) {
+    return {
+      ok: false,
+      reason: `母版被 ${impact} 个项目引用，超过 3：必须另存新模板，旧模板标 deprecated=true`,
+    };
+  }
+  return { ok: true, reason: `母版影响面 ${impact}/3` };
+}
diff --git a/BioanalysDesktop/server/index.js b/BioanalysDesktop/server/index.js
index 7712ef7..6354f5f 100644
--- a/BioanalysDesktop/server/index.js
+++ b/BioanalysDesktop/server/index.js
@@ -15,7 +15,7 @@ import { fileURLToPath } from 'node:url';
 
 import {
   DEFAULT_SERIAL, SYSTEM_LOGS, LINES, DEFAULT_PROJECT, sanitizeProjectId, projectLineDir,
-  resolveLineFromDataType, normalizeDatasets, normalizeDataSource,
+  PROJECTS_ROOT, resolveLineFromDataType, normalizeDatasets, normalizeDataSource,
 } from './domain.js';
 import { findAdb, runSync, runSshRaw, runSshStrict } from './proc.js';
 import { checkLink } from './link.js';
@@ -45,21 +45,50 @@ import {
 import { checkTumorBlacklist, validateProjectFields, BLACKLIST_HINT } from './tumor_blacklist.js';
 import { auditCommand } from './audit.js';
 import {
-  buildTaskScript, needsBridgeCheck, inspectBridgeNeed, buildBridgeCheckCommand,
+  describeSeries, resolvePlan, validateRegistry, loadWorkflows, modToScriptMap,
+} from './workflow_graph.js';
+import {
+  buildAdaptedFigureTasks, loadFigureTemplates, resolveFigure, validateRegistry as validateFigureRegistry,
+} from './figure_graph.js';
+import {
+  loadFigureCatalog, resolveCatalogFigure, searchFigureCatalog, validateFigureCatalog,
+} from './figure_catalog.js';
+import {
+  buildTaskScript, deriveAdaptedFigure, needsBridgeCheck, inspectBridgeNeed, buildBridgeCheckCommand,
   runBridgeCheckSync, BridgeCheckError, requiresKoGene, isValidKoGene, KNOCKOUT_STEPS,
 } from './task.js';
 import { runTask } from './run.js';
 import {
-  runReportBuild, pullDeliverables, checkRemoteProjectDir,
+  buildAdaptUploadPairs, readAdaptManifest, runReportBuild, pullDeliverables, checkRemoteProjectDir,
   isAllowedDeliverableName, localDeliverDir, localDeliverFilePath,
   runReportPreflight, writeSha256Sidecars,
 } from './report.js';
 
-const PORT = Number(process.env.BAD_PORT || 8787);
+const PORT = Number(process.env.BAD_PORT || 18787);
+const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
+
+/** 把项目相对 adapt_vars 输入映射成远端任务可用的绝对路径 */
+function remoteTaskInput(rawPath, projectId, lineId) {
+  const normalized = String(rawPath || '').split('\\').join('/').replace(/^\.\/+/, '');
+  if (!normalized) return `${projectLineDir(projectId, lineId)}/processed/input.tsv`;
+  if (normalized.startsWith(`data/${lineId}/`)) {
+    return `${PROJECTS_ROOT}/${projectId}/${normalized.slice('data/'.length)}`;
+  }
+  if (normalized.startsWith(`figures/${lineId}/`)) {
+    return `${PROJECTS_ROOT}/${projectId}/${normalized}`;
+  }
+  if (normalized.startsWith('processed/') || normalized.startsWith('results/')) {
+    return `${projectLineDir(projectId, lineId)}/${normalized}`;
+  }
+  if (!normalized.includes('/')) {
+    return `${projectLineDir(projectId, lineId)}/processed/${normalized}`;
+  }
+  return `${PROJECTS_ROOT}/${projectId}/${normalized}`;
+}
 
 /**
  * 工作台口令（HTTP Basic）。
- * 8787 会经 frp 暴露到公网，frp 从本机 127.0.0.1 回连，服务端无法用来源地址区分内外，
+ * 18787 会经 frp 暴露到公网，frp 从本机 127.0.0.1 回连，服务端无法用来源地址区分内外，
  * 所以只能整站鉴权：环境变量给了账号口令就强制校验，没给则保持本地开发/测试的免密行为。
  * 正式常驻由 ops/serve_guard.ps1 注入口令（口令文件在用户主目录，不落源码）。
  */
@@ -170,6 +199,17 @@ function runRemoteRaw(command) {
   return runSshRaw('k40-ubuntu', command, { timeoutMs: 40000 });
 }
 
+/**
+ * 列远端该线 processed/ 下的文件名（不含路径）。
+ * 只取一层、不递归：M4 的产物核对只需要文件名集合，递归会在容器里触发 P-23。
+ * ssh 失败时返回空集合 -  - 预览端点不该因为链路抖动就 500，缺产物会显示成 missing。
+ */
+function listRemoteProcessed(projectId, lineId) {
+  const dir = `${projectLineDir(projectId, lineId)}/processed`;
+  const out = runRemote(`ls -1 ${dir} 2>/dev/null || true`);
+  return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
+}
+
 /** 宽松版：只要文本，忽略退出码（多数调用点靠命令里的 `|| true` / MISSING 自己兜底） */
 function runRemote(command) {
   return runRemoteRaw(command).text;
@@ -180,7 +220,7 @@ function runRemote(command) {
  *
  * 存在的理由（踩坑台账 P-15）：宽松版丢弃退出码，链路断时 ssh 返回 255 且
  * stdout 为空，第 1 维会把空串判成"原生 ext4"、第 2 维会把空串算成 100% free，
- * 自检出现假绿灯:而自检是提交门禁，假绿灯比红灯危险得多。
+ * 自检出现假绿灯 -  - 而自检是提交门禁，假绿灯比红灯危险得多。
  */
 function runRemoteStrict(command) {
   return runSshStrict('k40-ubuntu', command, { timeoutMs: 40000 });
@@ -297,7 +337,7 @@ function listProjectsWithMeta() {
  * 列出一个项目某条线 figures/ 下的图件（含中文说明），供 API 与后端预览页共用。
  *
  * 优先读本地回搬副本 outputs/<项目>/<线>/figures/（规范要求图件回搬本地），
- * 本地没有时才回落远端实时读取，并用 source 字段标明来源 : 不能让
+ * 本地没有时才回落远端实时读取，并用 source 字段标明来源  -  -  不能让
  * "本地还没回搬"被误读成"这条线没出图"。
  */
 function listFiguresForLine(projectId, lineId) {
@@ -545,7 +585,7 @@ const STATIC_MIME = {
 
 /**
  * 托管管理员工作台前端（dist/）。
- * 8787 只提供管理员工作台（/）与后端 API；客户需求提交入口是独立服务（见 portal/），不在此端口。
+ * 18787 只提供管理员工作台（/）与后端 API；客户需求提交入口是独立服务（见 portal/），不在此端口。
  * 无扩展名的路径按 SPA 回退到 index.html（React 单页，路由在客户端状态里）。
  * @param {import('node:http').ServerResponse} res
  * @param {string} pathname
@@ -588,7 +628,7 @@ function serveStatic(res, pathname) {
       '<body style="font-family:sans-serif;max-width:640px;margin:80px auto;padding:0 20px;color:#0f172a">' +
       '<h1 style="color:#0d9488">工作台前端尚未构建</h1>' +
       '<p>请在 <code>BioanalysDesktop/</code> 目录执行 <code>npm run build</code> 生成 <code>dist/</code> 后刷新本页。</p>' +
-      '<p>开发模式可改用 <code>npm run dev</code>（Vite 监听 5173，API 代理到 8787）。</p>' +
+      '<p>开发模式可改用 <code>npm run dev</code>（Vite 监听 5173，API 代理到 18787）。</p>' +
       '</body>'
     );
   }
@@ -599,8 +639,18 @@ function serveStatic(res, pathname) {
  * 从 pipelineDag 推断分析线：取命中步骤数最多的那条线。
  * 为什么不用 dataType：需求文件可能缺 dataType（旧格式），但步骤 id 是母版固定的。
  */
-function lineFromPipeline(dag) {
-  const ids = (Array.isArray(dag) ? dag : []).map((d) => d?.stepId).filter(Boolean);
+// 导出供测试：双形态（mod id / 母版名）推断分析线是 M3 的关键兼容层，
+// 没有测试钉住的话，未来改 LINE_STEPS 或映射时会静默失配。
+export function lineFromPipeline(dag) {
+  // 双形态兼容：pipelineDag 的 stepId 既可能是母版名（历史提交、runner 直跑），
+  // 也可能是 mod id（mod 化后的客户端，如 l2_tf_scenic）。LINE_STEPS 派生自注册表的
+  // script 字段即母版名，所以 mod id 要先经 modScriptIndex 翻成母版名再比对，
+  // 否则 mod 化后这里会全部失配、分析线推断为空。
+  const modToScript = modToScriptMap();
+  const ids = (Array.isArray(dag) ? dag : [])
+    .map((d) => d?.stepId)
+    .filter(Boolean)
+    .map((s) => modToScript.get(s) || s);
   if (!ids.length) return '';
   let best = '';
   let bestHits = 0;
@@ -730,6 +780,12 @@ const server = http.createServer(async (req, res) => {
           dataSource: requested.dataSource,
           groupingDesign: requested.groupingDesign,
           pipelineDag: requested.pipelineDag,
+          // mod 化客户端形态：只传 seriesId + modIds + koGene，不传 pipelineDag。
+          // buildProjectMeta 里的 buildPipelineDag 会把它合成 pipeline_dag，
+          // 这里必须透传，否则新客户端的步骤选择到服务台就丢了。
+          seriesId: requested.seriesId,
+          modIds: requested.modIds,
+          koGene: requested.koGene,
           aclAndOutput: requested.aclAndOutput,
           // aims v3.0 intake 四块
           biologicalPriors: requested.biologicalPriors,
@@ -740,7 +796,9 @@ const server = http.createServer(async (req, res) => {
           dataFiles: requested.dataFiles,
           // S24/R2：WGCNA 参数契约（表单选填；normalizeWgcnaConfig 逐键回落默认）
           wgcnaConfig: requested.wgcnaConfig,
-          lineId: requested.lineId,
+          // mod 化客户端用 seriesId 表达同一件事（分析线），没有单独的 lineId 字段。
+          // 两个名字都认，缺了就都空着让 strict 校验去拒。
+          lineId: requested.lineId || requested.seriesId,
         });
       } catch (cause) {
         return json(res, 400, { error: cause.message });
@@ -802,6 +860,56 @@ const server = http.createServer(async (req, res) => {
     return json(res, 200, { steps: LINE_STEPS, meta: PIPELINE_STEP_META });
   }
 
+  // --- mod 注册表（单一事实源 src/workflows.json）---
+  // 与 /api/projects/steps 的区别：那个是「母版名」兼容视图（旧前端在用），
+  // 这三个是注册表本体，返回 mod id / 阶段 / 依赖 / 成本，供组合校验用。
+  if (url.pathname === '/api/workflows') {
+    const wf = loadWorkflows();
+    const check = validateRegistry();
+    return json(res, 200, {
+      // 客户端一次拿全：系列清单 + 每条线的阶段与 mod + 全局约束
+      series: wf.series.map((s) => describeSeries(s.id)),
+      constraints: wf.constraints,
+      // 注册表自洽状态一并下发：坏了客户端能看到，而不是静默拿到半份图
+      registry_ok: check.ok,
+      registry_errors: check.errors,
+    });
+  }
+
+  // 组合合法性预检：客户端勾完步骤后先问一次，别等远端跑爆才发现
+  if (url.pathname === '/api/workflows/resolve' && req.method === 'POST') {
+    let body = '';
+    req.on('data', (chunk) => { body += chunk; });
+    req.on('end', () => {
+      let parsed = {};
+      try {
+        parsed = body.trim() ? JSON.parse(body) : {};
+      } catch (cause) {
+        return json(res, 400, { error: `请求体不是合法 JSON: ${cause instanceof Error ? cause.message : String(cause)}` });
+      }
+      const seriesId = String(parsed.seriesId || parsed.series || '').trim();
+      const modIds = Array.isArray(parsed.modIds) ? parsed.modIds.map((x) => String(x)) : [];
+      const koGene = String(parsed.koGene || '').trim();
+      if (!seriesId) return json(res, 400, { error: '缺少 seriesId' });
+      if (modIds.length === 0) return json(res, 400, { error: 'modIds 不能为空' });
+      const plan = resolvePlan(seriesId, modIds, { koGene });
+      // 非法组合回 422：调用方传错了，不是服务端故障
+      return json(res, plan.ok ? 200 : 422, plan);
+    });
+    return;
+  }
+
+  // 单系列详情必须放在 resolve 之后：否则前缀匹配会把 /api/workflows/resolve
+  // 吞成 seriesId=resolve，返回「未知分析系列」。
+  if (url.pathname.startsWith('/api/workflows/')) {
+    const seriesId = url.pathname.slice('/api/workflows/'.length).split('?')[0];
+    // 只认注册表里真实存在的系列 id。不加这道闸，任何 /api/workflows/<任意串>
+    // 都会走到这里，把拼错的路由名报成「未知分析系列」，排查时极易误判。
+    const detail = describeSeries(seriesId);
+    if (!detail) return json(res, 404, { error: `未知分析系列: ${seriesId}` });
+    return json(res, 200, detail);
+  }
+
   // 单个项目的关键元数据：Studio 用它显示"这批图按什么模板/阈值出的"
   if (url.pathname === '/api/projects/meta') {
     const projectId = sanitizeProjectId(url.searchParams.get('project') || '');
@@ -922,7 +1030,22 @@ const server = http.createServer(async (req, res) => {
     try {
       const raw = runRemoteStrict(buildIsolationCommand());
       const isolation = evaluateIsolation(parseIsolationOutput(raw));
-      checks.push(mergeIsolationChecks(isolation, runSha256ParityCheck()));
+      const merged = mergeIsolationChecks(isolation, runSha256ParityCheck());
+      // P17：子灯结构化下发（前端 sub_checks），value 仍保持字符串兼容旧前端
+      checks.push({
+        id: merged.id,
+        label: merged.label,
+        status: merged.status,
+        value: merged.value,
+        detail: merged.detail,
+        sub_checks: (merged.subChecks ?? []).map((sub) => ({
+          id: sub.id,
+          label: sub.label,
+          status: sub.status,
+          value: sub.value,
+          detail: sub.detail,
+        })),
+      });
     } catch (e) {
       checks.push({ id: 'isolation', label: '跨线隔离/桥接/版本', status: 'unknown', value: '', detail: '无法读取: ' + (e instanceof Error ? e.message : String(e)) });
     }
@@ -1028,6 +1151,235 @@ const server = http.createServer(async (req, res) => {
     return json(res, 200, { blocked: false, projectId, lineId, root: guard.normalized, tree });
   }
 
+  if (url.pathname === '/api/figures/templates') {
+    const registry = loadFigureTemplates();
+    const check = validateFigureRegistry();
+    const lineId = url.searchParams.get('line') || LINES[0];
+    const templates = registry.templates.map((item) => ({
+      id: item.id,
+      name: item.name,
+      level: item.level,
+      category: item.category,
+      language: item.language,
+      deps_status: item.deps_status,
+      verified: item.verified,
+      preview: item.preview,
+      source_sha256: item.source_sha256,
+      linked_mods: item.linked_mods,
+      adapt_vars: item.adapt_vars,
+      block_reason: item.block_reason || '',
+    }));
+    return json(res, 200, {
+      ok: check.ok,
+      registry_ok: check.ok,
+      registry_errors: check.errors,
+      stats: check.stats,
+      lineId,
+      templates,
+    });
+  }
+
+  if (url.pathname === '/api/figures/templates/preview') {
+    const templateId = url.searchParams.get('id') || '';
+    const registry = loadFigureTemplates();
+    const item = registry.templates.find((candidate) => candidate.id === templateId);
+    if (!item || item.deps_status !== 'ready' || !item.preview) {
+      return json(res, 404, { error: `模板预览不可用: ${templateId}` });
+    }
+    const file = path.resolve(REPO_ROOT, item.preview);
+    if (!file.startsWith(REPO_ROOT + path.sep)) {
+      return json(res, 400, { error: '模板预览路径越界' });
+    }
+    const lower = file.toLowerCase();
+    const mime = lower.endsWith('.png') ? 'image/png'
+      : lower.endsWith('.svg') ? 'image/svg+xml'
+      : lower.endsWith('.gif') ? 'image/gif'
+      : lower.endsWith('.webp') ? 'image/webp'
+      : lower.endsWith('.pdf') ? 'application/pdf'
+      : 'image/jpeg';
+    const stat = fs.statSync(file);
+    res.writeHead(200, {
+      'Content-Type': mime,
+      'Content-Length': stat.size,
+      'Cache-Control': 'no-store',
+    });
+    fs.createReadStream(file).pipe(res);
+    return;
+  }
+
+  if (url.pathname === '/api/figures/catalog') {
+    const check = validateFigureCatalog();
+    const entries = searchFigureCatalog({
+      query: url.searchParams.get('q') || '',
+      language: url.searchParams.get('language') || '',
+      status: url.searchParams.get('status') || '',
+      limit: url.searchParams.get('limit') || 50,
+    }).map((item) => ({
+      catalog_id: item.catalog_id,
+      page_id: item.page_id,
+      title: item.title,
+      lang: item.lang,
+      chart_type: item.chart_type,
+      family: item.family,
+      bio_level: item.bio_level,
+      bio_tags: item.bio_tags,
+      score: item.score,
+      status: item.status,
+      deps: item.deps,
+      page_url: item.page_url,
+      preview_path: item.preview_path,
+      code_path: item.code_path,
+      width: item.width,
+      height: item.height,
+      pilot: item.pilot,
+      suggested_template_id: item.suggested_template_id,
+    }));
+    return json(res, 200, {
+      ok: check.ok,
+      catalog_ok: check.ok,
+      catalog_errors: check.errors,
+      stats: check.stats,
+      entries,
+    });
+  }
+
+  if (url.pathname === '/api/figures/catalog/preview') {
+    const catalogId = url.searchParams.get('id') || '';
+    const resolved = resolveCatalogFigure(catalogId);
+    if (!resolved.ok || !resolved.preview_abs) {
+      return json(res, 404, {
+        error: `候选图预览不可用: ${catalogId}`,
+        errors: resolved.errors,
+      });
+    }
+    const stat = fs.statSync(resolved.preview_abs);
+    res.writeHead(200, {
+      'Content-Type': 'image/png',
+      'Content-Length': stat.size,
+      'Cache-Control': 'no-store',
+    });
+    fs.createReadStream(resolved.preview_abs).pipe(res);
+    return;
+  }
+
+  if (url.pathname === '/api/figures/adapt') {
+    const projectId = resolveProjectParam(url);
+    if (!projectId) {
+      return json(res, 400, { error: 'project 参数非法' });
+    }
+    try {
+      const manifest = readAdaptManifest(undefined, projectId);
+      return json(res, 200, { ok: true, projectId, items: manifest });
+    } catch (cause) {
+      return json(res, 500, { error: `读取适配清单失败: ${cause instanceof Error ? cause.message : String(cause)}` });
+    }
+  }
+
+  if (url.pathname === '/api/figures/adapt/derive' && req.method === 'POST') {
+    let body = '';
+    req.on('data', (chunk) => { body += chunk; });
+    req.on('end', async () => {
+      let requested;
+      try {
+        requested = JSON.parse(body || '{}');
+      } catch (cause) {
+        return json(res, 400, { error: `请求体不是合法 JSON: ${cause.message}` });
+      }
+      const projectId = sanitizeProjectId(requested.projectId);
+      const lineId = requested.lineId;
+      const templateId = String(requested.templateId || '');
+      if (!projectId) return json(res, 400, { error: 'projectId 参数非法' });
+      if (!LINES.includes(lineId)) return json(res, 400, { error: `lineId 参数非法: ${lineId}` });
+
+      const selectedModIds = Array.isArray(requested.selectedModIds)
+        ? requested.selectedModIds.map(String) : [];
+      const adaptVars = requested.adaptVars && typeof requested.adaptVars === 'object'
+        ? requested.adaptVars : {};
+      const resolved = resolveFigure(templateId, lineId, projectId, adaptVars, selectedModIds);
+      if (!resolved.ok) {
+        return json(res, 422, { ok: false, errors: resolved.errors, template_id: templateId });
+      }
+
+      let remoteExists;
+      try {
+        remoteExists = await checkRemoteProjectDir(projectId);
+      } catch (cause) {
+        return json(res, 503, { ok: false, error: `远端链路检查失败: ${cause instanceof Error ? cause.message : String(cause)}` });
+      }
+      if (!remoteExists) {
+        return json(res, 400, { ok: false, error: `远端项目目录不存在: ${PROJECTS_ROOT}/${projectId}` });
+      }
+
+      const derivation = deriveAdaptedFigure({
+        projectId,
+        lineId,
+        templateId,
+        template: resolved.template,
+        adaptVars,
+      });
+      if (!derivation.ok) {
+        return json(res, 422, { ok: false, errors: derivation.errors, template_id: templateId });
+      }
+      const adapted = buildAdaptedFigureTasks({
+        projectId,
+        lineId,
+        selectedFigures: [{ template_id: templateId, adapt_vars: adaptVars }],
+        templatesRegistry: [resolved.template],
+      });
+      if (!adapted.ok || adapted.tasks.length !== 1) {
+        return json(res, 422, { ok: false, errors: adapted.errors, template_id: templateId });
+      }
+      const adaptedTask = adapted.tasks[0];
+
+      const remoteDir = path.posix.dirname(derivation.remote_path);
+      const mkdir = runRemoteRaw(`mkdir -p '${remoteDir}'`);
+      if (mkdir.code !== 0) {
+        return json(res, 503, {
+          ok: false,
+          error: `远端适配目录创建失败: ${mkdir.text}`,
+          local_path: derivation.local_path,
+        });
+      }
+      const scp = runSync(['scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', derivation.local_path, `k40-ubuntu:${derivation.remote_path}`]);
+      if (scp.code !== 0) {
+        return json(res, 503, {
+          ok: false,
+          error: `适配副本上传失败: ${scp.stderr || scp.stdout || 'stderr 为空'}`,
+          local_path: derivation.local_path,
+        });
+      }
+
+      const taskPayload = {
+        projectId,
+        lineId,
+        step: adaptedTask.step,
+        inputs: [remoteTaskInput(adaptVars.input_data, projectId, lineId)],
+        outputs: adaptedTask.outputs,
+        seed: Number.isFinite(Number(requested.seed)) && requested.seed !== ''
+          ? Number(requested.seed)
+          : 20261013,
+        scriptPath: adaptedTask.script_path,
+        language: adaptedTask.language,
+        canonicalOutput: adaptedTask.canonical_output,
+        customOutput: adaptedTask.custom_output,
+        adapted: true,
+      };
+      return json(res, 200, {
+        ok: true,
+        projectId,
+        lineId,
+        template_id: templateId,
+        selected_mods: resolved.selected_mods,
+        local_path: derivation.local_path,
+        remote_path: derivation.remote_path,
+        master_sha256: derivation.master_sha256,
+        derived_sha256: derivation.manifest_entry.derived_sha256,
+        task: taskPayload,
+      });
+    });
+    return;
+  }
+
   if (url.pathname === '/api/figures/list') {
     // 图件浏览：列出本项目该线 figures/ 下的 PNG，供可视化界面渲染
     const projectId = resolveProjectParam(url);
@@ -1056,6 +1408,64 @@ const server = http.createServer(async (req, res) => {
     });
   }
 
+  // M4：按 mod 分组的产物预览。
+  // 与 /api/figures/list 的区别：那个把 figures/ 全量倒出，这个按客户勾选的 mod 分组，
+  // 没勾选的 mod 不出现（客户不该看到没买的分析），且能说清"该 mod 没跑"而非"文件丢失"。
+  if (url.pathname === '/api/preview/mods') {
+    const projectId = resolveProjectParam(url);
+    if (!projectId) {
+      return json(res, 400, { error: 'project 参数非法（只允许字母数字 . _ -）' });
+    }
+    const lineId = url.searchParams.get('line') || LINES[0];
+    // modIds 由调用方给（一般是该项目 pipeline_dag 里勾选的）；不传则按该线全链
+    const modIds = (url.searchParams.get('modIds') || '').split(',').map((s) => s.trim()).filter(Boolean);
+
+    const series = loadWorkflows().series.find((s) => s.id === lineId);
+    if (!series) return json(res, 404, { error: `未知分析系列: ${lineId}` });
+
+    // 读取该线 processed/ 与 figures/ 的真实产物，用于判定每个 mod 跑没跑
+    const listed = listFiguresForLine(projectId, lineId);
+    const figureNames = new Set((listed.figures || []).map((f) => f.name));
+    const processedNames = listRemoteProcessed(projectId, lineId);
+
+    const allMods = series.stages.flatMap((st) => st.mods.map((m) => ({ ...m, stage: st })));
+    const picked = modIds.length
+      ? allMods.filter((m) => modIds.includes(m.id))
+      : allMods;
+
+    const groups = picked.map((m) => {
+      const script = m.script || m.id;
+      const products = (m.produces || []).map((name) => {
+        // 产物可能落在 processed/ 或 figures/（outputs_dir=figures 的 mod）
+        const present = figureNames.has(name) || processedNames.has(name);
+        return { name, present };
+      });
+      const presentCount = products.filter((p) => p.present).length;
+      return {
+        mod_id: m.id,
+        script,
+        name: m.name,
+        stage_id: m.stage.id,
+        stage_name: m.stage.name,
+        status: products.length === 0
+          ? 'unknown'
+          : (presentCount === products.length ? 'complete' : (presentCount > 0 ? 'partial' : 'missing')),
+        present_count: presentCount,
+        total_count: products.length,
+        products,
+      };
+    });
+
+    return json(res, 200, {
+      blocked: listed.blocked === true,
+      projectId,
+      lineId,
+      reason: listed.reason || '',
+      mod_count: groups.length,
+      groups,
+    });
+  }
+
   if (url.pathname === '/api/figures/pull' && req.method === 'POST') {
     // 图件回搬：把远端 figures/（以及 results/）拉到本地 outputs/，供视图 4 离线查看。
     // 本地只跑 scp，不触发任何计算（零算力红线）。
@@ -1178,6 +1588,28 @@ const server = http.createServer(async (req, res) => {
       if (!remoteExists) {
         return json(res, 400, { ok: false, error: `远端项目目录不存在: /mnt/ssd/bio_data/projects/${projectId}` });
       }
+      // 适配副本按既有 build_client_report 的 scripts/ 扫描口交付，不改动引擎。
+      let adaptPairs = [];
+      try {
+        adaptPairs = buildAdaptUploadPairs(undefined, projectId);
+      } catch (cause) {
+        return json(res, 400, { ok: false, error: `适配清单无效: ${cause.message}` });
+      }
+      for (const pair of adaptPairs) {
+        const remoteScriptDir = path.posix.dirname(pair.remote);
+        const mkdir = runRemoteRaw(`mkdir -p '${remoteScriptDir}'`);
+        if (mkdir.code !== 0) {
+          return json(res, 503, { ok: false, error: `远端适配目录创建失败: ${mkdir.text}` });
+        }
+        const scp = runSync(['scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', pair.local, `k40-ubuntu:${pair.remote}`]);
+        if (scp.code !== 0) {
+          return json(res, 503, {
+            ok: false,
+            error: `适配副本上传失败: ${scp.stderr || scp.stdout || 'stderr 为空'}`,
+            template_id: pair.template_id,
+          });
+        }
+      }
       // 交付前置门禁（D4 / docs/delivery_package_spec.md 第三节 3/5/6 条）：
       // 打包前先查磁盘水位、运行中任务、失败台账，任一不过即 409 且原样回报，
       // 避免"打包成功但产物不可信"。force:true 仅放行失败台账，水位与运行中任务仍拦。
@@ -1201,6 +1633,8 @@ const server = http.createServer(async (req, res) => {
           files: pulled.files,
           report_md_bytes: pulled.report_md_bytes,
           report_html_bytes: pulled.report_html_bytes,
+          adapted_code_count: adaptPairs.length,
+          adapted_manifest: readAdaptManifest(undefined, projectId),
           preflight,
           sidecars,
         });
@@ -1458,7 +1892,7 @@ const server = http.createServer(async (req, res) => {
 
   if (url.pathname === '/api/tasks' && req.method === 'GET') {
     // 在跑任务列表：让界面知道有没有重复下发。
-    // 字段名与 /api/tasks/submit 的返回值统一为 taskId : 两处用不同名字
+    // 字段名与 /api/tasks/submit 的返回值统一为 taskId  -  -  两处用不同名字
     // （这里曾叫 id）会让调用方按 submit 的字段去比对列表，永远匹配不上，
     // 长任务被误判成"已结束"（2026-10-19 端到端实测踩到）。
     return json(res, 200, {
@@ -1504,6 +1938,26 @@ const server = http.createServer(async (req, res) => {
           error: `step 只能包含字母数字和 . _ -（命令名）: ${requested.step}。参数请用 inputs/outputs 传递`,
         });
       }
+      const adapted = requested.adapted === true;
+      let adaptedScript = '';
+      let adaptedLanguage = '';
+      let canonicalOutput = '';
+      if (adapted) {
+        adaptedScript = String(requested.scriptPath || '');
+        adaptedLanguage = String(requested.language || '');
+        canonicalOutput = String(requested.canonicalOutput || '');
+        const scriptPrefix = `/mnt/ssd/bio_data/projects/${projectId}/${lineId}/scripts/adapt_`;
+        if (!adaptedScript.startsWith(scriptPrefix) || !/\.(R|py)$/.test(adaptedScript)) {
+          return json(res, 400, { error: `adapted scriptPath 非法: ${adaptedScript}` });
+        }
+        if (!['r', 'python'].includes(adaptedLanguage)) {
+          return json(res, 400, { error: `adapted language 非法: ${adaptedLanguage}` });
+        }
+        if (!canonicalOutput || canonicalOutput.includes('..') || canonicalOutput.startsWith('/')
+          || !/^[A-Za-z0-9._/-]+$/.test(canonicalOutput)) {
+          return json(res, 400, { error: `adapted canonicalOutput 非法: ${canonicalOutput}` });
+        }
+      }
 
       // P14 / aims:185：虚拟敲除必须由用户指定靶基因（target_ko_gene）。
       // 为什么在提交层就拦：母版里写死 KO_GENE 时，用户勾了"虚拟敲除"却敲的是别人的基因，
@@ -1533,7 +1987,7 @@ const server = http.createServer(async (req, res) => {
 
       // inputs / outputs 必须是字符串数组。调用方（含脚本化的 PowerShell / curl）
       // 很容易把单元素数组序列化成裸字符串，此时 task.js 的 inputs.map 会抛
-      // TypeError 并**直接打死整个服务**（2026-10-19 实测：8787 进程退出）。
+      // TypeError 并**直接打死整个服务**（2026-10-19 实测：18787 进程退出）。
       // 参数类型错误是调用方问题，必须 400 返回，不能让服务端崩。
       for (const field of ['inputs', 'outputs']) {
         const value = requested[field];
@@ -1546,6 +2000,14 @@ const server = http.createServer(async (req, res) => {
         }
       }
 
+      // P-29：禁止并发 SSH 到 k40-ubuntu。单任务串行是 proot 不进入 abort
+      // 自我维持环的必要条件；跨项目并发同样禁止。
+      if (runningTasks.size > 0) {
+        return json(res, 409, {
+          error: `P-29 禁止并发 SSH：当前已有 ${runningTasks.size} 个任务在运行，请等待完成后再提交`,
+        });
+      }
+
       // 同项目同线同步骤不允许并发第二次：生信任务重，跑重了难收拾
       const duplicate = [...runningTasks.values()].some(
         (task) => task.projectId === projectId && task.lineId === lineId && task.step === requested.step
@@ -1564,11 +2026,15 @@ const server = http.createServer(async (req, res) => {
         seed: requested.seed,
         // 非敲除步骤这里是空串，task.js 只在 requiresKoGene(step) 时注入，语义一致
         targetKoGene: targetKoGene || undefined,
+        scriptPath: adapted ? adaptedScript : undefined,
+        language: adapted ? adaptedLanguage : undefined,
+        canonicalOutput: adapted ? canonicalOutput : undefined,
+        adapted,
       };
 
       // 审计提前到提交前：越界就不给 taskId，不启动、不占任务位。
       // 整段包 try/catch：参数形态异常（如 inputs 传了对象）不能把服务打死，
-      // 必须是 400 返回 : 一次崩溃会让所有在跑任务与 SSE 连接一起断。
+      // 必须是 400 返回  -  -  一次崩溃会让所有在跑任务与 SSE 连接一起断。
       let script;
       try {
         script = buildTaskScript(taskSpec);
@@ -1589,21 +2055,21 @@ const server = http.createServer(async (req, res) => {
 
       // ── 桥接四项断言检查点（S28 / 架构评审 D1）──────────────────────────
       // aims §一.3：每次跨语言转换必须过 ops/verify_bridge_checkpoint.py。
-      // 58 个分析脚本 0 调用（铁律空转），接线位置定为提交层:只有这里全知
+      // 58 个分析脚本 0 调用（铁律空转），接线位置定为提交层 -  - 只有这里全知
       // "这一步是不是跨语言步骤"。母版缺失不阻断提交（保持既有行为），但必须
       // warn 可观测；K40 不可达时明确 503，绝不静默放过。
-      const bridgeNeed = inspectBridgeNeed(lineId, requested.step);
-      if (!bridgeNeed.masterExists) {
+      const bridgeNeed = adapted ? { masterExists: false, bilingual: false, guardWired: false, reason: 'adapted task' } : inspectBridgeNeed(lineId, requested.step);
+      if (!adapted && !bridgeNeed.masterExists) {
         console.warn(`[bridge] ${lineId}/${requested.step} 母版缺失，跳过桥接判定: ${bridgeNeed.reason}`);
       }
       // task-10 / m00939 边界②：母版自己也要调 src/bridge_guard.sh，否则直连 K40
       // 跑母版时断言仍空转。这里只 warn 不阻断：老母版不该因为新规突然提交失败，
       // 但不变量测试 tests/bridge_guard_invariant.test.js 会把缺口钉在 CI 上。
-      if (bridgeNeed.bilingual && !bridgeNeed.guardWired) {
+      if (!adapted && bridgeNeed.bilingual && !bridgeNeed.guardWired) {
         console.warn(`[bridge] ${lineId}/${requested.step} 是跨语言母版但未调用 src/bridge_guard.sh，`
           + `提交层仍会执行断言，直连 K40 跑母版则不会；请按 task-10 接线`);
       }
-      if (needsBridgeCheck(lineId, requested.step)) {
+      if (!adapted && needsBridgeCheck(lineId, requested.step)) {
         let bridgePlan;
         try {
           bridgePlan = buildBridgeCheckCommand(lineId, requested.step, {
@@ -1650,6 +2116,10 @@ const server = http.createServer(async (req, res) => {
             seed: requested.seed,
             // 与上面 taskSpec 同源：审计用的脚本与实际跑的脚本必须带同一个靶基因
             targetKoGene: targetKoGene || undefined,
+            scriptPath: adapted ? adaptedScript : undefined,
+            language: adapted ? adaptedLanguage : undefined,
+            canonicalOutput: adapted ? canonicalOutput : undefined,
+            adapted,
           },
           {
             onStdout: (text) => sendEvent(taskId, 'stdout', text),
@@ -1750,9 +2220,18 @@ try {
   console.warn(`[bioanalys-desktop] 启动清理上传会话异常（已忽略）: ${cause.message}`);
 }
 
-server.listen(PORT, '127.0.0.1', () => {
-  console.log(`[bioanalys-desktop] backend listening on http://127.0.0.1:${PORT}`);
-  console.log(`[bioanalys-desktop] adb = ${adb}`);
-});
+// 探针出口：LINE_INFER_PROBE=<JSON> 时只跑纯函数并打印结果，不监听端口。
+// 为什么需要它：lineFromPipeline 的失配只在"有 dataFiles 时才报错"，manifest 不带
+// dataFiles 时那条路径根本不执行，HTTP 断言抓不到，会假绿。子进程直调纯函数，失配即红。
+// 这里不 import 远端链路，所以在 listen 之前就要分流，避免探针进程白起一个服务。
+if (process.env.LINE_INFER_PROBE) {
+  const dag = JSON.parse(process.env.LINE_INFER_PROBE);
+  process.stdout.write(lineFromPipeline(dag));
+} else {
+  server.listen(PORT, '127.0.0.1', () => {
+    console.log(`[bioanalys-desktop] backend listening on http://127.0.0.1:${PORT}`);
+    console.log(`[bioanalys-desktop] adb = ${adb}`);
+  });
+}
 
 export { server };
diff --git a/BioanalysDesktop/server/task.js b/BioanalysDesktop/server/task.js
index f601fec..ecdaa84 100644
--- a/BioanalysDesktop/server/task.js
+++ b/BioanalysDesktop/server/task.js
@@ -6,7 +6,7 @@
  *   2. 台账必须能被 ledger.js 自己判合法，否则写出去的账自己就违规，成了讽刺。
  */
 
-import { randomUUID } from 'node:crypto';
+import { randomUUID, createHash } from 'node:crypto';
 // default 导入而非具名导入：ESM 具名导入是链接期快照，测试拦截不到（见 run.js 同款注释）。
 // 桥接校验的同步 ssh 执行必须可在进程内被测试垫片替换。
 import childProcess from 'node:child_process';
@@ -14,15 +14,308 @@ import fs from 'node:fs';
 import path from 'node:path';
 import { fileURLToPath } from 'node:url';
 
-import { LINES, DEFAULT_PROJECT, projectLineDir, binDir, sanitizeProjectId } from './domain.js';
+import {
+  LINES, DEFAULT_PROJECT, projectLineDir, binDir, sanitizeProjectId, SYSTEM_LOGS,
+} from './domain.js';
 import { assertAllowedProgram } from './proc.js';
+import { modToScriptMap, scriptToModMap } from './workflow_graph.js';
+import { buildAdaptedFigureSource } from './figure_adapters.js';
+
+/** 主节点温度熔断阈值，与 server/selfcheck.js 的 TEMP_FAIL_C 对齐 */
+export const NODE_TEMP_FAIL_C = 95;
+/** 主节点不可用后，新任务必须在 10 秒内切到备用节点 */
+export const NODE_FAILOVER_LIMIT_MS = 10000;
+
+const DEFAULT_COMPUTE_NODES = Object.freeze([
+  Object.freeze({ id: 'k40-ubuntu', host: 'k40-ubuntu', primary: true }),
+]);
+
+const DEFAULT_ACTION_FILE = path.resolve(
+  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'con_hf', 'ledger', 'actions.jsonl',
+);
+
+const SSH_TARGET_RE = /^[A-Za-z0-9._@:-]+$/;
+const NODE_HEALTH_END = 'NODE_HEALTH_END';
+
+/**
+ * 解析算力节点池。
+ * @param {string|null} rawJson 默认读 BIO_COMPUTE_NODES；未配置时只启用 K40
+ * @returns {Array<{id: string, host: string, primary: boolean}>}
+ */
+export function parseComputeNodes(rawJson = process.env.BIO_COMPUTE_NODES) {
+  if (!rawJson) return [...DEFAULT_COMPUTE_NODES];
+  const parsed = JSON.parse(rawJson);
+  if (!Array.isArray(parsed) || parsed.length === 0) {
+    throw new Error('BIO_COMPUTE_NODES 必须是非空节点数组');
+  }
+  const normalized = parsed.map((node) => {
+    if (!node || typeof node !== 'object' || !/^[A-Za-z0-9._-]+$/.test(node.id ?? '')) {
+      throw new Error('算力节点缺少合法 id');
+    }
+    const host = String(node.host || node.id);
+    if (!SSH_TARGET_RE.test(host)) {
+      throw new Error(`算力节点 SSH 目标非法: ${host}`);
+    }
+    return {
+      id: String(node.id),
+      host,
+      primary: node.primary === true,
+    };
+  });
+  const primaries = normalized.filter((node) => node.primary);
+  if (primaries.length !== 1 || primaries[0].id !== 'k40-ubuntu') {
+    throw new Error('BIO_COMPUTE_NODES 必须且只能把 k40-ubuntu 配置为主节点');
+  }
+  if (new Set(normalized.map((node) => node.id)).size !== normalized.length) {
+    throw new Error('BIO_COMPUTE_NODES 节点 id 不得重复');
+  }
+  return normalized;
+}
+
+/**
+ * 单节点健康判定：SSH 离线或温度达到熔断阈值时不可用。
+ * 温度不可读不算失败，避免缺传感器就误切备用节点。
+ * @param {{id: string}} node
+ * @param {{reachable?: boolean, tempC?: number|null}} [health]
+ */
+export function evaluateNode(node, health = {}) {
+  const reachable = health.reachable !== false;
+  const tempC = Number(health.tempC);
+  const hot = Number.isFinite(tempC) && tempC >= NODE_TEMP_FAIL_C;
+  const available = reachable && !hot;
+  const reason = !reachable ? 'offline' : hot ? 'temperature_threshold' : null;
+  return { ...node, available, reason };
+}
+
+/**
+ * 单节点健康探针命令。温度不可读时仍会输出结束哨兵，避免把缺传感器误判成离线。
+ */
+export function buildNodeHealthCommand() {
+  return [
+    `(cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | sort -n | tail -1 | sed 's/^/TEMP|/')`,
+    `echo '${NODE_HEALTH_END}'`,
+  ].join('; ');
+}
+
+/**
+ * 解析节点健康探针输出。毫摄氏度与摄氏度都接受，口径与 selfcheck.js 一致。
+ * @param {string} text
+ * @returns {{tempC: number|null, sawEnd: boolean}}
+ */
+export function parseNodeHealthOutput(text) {
+  let tempMilli = null;
+  let sawEnd = false;
+  for (const raw of String(text ?? '').split(/\r?\n/)) {
+    const line = raw.trim();
+    if (line === NODE_HEALTH_END) {
+      sawEnd = true;
+      continue;
+    }
+    if (line.startsWith('TEMP|')) {
+      const value = Number(line.slice('TEMP|'.length));
+      if (Number.isFinite(value)) tempMilli = value;
+    }
+  }
+  return {
+    tempC: tempMilli === null
+      ? null
+      : (tempMilli > 1000 ? Math.round(tempMilli / 1000) : Math.round(tempMilli)),
+    sawEnd,
+  };
+}
+
+/**
+ * 通过 SSH 读取单个节点健康状态。SSH 非零退出视为离线，温度读不到仍视为可达。
+ */
+export function probeNodeHealth(node, options = {}) {
+  const timeoutMs = Math.max(1, Number(options.timeoutMs || 4500));
+  let result;
+  try {
+    result = childProcess.spawnSync(
+      'ssh',
+      [
+        '-o', 'BatchMode=yes',
+        '-o', `ConnectTimeout=${Math.max(1, Math.ceil(timeoutMs / 1000))}`,
+        node.host,
+        buildNodeHealthCommand(),
+      ],
+      {
+        encoding: 'utf8',
+        timeout: timeoutMs,
+        windowsHide: true,
+      },
+    );
+  } catch (cause) {
+    return { reachable: false, tempC: null, reason: cause.message };
+  }
+  if (result.error || result.status !== 0) {
+    return {
+      reachable: false,
+      tempC: null,
+      reason: result.error?.message || String(result.stderr || 'ssh_offline').trim(),
+    };
+  }
+  return {
+    reachable: true,
+    ...parseNodeHealthOutput(result.stdout),
+    reason: null,
+  };
+}
+
+/**
+ * 按池序探活，出现首个健康节点即停止，避免主节点正常时产生多余 SSH。
+ * 默认单节点最多 4.5 秒，整体截止时间锁死在 10 秒故障转移预算内。
+ */
+export function probeComputeNodes(nodes, options = {}) {
+  const now = options.now || Date.now;
+  const deadline = Number(options.deadline || (now() + NODE_FAILOVER_LIMIT_MS));
+  const healthByNodeId = {};
+  for (const node of nodes) {
+    const remaining = deadline - Number(now());
+    if (remaining <= 0) {
+      healthByNodeId[node.id] = { reachable: false, tempC: null, reason: 'failover_timeout' };
+      continue;
+    }
+    const health = probeNodeHealth(node, {
+      timeoutMs: Math.min(Number(options.nodeTimeoutMs || 4500), remaining),
+    });
+    healthByNodeId[node.id] = health;
+    if (evaluateNode(node, health).available) break;
+  }
+  return healthByNodeId;
+}
+
+/**
+ * 按池序选择第一个健康节点。健康数据缺失时走 online + 无温度的保守路径。
+ * @param {Array<{id: string, host: string, primary: boolean}>} nodes
+ * @param {Record<string, {reachable?: boolean, tempC?: number|null}>} healthByNodeId
+ * @param {number} [now] 可注入时钟，测试用它确认切换耗时
+ */
+export function selectComputeNode(nodes, healthByNodeId = {}, now = Date.now()) {
+  const clock = typeof now === 'function' ? now : () => Number(now);
+  const startedAt = Number(clock());
+  for (const node of nodes) {
+    const evaluated = evaluateNode(node, healthByNodeId[node.id] || {});
+    if (evaluated.available) {
+      return {
+        ...evaluated,
+        elapsedMs: Number(clock()) - startedAt,
+      };
+    }
+  }
+  return null;
+}
+
+/**
+ * 构造一条 failover 动作记录。
+ * @param {{fromNodeId: string, toNodeId: string, reason: string, taskId?: string, now?: number}} params
+ */
+export function buildFailoverAction(params = {}) {
+  const now = Number(params.now || Date.now());
+  const elapsedMs = Number(params.elapsedMs || 0);
+  const timestamp = new Date(now).toISOString();
+  return {
+    id: params.id || `FAN-${now}-${randomUUID().slice(0, 8)}`,
+    ts: timestamp,
+    timestamp,
+    type: 'action',
+    kind: 'failover',
+    task_id: params.taskId || null,
+    from_node_id: params.fromNodeId,
+    to_node_id: params.toNodeId,
+    reason: params.reason,
+    elapsed_ms: elapsedMs,
+    within_10s: elapsedMs <= NODE_FAILOVER_LIMIT_MS,
+  };
+}
+
+/**
+ * 把 failover 动作追加为 JSONL 台账。
+ * @param {string} filePath
+ * @param {object} action
+ */
+export function appendAction(filePath, action) {
+  fs.mkdirSync(path.dirname(filePath), { recursive: true });
+  fs.appendFileSync(filePath, `${JSON.stringify(action)}\n`, 'utf8');
+}
+
+/**
+ * 算力池路由接缝：调用方传入健康快照与真实执行器，task.js 只负责选择与落账。
+ * @param {object} task
+ * @param {{
+ *   nodes?: Array<{id: string, host: string, primary: boolean}>,
+ *   healthByNodeId?: Record<string, object>,
+ *   executor: Function,
+ *   now?: Function,
+ *   actionPath?: string|null,
+ *   logAction?: Function,
+ * }} options
+ */
+export async function routeTask(task, options = {}) {
+  const now = options.now || Date.now;
+  const nodes = options.nodes || parseComputeNodes();
+  const startedAt = Number(now());
+  const healthByNodeId = options.healthByNodeId
+    || (nodes.length === 1
+      ? {}
+      : await (options.healthProbe || probeComputeNodes)(nodes, {
+        now,
+        deadline: startedAt + NODE_FAILOVER_LIMIT_MS,
+      }));
+  const selected = selectComputeNode(nodes, healthByNodeId, now);
+  if (!selected) {
+    throw new Error('算力节点池无可用节点');
+  }
+  const primary = nodes.find((node) => node.primary) || nodes[0];
+  if (selected.id !== primary.id && options.actionPath !== null) {
+    const primaryHealth = healthByNodeId[primary.id] || {};
+    const primaryEvaluation = evaluateNode(primary, primaryHealth);
+    const action = buildFailoverAction({
+      fromNodeId: primary.id,
+      toNodeId: selected.id,
+      reason: primaryEvaluation.reason || 'unavailable',
+      taskId: task.taskId,
+      elapsedMs: Number(now()) - startedAt,
+      now: now(),
+    });
+    if (options.logAction) options.logAction(action);
+    else appendAction(options.actionPath || process.env.BIO_ACTIONS_LEDGER || DEFAULT_ACTION_FILE, action);
+  }
+  const executor = options.executor || (async () => ({ ok: true }));
+  const result = await executor(task, selected);
+  return { ...result, nodeId: selected.id, elapsedMs: selected.elapsedMs };
+}
+
+/**
+ * 把调用方给的步骤标识归一成**母版名**。
+ *
+ * 为什么需要：mod 化后客户端与 pipeline_dag 都用 mod id（l2_tf_scenic），
+ * 而远端 bin/<line>/ 下部署的是母版名（scenic_tf）。下发时若不翻一层，
+ * 会在 bin/ 下找不到文件，任务起不来。
+ * 母版名原样返回（历史调用方与 runner 直跑不受影响）。
+ * @param {string} step mod id 或母版名
+ * @returns {string} 母版名
+ */
+export function resolveStepName(step) {
+  const raw = String(step || '').trim();
+  if (!raw) return raw;
+  // 新命名形态 l<数字>_<工序>_<功能> 才需要翻；母版名（scenic_tf 等）直接返回
+  if (!/^l\d_[a-z][a-z0-9_]*$/.test(raw)) return raw;
+  // modToScriptMap 是 mod id -> 母版名；scriptToModMap 是反的，别拿错
+  return modToScriptMap().get(raw) || raw;
+}
 
 /** 本地母版根：src/<line>/scripts/<step>（src 是母版，远端 bin 是部署产物） */
 const SRC_SCRIPTS_ROOT = process.env.BIOANALYS_SRC_ROOT
   || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
+/** 图模板派生副本读取母版时的仓库根，生产路径随安装位置解析 */
+const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
+const FIGURE_MASTER_ROOT = path.resolve(REPO_ROOT, 'reference', '05.可参考出图代码');
 
 /** 桥接四项断言引擎（aims §一.3 钦定；ops/ 属另一会话域，只调用不修改） */
 export const BRIDGE_ENGINE_REMOTE = '/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py';
+/** 桥接校验必须使用带 anndata 的分析 venv，避免系统 python3 缺包造成假红 */
+export const BRIDGE_PYTHON_REMOTE = '/mnt/ssd/bio_data/ops/layout_autoload/bin/python3';
 
 /** 桥接校验 ssh 同步超时：引擎内部 RDS 分支自带 120s，h5ad 大文件读取留足余量 */
 export const BRIDGE_SSH_TIMEOUT_MS = 300000;
@@ -35,6 +328,13 @@ export const BRIDGE_SSH_TIMEOUT_MS = 300000;
  * target_ko_gene】是给人看的说明文字，随时可能被改文案，拿它当判据会在改文案时静默失效。
  */
 export const KNOCKOUT_STEPS = ['virtual_knockout', 'spatial_knockout'];
+export const LONG_RUNNING_STEPS = ['scenic_tf', 'virtual_knockout'];
+
+export function isLongRunningStep(step) {
+  const raw = String(step || '').trim();
+  const resolved = resolveStepName(step);
+  return LONG_RUNNING_STEPS.includes(resolved) || raw === 'l2_ko_scrna';
+}
 
 /**
  * 靶基因符号的合法形态：首字符必须是字母或数字，其余为字母数字与 . _ -，总长 1..32。
@@ -63,8 +363,8 @@ export class BridgeCheckError extends Error {
   }
 }
 
-/** 命令位的 Rscript 调用（行首或分隔符后；`BIOANALYS_SEED=x Rscript`、`["Rscript"` 也算） */
-const RSCRIPT_CALL_RE = /(^|[\s;&|"])Rscript(?=[\s"']|$)/;
+/** 命令位的 Rscript 或显式 shim 变量调用（行首或分隔符后） */
+const RSCRIPT_CALL_RE = /(^|[\s;&|"])(?:\$RSCRIPT_BIN|\$\{RSCRIPT_BIN\}|Rscript)(?=[\s"']|$)/;
 /** 命令位的 python/python3 调用（heredoc 首行 `python3 - <<'PYSCRIPT'` 即此形态） */
 const PYTHON_CALL_RE = /(^|[\s;&|])python3?(?=[\s"']|$)/;
 /** 母版内部是否调用了桥接守卫（src/bridge_guard.sh，task-10） */
@@ -170,7 +470,7 @@ export function needsBridgeCheck(lineId, stepName) {
  * 构造桥接四项断言的远端执行命令。
  *
  * 引擎 CLI 契约（ops/verify_bridge_checkpoint.py）要求 --input 指向一个真实存在的
- * .h5ad/.rds 文件，因此 inputs 必须参与构造:提交层拿到的就是本次任务声明的输入，
+ * .h5ad/.rds 文件，因此 inputs 必须参与构造：提交层拿到的就是本次任务声明的输入，
  * 不是编造：取第一个 .h5ad/.rds 输入；相对路径按该项目该线 processed/ 解析。
  * --from/--to 按引擎自身语义定：check_h5ad 用 anndata（Python 产物）、check_rds 用 R（R 产物）。
  *
@@ -206,7 +506,7 @@ export function buildBridgeCheckCommand(lineId, stepName, { inputs = [], project
   // ssh 回传的 stderr 通道会间歇性丢失，导致提交层 400 error 里点不了断言项。
   // 把 stderr 并入 stdout 单通道后，[BRIDGE FAIL]/[BRIDGE OK] 一律走 stdout 稳定回传；
   // shellQuote 对 --input 的单引号转义不变，命令结构其余不变。
-  const remoteScript = `python3 ${BRIDGE_ENGINE_REMOTE} --input ${shellQuote(inputPath)} --from ${fromLang} --to ${toLang} 2>&1`;
+  const remoteScript = `${BRIDGE_PYTHON_REMOTE} ${BRIDGE_ENGINE_REMOTE} --input ${shellQuote(inputPath)} --from ${fromLang} --to ${toLang} 2>&1`;
   return { command: remoteScript, remoteScript, inputFile: inputPath, fromLang, toLang, reason: null };
 }
 
@@ -245,6 +545,138 @@ function shellQuote(text) {
   return `'${String(text).replace(/'/g, String.raw`'\''`)}'`;
 }
 
+/** 图模板派生副本的固定文件名，模板 id 已是安全段，不在这里重建命名规则 */
+function adaptFileName(template) {
+  const extension = template.language === 'python' ? '.py' : '.R';
+  return `adapt_${template.id}${extension}`;
+}
+
+/** 本地项目根可由测试重定向；生产默认仍是仓库 local_projects/ */
+export function localAdaptPath(root = process.env.BIO_LOCAL_PROJECTS || REPO_ROOT, projectId, templateId, language = 'r') {
+  const safeProject = sanitizeProjectId(projectId);
+  if (!safeProject) throw new Error(`project_id 非法: ${projectId}`);
+  return path.resolve(
+    String(root),
+    'local_projects',
+    safeProject,
+    'figures',
+    'adapt',
+    adaptFileName({ id: templateId, language }),
+  );
+}
+
+function adaptManifestPath(root = process.env.BIO_LOCAL_PROJECTS || REPO_ROOT, projectId) {
+  const safeProject = sanitizeProjectId(projectId);
+  if (!safeProject) throw new Error(`project_id 非法: ${projectId}`);
+  return path.resolve(String(root), 'local_projects', safeProject, 'figures', 'adapt', 'manifest.json');
+}
+
+function readManifest(manifestFile) {
+  try {
+    const parsed = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
+    return Array.isArray(parsed) ? parsed : [];
+  } catch {
+    return [];
+  }
+}
+
+/**
+ * 复制 ready 母版并生成项目私有适配副本。
+ *
+ * 母版只读，头部带回 Master-Source 与 Master-SHA256；adapt_vars 写成语言级
+ * ADAPT_VARS 声明，不修改 source 的可执行逻辑。manifest 是后续交付对账的窄接口。
+ */
+export function deriveAdaptedFigure({
+  root = process.env.BIO_LOCAL_PROJECTS || REPO_ROOT,
+  projectId,
+  lineId,
+  templateId,
+  template,
+  adaptVars = {},
+}) {
+  const errors = [];
+  const safeProject = sanitizeProjectId(projectId);
+  if (!safeProject) errors.push(`project_id 非法: ${projectId}`);
+  if (!LINES.includes(lineId)) errors.push(`line_id 非法: ${lineId}`);
+  if (template?.id !== templateId || typeof template?.source !== 'string') {
+    errors.push(`templateId 与 template 不匹配: ${templateId}`);
+  }
+  if (template?.deps_status !== 'ready' || template?.verified !== true) {
+    errors.push(`图模板 ${templateId} 不是 ready 状态`);
+  }
+  if (errors.length > 0) return { ok: false, errors, template: null, local_path: null };
+
+  const master = path.resolve(REPO_ROOT, template.source);
+  const masterRelative = path.relative(FIGURE_MASTER_ROOT, master);
+  if (!masterRelative || masterRelative === '..' || masterRelative.startsWith(`..${path.sep}`)
+    || path.isAbsolute(masterRelative)) {
+    errors.push('模板 source 不在仓库 reference/05. 内');
+    return { ok: false, errors, template, local_path: null };
+  }
+  if (!fs.existsSync(master)) {
+    return { ok: false, errors: [`母版不存在: ${template.source}`], template, local_path: null };
+  }
+  const masterBytes = fs.readFileSync(master);
+  const masterSha = createHash('sha256').update(masterBytes).digest('hex');
+  if (template.source_sha256 !== masterSha) {
+    return { ok: false, errors: [`母版 SHA256 漂移: ${templateId}`], template, local_path: null };
+  }
+
+  const safeLine = LINES.includes(lineId) ? lineId : null;
+  const adaptDir = path.resolve(String(root), 'local_projects', safeProject, 'figures', 'adapt');
+  fs.mkdirSync(adaptDir, { recursive: true });
+  const localPath = path.join(adaptDir, adaptFileName(template));
+  let adapted;
+  try {
+    adapted = buildAdaptedFigureSource({
+      template: { ...template, source_sha256: masterSha },
+      masterSource: masterBytes.toString('utf8'),
+      inputPath: adaptVars.input_data,
+      projectId: safeProject,
+      lineId: safeLine,
+      adaptVars,
+    });
+  } catch (cause) {
+    return {
+      ok: false,
+      errors: [cause instanceof Error ? cause.message : String(cause)],
+      template,
+      local_path: null,
+    };
+  }
+  const header = adapted.split('\n')[0];
+  fs.writeFileSync(localPath, adapted, 'utf8');
+
+  const manifestFile = adaptManifestPath(root, safeProject);
+  const entries = readManifest(manifestFile).filter((item) => item.template_id !== templateId);
+  const entry = {
+    template_id: templateId,
+    project_id: safeProject,
+    line_id: safeLine,
+    master_source: template.source,
+    master_sha256: masterSha,
+    derived_sha256: createHash('sha256').update(fs.readFileSync(localPath)).digest('hex'),
+    adapt_vars: adaptVars,
+    local_path: path.resolve(localPath),
+    remote_path: `/mnt/ssd/bio_data/projects/${safeProject}/${safeLine}/scripts/${adaptFileName(template)}`,
+  };
+  entries.push(entry);
+  fs.writeFileSync(manifestFile, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
+  return {
+    ok: true,
+    errors: [],
+    template,
+    selected_template: template.id,
+    adapt_vars: adaptVars,
+    local_path: localPath,
+    remote_path: entry.remote_path,
+    adapt_header: header,
+    master_sha256: masterSha,
+    manifest_path: manifestFile,
+    manifest_entry: entry,
+  };
+}
+
 /**
  * 生成远端执行脚本。
  *
@@ -254,19 +686,28 @@ function shellQuote(text) {
  * bin 全局一份，所有项目共用（代码本体不随项目复制）。
  * 没有这一行，服务器上找不到命令，一切 step 都是 command not found。
  *
- * @param {{projectId?: string, lineId: string, step: string, inputs: string[], outputs: string[], seed?: number, throttled?: boolean, targetKoGene?: string}} task
+ * @param {{projectId?: string, lineId: string, step: string, inputs: string[], outputs: string[], seed?: number, throttled?: boolean, targetKoGene?: string, detached?: boolean, wrapperTaskId?: string}} task
  * @returns {string}
  */
 export function buildTaskScript(task) {
   const {
     projectId = DEFAULT_PROJECT, lineId, step, inputs = [], outputs = [], seed, throttled = false,
-    targetKoGene,
+    targetKoGene, detached = false, wrapperTaskId = '', scriptPath = '', language = '',
+    canonicalOutput = '', adapted = false,
   } = task;
   if (!LINES.includes(lineId)) {
     throw new Error(`line_id 非法: ${lineId}`);
   }
+  // mod id -> 母版名。调用方（客户端 / pipeline_dag）可能给 l2_tf_scenic，
+  // 而远端 bin/<line>/ 与本地 src/<line>/scripts/ 都是母版名。这里统一翻一层，
+  // 下游所有使用点（母版路径、bin 路径、wrapper 参数）就都拿到母版名了。
+  const stepName = resolveStepName(step);
+  if (!stepName) {
+    throw new Error('step 不能为空');
+  }
 
   const lineDir = projectLineDir(projectId, lineId);
+  const outputList = Array.isArray(outputs) ? outputs : [];
   const lines = [
     '#!/usr/bin/env bash',
     'set -euo pipefail',
@@ -288,7 +729,7 @@ export function buildTaskScript(task) {
   // 非敲除步骤即使传了 targetKoGene 也不注入：一张表（requiresKoGene）管到底，语义是"忽略"。
   // 缺基因就抛错而不是退回 TNF 兜底：母版兜底只用于直连 K40 手工跑（stderr 留痕），
   // 提交层是唯一全知"这次敲的是谁"的地方，静默跑 TNF 会产出与用户预期不符的结论。
-  if (requiresKoGene(step)) {
+  if (requiresKoGene(stepName)) {
     if (!isValidKoGene(targetKoGene)) {
       throw new Error(
         `虚拟敲除步骤必须指定合法 target_ko_gene（字母数字与 . _ -，长度 1..32）: ${JSON.stringify(targetKoGene ?? null)}`
@@ -316,34 +757,80 @@ export function buildTaskScript(task) {
   // inputs/outputs 必须是数组；调用方传了裸字符串时归一化为空数组而不是抛 TypeError
   // （TypeError 会顺着事件回调打死整个 Node 进程，2026-10-19 实测踩到）。
   const inputList = Array.isArray(inputs) ? inputs : [];
-  const outputList = Array.isArray(outputs) ? outputs : [];
   const inputArgs = inputList.map((path) => `--input ${shellQuote(path)}`).join(' ');
   const outputArgs = outputList.map((path) => `--output ${shellQuote(path)}`).join(' ');
   const seedArgs = seed === undefined || seed === null ? '' : `--seed ${Number(seed)}`;
 
   // 构建原始 step 命令
-  const rawCmd = [
-    shellQuote(step),
-    inputArgs,
-    outputArgs,
-    seedArgs,
-  ].filter(Boolean).join(' ');
+  let rawCmd;
+  let gatePath = `${binDir(lineId)}/${stepName}`;
+  if (adapted) {
+    const adaptedScript = String(scriptPath || '');
+    const expectedPrefix = `/mnt/ssd/bio_data/projects/${projectId}/${lineId}/scripts/adapt_`;
+    if (!adaptedScript.startsWith(expectedPrefix) || !/\.(R|py)$/.test(adaptedScript)) {
+      throw new Error(`adapted scriptPath 非法: ${adaptedScript}`);
+    }
+    if (!canonicalOutput || outputList.length !== 1) {
+      throw new Error('adapted 任务必须提供一个 canonicalOutput 和一个 output');
+    }
+    const scriptDir = path.posix.dirname(adaptedScript);
+    const outputPath = outputList[0];
+    const candidates = [path.posix.join(scriptDir, canonicalOutput)];
+    if (!canonicalOutput.startsWith('figures/')) {
+      candidates.push(path.posix.join(scriptDir, 'figures', canonicalOutput));
+    }
+    const runner = language === 'python'
+      ? `python3 ${shellQuote(adaptedScript)}`
+      : `Rscript --vanilla ${shellQuote(adaptedScript)}`;
+    const copyBranches = candidates.map((candidate, index) => {
+      const prefix = index === 0 ? 'if' : 'elif';
+      return `${prefix} [ -f ${shellQuote(candidate)} ]; then cp ${shellQuote(candidate)} ${shellQuote(outputPath)};`;
+    }).join(' ');
+    rawCmd = [
+      `cd ${shellQuote(scriptDir)}`,
+      `mkdir -p ${shellQuote(path.posix.dirname(outputPath))}`,
+      `rm -f ${shellQuote(outputPath)}`,
+      runner,
+      `${copyBranches} else echo ${shellQuote(`adapted output missing: ${canonicalOutput}`)} >&2; exit 1; fi`,
+    ].join(' && ');
+    gatePath = adaptedScript;
+  } else {
+    rawCmd = [
+      shellQuote(stepName),
+      inputArgs,
+      outputArgs,
+      seedArgs,
+    ].filter(Boolean).join(' ');
+  }
 
   if (throttled) {
     // 走 ops/run_throttled_task.sh：nice/ionice 降权 + 存储水位与跨线门禁 + 线程封顶（aims §六.3）。
     // 用**命令串模式**（BIO_EXEC_CMD），$5 只给门禁做跨线静态扫描，传母版绝对路径。
-    // 2026-10-21 之前这里把整条 rawCmd 当 $5 传，包装器随后执行 "$SCRIPT_PATH" : 那是一个
+    // 2026-10-21 之前这里把整条 rawCmd 当 $5 传，包装器随后执行 "$SCRIPT_PATH"：那是一个
     // 含空格的文件名，必然 ENOENT，所以 throttled 分支长期不可用，引擎（run.js）只能
     // throttled=false 绕过包装器直跑，降权/门禁/线程封顶对工作台下发的任务全部失效（D-21）。
-    const wrapperTaskId = `task_$(date +%s)_${Math.random().toString(36).slice(2, 8)}`;
+    const resolvedWrapperTaskId = wrapperTaskId
+      || `task_$(date +%s)_${Math.random().toString(36).slice(2, 8)}`;
+    if (detached && !/^[A-Za-z0-9._-]+$/.test(resolvedWrapperTaskId)) {
+      throw new Error(`wrapperTaskId 非法: ${resolvedWrapperTaskId}`);
+    }
     // 命令串要整串再套一层单引号：里面本来就含 '--input' 这类单引号，shellQuote 负责 ''' 转义
     lines.push(`export BIO_EXEC_CMD=${shellQuote(rawCmd)}`);
     // 引擎自己有权威台账（server/run.js persistEntry，字段含 project_id/seed），
     // 包装器再写一份精简台账就成了双账，故关掉包装器台账（D-21）
-    lines.push('export BIO_WRAPPER_LEDGER=0');
-    lines.push(
-      `bash /mnt/ssd/bio_data/ops/run_throttled_task.sh ${wrapperTaskId} ${lineId} ${shellQuote(step)} self ${shellQuote(`${binDir(lineId)}/${step}`)}`
-    );
+    lines.push(`export BIO_WRAPPER_LEDGER=${detached ? '1' : '0'}`);
+    if (detached) {
+      lines.push(`export BIO_WRAPPER_LEDGER_PATH="/tmp/${resolvedWrapperTaskId}_ledger.json"`);
+    }
+    const wrapperCommand = `bash /mnt/ssd/bio_data/ops/run_throttled_task.sh ${resolvedWrapperTaskId} ${lineId} ${shellQuote(stepName)} self ${shellQuote(gatePath)}`;
+    if (detached) {
+      lines.push(
+        `setsid nohup ${wrapperCommand} > ${SYSTEM_LOGS}/${resolvedWrapperTaskId}.wrapper.log 2>&1 < /dev/null &`,
+      );
+      lines.push(`echo ${shellQuote(resolvedWrapperTaskId)}`);
+    } else {
+      lines.push(wrapperCommand);
+    }
   } else {
     lines.push(rawCmd);
   }
@@ -375,7 +862,7 @@ export function buildLedgerEntry(params) {
     startedAt,
     endedAt,
     language = 'R',
-    version = '4.3.3',
+    version = '4.5.3',
     envName = `${lineId}_env`,
     containerImage = 'proot-ubuntu24.04-aarch64',
   } = params;
@@ -383,6 +870,13 @@ export function buildLedgerEntry(params) {
   if (!LINES.includes(lineId)) {
     throw new Error(`line_id 非法: ${lineId}`);
   }
+  // step_name 一律记母版名：61 条历史台账都是母版名，混用会让台账巡检与审计失配。
+  // 调用方传的是 mod id 时，额外记一个 mod_id 字段保留客户视角追溯。
+  const stepName = resolveStepName(step);
+  const modId = /^l\d_[a-z][a-z0-9_]*$/.test(String(step || '').trim())
+    ? String(step).trim()
+    // 键必须带 lineId：enrichment_figures 等母版名跨线同名，不带线会反查错线
+    : (scriptToModMap(lineId).get(`${lineId}:${stepName}`) || null);
   if (!sanitizeProjectId(projectId)) {
     throw new Error(`project_id 非法: ${projectId}`);
   }
@@ -395,7 +889,10 @@ export function buildLedgerEntry(params) {
     task_id: randomUUID(),
     project_id: projectId,
     line_id: lineId,
-    step_name: step,
+    step_name: stepName,
+    // 客户视角的 mod id（母版名调用时为 null）。双列并存：
+    // 台账巡检与历史对账认 step_name，客户报告与组合追溯认 mod_id。
+    mod_id: modId,
     status,
     start_time: startedAt || new Date().toISOString(),
     end_time: endedAt || new Date().toISOString(),
diff --git a/BioanalysDesktop/server/workflow_graph.js b/BioanalysDesktop/server/workflow_graph.js
new file mode 100644
index 0000000..f209ecd
--- /dev/null
+++ b/BioanalysDesktop/server/workflow_graph.js
@@ -0,0 +1,370 @@
+/**
+ * workflow_graph.js : mod 注册表的加载、校验与组合合法性判定。
+ *
+ * 单一事实源：`src/workflows.json`。客户端（portal）、服务台（BioanalysDesktop）、
+ 取证 runner（cn_debug/lib/chain_runner.mjs）三方共读同一份，避免依赖关系三处漂移。
+ *
+ * 校验的四类硬错误（任一不过即拒绝该组合）：
+ *   1. 悬空依赖：requires 引用了任何 mod 都不产生的产物；
+ *   2. 跨线泄漏：requires 引用了别的 series 才产生的产物（aims 铁律二）；
+ *   3. 阶段倒挂：选中的 mod 的 stage order 比它依赖的 mod 更小；
+ *   4. 母版缺失：mod id 在 src/<line>/scripts/ 下没有对应文件。
+ *
+ * 成本预估（est_minutes / peak_mem_mb）用于组合前拦截：超出 K40 7.5G 内存配额
+ * 或总时长超上限时拒绝，而不是等远端跑爆。
+ */
+
+import fs from 'node:fs';
+import path from 'node:path';
+import { fileURLToPath } from 'node:url';
+
+const HERE = path.dirname(fileURLToPath(import.meta.url));
+const REPO = path.resolve(HERE, '..', '..');
+const REGISTRY = path.join(REPO, 'src', 'workflows.json');
+
+let cache = null;
+
+/** 读注册表（带缓存；测试用 reloadWorkflows() 强制重读）。 */
+export function loadWorkflows() {
+  if (cache) return cache;
+  const raw = fs.readFileSync(REGISTRY, 'utf8');
+  cache = JSON.parse(raw);
+  return cache;
+}
+
+/** 测试用：清缓存。 */
+export function reloadWorkflows() {
+  cache = null;
+  return loadWorkflows();
+}
+
+/** 扁平化：modId -> {mod, seriesId, stage}。 */
+export function indexMods() {
+  const wf = loadWorkflows();
+  const out = new Map();
+  for (const series of wf.series) {
+    for (const stage of series.stages) {
+      for (const mod of stage.mods) {
+        // key 必须带 series 前缀：三条线有同名 mod（normalize_hvg / enrichment /
+        // enrichment_figures / dr_post_analysis），只用 modId 会让后加载的线覆盖前一条。
+        out.set(`${series.id}:${mod.id}`, { mod, series, stage });
+      }
+    }
+  }
+  return out;
+}
+
+/** 产物名 -> 生产它的 modId 列表（一对多：同一产物可能由多个 mod 产生）。 */
+export function indexProducers() {
+  const idx = indexMods();
+  const out = new Map();
+  for (const [key, entry] of idx) {
+    for (const p of entry.mod.produces || []) {
+      if (!out.has(p)) out.set(p, []);
+      // 存 series 限定的 key，避免 line2 的产物被 line3 同名 mod 冒名
+      out.get(p).push(key);
+    }
+  }
+  return out;
+}
+
+/**
+ * 全量静态校验。返回 {ok, errors, stats}。
+ * errors 里每条都带 series/mod 定位，便于直接跳到 workflows.json 对应行修。
+ */
+export function validateRegistry() {
+  const wf = loadWorkflows();
+  const errors = [];
+  if (wf.manifest_version !== 2) {
+    errors.push(`manifest_version 必须为 2，实际 ${wf.manifest_version}`);
+  }
+  if (wf.manifest_kind !== 'workspace_module_registry') {
+    errors.push(`manifest_kind 必须为 workspace_module_registry，实际 ${wf.manifest_kind}`);
+  }
+  const producers = indexProducers();
+  const seriesIds = new Set(wf.series.map((s) => s.id));
+
+  for (const series of wf.series) {
+    if (!seriesIds.has(series.id)) errors.push(`series id 重复: ${series.id}`);
+    const orders = series.stages.map((s) => s.order);
+    if (new Set(orders).size !== orders.length) {
+      errors.push(`${series.id}: stage order 有重复 ${orders.join(',')}`);
+    }
+    for (const stage of series.stages) {
+      for (const mod of stage.mods) {
+        const where = `${series.id}/${stage.id}/${mod.id}`;
+        // 母版必须真实存在。mod.id 是注册表命名（<系列>_<工序>_<功能>），
+        // 与磁盘上的母版文件名不同:母版名走 mod.script，两者不能混。
+        const scriptName = mod.script || mod.id;
+        const scriptPath = path.join(REPO, 'src', series.id, 'scripts', scriptName);
+        if (!fs.existsSync(scriptPath)) {
+          errors.push(`${where}: 母版缺失 src/${series.id}/scripts/${scriptName}`);
+        }
+        // requires 不得为空
+        if (!mod.requires || mod.requires.length === 0) {
+          errors.push(`${where}: requires 为空（每个 mod 都必须声明输入）`);
+        }
+        // produces 不得为空
+        if (!mod.produces || mod.produces.length === 0) {
+          errors.push(`${where}: produces 为空（每个 mod 都必须声明产物）`);
+        }
+        // 悬空依赖 / 跨线泄漏
+        for (const req of mod.requires || []) {
+          // 原始输入（非别的 mod 产物）用白名单放过
+          if (RAW_INPUTS.has(req)) continue;
+          const who = producers.get(req);
+          if (!who) {
+            errors.push(`${where}: 悬空依赖，产物 '${req}' 无人生产`);
+            continue;
+          }
+          const foreign = who.filter((p) => !sameSeries(p, series.id));
+          if (foreign.length) {
+            errors.push(`${where}: 跨线泄漏，'${req}' 由 ${foreign.join(',')} 生产（aims 铁律二）`);
+          }
+        }
+        // after 必须指向同线且 order 更小的 mod
+        for (const dep of mod.after || []) {
+          const target = indexMods().get(`${series.id}:${dep}`);
+          if (!target) {
+            errors.push(`${where}: after 指向不存在的 mod '${dep}'`);
+          } else if (target.series.id !== series.id) {
+            errors.push(`${where}: after 跨线指向 ${dep}`);
+          }
+        }
+        // ko_gene 声明必须与全局约束一致
+        if (mod.ko_gene && !wf.constraints.ko_gene_required_mods.includes(mod.id)) {
+          errors.push(`${where}: 声明了 ko_gene 但没进 constraints.ko_gene_required_mods`);
+        }
+        // 命名规则：<系列短名>_<工序>_<功能名>，防三条线同名撞车
+        // line1_bulk -> l1、line2_scrna -> l2、line3_spatial -> l3
+        const prefix = `l${series.id.replace(/\D/g, '')}`;
+        if (!mod.id.startsWith(`${prefix}_`)) {
+          errors.push(`${where}: id 必须以 ${prefix}_ 开头（系列+工序+功能名），实际 ${mod.id}`);
+        }
+        if (!/^l\d_[a-z][a-z0-9_]*$/.test(mod.id)) {
+          errors.push(`${where}: id 不符合 <系列>_<工序>_<功能> 小写下划线命名，实际 ${mod.id}`);
+        }
+        // script 必须显式声明，且不得与 id 相同（相同说明忘了建映射，母版会找不到）
+        if (!mod.script) {
+          errors.push(`${where}: 缺 script 字段（母版文件名）`);
+        } else if (mod.script === mod.id) {
+          errors.push(`${where}: script 与 id 相同（${mod.id}），母版名应保持磁盘原名`);
+        }
+      }
+    }
+  }
+
+  const totalMods = [...indexMods().keys()].length;
+  return { ok: errors.length === 0, errors, stats: { series: wf.series.length, mods: totalMods } };
+}
+
+/** 原始输入白名单：这些是客户在表单里给的，不是上游 mod 的产物。 */
+const RAW_INPUTS = new Set([
+  'series_matrix', 'gpl', 'gpl_soft', 'gpl_soft_mouse', 'gpl_soft_human',
+  'grouping.txt', 'raw_tar', 'processed', 'survival_data',
+]);
+
+function sameSeries(modId, seriesId) {
+  // modId 可能是裸 modId，也可能是 series 限定的 key；两种都认
+  const entry = indexMods().get(modId.includes(':') ? modId : `${seriesId}:${modId}`);
+  return entry && entry.series.id === seriesId;
+}
+
+/**
+ * 组合合法性判定。给定 seriesId 与勾选的 modId 列表，返回
+ * {ok, errors, ordered, estMinutes, peakMemMb}。
+ * ordered 是拓扑排序后的执行序（stage order 优先，同 stage 内保持声明序）。
+ */
+export function resolvePlan(seriesId, selectedIds, opts = {}) {
+  const wf = loadWorkflows();
+  const errors = [];
+  const series = wf.series.find((s) => s.id === seriesId);
+  if (!series) return { ok: false, errors: [`未知系列 ${seriesId}`], ordered: [], estMinutes: 0, peakMemMb: 0 };
+
+  const idx = indexMods();
+  // selected 内部统一存 series 限定的 key（与 indexProducers 的 key 同构）；
+  // 对外（入参 selectedIds、出参 ordered）用裸 modId，客户端不该感知 series 前缀。
+  const selected = new Set();
+  for (const id of selectedIds) {
+    // 先用调用方给的 series 查；查不到再全局查，这样才能报出「属于哪条线」
+    // 而不是含糊的「未知 mod」（跨线选中是最该说清的一种错）。
+    let entry = idx.get(`${seriesId}:${id}`);
+    if (!entry) {
+      for (const s of loadWorkflows().series) {
+        const hit = idx.get(`${s.id}:${id}`);
+        if (hit) { entry = hit; break; }
+      }
+    }
+    if (!entry) {
+      errors.push(`未知 mod '${id}'`);
+      continue;
+    }
+    if (entry.series.id !== seriesId) {
+      errors.push(`跨线选中：'${id}' 属于 ${entry.series.id}，不是 ${seriesId}`);
+      continue;
+    }
+    selected.add(`${seriesId}:${id}`);
+  }
+
+  // 必经 stage 的 mod 必须全选
+  for (const stage of series.stages) {
+    if (!stage.required) continue;
+    for (const mod of stage.mods) {
+      // stage 必经不等于其中每个 mod 都必经：mod 自身标 optional=true 的可跳过
+      if (mod.optional) continue;
+      if (!selected.has(`${seriesId}:${mod.id}`)) {
+        errors.push(`必经阶段 ${stage.id} 缺少 mod '${mod.id}'`);
+      }
+    }
+  }
+
+  // 依赖闭合：选中的 mod 的 requires（非原始输入）必须有生产者也被选中
+  const producers = indexProducers();
+  for (const id of selected) {
+    const entry = idx.get(id);
+    const bare = id.slice(seriesId.length + 1);
+    for (const req of entry.mod.requires || []) {
+      if (RAW_INPUTS.has(req)) continue;
+      const who = (producers.get(req) || []).filter((p) => sameSeries(p, seriesId));
+      if (!who.some((p) => selected.has(p))) {
+        errors.push(`${bare} 依赖 '${req}'，但生产者 [${who.map((k) => k.slice(seriesId.length + 1)).join(',') || '无'}] 未选中`);
+      }
+    }
+    for (const dep of entry.mod.after || []) {
+      if (!selected.has(`${seriesId}:${dep}`)) errors.push(`${bare} 声明 after '${dep}' 但未选中`);
+    }
+  }
+
+  // 拓扑排序
+  const ordered = [];
+  const visited = new Set();
+  const visiting = new Set();
+  const visit = (id) => {
+    if (visited.has(id)) return;
+    if (visiting.has(id)) {
+      errors.push(`依赖成环：${id.slice(seriesId.length + 1)}`);
+      return;
+    }
+    visiting.add(id);
+    const entry = idx.get(id);
+    for (const req of entry.mod.requires || []) {
+      if (RAW_INPUTS.has(req)) continue;
+      for (const p of producers.get(req) || []) {
+        if (sameSeries(p, seriesId) && selected.has(p)) visit(p);
+      }
+    }
+    for (const dep of entry.mod.after || []) {
+      if (selected.has(`${seriesId}:${dep}`)) visit(`${seriesId}:${dep}`);
+    }
+    visiting.delete(id);
+    visited.add(id);
+    ordered.push(id);
+  };
+  for (const stage of [...series.stages].sort((a, b) => a.order - b.order)) {
+    for (const mod of stage.mods) {
+      if (selected.has(`${seriesId}:${mod.id}`)) visit(`${seriesId}:${mod.id}`);
+    }
+  }
+
+  // 对外吐裸 modId，客户端不感知 series 前缀
+  const orderedBare = ordered.map((k) => k.slice(seriesId.length + 1));
+
+  let estMinutes = 0;
+  let peakMemMb = 0;
+  for (const id of ordered) {
+    const m = idx.get(id).mod;
+    estMinutes += m.est_minutes || 0;
+    peakMemMb = Math.max(peakMemMb, m.peak_mem_mb || 0);
+  }
+
+  const quota = wf.constraints.mem_quota_mb;
+  if (peakMemMb > quota) {
+    errors.push(`峰值内存 ${peakMemMb}MB 超出 K40 配额 ${quota}MB`);
+  }
+
+  // 敲除类 mod 必须带靶基因：母版在参数解析处就会 exit 2，不预先拦就是白跑一次远端执行
+  const koGene = (opts.koGene || '').trim();
+  if (!koGene) {
+    for (const key of selected) {
+      const entry = idx.get(key);
+      if (entry && entry.mod.ko_gene) {
+        errors.push(`${key.slice(seriesId.length + 1)} 需要靶基因（--ko-gene），但未提供`);
+      }
+    }
+  }
+
+  return { ok: errors.length === 0, errors, ordered: orderedBare, estMinutes, peakMemMb };
+}
+
+/**
+ * mod id -> 母版名。
+ *
+ * 为什么需要：pipelineDag 的 stepId 历史上存的是母版名，mod 化后的客户端传的是
+ * mod id（l2_tf_scenic）。lineFromPipeline 之类的推断逻辑按母版名比对，
+ * 不翻一层就会全部失配。服务台侧就近取这份映射，不 import cn_debug 的取证库。
+ */
+export function modToScriptMap() {
+  const out = new Map();
+  for (const series of loadWorkflows().series) {
+    for (const stage of series.stages) {
+      for (const mod of stage.mods) out.set(mod.id, mod.script || mod.id);
+    }
+  }
+  return out;
+}
+
+/**
+ * 母版名 -> mod id（反查）。
+ *
+ * 键必须是 `<lineId>:<母版名>`：enrichment_figures / normalize_hvg / enrichment /
+ * dr_post_analysis 在两条以上线同名（磁盘上分属不同目录），只用母版名做 key 会让
+ * 后加载的线覆盖前一条，line1 的 l1_enrich_figures 永远反查不到
+ * （2026-10-23 被 step_name_resolve 测试抓到的真实缺陷）。
+ */
+export function scriptToModMap(lineId) {
+  const out = new Map();
+  for (const series of loadWorkflows().series) {
+    if (lineId && series.id !== lineId) continue;
+    for (const stage of series.stages) {
+      for (const mod of stage.mods) {
+        out.set(`${series.id}:${mod.script || mod.id}`, mod.id);
+      }
+    }
+  }
+  return out;
+}
+
+/** 客户端用：某系列的全部 stage 与 mod（含勾选态由调用方算）。 */
+export function describeSeries(seriesId) {
+  const wf = loadWorkflows();
+  const series = wf.series.find((s) => s.id === seriesId);
+  if (!series) return null;
+  return {
+    id: series.id,
+    name: series.name,
+    data_form: series.data_form,
+    language_profile: series.language_profile,
+    seed: series.seed,
+    stages: [...series.stages]
+      .sort((a, b) => a.order - b.order)
+      .map((s) => ({
+        id: s.id,
+        name: s.name,
+        order: s.order,
+        required: !!s.required,
+        notes: s.notes || '',
+        mods: s.mods.map((m) => ({
+          id: m.id,
+          script: m.script || m.id,
+          name: m.name,
+          language: m.language,
+          est_minutes: m.est_minutes,
+          peak_mem_mb: m.peak_mem_mb,
+          optional: !!m.optional,
+          ko_gene: !!m.ko_gene,
+          risk: m.risk || '',
+          notes: m.notes || '',
+        })),
+      })),
+  };
+}
diff --git a/ops/serve_guard.ps1 b/ops/serve_guard.ps1
index 9a5c43e..db39c55 100644
--- a/ops/serve_guard.ps1
+++ b/ops/serve_guard.ps1
@@ -1,11 +1,11 @@
 <#
-常驻守护：保持 工作台(8787) / 用户端(8080) / frpc 三个进程在跑。
+常驻守护：保持 工作台(18787) / 用户端(8080) / frpc 三个进程在跑。
 
 设计口径：
   - 只做运行时守护，不注册开机自启、不写启动项、不建计划任务。需要时手动启动本脚本。
   - 每轮按端口/进程探测：HTTP 探活失败才重启，活着的一律不碰（不打断在跑的分析任务）。
   - 工作台默认**不启用**口令（只在本机用，浏览器不该每次弹登录框）。
-    仅当用 -RequireAuth 启动、或 frpc 里把 8787 映射到公网时，才带口令运行；
+    仅当用 -RequireAuth 启动、或 frpc 里把 18787 映射到公网时，才带口令运行；
     口令来自用户主目录的 workbench_auth.json，脚本首次需要时自动生成，
     不进源码、不进仓库、不写日志。
   - 日志追加到 cn_debug/serve_guard.log。
@@ -19,6 +19,7 @@
 param(
   [switch]$Once,
   [switch]$RequireAuth,
+  [switch]$DryRun,
   [int]$IntervalSec = 30
 )
 
@@ -60,6 +61,7 @@ $workbenchDir = Join-Path $root 'BioanalysDesktop'
 $frpcDir = 'C:\Users\18765\Desktop\旅游攻略\frp_0.69.1_windows_amd64\frp_0.69.1_windows_amd64'
 $frpcExe = Join-Path $frpcDir 'frpc.exe'
 $authFile = Join-Path $env:USERPROFILE '.bioanalys\workbench_auth.json'
+$syncDaemon = Join-Path $root 'ops\sync_daemon.ps1'
 
 function Get-WorkbenchAuth {
   if (Test-Path $authFile) {
@@ -90,36 +92,74 @@ function Test-HttpOk([string]$Url) {
 # 用来识别「被人手动/别的脚本免密拉起」的工作台实例，这种实例不能留在公网端口上。
 function Test-AuthEnforced {
   try {
-    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/api/projects/list' -UseBasicParsing -TimeoutSec 5
+    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:18787/api/projects/list' -UseBasicParsing -TimeoutSec 5
     return $response.StatusCode -eq 401
   } catch {
     return $_.Exception.Response.StatusCode.value__ -eq 401
   }
 }
 
-# 按端口占用者杀进程，比按命令行匹配可靠（命令行里正反斜杠、参数写法都可能不同）
-function Stop-PortOwner([int]$Port) {
-  $owners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
-    Select-Object -ExpandProperty OwningProcess -Unique
-  foreach ($ownerPid in $owners) {
-    if (-not $ownerPid) { continue }
+# 端口预检返回 JSON 与专用退出码。只有命令行匹配本项目 Node 服务时才允许停止占用者。
+function Get-PortPreflight([int]$Port, [string]$ExpectedPattern) {
+  $preflightScript = Join-Path $PSScriptRoot 'port_preflight.ps1'
+  $output = & pwsh -NoProfile -File $preflightScript `
+    -Port $Port `
+    -ExpectedPattern $ExpectedPattern
+  $exitCode = $LASTEXITCODE
+  $details = $null
+  try {
+    $details = ($output | ConvertFrom-Json)
+  } catch {
+    $details = [pscustomobject]@{
+      port = $Port
+      status = 'error'
+      safe_to_stop = $false
+      owners = @()
+      error = '端口预检输出不是合法 JSON'
+    }
+  }
+  return [pscustomobject]@{
+    exit_code = $exitCode
+    details = $details
+  }
+}
+
+function Stop-ExpectedPortOwner([int]$Port, [string]$ExpectedPattern) {
+  $preflight = Get-PortPreflight $Port $ExpectedPattern
+  if ($preflight.details.status -eq 'free') { return $true }
+  if ($preflight.details.status -eq 'foreign' -or -not $preflight.details.safe_to_stop) {
+    $ownerText = @($preflight.details.owners | ForEach-Object {
+      "pid=$($_.pid) name=$($_.process_name) state=$($_.states -join ',')"
+    }) -join '; '
+    Write-Log "拒绝清理外部进程 port=$Port $ownerText"
+    return $false
+  }
+  foreach ($owner in @($preflight.details.owners)) {
+    if (-not $owner.pid -or -not $owner.matches_expected) { continue }
     try {
-      Stop-Process -Id $ownerPid -Force -ErrorAction Stop
-      Write-Log "清理占用端口 $Port 的进程 pid=$ownerPid"
+      Stop-Process -Id $owner.pid -Force -ErrorAction Stop
+      Write-Log "清理本项目占用端口 $Port 的进程 pid=$($owner.pid)"
     } catch {
-      Write-Log "清理端口 $Port 占用进程失败 pid=$ownerPid：$($_.Exception.Message)"
+      Write-Log "清理端口 $Port 占用进程失败 pid=$($owner.pid)：$($_.Exception.Message)"
+      return $false
     }
   }
-  # 等端口真正释放，避免新进程 bind EADDRINUSE
+  # 等端口真正释放，避免新进程 bind EADDRINUSE。
   for ($i = 0; $i -lt 20; $i++) {
-    $still = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
-    if (-not $still) { return }
+    $still = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
+    if (-not $still) { return $true }
     Start-Sleep -Milliseconds 250
   }
+  Write-Log "端口 $Port 停止本项目占用者后仍未释放"
+  return $false
 }
 
 function Start-Workbench($auth) {
-  $env:BAD_PORT = '8787'
+  if ($DryRun) {
+    Write-Log '[dry-run] 将拉起工作台 (18787)'
+    return
+  }
+  $env:BAD_PORT = '18787'
   if ($auth) {
     $env:BAD_AUTH_USER = $auth.user
     $env:BAD_AUTH_PASS = $auth.pass
@@ -134,10 +174,14 @@ function Start-Workbench($auth) {
     -WindowStyle Hidden `
     -RedirectStandardOutput (Join-Path $logDir 'workbench_out.log') `
     -RedirectStandardError (Join-Path $logDir 'workbench_err.log')
-  Write-Log '已拉起工作台 (8787)'
+  Write-Log '已拉起工作台 (18787)'
 }
 
 function Start-Portal {
+  if ($DryRun) {
+    Write-Log '[dry-run] 将拉起用户端 (8080)'
+    return
+  }
   Start-Process -FilePath $nodeExe `
     -ArgumentList 'portal/serve.mjs' `
     -WorkingDirectory $root `
@@ -148,6 +192,10 @@ function Start-Portal {
 }
 
 function Start-Frpc {
+  if ($DryRun) {
+    Write-Log '[dry-run] 将拉起 frpc'
+    return
+  }
   if (!(Test-Path $frpcExe)) {
     Write-Log "找不到 frpc.exe：$frpcExe"
     return
@@ -164,31 +212,53 @@ function Start-Frpc {
 function Invoke-GuardPass {
   $auth = if ($RequireAuth) { Get-WorkbenchAuth } else { $null }
 
-  if (Test-HttpOk 'http://127.0.0.1:8787/api/health') {
+  if (Test-HttpOk 'http://127.0.0.1:18787/api/health') {
     if ($RequireAuth -and -not (Test-AuthEnforced)) {
-      Write-Log '工作台 8787 在跑但未强制口令，重启为带口令实例'
-      Stop-PortOwner 8787
-      Start-Workbench $auth
+      Write-Log '工作台 18787 在跑但未强制口令，重启为带口令实例'
+      if (Stop-ExpectedPortOwner 18787 'server[\\/]index\.js') {
+        Start-Workbench $auth
+      }
     } elseif ($RequireAuth) {
-      Write-Log '工作台 8787 正常（口令已生效）'
+      Write-Log '工作台 18787 正常（口令已生效）'
     } elseif (Test-AuthEnforced) {
       # 上一轮用 -RequireAuth 起的实例仍在跑；本机用遇到登录框就手动重启该服务即可
-      Write-Log '工作台 8787 正常（当前实例带口令，本机访问如需免密请重启工作台）'
+      Write-Log '工作台 18787 正常（当前实例带口令，本机访问如需免密请重启工作台）'
     } else {
-      Write-Log '工作台 8787 正常'
+      Write-Log '工作台 18787 正常'
     }
   } else {
-    Write-Log '工作台 8787 探活失败，准备重启'
-    Stop-PortOwner 8787
-    Start-Workbench $auth
+    Write-Log '工作台 18787 探活失败，先做端口占用预检'
+    $preflight = Get-PortPreflight 18787 'server[\\/]index\.js'
+    if ($preflight.details.status -eq 'foreign') {
+      $ownerText = @($preflight.details.owners | ForEach-Object {
+        "pid=$($_.pid) name=$($_.process_name) state=$($_.states -join ',')"
+      }) -join '; '
+      Write-Log "拒绝清理外部进程 port=18787 $ownerText"
+    } elseif (Stop-ExpectedPortOwner 18787 'server[\\/]index\.js') {
+      Start-Workbench $auth
+    }
   }
 
   if (Test-HttpOk 'http://127.0.0.1:8080/health') {
     Write-Log '用户端 8080 正常'
+    if (Test-Path $syncDaemon) {
+      if ($env:SYNC_TOKEN) {
+        & $syncDaemon -Once -PortalBase 'http://127.0.0.1:8080'
+      } else {
+        Write-Log 'sync daemon skip：SYNC_TOKEN 未配置'
+      }
+    }
   } else {
-    Write-Log '用户端 8080 探活失败，准备重启'
-    Stop-PortOwner 8080
-    Start-Portal
+    Write-Log '用户端 8080 探活失败，先做端口占用预检'
+    $preflight = Get-PortPreflight 8080 'portal[\\/]serve\.mjs'
+    if ($preflight.details.status -eq 'foreign') {
+      $ownerText = @($preflight.details.owners | ForEach-Object {
+        "pid=$($_.pid) name=$($_.process_name) state=$($_.states -join ',')"
+      }) -join '; '
+      Write-Log "拒绝清理外部进程 port=8080 $ownerText"
+    } elseif (Stop-ExpectedPortOwner 8080 'portal[\\/]serve\.mjs') {
+      Start-Portal
+    }
   }
 
   $frpc = Get-CimInstance Win32_Process -Filter "Name='frpc.exe'" -ErrorAction SilentlyContinue
@@ -200,7 +270,7 @@ function Invoke-GuardPass {
   }
 }
 
-Write-Log "守护启动 node=$nodeExe interval=${IntervalSec}s once=$Once requireAuth=$RequireAuth"
+Write-Log "守护启动 node=$nodeExe interval=${IntervalSec}s once=$Once requireAuth=$RequireAuth dryRun=$DryRun"
 do {
   try {
     Invoke-GuardPass
diff --git a/ops/sync_daemon.ps1 b/ops/sync_daemon.ps1
new file mode 100644
index 0000000..1fb6379
--- /dev/null
+++ b/ops/sync_daemon.ps1
@@ -0,0 +1,518 @@
+<#
+.SYNOPSIS
+    WP-3.3 sync daemon：默认 stub 模式供 CI；real 模式接通工作台全链路。
+
+.DESCRIPTION
+    本脚本只做编排，导入建项、K40 派发、产物回收与交付打包由 Invoke-*-Stub 占位。
+    这些占位是后续接通的窄 seam：函数签名不变时，替换实现不需要改主流程。
+    网络只访问本地 portal，NO_PROXY 显式豁免 127.0.0.1 和 localhost。
+
+.PARAMETER PortalBase
+    本机 portal 地址，默认 http://127.0.0.1:8080。
+
+.PARAMETER SyncToken
+    编排面令牌。默认读 SYNC_TOKEN；空值时退出码 2。
+
+.PARAMETER BatchSize
+    每轮处理的 pending 数量，SYNC_BATCH 环境变量可覆盖；默认 1 串行。
+
+.PARAMETER Mode
+    stub 为 CI 与空转演练；real 调用 18787 建项、任务、回搬、报告与 result。
+
+.EXAMPLE
+    pwsh -File ops/sync_daemon.ps1 -Once
+    pwsh -File ops/sync_daemon.ps1 -Once -Mode real
+    pwsh -File ops/sync_daemon.ps1 -Once -PortalBase http://127.0.0.1:8080
+#>
+[CmdletBinding()]
+param(
+    [string]$PortalBase = ($env:PORTAL_BASE ? $env:PORTAL_BASE : 'http://127.0.0.1:8080'),
+    [string]$SyncToken = $env:SYNC_TOKEN,
+    [int]$BatchSize = ($env:SYNC_BATCH ? [int]$env:SYNC_BATCH : 1),
+    [string]$SpoolRoot = 'con_hf/sync/spool',
+    [string]$ActionsPath = 'con_hf/ledger/actions.jsonl',
+    [switch]$Once,
+    [int]$IntervalSec = 30,
+    [int]$BackoffSeconds = 1,
+    [string]$Mode = 'stub',
+    [string]$WorkbenchBase = ($env:BIO_WORKBENCH_BASE ? $env:BIO_WORKBENCH_BASE : 'http://127.0.0.1:18787'),
+    [string]$WorkbenchUser = $env:BIO_WORKBENCH_USER,
+    [string]$WorkbenchPass = $env:BIO_WORKBENCH_PASS,
+    [bool]$ReuseExistingProject = ($env:SYNC_REUSE_EXISTING -eq '1')
+)
+
+$ErrorActionPreference = 'Stop'
+$env:NO_PROXY = '127.0.0.1,localhost'
+$env:no_proxy = '127.0.0.1,localhost'
+$RepoRoot = Split-Path -Parent $PSScriptRoot
+$PortalBase = $PortalBase.TrimEnd('/')
+$SpoolRoot = Join-Path $RepoRoot $SpoolRoot
+$ActionsPath = Join-Path $RepoRoot $ActionsPath
+$ActionId = 'ACT-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + (Get-Random -Minimum 1000 -Maximum 9999)
+
+function Test-SafeProjectId {
+    param([string]$ProjectId)
+    return ($ProjectId -and $ProjectId -match '^[A-Za-z0-9._-]{1,64}$' -and !$ProjectId.StartsWith('.'))
+}
+
+function Get-RealProjectId {
+    param([string]$Ticket, [object]$Requirement)
+    $candidates = @(
+        [string]$Requirement.projectId,
+        [string]$Requirement.project_id,
+        [string]$Requirement.basicInfo.projectId,
+        [string]$Requirement.basic_info.project_id,
+        [string]$Requirement.basicInfo.name,
+        $Ticket
+    ) | Where-Object { $_ -and $_.Trim() }
+    foreach ($candidate in $candidates) {
+        $safe = $candidate.Trim().Replace(' ', '_').Replace('/', '_').Replace('\', '_').Replace(':', '_')
+        if (Test-SafeProjectId -ProjectId $safe) { return $safe }
+    }
+    throw "无法派生合法 project_id：ticket=$Ticket"
+}
+
+function Invoke-WorkbenchApi {
+    param(
+        [string]$Path,
+        [string]$Method = 'GET',
+        [object]$Body = $null
+    )
+    $raw = "$WorkbenchUser`:$WorkbenchPass"
+    $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($raw))
+    $headers = @{ Authorization = "Basic $basic" }
+    if ($null -ne $Body) {
+        return Invoke-RestMethod -Uri ($WorkbenchBase + $Path) -Method $Method -Headers $headers `
+            -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress -Depth 12)
+    }
+    return Invoke-RestMethod -Uri ($WorkbenchBase + $Path) -Method $Method -Headers $headers
+}
+
+function Invoke-ProjectCreateReal {
+    param([string]$Ticket, [string]$ProjectId, [object]$Requirement, [string]$PackagePath)
+    $body = if ($Requirement) { $Requirement } else { @{ projectId = $ProjectId } }
+    if (!$body.projectId) { $body.projectId = $ProjectId }
+    $existingProjects = Invoke-WorkbenchApi -Path '/api/projects/list'
+    if (@($existingProjects.projects | Where-Object { $_.projectId -eq $ProjectId }).Count -gt 0) {
+        return @{
+            imported = $true
+            existing = $true
+            project_id = $ProjectId
+            package_path = $PackagePath
+            workbench_project_id = $ProjectId
+            response = @{ projectId = $ProjectId; existing = $true }
+        }
+    }
+    try {
+        $response = Invoke-WorkbenchApi -Path '/api/projects/create' -Method 'POST' -Body $body
+        return @{
+            imported = $true
+            existing = $false
+            project_id = $ProjectId
+            package_path = $PackagePath
+            workbench_project_id = $response.projectId
+            response = $response
+        }
+    } catch {
+        $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
+        if ($statusCode -eq 409) {
+            return @{
+                imported = $true
+                existing = $true
+                project_id = $ProjectId
+                package_path = $PackagePath
+                workbench_project_id = $ProjectId
+                response = @{ projectId = $ProjectId; existing = $true }
+            }
+        }
+        throw
+    }
+}
+
+function Wait-TaskComplete {
+    param([string]$TaskId)
+    Start-Sleep -Seconds 60
+    for (;;) {
+        $running = Invoke-WorkbenchApi -Path '/api/tasks'
+        $still = @($running.tasks | Where-Object { $_.taskId -eq $TaskId })
+        if ($still.Count -eq 0) { return $true }
+        Start-Sleep -Seconds 60
+    }
+}
+
+function Invoke-TaskDispatchReal {
+    param([string]$Ticket, [string]$ProjectId, [object]$Requirement)
+    $lineId = [string]($Requirement.lineId || $Requirement.seriesId)
+    if (!$lineId) { throw "无法确定分析线：ticket=$Ticket" }
+    $seedValue = $Requirement.seed
+    if (!$seedValue) {
+        $envSeed = [string]$env:SYNC_SEED
+        if (!$envSeed) { throw "real mode 需要显式种子：requirement.seed 或 SYNC_SEED，ticket=$Ticket" }
+        $seedValue = [int]$envSeed
+    }
+    $steps = @($Requirement.pipelineDag | ForEach-Object { $_.stepId })
+    if ($steps.Count -eq 0) { throw "pipelineDag 缺失：ticket=$Ticket" }
+    $results = @()
+    foreach ($step in $steps) {
+        $body = @{
+            projectId = $ProjectId
+            lineId = $lineId
+            step = [string]$step
+            inputs = @($Requirement.pipelineDag | Where-Object { $_.stepId -eq $step } | ForEach-Object { $_.inputs }) | Where-Object { $_ }
+            outputs = @($Requirement.pipelineDag | Where-Object { $_.stepId -eq $step } | ForEach-Object { $_.outputs }) | Where-Object { $_ }
+            seed = [int]$seedValue
+        }
+        if ([string]$step -like '*knockout*' -or [string]$step -like '*ko_*') {
+            $body.targetKoGene = [string]$Requirement.biologicalPriors.targetKoGene
+        }
+        $response = Invoke-WorkbenchApi -Path '/api/tasks/submit' -Method 'POST' -Body $body
+        Wait-TaskComplete -TaskId $response.taskId | Out-Null
+        $results += @{ task_id = $response.taskId; step = [string]$step; waited = $true }
+    }
+    return @{ dispatched = $true; project_id = $ProjectId; tasks = $results }
+}
+
+function Invoke-PullOutputsReal {
+    param([string]$Ticket, [string]$ProjectId, [object]$DispatchResult)
+    $scriptPath = Join-Path $RepoRoot 'ops/07_pull_outputs.ps1'
+    $output = & pwsh -NoProfile -File $scriptPath -Project $ProjectId 2>&1
+    $exitCode = $LASTEXITCODE
+    return @{
+        pulled = ($exitCode -eq 0)
+        project_id = $ProjectId
+        dispatch = $DispatchResult
+        exit_code = $exitCode
+        output = ($output | Out-String).Trim()
+    }
+}
+
+function Invoke-ReportBuildReal {
+    param([string]$Ticket, [string]$ProjectId, [object]$PullResult)
+    $response = Invoke-WorkbenchApi -Path '/api/report/build' -Method 'POST' -Body @{
+        projectId = $ProjectId
+        force = $true
+    }
+    return @{
+        packed = $true
+        project_id = $ProjectId
+        pull = $PullResult
+        response = $response
+    }
+}
+
+function Build-RealResultFiles {
+    param([string]$ProjectId, [object]$ReportResult)
+    $resultFiles = @()
+    $totalBytes = 0
+    $projectRoot = Join-Path (Join-Path $RepoRoot 'local_projects') $ProjectId
+    $deliverRoot = Join-Path $projectRoot 'deliverables'
+    foreach ($file in @($ReportResult.response.files)) {
+        $leaf = Split-Path -Leaf ([string]$file.name)
+        $localPath = Join-Path $deliverRoot $leaf
+        if (!(Test-Path $localPath)) { continue }
+        $bytes = [IO.File]::ReadAllBytes($localPath)
+        if ($bytes.Length -gt 24MB -or ($totalBytes + $bytes.Length) -gt 24MB) { continue }
+        $resultFiles += @{
+            path = "deliverables/$leaf"
+            sha256 = (Get-FileHash -Path $localPath -Algorithm SHA256).Hash.ToLowerInvariant()
+            size = $bytes.Length
+            content_base64 = [Convert]::ToBase64String($bytes)
+        }
+        $totalBytes += $bytes.Length
+    }
+    $figureRoot = Join-Path $projectRoot 'figures'
+    if (Test-Path $figureRoot) {
+        $images = @(Get-ChildItem $figureRoot -Recurse -File | Where-Object {
+            $_.Extension -match '^\.(png|jpg|jpeg|webp)$'
+        } | Sort-Object FullName | Select-Object -First 12)
+        foreach ($image in $images) {
+            $bytes = [IO.File]::ReadAllBytes($image.FullName)
+            if ($bytes.Length -gt 6MB -or ($totalBytes + $bytes.Length) -gt 22MB) { continue }
+            $rel = $image.FullName.Substring($projectRoot.Length).TrimStart('\', '/').Replace('\', '/')
+            $resultFiles += @{
+                path = $rel
+                sha256 = (Get-FileHash -Path $image.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
+                size = $bytes.Length
+                content_base64 = [Convert]::ToBase64String($bytes)
+            }
+            $totalBytes += $bytes.Length
+        }
+    }
+    return $resultFiles
+}
+
+function Invoke-SyncResultReal {
+    param([object]$Body)
+    return Invoke-SyncApi -Path '/api/sync/result' -Method 'POST' -Body $Body
+}
+
+function Write-Action {
+    param(
+        [string]$Ticket = '',
+        [string]$Step,
+        [string]$Status = 'ok',
+        [object]$Detail = $null,
+        [int]$Attempt = 0
+    )
+    $entry = [ordered]@{
+        id = $ActionId
+        ts = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
+        type = 'action'
+        kind = 'portal_sync_daemon'
+        ticket = $Ticket
+        step = $Step
+        status = $Status
+        attempt = $Attempt
+        detail = $Detail
+    }
+    $dir = Split-Path -Parent $ActionsPath
+    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
+    Add-Content -Path $ActionsPath -Value ($entry | ConvertTo-Json -Compress -Depth 8) -Encoding utf8
+}
+
+function Invoke-SyncApi {
+    param(
+        [string]$Path,
+        [string]$Method = 'GET',
+        [object]$Body = $null
+    )
+    $headers = @{ Authorization = 'Bearer ' + $SyncToken }
+    if ($null -ne $Body) {
+        return Invoke-RestMethod -Uri ($PortalBase + $Path) -Method $Method -Headers $headers `
+            -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress -Depth 8)
+    }
+    return Invoke-RestMethod -Uri ($PortalBase + $Path) -Method $Method -Headers $headers
+}
+
+function Test-SafeTicket {
+    param([string]$Ticket)
+    return ($Ticket -and $Ticket.Trim() -eq $Ticket -and $Ticket.Length -le 180 `
+        -and $Ticket -notmatch '[/\\]' -and $Ticket -notmatch '^\.' -and $Ticket -notin @('.', '..'))
+}
+
+function Test-SafeTarPath {
+    param([string]$Entry)
+    if (!$Entry -or $Entry.Length -gt 240 -or $Entry.StartsWith('/') -or $Entry.Contains('\')) {
+        return $false
+    }
+    if ($Entry -match '^[A-Za-z]:') { return $false }
+    foreach ($part in ($Entry -split '/')) {
+        if ($part -eq '..' -or $part -eq '') { return $false }
+    }
+    return $true
+}
+
+function Invoke-SafeUnpack {
+    param(
+        [string]$ArchivePath,
+        [string]$Ticket,
+        [string]$Destination
+    )
+    if (!(Test-SafeTarPath -Entry $Ticket)) {
+        throw "拒绝 zip-slip：ticket 路径非法 $Ticket"
+    }
+    $spoolResolved = [System.IO.Path]::GetFullPath($SpoolRoot)
+    $destResolved = [System.IO.Path]::GetFullPath($Destination)
+    if (!$destResolved.StartsWith($spoolResolved + [System.IO.Path]::DirectorySeparatorChar)) {
+        throw '拒绝 zip-slip：解包落点在 spool 之外'
+    }
+    if (Test-Path $destResolved) {
+        if (!$destResolved.StartsWith($spoolResolved + [System.IO.Path]::DirectorySeparatorChar)) {
+            throw '拒绝 zip-slip：清理前发现越界落点'
+        }
+        Remove-Item -LiteralPath $destResolved -Recurse -Force
+    }
+    New-Item -ItemType Directory -Path $destResolved -Force | Out-Null
+    $modeLines = & tar --list --verbose -f $ArchivePath 2>&1
+    if ($LASTEXITCODE -ne 0) { throw ('tar listing failed: ' + ($modeLines -join '; ')) }
+    foreach ($line in $modeLines) {
+        $trimmed = ([string]$line).Trim()
+        if (!$trimmed) { continue }
+        $typeChar = $trimmed.Substring(0, 1)
+        if ($typeChar -ne 'd' -and $typeChar -ne '-') {
+            throw '拒绝 zip-slip：tar 包含 symlink 或 device entry'
+        }
+    }
+    $names = & tar --list -f $ArchivePath 2>&1
+    if ($LASTEXITCODE -ne 0) { throw ('tar names failed: ' + ($names -join '; ')) }
+    foreach ($name in $names) {
+        if (!$name) { continue }
+        if (!(Test-SafeTarPath -Entry ([string]$name))) {
+            throw "拒绝 zip-slip：tar 路径非法 $name"
+        }
+    }
+    & tar -xzf $ArchivePath -C $destResolved
+    if ($LASTEXITCODE -ne 0) { throw 'tar unpack failed' }
+    return $destResolved
+}
+
+function Invoke-ImportStub {
+    param([string]$Ticket, [string]$PackagePath)
+    return @{ imported = $true; project_id = $Ticket; package_path = $PackagePath }
+}
+
+function Invoke-DispatchStub {
+    param([string]$Ticket, [object]$ImportResult)
+    return @{ dispatched = $true; project_id = $Ticket; import = $ImportResult }
+}
+
+function Invoke-PullStub {
+    param([string]$Ticket, [object]$DispatchResult)
+    return @{ pulled = $true; project_id = $Ticket; dispatch = $DispatchResult }
+}
+
+function Invoke-PackStub {
+    param([string]$Ticket, [object]$PullResult)
+    return @{ packed = $true; project_id = $Ticket; pull = $PullResult }
+}
+
+function Invoke-SyncTicket {
+    param([string]$Ticket)
+    if (!(Test-SafeTicket -Ticket $Ticket)) {
+        Write-Action -Ticket $Ticket -Step 'portal_sync_ticket' -Status 'invalid'
+        return
+    }
+    $attempts = 3
+    for ($attempt = 1; $attempt -le $attempts; $attempt++) {
+        $stage = 'claim'
+        try {
+            $claim = Invoke-SyncApi -Path '/api/sync/claim' -Method 'POST' -Body @{ ticket = $Ticket }
+            Write-Action -Ticket $Ticket -Step 'portal_sync_claim' -Attempt $attempt -Detail @{ sha256 = $claim.sha256 }
+            $archive = Join-Path $SpoolRoot ($claim.sha256 + '.tar.gz')
+            New-Item -ItemType Directory -Path $SpoolRoot -Force | Out-Null
+            Invoke-WebRequest -Uri $claim.download_url -OutFile $archive -Headers @{ Authorization = 'Bearer ' + $SyncToken } -UseBasicParsing
+            Write-Action -Ticket $Ticket -Step 'portal_sync_download' -Attempt $attempt -Detail @{ bytes = (Get-Item $archive).Length }
+            $actual = (Get-FileHash -Path $archive -Algorithm SHA256).Hash.ToLowerInvariant()
+            if ($actual -ne $claim.sha256) { throw 'archive sha256 mismatch' }
+            Write-Action -Ticket $Ticket -Step 'portal_sync_verify' -Attempt $attempt -Detail @{ sha256 = $actual }
+            $destination = Join-Path $SpoolRoot $Ticket
+            $unpacked = Invoke-SafeUnpack -ArchivePath $archive -Ticket $Ticket -Destination $destination
+            Write-Action -Ticket $Ticket -Step 'portal_sync_unpack' -Attempt $attempt -Detail @{ destination = $unpacked }
+            $requirement = $null
+            $requirementPath = Join-Path $unpacked 'requirement.json'
+            if (!(Test-Path $requirementPath)) {
+                $flatRequirement = Get-ChildItem $unpacked -File -Filter '*.json' | Select-Object -First 1
+                if ($flatRequirement) { $requirementPath = $flatRequirement.FullName }
+            }
+            if (Test-Path $requirementPath) {
+                $requirement = Get-Content -LiteralPath $requirementPath -Raw | ConvertFrom-Json
+            }
+            if ($Mode -eq 'real') {
+                $projectId = Get-RealProjectId -Ticket $Ticket -Requirement $requirement
+                $stage = 'project_create'
+                if ($ReuseExistingProject) {
+                    $import = @{
+                        imported = $true
+                        existing = $true
+                        project_id = $projectId
+                        package_path = $unpacked
+                        workbench_project_id = $projectId
+                        response = @{ projectId = $projectId; existing = $true }
+                    }
+                } else {
+                    $import = Invoke-ProjectCreateReal -Ticket $Ticket -ProjectId $projectId -Requirement $requirement -PackagePath $unpacked
+                }
+                Write-Action -Ticket $Ticket -Step 'portal_sync_import_real' -Attempt $attempt -Detail @{ project_id = $projectId }
+                $stage = 'task_dispatch'
+                $dispatch = Invoke-TaskDispatchReal -Ticket $Ticket -ProjectId $projectId -Requirement $requirement
+                Write-Action -Ticket $Ticket -Step 'portal_sync_dispatch_real' -Attempt $attempt -Detail @{ task_count = @($dispatch.tasks).Count }
+                $stage = 'pull_outputs'
+                $pull = Invoke-PullOutputsReal -Ticket $Ticket -ProjectId $projectId -DispatchResult $dispatch
+                Write-Action -Ticket $Ticket -Step 'portal_sync_pull_real' -Attempt $attempt -Detail @{ exit_code = $pull.exit_code }
+                $stage = 'report_build'
+                $pack = Invoke-ReportBuildReal -Ticket $Ticket -ProjectId $projectId -PullResult $pull
+                Write-Action -Ticket $Ticket -Step 'portal_sync_pack_real' -Attempt $attempt -Detail @{ files = @($pack.response.files).Count }
+                $stage = 'result_files'
+                $resultFiles = Build-RealResultFiles -ProjectId $projectId -ReportResult $pack
+            } else {
+                $import = Invoke-ImportStub -Ticket $Ticket -PackagePath $unpacked
+                Write-Action -Ticket $Ticket -Step 'portal_sync_import_stub' -Attempt $attempt -Detail $import
+                $dispatch = Invoke-DispatchStub -Ticket $Ticket -ImportResult $import
+                Write-Action -Ticket $Ticket -Step 'portal_sync_dispatch_stub' -Attempt $attempt -Detail $dispatch
+                $pull = Invoke-PullStub -Ticket $Ticket -DispatchResult $dispatch
+                Write-Action -Ticket $Ticket -Step 'portal_sync_pull_stub' -Attempt $attempt -Detail $pull
+                $pack = Invoke-PackStub -Ticket $Ticket -PullResult $pull
+                Write-Action -Ticket $Ticket -Step 'portal_sync_pack_stub' -Attempt $attempt -Detail $pack
+            }
+            if (!$resultFiles) { $resultFiles = @() }
+            $stage = 'sync_result'
+            $resultBody = @{
+                ticket = $Ticket
+                status = 'done'
+                manifest = @{
+                    archive_sha256 = $claim.sha256
+                    project_id = if ($import.project_id) { $import.project_id } else { $Ticket }
+                    imported = $import.imported
+                    reused_existing_project = $import.existing
+                    dispatched = $dispatch.dispatched
+                    pulled = $pull.pulled
+                    packed = $pack.packed
+                    mode = $Mode
+                    result_file_count = @($resultFiles).Count
+                }
+                files = @($resultFiles)
+            }
+            $result = Invoke-SyncResultReal -Body $resultBody
+            Write-Action -Ticket $Ticket -Step 'portal_sync_result' -Attempt $attempt -Detail $result
+            return
+        } catch {
+            $message = $_.Exception.Message -replace 'Bearer\s+[^\s]+', 'Bearer <REDACTED>'
+            $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
+            $responseBody = if ($_.ErrorDetails.Message) {
+                $_.ErrorDetails.Message -replace 'Bearer\s+[^\s]+', 'Bearer <REDACTED>'
+            } else { '' }
+            Write-Action -Ticket $Ticket -Step 'portal_sync_attempt' -Status 'failed' -Attempt $attempt -Detail @{
+                stage = $stage
+                status_code = $statusCode
+                error = $message
+                response = $responseBody
+            }
+            if ($attempt -lt $attempts) {
+                Start-Sleep -Seconds ($BackoffSeconds * [Math]::Pow(2, $attempt - 1))
+            }
+        }
+    }
+    $failure = @{ reason = 'sync ticket failed after 3 attempts'; ticket = $Ticket }
+    try {
+            $result = Invoke-SyncResultReal -Body @{
+            ticket = $Ticket
+            status = 'failed'
+            manifest = $failure
+            files = @()
+        }
+        Write-Action -Ticket $Ticket -Step 'portal_sync_failed_result' -Detail $result
+    } catch {
+        $message = $_.Exception.Message -replace 'Bearer\s+[^\s]+', 'Bearer <REDACTED>'
+        Write-Action -Ticket $Ticket -Step 'portal_sync_failed_result' -Status 'failed' -Detail @{ error = $message }
+    }
+}
+
+function Invoke-SyncOnce {
+    $pending = Invoke-SyncApi -Path '/api/sync/pending' -Method 'GET'
+    $tickets = @($pending.tickets | Select-Object -First ([Math]::Max(1, $BatchSize)))
+    Write-Action -Step 'portal_sync_pending' -Detail @{ count = $tickets.Count }
+    foreach ($ticket in $tickets) {
+        Invoke-SyncTicket -Ticket $ticket.ticket
+    }
+}
+
+if (!$SyncToken) {
+    Write-Action -Step 'portal_sync_daemon' -Status 'failed' -Detail @{ reason = 'SYNC_TOKEN missing' }
+    exit 2
+}
+
+if ($Mode -eq 'real' -and (!$WorkbenchUser -or !$WorkbenchPass)) {
+    Write-Action -Step 'portal_sync_daemon' -Status 'failed' -Detail @{ reason = 'real mode needs BIO_WORKBENCH_USER and BIO_WORKBENCH_PASS' }
+    exit 2
+}
+
+do {
+    try {
+        Invoke-SyncOnce
+    } catch {
+        $message = $_.Exception.Message -replace 'Bearer\s+[^\s]+', 'Bearer <REDACTED>'
+        Write-Action -Step 'portal_sync_daemon' -Status 'failed' -Detail @{ error = $message }
+    }
+    if ($Once) { break }
+    Start-Sleep -Seconds ([Math]::Max(1, $IntervalSec))
+} while ($true)
diff --git a/portal/serve.mjs b/portal/serve.mjs
index 9376219..0f5f6dd 100644
--- a/portal/serve.mjs
+++ b/portal/serve.mjs
@@ -1,7 +1,7 @@
 /**
  * 用户需求提交入口 · 独立服务
  *
- * 与管理员工作台（BioanalysDesktop，8787）彻底解耦：
+ * 与管理员工作台（BioanalysDesktop，18787）彻底解耦：
  *   - 不挂工作台任何 API、不连数据面（projects/ 目录）
  *   - 独立端口（默认 127.0.0.1:8080），可单独内网穿透给客户
  *   - 客户点「提交给对接人」后，需求 JSON 落到本目录 inbox/（人工中转的收件箱）
@@ -22,6 +22,9 @@ import http from 'node:http';
 import fs from 'node:fs';
 import path from 'node:path';
 import crypto from 'node:crypto';
+import zlib from 'node:zlib';
+import stream from 'node:stream';
+import { pipeline } from 'node:stream/promises';
 import { fileURLToPath } from 'node:url';
 import {
   DATA_ROLES, DATA_EXT, MAX_DATA_BYTES, MAX_DATA_FILES_PER_ROLE,
@@ -31,18 +34,28 @@ import {
 import {
   DATA_EXT as SHARED_DATA_EXT, MAX_DATA_BYTES as SHARED_MAX_DATA_BYTES,
 } from '../shared/data_formats.mjs';
-import { BLACKLIST_PATTERNS } from '../BioanalysDesktop/server/tumor_blacklist.js';
+import { BLACKLIST_PATTERNS, validateProjectFields } from '../BioanalysDesktop/server/tumor_blacklist.js';
+import { resolveFigure } from '../BioanalysDesktop/server/figure_graph.js';
+import {
+  resolveCatalogFigure, searchFigureCatalog, validateFigureCatalog,
+} from '../BioanalysDesktop/server/figure_catalog.js';
 
 const PORT = Number(process.env.PORTAL_PORT || 8080);
 const HOST = process.env.PORTAL_HOST || '127.0.0.1';
+// 仓库根：本文件在 <repo>/portal/ 下，上一级即仓库根。工作流注册表在那里。
+const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
 /**
  * 可选访问令牌（B4）：默认空字符串 = 完全开放，行为与未启用鉴权的历史版本一致；
  * 运维显式设置 PORTAL_TOKEN 后，/api/* 写端点要求携带令牌（Bearer 头或 ?token=）。
  * 静态页与 /health 永不鉴权（页面要能打开、探活要能通）。
  */
 const PORTAL_TOKEN = process.env.PORTAL_TOKEN || '';
+const SYNC_TOKEN = process.env.SYNC_TOKEN || '';
+const PORTAL_CLIENT_TOKEN = process.env.PORTAL_CLIENT_TOKEN || '';
 /** 鉴权失败的统一响应文案（不回显 token 本身，避免把收到的令牌写进日志/响应） */
 const AUTH_ERROR = '未授权：缺少或错误的 access token（设置 PORTAL_TOKEN 的服务需要令牌）';
+const SYNC_AUTH_ERROR = '未授权：缺少或错误的 SYNC_TOKEN';
+const CLIENT_AUTH_ERROR = '未授权：缺少或错误的客户访问 token（设置 PORTAL_CLIENT_TOKEN 的服务需要令牌）';
 const INDEX = fileURLToPath(new URL('./index.html', import.meta.url));
 const INBOX = process.env.PORTAL_INBOX
   ? path.resolve(process.env.PORTAL_INBOX)
@@ -107,6 +120,13 @@ const REF_MAX_BYTES = 20 * 1024 * 1024;
 const REF_EXT = ['.pdf', '.doc', '.docx', '.txt', '.md', '.zip'];
 const REF_SID_RE = /^[A-Za-z0-9_-]{6,64}$/;
 const REF_PATH_RE = /^refs\/[A-Za-z0-9_-]{6,64}\/[^/\\]{1,120}$/;
+/** Sync 状态机与下载缓存：状态存 inbox JSON，tar.gz 存内部缓存目录。 */
+const SYNC_STATUSES = ['pending', 'running', 'done', 'failed', 'blocked'];
+const SYNC_CACHE = path.join(INBOX, '.sync_cache');
+const TRIGGER_COOLDOWN_MS = 60_000;
+const SYNC_RESULT_MAX_BODY = Number(process.env.PORTAL_SYNC_RESULT_MAX_BYTES || 32 * 1024 * 1024);
+const TRIGGER_LIMITS = new Map();
+const FIGURE_ROOT_PREFIX = 'reference/05.可参考出图代码';
 
 /** 文件名安全化：保留中英文、数字、下划线、连字符 */
 function safeName(text) {
@@ -168,6 +188,197 @@ function sendJson(res, status, payload) {
   res.end(body);
 }
 
+/**
+ * 模式 A 调研需求单校验与落盘。
+ *
+ * 与 /api/submit 的分工：那份收的是"已定课题要跑分析"的完整需求（要素卡级别），
+ * 本端点只收"一个方向"，要素卡由调研过程自己填。两者不可互相替代。
+ *
+ * 字段口径来自 con_hf/topic_survey/request_schema.json，两边同步修改。
+ * 落盘形态沿用 inbox 的 JSON 约定，文件名带 ticket_id，结果页按它取。
+ *
+ * @returns {{ok: boolean, error?: string, ticketId?: string, file?: string}}
+ */
+function saveSurveyRequest(payload) {
+  const disease = String(payload.disease || '').trim();
+  if (!disease) return { ok: false, error: '疾病名称必填' };
+  if (disease.length > 200) return { ok: false, error: '疾病名称过长（上限 200 字符）' };
+
+  const ORG = ['any', 'Homo sapiens', 'Mus musculus'];
+  const KINDS = ['bulk', 'array', 'scrna', 'spatial'];
+  const organism = ORG.includes(payload.organism) ? payload.organism : 'any';
+  const kinds = Array.isArray(payload.data_kinds)
+    ? [...new Set(payload.data_kinds.filter((k) => KINDS.includes(k)))]
+    : [];
+  if (!kinds.length) return { ok: false, error: '至少选择一种数据类型' };
+
+  const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
+  const ticketId = 'TSV-' + new Date().toISOString().slice(0, 10).replace(/-/g, '')
+    + '-' + crypto.randomBytes(4).toString('hex');
+
+  const record = {
+    ticket_id: ticketId,
+    kind: 'topic_survey_request',
+    schema_version: 1,
+    created_at: new Date().toISOString(),
+    request: {
+      disease,
+      interest: clip(payload.interest, 2000),
+      organism,
+      tissue: clip(payload.tissue, 200),
+      data_kinds: kinds,
+      clue: clip(payload.clue, 4000),
+    },
+    // 结果页据此判断进度。派发出去后由调研侧改成 dispatched，完成改 completed。
+    status: 'pending',
+  };
+
+  const file = path.join(INBOX, `${ticketId}.json`);
+  fs.mkdirSync(INBOX, { recursive: true });
+  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
+  return { ok: true, ticketId, file };
+}
+
+/**
+ * 组合合法性判定（portal 本地版）。
+ *
+ * 与工作台 BioanalysDesktop/server/workflow_graph.js 的 resolvePlan **同语义**：
+ * 同一份注册表、同一套规则（必经 stage 的非 optional mod 必须全选、依赖闭合、
+ * 跨线选中拒绝、ko_gene 必须给靶基因、峰值内存不超配额）、同样的拓扑排序。
+ * 两边各写一份是为了保住 portal 的独立性；规则一致性由
+ * BioanalysDesktop/tests/portal_resolve_parity.test.js 逐条对账钉住。
+ *
+ * @returns {{ok: boolean, errors: string[], ordered: string[], estMinutes: number, peakMemMb: number}}
+ */
+function resolveLocally(reg, seriesId, selectedIds, koGene) {
+  const errors = [];
+  const series = reg.series.find((s) => s.id === seriesId);
+  if (!series) {
+    return { ok: false, errors: [`未知系列 ${seriesId}`], ordered: [], estMinutes: 0, peakMemMb: 0 };
+  }
+
+  // 扁平索引：key 必须带 series 前缀（三条线有同名母版，裸 id 会互相覆盖）
+  const index = new Map();
+  const producers = new Map();
+  for (const s of reg.series) {
+    for (const st of s.stages) {
+      for (const m of st.mods) {
+        index.set(`${s.id}:${m.id}`, { mod: m, series: s, stage: st });
+        for (const p of m.produces || []) {
+          if (!producers.has(p)) producers.set(p, []);
+          producers.get(p).push(`${s.id}:${m.id}`);
+        }
+      }
+    }
+  }
+
+  const selected = new Set();
+  for (const id of selectedIds) {
+    const entry = index.get(`${seriesId}:${id}`);
+    if (!entry) {
+      // 全局再查一次，才能报清"属于哪条线"而不是含糊的"未知 mod"
+      let other = null;
+      for (const s of reg.series) {
+        const hit = index.get(`${s.id}:${id}`);
+        if (hit) { other = hit; break; }
+      }
+      errors.push(other
+        ? `跨线选中：'${id}' 属于 ${other.series.id}，不是 ${seriesId}`
+        : `未知 mod '${id}'`);
+      continue;
+    }
+    selected.add(`${seriesId}:${id}`);
+  }
+
+  // 必经 stage 的非 optional mod 必须全选
+  for (const st of series.stages) {
+    if (!st.required) continue;
+    for (const m of st.mods) {
+      if (m.optional) continue;
+      if (!selected.has(`${seriesId}:${m.id}`)) {
+        errors.push(`必经阶段 ${st.id} 缺少 mod '${m.id}'`);
+      }
+    }
+  }
+
+  // 依赖闭合：requires（非原始输入）的生产者必须也被选中
+  const rawInputs = new Set(['series_matrix', 'gpl', 'gpl_soft', 'gpl_soft_mouse',
+    'gpl_soft_human', 'grouping.txt', 'raw_tar', 'processed', 'survival_data']);
+  const bare = (key) => key.slice(seriesId.length + 1);
+  for (const key of selected) {
+    const entry = index.get(key);
+    for (const req of entry.mod.requires || []) {
+      if (rawInputs.has(req)) continue;
+      const who = (producers.get(req) || []).filter((k) => k.startsWith(`${seriesId}:`));
+      if (!who.some((k) => selected.has(k))) {
+        errors.push(`${bare(key)} 依赖 '${req}'，但生产者 [${who.map(bare).join(',') || '无'}] 未选中`);
+      }
+    }
+    for (const dep of entry.mod.after || []) {
+      if (!selected.has(`${seriesId}:${dep}`)) {
+        errors.push(`${bare(key)} 声明 after '${dep}' 但未选中`);
+      }
+    }
+  }
+
+  // 拓扑排序（stage order 优先，同 stage 内保持勾选顺序）
+  const ordered = [];
+  const visited = new Set();
+  const visiting = new Set();
+  const visit = (key) => {
+    if (visited.has(key)) return;
+    if (visiting.has(key)) { errors.push(`依赖成环：${bare(key)}`); return; }
+    visiting.add(key);
+    const entry = index.get(key);
+    for (const req of entry.mod.requires || []) {
+      if (rawInputs.has(req)) continue;
+      for (const p of producers.get(req) || []) {
+        if (p.startsWith(`${seriesId}:`) && selected.has(p)) visit(p);
+      }
+    }
+    for (const dep of entry.mod.after || []) {
+      if (selected.has(`${seriesId}:${dep}`)) visit(`${seriesId}:${dep}`);
+    }
+    visiting.delete(key);
+    visited.add(key);
+    ordered.push(key);
+  };
+  for (const st of [...series.stages].sort((a, b) => a.order - b.order)) {
+    for (const m of st.mods) {
+      if (selected.has(`${seriesId}:${m.id}`)) visit(`${seriesId}:${m.id}`);
+    }
+  }
+
+  let estMinutes = 0;
+  let peakMemMb = 0;
+  for (const key of ordered) {
+    const m = index.get(key).mod;
+    estMinutes += m.est_minutes || 0;
+    peakMemMb = Math.max(peakMemMb, m.peak_mem_mb || 0);
+  }
+  const quota = reg.constraints?.mem_quota_mb;
+  if (quota && peakMemMb > quota) {
+    errors.push(`峰值内存 ${peakMemMb}MB 超出 K40 配额 ${quota}MB`);
+  }
+
+  // 敲除类 mod 必须给靶基因（母版会在参数解析处 exit 2，预先拦省一次远端执行）
+  if (!koGene) {
+    for (const key of selected) {
+      if (index.get(key).mod.ko_gene) {
+        errors.push(`${bare(key)} 需要靶基因（--ko-gene），但未提供`);
+      }
+    }
+  }
+
+  return {
+    ok: errors.length === 0,
+    errors,
+    ordered: ordered.map(bare),
+    estMinutes,
+    peakMemMb,
+  };
+}
+
 /** 定长比较防时序侧信道：长度不等直接拒（长度本身不保密，无需常量时间） */
 function tokensEqual(provided, expected) {
   const a = Buffer.from(String(provided), 'utf8');
@@ -193,6 +404,593 @@ export function checkToken(req, url) {
   return { ok: true };
 }
 
+/** 与 checkToken 同形态，但让编排面 token 与客户 token 各自闭环，互不借用。 */
+function checkEnvToken(req, url, expected, errorText) {
+  if (!expected) return { ok: false, error: errorText };
+  const header = String((req && req.headers && req.headers.authorization) || '').trim();
+  const bearer = /^Bearer\s+(.+)$/i.exec(header);
+  const query = url && url.searchParams ? String(url.searchParams.get('token') || '') : '';
+  const provided = (bearer && bearer[1].trim()) || query;
+  if (!provided || !tokensEqual(provided, expected)) return { ok: false, error: errorText };
+  return { ok: true };
+}
+
+function checkSyncAuth(req, url) {
+  return checkEnvToken(req, url, SYNC_TOKEN, SYNC_AUTH_ERROR);
+}
+
+function checkClientSyncAuth(req, url) {
+  return checkEnvToken(req, url, PORTAL_CLIENT_TOKEN, CLIENT_AUTH_ERROR);
+}
+
+/**
+ * 把 URL 里的 ticket 解析成 inbox 内的唯一事实文件。
+ * 包形态用 package 目录，扁平形态用根级 JSON；路径穿越与隐藏目录一律拒。
+ */
+function resolveSyncTicket(ticket) {
+  const value = String(ticket || '').trim();
+  if (!value || value.length > 180 || value === '.' || value === '..'
+    || value.startsWith('.') || value.includes('/') || value.includes('\\')) return null;
+  const root = path.resolve(INBOX);
+  const flat = path.resolve(root, `${value}.json`);
+  if (flat.startsWith(root + path.sep)) {
+    let flatStat = null;
+    try { flatStat = fs.statSync(flat); } catch { flatStat = null; }
+    if (flatStat && flatStat.isFile()) {
+      return { ticket: value, isPackage: false, root, recordPath: flat };
+    }
+  }
+  const packageDir = path.resolve(root, value);
+  if (!packageDir.startsWith(root + path.sep)) return null;
+  const recordPath = path.join(packageDir, 'requirement.json');
+  let recordStat = null;
+  try { recordStat = fs.statSync(recordPath); } catch { recordStat = null; }
+  if (recordStat && recordStat.isFile()) {
+    return { ticket: value, isPackage: true, root: packageDir, recordPath };
+  }
+  return null;
+}
+
+function isSyncStatus(value) {
+  return SYNC_STATUSES.includes(value);
+}
+
+function isLegacySyncRecord(record) {
+  return !record || !isSyncStatus(record.sync_status);
+}
+
+function readJsonSync(recordPath) {
+  return JSON.parse(fs.readFileSync(recordPath, 'utf8'));
+}
+
+function writeJsonAtomic(file, value) {
+  const tmp = `${file}.tmp-${crypto.randomBytes(6).toString('hex')}`;
+  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
+  fs.renameSync(tmp, file);
+}
+
+function listPendingSyncTickets() {
+  const found = [];
+  let entries = [];
+  try { entries = fs.readdirSync(INBOX, { withFileTypes: true }); }
+  catch { entries = []; }
+  for (const entry of entries) {
+    if (entry.name.startsWith('.') || entry.name === 'uploads' || entry.name === 'refs') continue;
+    let record = null;
+    let ticket = entry.name;
+    if (entry.isDirectory()) {
+      const recordPath = path.join(INBOX, entry.name, 'requirement.json');
+      try { record = readJsonSync(recordPath); } catch { record = null; }
+    } else if (entry.isFile() && entry.name.endsWith('.json')) {
+      const recordPath = path.join(INBOX, entry.name);
+      try { record = readJsonSync(recordPath); } catch { record = null; }
+      ticket = entry.name.replace(/\.json$/, '');
+    }
+    if (record && record.sync_status === 'pending') {
+      found.push({ ticket, urgent: Boolean(record.sync_urgent), updated_at: record.sync_updated_at || record.created_at || '' });
+    }
+  }
+  found.sort((a, b) => (Number(b.urgent) - Number(a.urgent)) || a.ticket.localeCompare(b.ticket));
+  return found;
+}
+
+/**
+ * 采集包内文件做 tar.gz。隐藏文件、结果产物与符号链接不进待办包，
+ * 避免把上一轮结果或外部指针对象回灌给编排面。
+ */
+function collectSyncFiles(root) {
+  const rootStat = fs.statSync(root);
+  if (rootStat.isFile()) {
+    return [{ abs: root, rel: path.basename(root), stat: rootStat }];
+  }
+  const files = [];
+  const walk = (abs, rel) => {
+    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
+      const childAbs = path.join(abs, entry.name);
+      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
+      if (entry.name.startsWith('.')) continue;
+      if (entry.isSymbolicLink()) continue;
+      if (entry.isDirectory()) walk(childAbs, childRel);
+      else if (entry.isFile()) files.push({ abs: childAbs, rel: childRel, stat: fs.statSync(childAbs) });
+    }
+  };
+  walk(root, '');
+  return files;
+}
+
+function octalTar(value, width) {
+  return value.toString(8).padStart(width - 1, '0') + '\0';
+}
+
+function tarHeader(name, size, typeFlag, mode) {
+  let displayName = name.replace(/\\/g, '/');
+  let prefix = '';
+  if (Buffer.byteLength(displayName, 'utf8') > 100) {
+    const slash = displayName.lastIndexOf('/');
+    if (slash <= 0) throw new Error(`tar 路径过长：${name}`);
+    prefix = displayName.slice(0, slash);
+    displayName = displayName.slice(slash + 1);
+    if (Buffer.byteLength(prefix, 'utf8') > 155 || Buffer.byteLength(displayName, 'utf8') > 100) {
+      throw new Error(`tar 路径过长：${name}`);
+    }
+  }
+  const header = Buffer.alloc(512, 0);
+  header.write(displayName, 0, 100, 'utf8');
+  header.write(prefix, 345, 155, 'utf8');
+  header.write(octalTar(mode, 8), 100, 'utf8');
+  header.write(octalTar(0, 8), 108, 'utf8');
+  header.write(octalTar(0, 8), 116, 'utf8');
+  header.write(octalTar(size, 12), 124, 'utf8');
+  header.write(octalTar(0, 12), 136, 'utf8');
+  header.write('        ', 148, 'utf8');
+  header.write(typeFlag, 156, 'utf8');
+  header.write('ustar\0', 257, 'utf8');
+  header.write('00', 263, 'utf8');
+  const checksum = header.reduce((sum, byte) => sum + byte, 0);
+  header.write(octalTar(checksum, 8), 148, 'utf8');
+  header.write(typeFlag, 156, 'utf8');
+  return header;
+}
+
+async function* tarFileData(root) {
+  const files = collectSyncFiles(root);
+  for (const file of files) {
+    yield tarHeader(file.rel, file.stat.size, '0', 0o644);
+    const source = fs.createReadStream(file.abs, { highWaterMark: 512 * 1024 });
+    for await (const chunk of source) yield chunk;
+    const tail = file.stat.size % 512;
+    if (tail) yield Buffer.alloc(512 - tail, 0);
+  }
+  yield Buffer.alloc(1024, 0);
+}
+
+/** 打包器只做 tar.gz；sha256 在 gzip 后计算，daemon 下载后直接对账。 */
+async function buildSyncPackage(root, ticket) {
+  fs.mkdirSync(SYNC_CACHE, { recursive: true });
+  const cacheName = `${crypto.createHash('sha256').update(ticket).digest('hex')}.tar.gz`;
+  const archive = path.join(SYNC_CACHE, cacheName);
+  const tmp = `${archive}.tmp-${crypto.randomBytes(6).toString('hex')}`;
+  const gzip = zlib.createGzip({ level: 6 });
+  const out = fs.createWriteStream(tmp);
+  const hash = crypto.createHash('sha256');
+  const hashTap = new stream.Transform({
+    transform(chunk, encoding, callback) {
+      hash.update(chunk);
+      callback(null, chunk);
+    },
+  });
+  try {
+    await pipeline(stream.Readable.from(tarFileData(root), { objectMode: false }), gzip, hashTap, out);
+    await fs.promises.rename(tmp, archive);
+    return { archive, sha256: hash.digest('hex') };
+  } catch (cause) {
+    try { fs.rmSync(tmp, { force: true }); } catch { /* 写流失败时残留无关键数据 */ }
+    throw cause;
+  }
+}
+
+async function hashSyncArchive(archive) {
+  const source = fs.createReadStream(archive, { highWaterMark: 512 * 1024 });
+  const hash = crypto.createHash('sha256');
+  const sink = new stream.Writable({
+    write(chunk, encoding, callback) { callback(); },
+  });
+  await pipeline(source, hash, sink);
+  return hash.digest('hex');
+}
+
+async function claimSyncTicket(ticket, recordPath, packageRoot) {
+  const record = readJsonSync(recordPath);
+  if (isLegacySyncRecord(record)) return { error: 'legacy 单子不参与同步', status: 409 };
+  if (['done', 'failed', 'blocked'].includes(record.sync_status)) {
+    return { error: `当前状态 ${record.sync_status}，不能再 claim`, status: 409 };
+  }
+  if (record.sync_status === 'pending') {
+    record.sync_status = 'running';
+  }
+  let pack = null;
+  const cachedArchive = path.join(SYNC_CACHE,
+    `${crypto.createHash('sha256').update(ticket).digest('hex')}.tar.gz`);
+  if (fs.existsSync(cachedArchive)) {
+    pack = { archive: cachedArchive, sha256: record.sync_package_sha256
+      || (await buildSyncPackage(packageRoot, ticket)).sha256 };
+  } else {
+    pack = await buildSyncPackage(packageRoot, ticket);
+  }
+  const now = new Date().toISOString();
+  record.sync_status = 'running';
+  record.sync_claimed_at = now;
+  record.sync_updated_at = now;
+  record.sync_package_sha256 = pack.sha256;
+  record.sync_urgent = Boolean(record.sync_urgent);
+  writeJsonAtomic(recordPath, record);
+  return { record, pack };
+}
+
+function safeResultPath(root, rel) {
+  const value = String(rel || '');
+  if (!value || value.length > 240 || value.includes('\\') || value.startsWith('/')
+    || /^[A-Za-z]:/.test(value) || value.split('/').includes('..')) return null;
+  const full = path.resolve(root, value);
+  if (!full.startsWith(path.resolve(root) + path.sep)) return null;
+  return full;
+}
+
+function syncStatusPayload(ticket, record) {
+  const result = record.sync_result || {};
+  return {
+    ok: true,
+    ticket,
+    sync_status: record.sync_status,
+    sync_urgent: Boolean(record.sync_urgent),
+    updated_at: record.sync_updated_at || '',
+    manifest: result.manifest || null,
+    files: result.files || [],
+    result_at: result.received_at || '',
+  };
+}
+
+/**
+ * 图模板视图（WP-3.2）：只下发门户展示与表单需要的数据。
+ * preview 状态在服务端重新落哈希，前端不信任注册表自身说的 ok。
+ */
+function figurePreviewState(item) {
+  if (item.deps_status !== 'ready' || !item.verified) return 'not_verified';
+  const relative = String(item.preview || '');
+  if (!relative.startsWith(FIGURE_ROOT_PREFIX + '/')) return 'missing';
+  const target = path.resolve(REPO_ROOT, relative);
+  if (!target.startsWith(path.resolve(REPO_ROOT) + path.sep)) return 'missing';
+  try {
+    if (!fs.statSync(target).isFile()) return 'missing';
+    const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
+    return actual === item.preview_sha256 ? 'ok' : 'hash_mismatch';
+  } catch {
+    return 'missing';
+  }
+}
+
+function figureTemplatesPayload() {
+  const registryPath = path.resolve(REPO_ROOT, 'src', 'figure_templates.json');
+  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
+  const templates = (Array.isArray(registry.templates) ? registry.templates : []).map((item) => {
+    const state = figurePreviewState(item);
+    return {
+      id: item.id,
+      name: item.name,
+      level: item.level,
+      category: item.category,
+      language: item.language,
+      deps_status: item.deps_status,
+      deps: Array.isArray(item.deps) ? item.deps : [],
+      block_reason: item.block_reason || (item.deps_status === 'ready' ? '' : '依赖未完成验证'),
+      verified: Boolean(item.verified),
+      preview_state: state,
+      preview_url: state === 'ok' ? `/api/figure-templates/preview?id=${encodeURIComponent(item.id)}` : '',
+      lines: Array.isArray(item.lines) ? item.lines : [],
+      analysis_step: item.analysis_step || null,
+      input_tables: Array.isArray(item.input_tables) ? item.input_tables : [],
+      produces: Array.isArray(item.produces) ? item.produces : [],
+      output_glob: item.output_glob || null,
+      canonical_output: item.canonical_output || null,
+      sample_project_output: item.sample_project_output || null,
+      adapt_vars: item.adapt_vars || {},
+      linked_mods: Array.isArray(item.linked_mods) ? item.linked_mods : [],
+      deprecated: Boolean(item.deprecated),
+    };
+  });
+  return { templates };
+}
+
+function handleFigureTemplatePreview(req, res, url) {
+  const id = url.searchParams.get('id') || '';
+  let template;
+  try {
+    const registry = JSON.parse(fs.readFileSync(
+      path.resolve(REPO_ROOT, 'src', 'figure_templates.json'), 'utf8'));
+    template = (registry.templates || []).find((item) => item.id === id);
+  } catch {
+    return sendJson(res, 500, { ok: false, error: '读取图模板注册表失败' });
+  }
+  if (!template || template.deps_status !== 'ready' || !template.verified) {
+    return sendJson(res, 404, { ok: false, error: '模板不可用或尚未验证' });
+  }
+  const state = figurePreviewState(template);
+  if (state === 'hash_mismatch') {
+    return sendJson(res, 409, { ok: false, error: '预览图与模板不同步' });
+  }
+  if (state !== 'ok') {
+    return sendJson(res, 404, { ok: false, error: '预览图缺失' });
+  }
+  const target = path.resolve(REPO_ROOT, template.preview);
+  if (!target.startsWith(path.resolve(REPO_ROOT) + path.sep)) {
+    return sendJson(res, 400, { ok: false, error: '预览图路径越界' });
+  }
+  let bytes;
+  try { bytes = fs.readFileSync(target); }
+  catch {
+    return sendJson(res, 404, { ok: false, error: '预览图缺失' });
+  }
+  res.writeHead(200, {
+    'Content-Type': 'image/png',
+    'Content-Length': String(bytes.length),
+    'Cache-Control': 'no-store',
+    'X-Content-Type-Options': 'nosniff',
+  });
+  return res.end(bytes);
+}
+
+/** 提交前用同一个权威校验器裁决选中的图模板，越界或缺失 adapt_vars 不落盘。 */
+function validateFigureTemplateSelections(payload) {
+  const selections = Array.isArray(payload.figure_templates) ? payload.figure_templates : [];
+  if (!selections.length) return { ok: true };
+  const projectId = String(payload.basicInfo?.name || '').trim();
+  const errors = [];
+  for (const [index, selection] of selections.entries()) {
+    const templateId = String(selection?.template_id || '');
+    const adaptVars = selection?.adapt_vars && typeof selection.adapt_vars === 'object'
+      && !Array.isArray(selection.adapt_vars) ? selection.adapt_vars : null;
+    if (!templateId || !adaptVars) {
+      errors.push(`figure_templates[${index}] 缺少 template_id 或 adapt_vars`);
+      continue;
+    }
+    const result = resolveFigure(templateId, String(payload.seriesId || ''), projectId, adaptVars, payload.modIds || []);
+    if (!result.ok) errors.push(...result.errors);
+  }
+  return { ok: errors.length === 0, errors };
+}
+
+function handleJsonBody(req, res, maxBytes, handler) {
+  const chunks = [];
+  let size = 0;
+  req.on('data', (chunk) => {
+    size += chunk.length;
+    if (size > maxBytes) {
+      req.destroy();
+      return;
+    }
+    chunks.push(chunk);
+  });
+  req.on('end', async () => {
+    let payload;
+    try {
+      payload = Buffer.concat(chunks).length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
+    } catch (cause) {
+      return sendJson(res, 400, { ok: false, error: `请求体不是合法 JSON: ${cause.message}` });
+    }
+    try {
+      await handler(payload);
+    } catch (cause) {
+      if (!res.headersSent) {
+        return sendJson(res, 500, {
+          ok: false,
+          error: `sync 请求处理失败: ${cause instanceof Error ? cause.message : String(cause)}`,
+        });
+      }
+    }
+  });
+  req.on('error', () => {
+    if (!res.headersSent) sendJson(res, 400, { ok: false, error: '读取 sync 请求失败' });
+  });
+}
+
+async function handleSyncClaim(req, res) {
+  handleJsonBody(req, res, 64 * 1024, async (payload) => {
+    const resolved = resolveSyncTicket(payload.ticket);
+    if (!resolved) return sendJson(res, 400, { ok: false, error: 'ticket 非法或不存在' });
+    let claimed;
+    const packageRoot = resolved.isPackage ? resolved.root : resolved.recordPath;
+    try { claimed = await claimSyncTicket(resolved.ticket, resolved.recordPath, packageRoot); }
+    catch (cause) {
+      return sendJson(res, 500, {
+        ok: false,
+        error: `claim 失败: ${cause instanceof Error ? cause.message : String(cause)}`,
+      });
+    }
+    if (claimed.error) return sendJson(res, claimed.status, { ok: false, error: claimed.error });
+    const downloadUrl = new URL(
+      `/api/sync/package?ticket=${encodeURIComponent(resolved.ticket)}`,
+      `http://${HOST}:${PORT}`,
+    ).href;
+    return sendJson(res, 200, {
+      ok: true,
+      ticket: resolved.ticket,
+      status: 'running',
+      download_url: downloadUrl,
+      sha256: claimed.pack.sha256,
+      claimed_at: claimed.record.sync_claimed_at,
+    });
+  });
+}
+
+async function handleSyncPackage(req, res, url) {
+  const resolved = resolveSyncTicket(url.searchParams.get('ticket'));
+  if (!resolved) return sendJson(res, 400, { ok: false, error: 'ticket 非法或不存在' });
+  let record;
+  try { record = readJsonSync(resolved.recordPath); }
+  catch { return sendJson(res, 500, { ok: false, error: '读取同步状态失败' }); }
+  if (isLegacySyncRecord(record)) return sendJson(res, 409, { ok: false, error: 'legacy 单子不参与同步' });
+  if (record.sync_status !== 'running') {
+    return sendJson(res, 409, { ok: false, error: `当前状态 ${record.sync_status}，先 claim 再下载` });
+  }
+  const archive = path.join(SYNC_CACHE,
+    `${crypto.createHash('sha256').update(resolved.ticket).digest('hex')}.tar.gz`);
+  let stat;
+  try { stat = fs.statSync(archive); }
+  catch { return sendJson(res, 409, { ok: false, error: '下载包缺失，请重新 claim' }); }
+  if (record.sync_package_sha256) {
+    const actual = await hashSyncArchive(archive);
+    if (actual !== record.sync_package_sha256) {
+      return sendJson(res, 409, { ok: false, error: '下载包哈希不一致，请重新 claim' });
+    }
+  }
+  res.writeHead(200, {
+    'Content-Type': 'application/gzip',
+    'Content-Length': String(stat.size),
+    'Cache-Control': 'no-store',
+    'X-Content-Type-Options': 'nosniff',
+  });
+  try {
+    await pipeline(fs.createReadStream(archive, { highWaterMark: 512 * 1024 }), res);
+  } catch { res.destroy(); }
+}
+
+async function handleSyncResult(req, res) {
+  handleJsonBody(req, res, SYNC_RESULT_MAX_BODY, async (payload) => {
+    const resolved = resolveSyncTicket(payload.ticket);
+    if (!resolved) return sendJson(res, 400, { ok: false, error: 'ticket 非法或不存在' });
+    if (!['done', 'failed', 'blocked'].includes(payload.status)) {
+      return sendJson(res, 400, { ok: false, error: 'status 必须是 done / failed / blocked' });
+    }
+    if (!payload.manifest || typeof payload.manifest !== 'object') {
+      return sendJson(res, 400, { ok: false, error: 'manifest 缺失或不是对象' });
+    }
+    let record;
+    try { record = readJsonSync(resolved.recordPath); }
+    catch { return sendJson(res, 500, { ok: false, error: '读取同步状态失败' }); }
+    if (isLegacySyncRecord(record)) return sendJson(res, 409, { ok: false, error: 'legacy 单子不参与同步' });
+    if (record.sync_status !== 'running') {
+      return sendJson(res, 409, { ok: false, error: `当前状态 ${record.sync_status}，result 只结算 running 单子` });
+    }
+
+    const files = Array.isArray(payload.files) ? payload.files : [];
+    const resultRoot = resolved.isPackage
+      ? path.join(resolved.root, 'sync_results')
+      : path.join(INBOX, 'sync_results', resolved.ticket);
+    fs.mkdirSync(resultRoot, { recursive: true });
+    const written = [];
+    try {
+      for (const item of files) {
+        const rel = item && typeof item.path === 'string' ? safeResultPath(resultRoot, item.path) : null;
+        if (!rel) throw new Error(`结果文件路径非法: ${String(item && item.path)}`);
+        const bytes = Buffer.from(String(item.content_base64 || ''), 'base64');
+        if (item.content_base64 && !bytes.length) throw new Error(`结果文件内容为空: ${item.path}`);
+        fs.mkdirSync(path.dirname(rel), { recursive: true });
+        fs.writeFileSync(rel, bytes);
+        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
+        if (item.sha256 && !tokensEqual(item.sha256, sha256)) {
+          throw new Error(`结果文件 sha256 不一致: ${item.path}`);
+        }
+        written.push({
+          path: item.path,
+          size: bytes.length,
+          sha256,
+          content_included: Boolean(item.content_base64),
+        });
+      }
+    } catch (cause) {
+      return sendJson(res, 400, {
+        ok: false,
+        error: `结果文件校验失败: ${cause instanceof Error ? cause.message : String(cause)}`,
+      });
+    }
+
+    const receivedAt = new Date().toISOString();
+    const syncResult = {
+      ticket: resolved.ticket,
+      status: payload.status,
+      manifest: payload.manifest,
+      files: written,
+      received_at: receivedAt,
+    };
+    writeJsonAtomic(path.join(resultRoot, 'sync_result.json'), syncResult);
+    record.sync_status = payload.status;
+    record.sync_urgent = false;
+    record.sync_result = syncResult;
+    record.sync_updated_at = receivedAt;
+    writeJsonAtomic(resolved.recordPath, record);
+    return sendJson(res, 200, { ok: true, ticket: resolved.ticket, status: payload.status });
+  });
+}
+
+function handleSyncTrigger(req, res) {
+  handleJsonBody(req, res, 16 * 1024, async (payload) => {
+    const resolved = resolveSyncTicket(payload.ticket);
+    if (!resolved) return sendJson(res, 400, { ok: false, error: 'ticket 非法或不存在' });
+    const now = Date.now();
+    const last = TRIGGER_LIMITS.get(resolved.ticket) || 0;
+    if (now - last < TRIGGER_COOLDOWN_MS) {
+      const retryAfter = Math.max(1, Math.ceil((TRIGGER_COOLDOWN_MS - (now - last)) / 1000));
+      return sendJson(res, 429, { ok: false, retry_after: retryAfter, error: '稍后重试' });
+    }
+    let record;
+    try { record = readJsonSync(resolved.recordPath); }
+    catch { return sendJson(res, 500, { ok: false, error: '读取同步状态失败' }); }
+    if (isLegacySyncRecord(record)) return sendJson(res, 409, { ok: false, error: 'legacy 单子不参与同步' });
+    TRIGGER_LIMITS.set(resolved.ticket, now);
+    record.sync_urgent = true;
+    record.sync_updated_at = new Date().toISOString();
+    writeJsonAtomic(resolved.recordPath, record);
+    return sendJson(res, 200, { ok: true, ticket: resolved.ticket, urgent: true });
+  });
+}
+
+function handleSyncStatus(req, res, url) {
+  const resolved = resolveSyncTicket(url.searchParams.get('ticket'));
+  if (!resolved) return sendJson(res, 400, { ok: false, error: 'ticket 非法或不存在' });
+  let record;
+  try { record = readJsonSync(resolved.recordPath); }
+  catch { return sendJson(res, 500, { ok: false, error: '读取同步状态失败' }); }
+  if (isLegacySyncRecord(record)) {
+    return sendJson(res, 200, {
+      ok: true, ticket: resolved.ticket, sync_status: 'legacy',
+      sync_urgent: false, manifest: null, files: [], result_at: '',
+    });
+  }
+  return sendJson(res, 200, syncStatusPayload(resolved.ticket, record));
+}
+
+function handleSyncResultFile(req, res, url) {
+  const resolved = resolveSyncTicket(url.searchParams.get('ticket'));
+  if (!resolved) return sendJson(res, 400, { ok: false, error: 'ticket 非法或不存在' });
+  const rel = url.searchParams.get('path') || '';
+  // 包形态的结果在包内 sync_results；扁平单子的结果在全局
+  // sync_results/<ticket>/，不能把 ticket 段漏掉。
+  const root = resolved.isPackage
+    ? path.join(resolved.root, 'sync_results')
+    : path.join(INBOX, 'sync_results', resolved.ticket);
+  const target = safeResultPath(root, rel);
+  const ext = path.extname(String(rel || '')).toLowerCase();
+  const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.svg']);
+  if (!target || !IMAGE_EXT.has(ext)) {
+    return sendJson(res, 400, { ok: false, error: '结果文件路径非法或不是图像' });
+  }
+  let stat;
+  try { stat = fs.statSync(target); }
+  catch { return sendJson(res, 404, { ok: false, error: '结果文件缺失' }); }
+  if (!stat.isFile()) return sendJson(res, 400, { ok: false, error: '结果文件不是普通文件' });
+  const type = ext === '.png' ? 'image/png'
+    : ext === '.svg' ? 'image/svg+xml'
+    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
+  const bytes = fs.readFileSync(target);
+  res.writeHead(200, {
+    'Content-Type': type,
+    'Content-Length': String(bytes.length),
+    'Cache-Control': 'no-store',
+    'X-Content-Type-Options': 'nosniff',
+  });
+  return res.end(bytes);
+}
+
 /** 人类可读的字节数：按 KiB/MiB/GiB 取整显示（5GiB 不显示成莫名的 5120MB） */
 function humanBytes(bytes) {
   const units = [['GiB', 1024 ** 3], ['MiB', 1024 ** 2], ['KiB', 1024]];
@@ -374,6 +1172,13 @@ function handleSubmit(req, res) {
         error: `数据类型缺失或非法: ${JSON.stringify(dataType ?? null)}（应为本端 index.html 提供的四种之一）`,
       });
     }
+    const figureCheck = validateFigureTemplateSelections(payload);
+    if (!figureCheck.ok) {
+      return sendJson(res, 400, {
+        ok: false,
+        error: `图模板校验未通过: ${figureCheck.errors.join('；')}`,
+      });
+    }
     // 数据集↔平台配对：至少一组，且每组必须填 GSE（GPL 决定线内预处理分支，测序数据可留空）。
     // 多组数据必须逐行标明对应关系，否则下游分不清哪个平台属于哪个数据集，预处理会跑偏。
     const datasets = payload.dataSource.datasets;
@@ -441,6 +1246,9 @@ function handleSubmit(req, res) {
       const pkgDir = path.join(INBOX, plan.packageDir);
       try {
         fs.mkdirSync(pkgDir, { recursive: true });
+        payload.sync_status = 'pending';
+        payload.sync_urgent = false;
+        payload.sync_created_at = new Date().toISOString();
         // 需求与包清单
         fs.writeFileSync(path.join(INBOX, plan.requirementPath),
           JSON.stringify(payload, null, 2), 'utf8');
@@ -496,10 +1304,15 @@ function handleSubmit(req, res) {
     }
 
     // 扁平形态（老客户端，无数据文件）
-    const filename = `${stamp()}_需求_${safeName(projectName)}.json`;
+    // 同步归档与 Linux 解析链只吃 ASCII 文件名；原始中文项目名仍完整保存在 JSON 正文。
+    const asciiProjectName = safeName(projectName).replace(/[^\w-]+/g, '_') || 'requirement';
+    const filename = `${stamp()}_requirement_${asciiProjectName}.json`;
     const target = uniquePath(path.join(INBOX, filename));
     try {
       fs.mkdirSync(INBOX, { recursive: true });
+      payload.sync_status = 'pending';
+      payload.sync_urgent = false;
+      payload.sync_created_at = new Date().toISOString();
       fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
     } catch (cause) {
       return sendJson(res, 500, { ok: false, error: `写入收件箱失败: ${cause instanceof Error ? cause.message : String(cause)}` });
@@ -583,6 +1396,50 @@ const server = http.createServer((req, res) => {
     return res.end(html);
   }
 
+  // 模式 A 两个静态页：需求填写与结果选择。文件名写死在白名单里，不做目录穿越。
+  const SURVEY_PAGES = {
+    '/survey_request.html': 'survey_request.html',
+    '/survey_result.html': 'survey_result.html',
+  };
+  if (SURVEY_PAGES[url.pathname]) {
+    const file = fileURLToPath(new URL(`./${SURVEY_PAGES[url.pathname]}`, import.meta.url));
+    try {
+      const html = fs.readFileSync(file, 'utf8');
+      res.writeHead(200, {
+        'Content-Type': 'text/html; charset=utf-8',
+        'Cache-Control': 'no-cache',
+        'X-Content-Type-Options': 'nosniff',
+      });
+      return res.end(html);
+    } catch (cause) {
+      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
+      return res.end(`读取 ${SURVEY_PAGES[url.pathname]} 失败: ${cause instanceof Error ? cause.message : String(cause)}`);
+    }
+  }
+
+  const CATALOG_ASSETS = {
+    '/figure-catalog': ['figure_catalog.html', 'text/html; charset=utf-8'],
+    '/figure-catalog.html': ['figure_catalog.html', 'text/html; charset=utf-8'],
+    '/figure_catalog.css': ['figure_catalog.css', 'text/css; charset=utf-8'],
+    '/figure_catalog.js': ['figure_catalog.js', 'text/javascript; charset=utf-8'],
+  };
+  if (CATALOG_ASSETS[url.pathname]) {
+    const [name, contentType] = CATALOG_ASSETS[url.pathname];
+    const file = fileURLToPath(new URL(`./${name}`, import.meta.url));
+    try {
+      const body = fs.readFileSync(file);
+      res.writeHead(200, {
+        'Content-Type': contentType,
+        'Cache-Control': 'no-cache',
+        'X-Content-Type-Options': 'nosniff',
+      });
+      return res.end(body);
+    } catch (cause) {
+      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
+      return res.end(`读取 ${name} 失败: ${cause instanceof Error ? cause.message : String(cause)}`);
+    }
+  }
+
   // 三个写端点在启用 PORTAL_TOKEN 时要求令牌；未启用时 checkToken 直接放行（历史行为）
   const PROTECTED_API = url.pathname === '/api/submit'
     || url.pathname === '/api/datafiles'
@@ -608,6 +1465,102 @@ const server = http.createServer((req, res) => {
     return handleReferenceUpload(req, res, url);
   }
 
+  // Sync 编排面接口：只接受独立 SYNC_TOKEN，客户登录 token 不得触发下载或结算。
+  const SYNC_ORCHESTRATION = url.pathname === '/api/sync/pending'
+    || url.pathname === '/api/sync/claim'
+    || url.pathname === '/api/sync/package'
+    || url.pathname === '/api/sync/result';
+  if (SYNC_ORCHESTRATION) {
+    const verdict = checkSyncAuth(req, url);
+    if (!verdict.ok) {
+      console.warn(`[user-portal] sync 鉴权失败: ${req.method} ${url.pathname}`);
+      return sendJson(res, 401, { ok: false, error: verdict.error });
+    }
+  }
+  if (url.pathname === '/api/sync/pending' && req.method === 'GET') {
+    return sendJson(res, 200, { ok: true, tickets: listPendingSyncTickets() });
+  }
+  if (url.pathname === '/api/sync/claim' && req.method === 'POST') {
+    return handleSyncClaim(req, res);
+  }
+  if (url.pathname === '/api/sync/package' && req.method === 'GET') {
+    return handleSyncPackage(req, res, url);
+  }
+  if (url.pathname === '/api/sync/result' && req.method === 'POST') {
+    return handleSyncResult(req, res);
+  }
+
+  // 客户侧 sync 接口：客户登录 token 与编排面 token 各自独立。
+  if (url.pathname === '/api/sync/trigger' || url.pathname === '/api/sync/status'
+    || url.pathname === '/api/sync/results/file') {
+    const verdict = checkClientSyncAuth(req, url);
+    if (!verdict.ok) {
+      console.warn(`[user-portal] 客户 sync 鉴权失败: ${req.method} ${url.pathname}`);
+      return sendJson(res, 401, { ok: false, error: verdict.error });
+    }
+  }
+  if (url.pathname === '/api/sync/trigger' && req.method === 'POST') {
+    return handleSyncTrigger(req, res);
+  }
+  if (url.pathname === '/api/sync/status' && req.method === 'GET') {
+    return handleSyncStatus(req, res, url);
+  }
+
+  if (url.pathname === '/api/sync/results/file' && req.method === 'GET') {
+    return handleSyncResultFile(req, res, url);
+  }
+
+  if (url.pathname === '/api/figure-templates' && req.method === 'GET') {
+    try { return sendJson(res, 200, figureTemplatesPayload()); }
+    catch (cause) {
+      return sendJson(res, 500, {
+        ok: false,
+        error: `读取图模板注册表失败: ${cause instanceof Error ? cause.message : String(cause)}`,
+      });
+    }
+  }
+
+  if (url.pathname === '/api/figure-templates/preview' && req.method === 'GET') {
+    return handleFigureTemplatePreview(req, res, url);
+  }
+
+  if (url.pathname === '/api/figures/catalog' && req.method === 'GET') {
+    const check = validateFigureCatalog();
+    const entries = searchFigureCatalog({
+      query: url.searchParams.get('q') || '',
+      language: url.searchParams.get('language') || '',
+      status: url.searchParams.get('status') || '',
+      limit: url.searchParams.get('limit') || 50,
+    });
+    return sendJson(res, 200, {
+      ok: check.ok,
+      catalog_ok: check.ok,
+      catalog_errors: check.errors,
+      stats: check.stats,
+      entries,
+    });
+  }
+
+  if (url.pathname === '/api/figures/catalog/preview' && req.method === 'GET') {
+    const catalogId = url.searchParams.get('id') || '';
+    const resolved = resolveCatalogFigure(catalogId);
+    if (!resolved.ok || !resolved.preview_abs) {
+      return sendJson(res, 404, {
+        ok: false,
+        error: `候选图预览不可用: ${catalogId}`,
+        errors: resolved.errors,
+      });
+    }
+    const stat = fs.statSync(resolved.preview_abs);
+    res.writeHead(200, {
+      'Content-Type': 'image/png',
+      'Content-Length': stat.size,
+      'Cache-Control': 'no-store',
+    });
+    fs.createReadStream(resolved.preview_abs).pipe(res);
+    return;
+  }
+
   if (url.pathname === '/health') {
     // auth_required：客户端靠它决定是否显示 token 输入区（不删既有字段）
     return sendJson(res, 200, {
@@ -616,6 +1569,172 @@ const server = http.createServer((req, res) => {
     });
   }
 
+  // 模式 A：调研需求单接收。只收方向，不收要素卡（要素卡由调研过程自己填）。
+  if (url.pathname === '/api/survey/request' && req.method === 'POST') {
+    let raw = '';
+    let tooBig = false;
+    req.on('data', (c) => {
+      raw += c;
+      if (raw.length > 64 * 1024) { tooBig = true; req.destroy(); }
+    });
+    req.on('end', () => {
+      if (tooBig) return sendJson(res, 413, { error: '需求单过大' });
+      let payload;
+      try { payload = JSON.parse(raw || '{}'); }
+      catch { return sendJson(res, 400, { error: '请求体不是合法 JSON' }); }
+
+      // 肿瘤/免疫词面快筛（准入第一道闸）：与建项共用同一份权威实现，
+      // 不在本服务另写一份正则。语义级准入（筛子 L0）是第二道，由调研侧执行。
+      const bl = validateProjectFields({
+        disease: payload.disease, interest: payload.interest,
+        tissue: payload.tissue, clue: payload.clue,
+      });
+      if (bl.hit) {
+        return sendJson(res, 422, {
+          error: '需求内容命中平台排除范围（非肿瘤、非免疫专精）',
+          field: bl.field, matched: bl.matches,
+        });
+      }
+
+      const r = saveSurveyRequest(payload);
+      if (!r.ok) return sendJson(res, 422, { error: r.error });
+      return sendJson(res, 200, { ok: true, ticket_id: r.ticketId, status: r.status });
+    });
+    return undefined;
+  }
+
+  // 模式 A：结果页登记客户选中的课题。只回写 selection，不改调研结论。
+  if (url.pathname === '/api/survey/select' && req.method === 'POST') {
+    let raw = '';
+    req.on('data', (c) => { raw += c; if (raw.length > 16 * 1024) req.destroy(); });
+    req.on('end', () => {
+      let payload;
+      try { payload = JSON.parse(raw || '{}'); }
+      catch { return sendJson(res, 400, { error: '请求体不是合法 JSON' }); }
+
+      const tid = String(payload.ticket_id || '');
+      if (!/^TSV-\d{8}-[0-9a-f]{8}$/.test(tid)) {
+        return sendJson(res, 400, { error: 'ticket 格式不正确' });
+      }
+      const ids = Array.isArray(payload.topic_ids)
+        ? [...new Set(payload.topic_ids.map((x) => String(x)).filter((x) => /^T[1-9]$/.test(x)))]
+        : [];
+      if (!ids.length) return sendJson(res, 422, { error: '至少选择一个课题（T1 到 T9）' });
+
+      const file = path.join(INBOX, `${tid}.json`);
+      if (!fs.existsSync(file)) return sendJson(res, 404, { error: '找不到该调研单' });
+      let rec;
+      try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); }
+      catch { return sendJson(res, 500, { error: '调研单读取失败' }); }
+
+      rec.selection = { topic_ids: ids, selected_at: new Date().toISOString() };
+      if (rec.status === 'pending') rec.status = 'selected';
+      try {
+        fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, 'utf8');
+      } catch (cause) {
+        return sendJson(res, 500, { error: `回写失败: ${cause instanceof Error ? cause.message : String(cause)}` });
+      }
+      return sendJson(res, 200, { ok: true, ticket_id: tid, selected: ids, status: rec.status });
+    });
+    return undefined;
+  }
+
+  // 模式 A：结果页按 ticket 读调研进度与结论。
+  if (url.pathname === '/api/survey/result' && req.method === 'GET') {
+    const tid = String(url.searchParams.get('ticket') || '');
+    if (!/^TSV-\d{8}-[0-9a-f]{8}$/.test(tid)) {
+      return sendJson(res, 400, { error: 'ticket 格式不正确' });
+    }
+    const file = path.join(INBOX, `${tid}.json`);
+    if (!fs.existsSync(file)) return sendJson(res, 404, { error: '找不到该调研单' });
+    try {
+      const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
+      return sendJson(res, 200, rec);
+    } catch {
+      return sendJson(res, 500, { error: '调研单读取失败' });
+    }
+  }
+
+  // 工作流定义（只读）：让客户端的步骤勾选有唯一数据源。
+  // 为什么 portal 自己读文件而不转发工作台：本服务与工作台彻底解耦是既有设计
+  // （见文件头），不挂工作台任何 API。注册表 src/workflows.json 是静态文件，
+  // 直读既不破坏解耦，也避免"工作台没起客户端就点不了步骤"。
+  // 只暴露展示必需字段，不透出依赖图内部结构。
+  if (url.pathname === '/api/workflows') {
+    try {
+      const regPath = path.resolve(REPO_ROOT, 'src', 'workflows.json');
+      const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
+      const series = reg.series.map((s) => ({
+        id: s.id,
+        name: s.name,
+        data_form: s.data_form,
+        language_profile: s.language_profile,
+        stages: [...s.stages]
+          .sort((a, b) => a.order - b.order)
+          .map((st) => ({
+            id: st.id,
+            name: st.name,
+            order: st.order,
+            required: !!st.required,
+            notes: st.notes || '',
+            mods: st.mods.map((m) => ({
+              id: m.id,
+              name: m.name,
+              desc: m.desc || m.name,
+              tool: m.tool || '',
+              language: m.language,
+              est_minutes: m.est_minutes,
+              // 前端 renderWorkflowSummary 已支持峰值内存预估，缺这个字段就只显示时长
+              peak_mem_mb: m.peak_mem_mb,
+              optional: !!m.optional,
+              ko_gene: !!m.ko_gene,
+              risk: m.risk || '',
+            })),
+          })),
+      }));
+      return sendJson(res, 200, { series, constraints: reg.constraints });
+    } catch (cause) {
+      return sendJson(res, 500, {
+        error: `读取工作流注册表失败: ${cause instanceof Error ? cause.message : String(cause)}`,
+      });
+    }
+  }
+
+  // 组合预检（与工作台 /api/workflows/resolve 同语义，本地实现）。
+  // 为什么不在 portal 转发到工作台：本服务与工作台彻底解耦是既有设计，
+  // 且工作台可能没起:预检是增强项，不该因为工作台不在就废掉客户勾选。
+  // 合法性判定与工作台共用同一份注册表，结论不会分叉。
+  if (url.pathname === '/api/workflows/resolve' && req.method === 'POST') {
+    let body = '';
+    req.on('data', (chunk) => { body += chunk; });
+    req.on('end', () => {
+      let parsed = {};
+      try {
+        parsed = body.trim() ? JSON.parse(body) : {};
+      } catch (cause) {
+        return sendJson(res, 400, { error: `请求体不是合法 JSON: ${cause.message}` });
+      }
+      const seriesId = String(parsed.seriesId || '').trim();
+      const modIds = Array.isArray(parsed.modIds) ? parsed.modIds.map(String) : [];
+      const koGene = String(parsed.koGene || '').trim();
+      if (!seriesId) return sendJson(res, 400, { error: '缺少 seriesId' });
+      if (!modIds.length) return sendJson(res, 400, { error: 'modIds 不能为空' });
+
+      try {
+        const regPath = path.resolve(REPO_ROOT, 'src', 'workflows.json');
+        const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
+        const result = resolveLocally(reg, seriesId, modIds, koGene);
+        // 非法组合回 422：调用方传错了，不是服务端故障（与工作台一致）
+        return sendJson(res, result.ok ? 200 : 422, result);
+      } catch (cause) {
+        return sendJson(res, 500, {
+          error: `组合预检失败: ${cause instanceof Error ? cause.message : String(cause)}`,
+        });
+      }
+    });
+    return;
+  }
+
   res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
   res.end('Not Found');
 });

