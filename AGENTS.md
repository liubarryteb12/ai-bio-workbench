# AI 辅助生信分析流程工作台 · Agent 指引

本文件每轮都进上下文，所以只放**导航指针**、**板块角色拓扑**和**少量硬规则**。
流程与规范正文在 `docs/`、各板块 `aims/` 与 `schemas/` 下，按下面的表去够，只在本文档保留查不到的工程铁律与踩坑约定。

## 先读这些

| 当你 | 读 |
|---|---|
| 动 `src/` 下任何分析代码前 | [docs/coding-standards.md](https://www.google.com/search?q=docs/coding-standards.md)（Linux 运行面、seed 契约、退出码） |
| 跨线搬数据、定文件放哪 | [docs/isolation.md](https://www.google.com/search?q=docs/isolation.md)（三线隔离）、[docs/directories.md](https://www.google.com/search?q=docs/directories.md)（文件放哪） |
| 开始一项功能、改架构、写 spec 或票 | [docs/mattpocock-workflow-spec.md](https://www.google.com/search?q=docs/mattpocock-workflow-spec.md) |
| 写或改 skill、`AGENTS.md`、任何 agent 会读的文档 | [docs/mattpocock-writing-spec.md](https://www.google.com/search?q=docs/mattpocock-writing-spec.md) |
| 推进四大板块演进、查跨端数据流与 `1 + N×3` 结构 | [docs/proposals/4\_sectors\_architecture\_expert\_report.md](https://www.google.com/search?q=docs/proposals/4_sectors_architecture_expert_report.md) 及各板块 `aims/`、`reference/` |
| 跑 K40 / 部署 / 幂等执行 / 遥测保活 | [docs/isolation.md](https://www.google.com/search?q=docs/isolation.md) 起手，再看 `ops/bio_limits.sh`、`ops/pi_idempotent_runner.sh`、`pi_telemetry_sidecar.py` |
| 做课题设计、选题准入判定、筛数据 | [docs/topic\_sieve\_spec.md](https://www.google.com/search?q=docs/topic_sieve_spec.md)（规则正本：L0 到 L4 与 T1 到 T9） |
| 派「按方向调研数据」的活 | [docs/topic\_survey\_sop.md](https://www.google.com/search?q=docs/topic_survey_sop.md)（模式 A 执行规程）与 `.agents/skills/topic-survey` |
| 校验客户端输入、管线清单、三联产物或终验评分 | `schemas/` 下对应 Schema（`requirement`、`execution_manifest`、`artifact_triad`、`acceptance_card`） |
| 读写治理台账、追踪任务状态与外包渠道归因 | `con_hf/ledger/*.jsonl`（双层五类追加式台账规范） |

隔离红线优先于上面任何一份。

## 四大板块与六大职能角色路由

架构按四个板块切分目录，运行时保持「服务端与 AI 进程内合体、手机端纯粹算力自治」：

| 板块目录 | 物理运行面 | 挂载的虚拟角色（`.agents/prompts/`） | 核心输入与输出契约 |
|---|---|---|---|
| `01_mobile_compute/` | Redmi K40 (`k40-ubuntu` ARM64 容器) | **Role 3 边缘算力与自愈 SRE** | 收 A2A 任务，经 `pi_idempotent_runner.sh` 产三联 Artifact (`json + diff + sha256`) |
| `02_client_ui/` | `portal/` 与 `BioanalysDesktop` 前端 | **Role 0 外包门禁与商业归因官** | 收模式 A/B 表单与 `_attribution` 渠道参数，按 Schema 产 `requirement.json` |
| `03_server_orchestrator/` | `BioanalysDesktop/server` (`127.0.0.1:18787`) | **Role 2 中枢调度与隔离守卫**、**Role 5 台账巡检官** | 校验三线隔离与 SHA256，走 Tailscale 派单，追加写入 `con_hf/ledger/*.jsonl`，打包 `deliverables/` |
| `04_ai_automation/` | 嵌入 `03_server` 进程内异步中间件 | **Role 1 生信首席规划官**、**Role 4 独立终验审计官** | 规划 `execution_manifest.json`（含算力筛），执行双阶段终验产 `acceptance_card.json` 与解读报告 |

## 硬规则

### 编码与文档面
- 分析代码跑在 `k40-ubuntu` 容器，按 Linux 面写：shebang + `set -euo pipefail`、LF 行尾、POSIX 路径、纯英文路径与文件名、脚本 755。`ops/` 下的 PowerShell 只做本地运维，不受此约束。
- 中文可进注释与报告正文。文档里一律使用逗号、冒号、句号、括号，杜绝使用破折号（em dash）。
- 展示任何命令、输出、捕获产物前先打码：secret 一律写 `<REDACTED>`。
- 一个含义一个真源。只缓存查不到的工程约定、取舍理由与配置陷阱，配置或 `--help` 已有的内容直接引用路径。
- 多行代码与长字符串一律落盘成 `.cjs` / `.ps1` / `.py` / `.sh` / `.md` 文件再执行。PowerShell 超二十行的内容用 here-string `@'` 与 `'@` 包裹（两者各自单独占一行）。短字符串默认单引号，只有确定要展开变量时才用双引号。
- 规则表述采用正面目标动词，明确写出期望落地的行为；每句话相对默认行为必须产生实际约束增量。

### 隔离、存储与算力面
- 三线数据（`line1_bulk`、`line2_scrna`、`line3_spatial`）严格拘束在各自沙箱根路径内，派单前执行规范化路径断言，阻断相对路径上溯（`..`）与跨线引用。
- 手机端全部读写、临时目录（`TMPDIR`）、HDF5/RDS 对象与 `.lock`/`.done` 检查点统一落盘在 Termux 原生 `ext4` 分区，避开 `/sdcard` 与 `/storage/emulated` 等 FUSE 挂载区。
- 算力面默认线程数为 3，与 `ops/bio_limits.sh` 一致，`BIO_MAX_THREADS` 可显式覆盖；单节点并发上限 `maxConcurrent: 2`；全局随机种子固定为 `seed=20261013`。
- 生成 `execution_manifest.json` 时执行前置算力准入筛（单步安全内存水位 5.5GB）：单细胞任务超 20,000 细胞或预估超内存水位时，前置插入 `geosketch` 降采样（上限 15,000 细胞）并开启 `AnnData(backed='r')`；`scTenifoldKnk` 输入高变基因控制在 3,000 以内。
- 手机端任务统一经 `ops/pi_idempotent_runner.sh` 以 `setsid` 独立进程组启动，命中 `.done` 与完整 `.triad.json` 时直接返回幂等缓存。
- 遥测边车 `pi_telemetry_sidecar.py` 在电池温度达 43.0°C 时发送 `SIGSTOP` 挂起计算进程组，回落至 39.0°C 时发送 `SIGCONT` 恢复；服务端轮询遇到 `THROTTLED_PAUSED` 状态时自动顺延超时计时器。

### 通信、终验与台账面
- A2A v1.0 (JSON-RPC 2.0) 通信固定走 Tailscale 专网（`100.64.0.0/10`），环境变量显式设置 `NO_PROXY="100.64.0.0/10,127.0.0.1,localhost"` 并在客户端关闭系统代理读取。
- 传算分离：JSON-RPC 报文只传 4MB 以内的控制指令与三联摘要（退出码、SHA256、截取 `stdout` 首尾 40 行与 `stderr` 尾部 60 行的削峰日志），矩阵与图件走独立文件流同步。
- 双阶段终验：第一阶段核验退出码为 0、SHA256 吻合、文件体积达标及图件首尾二进制魔数完整（PNG 首部签名加尾部 `IEND`，PDF 首部 `%PDF-` 加尾部 `%%EOF`）；第二阶段核验生物学合理性评分卡（达 75 分放行），报告数值 100% 溯源至统计结果摘要。
- 交付包 `deliverables/` 统一打包客户四大件：终验解读报告、高清图表集、统计结果表、以及 `04_Reproducibility_Capsule.zip`（含锁定版 Manifest、终验评分卡、SHA256 清单与 `sessionInfo` 版本快照）。
- 状态流转、隔离断言、算力消耗、终验结论与外包归因（`_attribution`）统一通过文件锁以原子追加方式写入 `con_hf/ledger/*.jsonl`，维护 `prev_record_sha256` 哈希链完整。

## 做事方式

按 [docs/mattpocock-workflow-spec.md](https://www.google.com/search?q=docs/mattpocock-workflow-spec.md) 走，要点是：

- 动手前先对齐。需求模糊或样本元数据缺失时先把问题问清。查事实是 AI 的活，做决策是用户的活。
- 每一步终于一个**说得清做完没做完**的判据（Schema 校验通过、测试变绿、魔数与 SHA256 对账吻合）。
- 有测试可跑就 test-first，一个垂直切块一个切块地推，先红后绿。
- 卡住或生信脚本报错时，先基于削峰日志和退出码建立对**这个**问题会变红的反馈环，定位属于 OOM、脏数据还是参数收敛问题，再输出最小化补丁（同一 `step_id` 自愈重试上限为 2 次，保留上游已完成节点的 `.done` 缓存）。
- 做完自己 review 一遍（含检查破折号、路径越界与硬编码凭证）再交付。

## Agent skills

### Issue tracker

Issues live in GitHub Issues at `liubarryteb12/ai-bio-workbench`, accessed via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default five canonical triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. See `docs/agents/domain.md`.

### Role prompts & topic survey

Role prompts (`Role 0` to `Role 5`) live in `.agents/prompts/`. Mode A topic survey skill lives in `.agents/skills/topic-survey`.
