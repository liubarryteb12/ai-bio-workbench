# AI 辅助生信分析流程工作台 · Agent 指引

本文件每轮都进上下文，所以只放**导航指针**和少量硬规则。
流程与规范正文在 `docs/` 下，按下面的表去够，不要把正文抄进来。

## 先读这些

| 当你 | 读 |
|---|---|
| 要知道架构宪法、路由表、范围红线、术语、重构契约在哪 | 根目录 `SPEC.md`、`ROUTER.yaml`、`SCOPE.md`、`GLOSSARY.md`、`MIGRATION.md`（2026-11-08 整体重构 W1 已上移，判据见 `MIGRATION.md`） |
| 动 `src/` 下任何分析代码前 | [docs/coding-standards.md](docs/coding-standards.md)（Linux 运行面、seed 契约、退出码） |
| 跨线搬数据、定文件放哪 | [docs/isolation.md](docs/isolation.md)（三线隔离）、[docs/directories.md](docs/directories.md)（文件放哪） |
| 开始一项功能、改架构、写 spec 或票 | [docs/mattpocock-workflow-spec.md](docs/mattpocock-workflow-spec.md) |
| 写或改 skill、`AGENTS.md`、任何 agent 会读的文档 | [docs/mattpocock-writing-spec.md](docs/mattpocock-writing-spec.md) |
| 跑 K40 / 部署 / 台账相关 | [docs/isolation.md](docs/isolation.md) 起手，再看 `ops/` 与具体线文档 |
| 远程执行 / 设备连不上 | [docs/remote_channel_policy.md](docs/remote_channel_policy.md)（ADB 主通道，SSH 仅显式特殊开关） |
| 出图或改图件模板 | [docs/figure_spec.md](docs/figure_spec.md)（v2.3：只出单图，300 DPI，图例外置右侧，图注左下） |
| 自动执行客户项目（发工单出回执） | [docs/WORK_ORDER_ORCHESTRATOR.md](docs/WORK_ORDER_ORCHESTRATOR.md)（工单 schema、fail closed 判据、回执落点） |
| 增删生信分析模块或改 `src/workflows.json` | 先跑 `node ops/module_ablation_matrix_gate.mjs`，判据见 [docs/MODULE_ABLATION_MATRIX.md](docs/MODULE_ABLATION_MATRIX.md) |
| 做课题设计、选题准入判定、筛数据 | [docs/topic_sieve_spec.md](docs/topic_sieve_spec.md)（规则正本：L0 到 L4 与 T1 到 T9） |
| 派「按方向调研数据」的活 | [docs/topic_survey_sop.md](docs/topic_survey_sop.md)（模式 A 执行规程） |

隔离红线优先于上面任何一份。

## 硬规则

- 分析代码跑在 k40-ubuntu 容器，按 Linux 面写：shebang + `set -euo pipefail`、LF 行尾、
  POSIX 路径、纯英文路径与文件名、脚本 755。`ops/` 下的 PowerShell 只做本地运维，不受此约束。
- **算力与内存红线（硬件受限运行面硬约束）**：运行环境为 8GB 内存设备（容器配额 7680 MB，纯 ARM CPU）。
  空间与单细胞解卷积分析必须保持轻量 `scipy.optimize.nnls`（单步内存 $\le 2.2\text{ GB}$），
  严禁在生产流水线上引入 `cell2location`、`Stereoscope`、`RCTD` 等深度学习或重型迭代回归算法（会直接导致 OOM Exit 137 或高温降频死锁）。
  反卷积精度提升一律走零算力路线：上游提纯输入 Marker（每个亚型严格限 Top 20 特异基因）与输出端 $<0.05$ 极低丰度硬截断。
  参考库中的 RCTD 等重型代码仅作为外部 PC 资产或客户专属交付件，严禁合并进生产流水线。
- 中文可进注释与报告正文。文档里不用 em dash，用逗号、冒号、句号、括号。
- **计算与文件传输默认走 ADB**：主计算入口、任务回执与新增文件传输一律经 `ops/adb_exec.ps1` 或 `BioanalysDesktop/server/adb_transfer.js`；SSH 只在显式 `BIO_COMPUTE_ADAPTER=ssh` 或 `-Transport ssh` 的特殊场景启用，禁用自动回落。
- **生产图件只出单图**：组合图模板保持 draft/pending，Ready 基线见 `ops/figure_ready_allowlist.json`；新增模板先过 `figure_ready_matrix` 与 `figure_code_gate`。
- 展示任何命令、输出、捕获产物前先打码：secret 一律写 `<REDACTED>`，别打印凭证或 key。
- **交付报告只写对读者有意义的事实**：统计量来源、口径、可追溯性。
  机器名、主机名与绝对路径、运行环境（容器/终端/架构）、内部脚本目录、
  「真机」「服务器」这类设施用语，一律不进报告正文与页脚。
  这类信息属透露分析设施，按商业机密对待。
  判据由 `BioanalysDesktop/tests/report_redaction_contract.test.js` 守着
  （扫正文时先剥离 base64 图片载荷，否则随机字符会误命中）。
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
