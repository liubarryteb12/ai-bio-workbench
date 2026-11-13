# 项目全景透视（2026-11-11）

> 用途：给外部评审、合作方或接手人一份可共同讨论的系统全景。
> 口径：以当前工作树为准，静态扫描与本地实测。实测结果：总门禁 25 道全绿，全量测试 1996 用例通过。
> 边界：本轮未连接算力设备做真实业务复跑，设备侧结论引自仓库契约与历史取证。
> 重要提示：工作树当前有 174 个已跟踪文件改动和 7 项未跟踪资产，尚未形成收口提交。本文同时标注“已提交基线”和“在途变更”。
> 性质：本文是 2026-11-11 的讨论快照，不是新的真源。与 `SPEC.md`、`SCOPE.md`、`workflows.json` 等冲突时，以那些文件为准。
> 下一步：本文结论已收成可执行目标与待办，见 `docs/GOAL_2026-11-11.md`（开工以它为准）。

---

## 零、一页速览

| 维度 | 事实 |
|---|---|
| 项目本质 | 面向三条生信分析线的受控分析交付工作台，不是通用问答机器人 |
| 运行形态 | 本地 Windows 交互与控制面、单台 ARM 设备算力面、外挂 SSD 数据面 |
| 分析能力 | 3 条线，54 个分析 Mod，55 个无扩展名分析母版 |
| 产品化入口 | 客户门户提交需求单，管理员工作台生成 `work_order/v2` 工单并执行 |
| 统一状态 | `receipt/v1` 权威回执，五态状态机，产物逐项登记 SHA-256 |
| 质量体系 | 25 道串联门禁，1996 个测试用例，239 个测试文件，19 条变异反证与 6 条 Q3/Q2 反证 |
| 治理体系 | 架构宪法、范围与 12 条否决台账、12 条声明式路由、五类追加式台账 |
| 核心代码规模 | 24,660 SLOC（86 个核心源文件，官方口径） |
| 全仓代码规模 | 约 14.7 万行纯代码（含测试与母版，按 Git 跟踪文件粗算） |
| 资产规模 | 参考库 2.69 GB，项目数据 859 MB，13 个本地项目，92 个图件模板 |
| 当前阶段 | 目录重构 W1 至 W10 已完成，产品化 T1 至 T5 在途，AI 管理员编排尚未开工 |
| 最大风险 | 单设备单点、单作者总线因子、在途变更未提交、交接文档与现状漂移 |

---

## 一、项目定位：它到底解决什么问题

一句话：把客户的一次生信分析需求，变成一条可审计、可复现、可验收、可追责的交付流水线。

它解决的不是“能不能跑分析”，而是下面四个更难的问题：

1. **可追溯**：每个产物从哪次工单、哪个 Mod、哪个 seed、哪台执行面来，回执里能查到。
2. **可复现**：母版与设备侧逐字节同源，环境版本与随机种子冻结，项目层不允许私改母版副本。
3. **可验收**：交付包先验后签，四关验收与 Ed25519 验签，下载门禁只认实时哈希。
4. **防退化**：门禁不仅证明“修好能变绿”，还要用变异反证证明“改坏会变红”。

明确不做的事，写在 `SCOPE.md`：

- 不做脱离退出判据的自主探索型 Agent。
- 不做通用大模型问答窗口。
- 不接与三条线无关的临时脚本需求。
- 不在生产链引入重型解卷积算法。

---

## 二、系统架构

### 2.1 物理拓扑

```text
客户浏览器
   |
   v
[门户 portal/ :8080]  需求单、文件分块上传、肿瘤黑名单筛查
   |
   v
[门户收件箱 portal/inbox/PKG_<时间戳>_<项目名>/]  需求单、清单、数据、参考文献
   |
   v
[管理员工作台 BioanalysDesktop/ :18787]  审阅、选线、选 Mod、选图、排队、看回执
   |
   v  ADB 单通道
[算力节点]  文件传输、通道管理、服务看护
   |
   v
[Linux 容器]  R 与 Python 科学计算执行面
   |
   v
[数据盘 /mnt/ssd/bio_data]  项目数据、母版部署、系统台账
```

关键事实：

- 本地只做交互、编排与轻量回搬，不承担分析计算。
- 计算与文件传输统一走 ADB。SSH 通道已封存到 `_archive/ssh_retired_20261111/`，恢复方式见该目录 `RESTORE.md`。
- 门户收件箱真源是 `portal/inbox/PKG_<时间戳>_<项目名>/`。工作台经 `portal_inbox.js` 读取，前端调用 `/api/portal/inbox` 列包，`/api/work-orders/from-package` 生成工单草稿。
- 设备侧项目根与仓库侧项目根语义对应，但路径不互相推导。仓库改目录不影响设备固定布局。

### 2.2 四层职责

| 层 | 目录 | 职责 | 不该做什么 |
|---|---|---|---|
| 交互层 | `BioanalysDesktop/src/`、`portal/` | 表单、预览、任务状态、回执时间线 | 不直接跑分析 |
| 控制面 | `core/`、`schemas/`、`skills/`、`tools/` | 门禁、契约、路由、编排、报告与交付 | 不存放客户原始数据 |
| 数据面 | `workspace/projects/`、设备 `projects/` | 项目输入、中间态、结果、图件、交付物 | 不混入控制面代码 |
| 算力面 | 设备容器与 SSD | R 与 Python 计算、产物落盘、运行标记 | 不长期存放仓库副本 |

### 2.3 三明治架构

架构宪法 `SPEC.md` 定义三原则，每条都绑定真实门禁：

| 原则 | 含义 | 执行门禁 |
|---|---|---|
| 三明治架构 | 确定性代码捕获触发，模型只在约束内匹配与抽取，工具执行前过强类型网关 | `schemas/schema_gateway.py`、`BioanalysDesktop/server/task_fsm.js`、`tools/dev/router_gate.mjs` |
| 控制面与数据面隔离 | 代码与规约在控制面，客户数据与交付物在数据面 | `tools/ops/02_check_isolation.ps1`、`tools/dev/test_isolation_gate.mjs` |
| Fail-Closed 与真源唯一 | 网关故障即拒绝，一个含义一个真源，否决设计有台账与有效期 | `tools/dev/router_gate.mjs`、`schema_gateway.test.js`、`tools/dev/mutation_gate.mjs` |

### 2.4 一次任务的判定链

系统把“越便宜越早失败”的判定顺序固定下来，共 11 层：

| 序 | 判定点 | 位置 | 失败后果 |
|---:|---|---|---|
| 1 | 鉴权 | `server/index.js` | 401 |
| 2 | 请求体上限 | `server/http_body.js` | 413 |
| 3 | 参数合法性 | 各路由 `sanitizeProjectId` | 400 |
| 4 | 命令审计 | `server/run.js:auditCommand` | 400 |
| 5 | 算力节点选择 | `server/task.js:selectComputeNode` | 故障转移或拒绝 |
| 6 | 幂等锁 | `tools/ops/run_throttled_task.sh` | 退出码 4 |
| 7 | 内存闸门 | `bio_memory_guard.py` | 干净报错，避免 OOM |
| 8 | 步骤自校验 | 各分析母版 | 退出码 1/2/3 |
| 9 | 产物回执 | `WROTE '<path>' <bytes>` | 台账记 failed |
| 10 | 状态对账 | `server/reconcile.js` | succeeded/failed/interrupted/unknown |
| 11 | 交付验收 | `server/report.js` | 409 ERR_DELIVERY_UNVERIFIED |

### 2.5 三类存储

| 类型 | 位置 | 内容 | 生命周期 |
|---|---|---|---|
| 台账 | `ledger/*.jsonl` | 每次执行的权威记录 | 永久，追加写 |
| 产物 | `workspace/projects/<id>/results`、`figures` | 分析结果 | 随项目 |
| 缓存 | `.tmp/`、`.ops_state/`、`node_modules/` | 临时与可重建 | 可随时删 |

---

## 三、三条分析线

注册表真源是 `tools/bio/workflows.json`，共 54 个 Mod。线之间默认硬隔离，唯一例外是注册表声明的冻结签名桥。

| 线 | 名称 | 阶段数 | Mod 数 | 主语言 | 末端模块 |
|---|---|---:|---:|---|---|
| `line1_bulk` | GEO Bulk 常规挖掘 | 6 | 15 | R 为主 | 机器学习建模与外部验证 |
| `line2_scrna` | 单细胞转录组与虚拟敲除 | 8 | 22 | Python 为主 | 虚拟敲除与 DR 后分析 |
| `line3_spatial` | 单细胞空间转录组与虚拟敲除 | 7 | 17 | Python 与 R | 空间虚拟敲除 |

### 3.1 线 1：GEO Bulk

阶段顺序：ingest 1，qc 2，de 2，enrich 3，ml 6，figures 1。

覆盖能力：数据预处理与注释，多数据集整合去批次，QC，分组，PCA，DEG 与 WGCNA，GO/KEGG 富集，PPI 与 hub，交集关键基因，LASSO 与模型诊断，独立 GEO 外部验证。

### 3.2 线 2：单细胞

阶段顺序：ingest 1，qc 2，integrate 3，profile 3，branches 5，tf 3，ko 4，figures 1。

覆盖能力：Harmony 整合，聚类与注释，细胞组成，分支分析，转录因子，scTenifoldKnk 虚拟敲除，DR 基因后分析。

### 3.3 线 3：空间转录组

阶段顺序：ingest 1，qc 2，dimred 3，spatial_stats 4，branches 4，ko 2，figures 1。

覆盖能力：Visium 读入，spot QC，降维，空间域识别，域 Marker，空间自相关，细胞类型解卷积，空间虚拟敲除。

### 3.4 算力红线

运行面是 12 GB 物理内存设备，容器默认上限 7.5 GB，单任务最高 8.0 GB，由 `BIO_MEM_LIMIT_GB` 控制，纯 ARM CPU。硬约束：

- 空间与单细胞解卷积只允许 `scipy.optimize.nnls`，单步内存不超过 2.2 GB。
- 禁止 `cell2location`、`Stereoscope`、`RCTD` 等重型算法进入生产链。
- 精度提升走零算力路线：上游 Top 20 特异 Marker 提纯，输出端小于 0.05 丰度硬截断。
- 违规由 `tools/dev/python_interpreter_gate.mjs` 拦截，登记在 `SCOPE.md` REJ-006。

---

## 四、应用层与接口

### 4.1 管理员工作台

技术栈：React 18、Vite 5、TypeScript 5.6，后端是原生 `node:http` 与自研路由派发微内核，无 Express/Koa。

当前 5 个主视图：

| 视图 | 作用 |
|---|---|
| `onboarding` | 项目向导与建项 |
| `console` | 输入控制台、上传、分组、DAG |
| `work-orders` | 作业中心，工单预览、排队、回执时间线 |
| `preflight` | 环境自检 |
| `studio` | 结果与图件预览 |

路由层拆成 7 个模块，约 55 个方法与路径分支：`projects`、`tasks`、`figures`、`report`、`upload`、`diagnostics`、`work_orders`。

### 4.2 客户门户

`portal/serve.mjs` 是单文件原生 HTTP 服务，默认 8080。共享契约由服务端运行时注入，避免前后端副本漂移。收件箱默认落在 `portal/inbox/`，带数据文件的提交归档为 `inbox/PKG_<时间戳>_<项目名>/{requirement.json,package_manifest.json,raw_data,refs}`。

门户提供 21 个 API 端点，覆盖：需求提交，数据文件，图件模板与预览，参考文件，课题调研，同步收发件箱，工作流解析。

### 4.3 作业 API（在途）

`work_order/v2` 正式入口的 6 个端点已出现在工作树：

| 方法与路径 | 行为 |
|---|---|
| `POST /api/work-orders` | 校验工单，落盘，状态 queued |
| `GET /api/work-orders` | 列出作业，只返回安全字段 |
| `GET /api/work-orders/queue` | 返回待执行队列与位置 |
| `GET /api/work-orders/:id` | 返回工单摘要、队列位置、回执状态 |
| `POST /api/work-orders/:id/run` | 管理员确认并排队 |
| `GET /api/work-orders/:id/receipt` | 返回 `receipt.v1.json` |

当前工作树已附带磁盘队列：`BioanalysDesktop/server/services/work_order.service.js` 从工单 meta 派生 `approved=true` 且 `queued` 的待执行列表，`startQueue` 维持单消费者泵，`recoverInterruptedRunning` 处理服务重启，`index.js` 在启动后拉起队列。该实现属于在途变更，尚未进入远端 `master`。

### 4.4 鉴权与租约

现状：工作台使用 Basic 鉴权，常量时间比较，本地开发可用 `BIO_ALLOW_DEV_NOAUTH=1`。

规划：`docs/AI_ORCHESTRATION_SPEC.md` 定义 AI 以管理员身份通过 HTTP 操作，人工可强制接管。全局单权威租约文件是 `.ops_state/orchestration_authority.json`，默认 TTL 120 秒，状态变更要求 `X-Bio-Lease-Id`，回执记录 actor 与 `actor_trace`。

注意：租约、身份映射与 AI 客户端目前只有规格与票，代码尚未落地。`auth_principal.js`、`authority.service.js`、`authority.routes.js`、`ai_orchestrator.mjs` 均不存在。

---

## 五、端到端生命周期

```text
需求单 requirement.json
  -> 门户归档 PKG_<时间戳>_<项目名>/
  -> 管理员审阅，生成 work_order/v2
  -> 作业 API 校验，落 workspace/projects/<id>/work_orders/
  -> 管理员确认，进入队列
  -> runWorkOrder 编译 DAG，补齐必需上游
  -> 逐项上传，校验 size 与 sha256
  -> 逐任务提交，串行等待回执
  -> 失败即短路，下游保持 blocked
  -> 报告构建，四关验收，Ed25519 签名
  -> receipt/v1 权威回执
  -> 兼容投影 work_order.receipt.json
  -> 客户下载交付包
```

关键文件：

| 环节 | 真源 |
|---|---|
| 工单声明面 | `schemas/work_order_v2.schema.json` |
| 工单运行时校验 | `shared/work_order_v2.mjs` |
| 回执声明面 | `schemas/receipt_v1.schema.json` |
| 回执运行时生成 | `BioanalysDesktop/server/receipt_v1.js` |
| 编排执行 | `tools/dev/work_order_orchestrator.mjs` |
| 作业服务 | `BioanalysDesktop/server/services/work_order.service.js` |
| 作业路由 | `BioanalysDesktop/server/routes/work_orders.routes.js` |
| 作业视图 | `BioanalysDesktop/src/views/WorkOrderCenterView.tsx` |

回执字段要点：`receipt_id` 由工单摘要加开始时间派生，`work_order_digest` 把回执绑定到输入，`stages`、`upload_receipts`、`task_receipts`、`acceptance`、`delivery`、`artifacts` 聚合证据。成功哨兵为 `PRODUCTIZATION_RECEIPT_OK`，失败与阻塞也写权威回执。

---

## 六、质量与治理体系

### 6.1 总门禁

单命令入口：`node tools/dev/run_all_gates.mjs`。清单与顺序的唯一真源是文件内的 `GATES` 数组。

当前 25 道，按“越便宜越靠前”排序：

| 组 | 门禁 |
|---|---|
| 环境与静态 | 宿主机预检、静态语言门禁、临时目录隔离、便携包同源、跳过原因白名单 |
| 结构与边界 | 项目脚本边界、项目内容消融、工单编排闭环、skills 契约、54 模块消融矩阵、受控桥接 |
| 路由与台账 | 路由与 REJ 一致性、台账与真源一致 |
| 图件 | 注册表同步、预览溯源、Ready 实证矩阵、出图溯源诚实性、300 DPI、源码规范 C1 至 C14 |
| 审计与反证 | 交付审计流、变异门禁 19 条、算力节点 脚本同源、Q3/Q2 变异 6 条 |
| 全量测试 | `metrics_sync --check`，测试数与基线一致 |

本次实测：`--skip-tests` 25 道全绿，用时 16 秒；全量 `metrics_sync --check` 通过，1996 用例，核心面 24,660 SLOC。

### 6.2 测试体系

- 239 个测试文件，1996 个用例，1992 通过，0 失败，4 条件跳过。
- 跳过必须带白名单原因，由 `skip_reason_gate.mjs` 校验。
- 测试强制单并发，因为端口与临时目录有独占假设。
- Playwright 端到端 27 个用例，独立 CI job。
- 变异反证分两层：`infra` 覆盖清理守卫、基线一致性、台账同源；`behavior` 覆盖静态扫描、出图证据、路由匹配。两层判据都是 `escaped === 0`。

### 6.3 治理文件

| 文件 | 作用 |
|---|---|
| `SPEC.md` | 架构宪法，三原则与执行门禁 |
| `SCOPE.md` | 范围内、范围外、12 条 REJ 否决台账 |
| `ROUTER.yaml` | 12 条声明式场景路由 |
| `GLOSSARY.md` | 领域术语唯一权威 |
| `INDEX.yaml` | 全局导航中枢 |
| `MIGRATION.md` | 整体重构契约与波次验收 |
| `AGENTS.md` | Agent 入职纪律与导航 |

### 6.4 台账

`ledger/` 下五类 JSONL：actions、changes、errors、fixes、pitfalls。追加式，不改历史。另有运维台账、坑位台账、图件准入台账、Argon 评审纪要。

---

## 七、工程规模与资产

### 7.1 代码规模

官方核心口径：24,660 SLOC，86 个核心源文件，统计面是 `BioanalysDesktop/server`、`BioanalysDesktop/src`、`portal`、`shared`。

按 Git 跟踪文件粗算的全仓纯代码：

| 类型 | 文件数 | 行数 |
|---|---:|---:|
| JavaScript `.js` | 314 | 57,840 |
| 无扩展名分析母版 | 55 | 24,995 |
| Python `.py` | 71 | 20,171 |
| ESM `.mjs` | 60 | 14,428 |
| React `.tsx` | 13 | 6,745 |
| PowerShell `.ps1` | 30 | 5,267 |
| HTML `.html` | 7 | 4,683 |
| Shell `.sh` | 25 | 3,568 |
| CSS `.css` | 2 | 2,544 |
| R `.r` | 40 | 2,453 |
| CJS `.cjs` | 17 | 2,137 |
| TypeScript `.ts` | 10 | 1,873 |
| Batch 与 YAML 等 | 7 | 561 |
| 合计 | 约 651 | 约 147,000 |

说明：统计含测试与母版，含当前工作树中已删除但仍在索引里的条目，量级参考，不作为验收数字。

文档与配置：Markdown 281 个文件约 5.2 万行，JSON 185 个文件约 3.7 万行。

### 7.2 资产体积

| 区域 | 文件数 | 体积 | 性质 |
|---|---:|---:|---|
| `references/` | 5,578 | 2.69 GB | 只读参考库 |
| `workspace/` | 2,465 | 859 MB | 项目数据与交接 |
| `cn_debug/` | 370 | 721 MB | 取证与调试证据 |
| `BioanalysDesktop/` | 39,522 | 501 MB | 应用、依赖与运行时 |
| `vendor/` | 2,499 | 294 MB | 第三方依赖 |
| `docs/` | 2,004 | 268 MB | 规范与运行记录 |
| `Python/` | 2,432 | 167 MB | 便携运行时 |
| `software/` | 1,817 | 237 MB | 软件资产 |
| `_archive/` | 3,418 | 221 MB | 冷备归档 |

### 7.3 图件资产

- `tools/bio/figure_templates.json` 登记 92 个模板。
- 27 个 Ready 单图，65 个 Draft。
- Ready 基线由 `tools/dev/figure_ready_allowlist.json` 人工封板，新增需要真机证据与显式改动。
- 只出单图，300 DPI，图例外置，图注在轴框外左下，分类色板 Okabe-Ito，空间图内嵌比例尺。

### 7.4 项目数据

`workspace/projects/` 下 13 个项目，覆盖 DCM、NAFLD、卒中空间、乳酸化、AIMS、算力节点 冒烟等。较大的三个：`PRJ_AIMS_V3_20261027` 158.5 MB，`PRJ_DCM_L3_20261109` 173.6 MB，`PRJ_DCM_BENCH_20261105` 138.1 MB。

---

## 八、当前进展与在途变更

### 8.1 已提交基线

- Git 历史 376 个提交（当前 HEAD），跨分支 432 个，时间跨度 2026-10-20 至 2026-11-09。
- 整体重构 W1 至 W10 已收口，基线 tag 为 `restructure-baseline-20261108`。
- 当前 `master` 最后提交：`ff5ddf2 feat(figures): 全量同步 92 个模板并补齐介绍`。
- 提交高度集中：2026 年第 45 周 274 个提交。
- 作者高度集中：单一主作者，另有 1 个本地引导提交。

### 8.2 工作树在途变更

当前未提交改动约 174 个已跟踪文件，7 项未跟踪资产，diff 约新增 1.09 万行、删除 0.74 万行。主题不是修 bug，而是一次产品化换轨：

1. **退役 A2A 与 Pi Agent 观测通道**：删除 `a2a_state.js`、`pi_agent*.js`、Pi 聊天视图与相关测试，新增 `pi_retirement_contract.test.js`。
2. **封存 SSH 通道**：`_archive/ssh_retired_20261111/` 落地，ADB 成为唯一通道。
3. **工单产品化 T1 至 T5**：`work_order/v2` schema 与运行时校验，`receipt/v1` 权威回执，作业 API，作业中心视图，提交包转工单，磁盘队列与单消费者泵。
4. **AI 管理员编排**：规格与实现票已写，代码未开工。

当前在途变更没有提交，意味着从远端拉取 `master` 的人拿不到作业中心与新回执，只能拿到上一版 Pi Agent 结构。这是共享与评审时最容易误解的一点。

### 8.3 实测健康度

| 检查 | 结果 |
|---|---|
| 总门禁 `--skip-tests` | 25 道全绿，16 秒 |
| 全量测试 `metrics_sync --check` | 通过，1996 用例，0 失败 |
| 算力节点 脚本同源门禁 | 通过 |
| 变异反证 | 19 条与 6 条，`escaped` 为 0 |

这说明在途代码没有破坏既有防线，但不等于产品化 T6 封板完成。

---

## 九、关键设计取舍

| 取舍 | 选择 | 代价 | 收益 |
|---|---|---|---|
| 算力位置 | 单台 ARM 设备与容器 | 单点风险，性能受限 | 成本极低，数据不出本地，功耗可控 |
| 后端框架 | 原生 `node:http` 与自研派发 | 路由与中间件要自己写 | 依赖极少，行为可完全审计 |
| 分析代码组织 | 母版与项目适配层 | 适配层可能漂移 | 通用逻辑复用，项目差异可留档 |
| 执行入口 | 结构化工单，不是自由 Agent | 需要预先定义字段与 DAG | 可复现，可验收，可追责 |
| 防线设计 | 25 道门禁与变异反证 | 维护成本高，改动要过更多关 | 防退化能力强，假绿空间小 |
| 图件策略 | 只出单图，Ready 白名单封板 | 组合图与长尾需求要单独孵化 | 300 DPI 与版式可机器验证 |
| 状态权威 | `receipt/v1` 单一权威与兼容投影 | 双文件需要同步 | 新消费者有统一入口，旧消费者不破 |
| 通道 | ADB 单通道 | 传输效率与稳定性受设备影响 | 攻击面小，运维路径唯一 |

---

## 十、风险与技术债

### 10.1 高风险

1. **单设备单点**：全部重计算依赖一台 ARM 设备。硬件损坏、接口松动、系统崩溃都会让真实分析能力归零。当前没有第二台容灾节点。
2. **在途变更未提交**：174 个文件的产品化换轨仍在工作树。评审者若只看远端 `master`，会得到过时结论。
3. **交接文档漂移**：`交接清单/交接清单总表.tsv` 仍写 19 道门禁、1852 测试、`ops/` 路径；现状是 25 道门禁、1996 测试、`tools/` 路径（2026-11-11 已随 docs(sync) 提交同步）。`项目情况汇总2026-11-04.md` 也停留在 30 个 Ready、82 个模板、1465 测试。
4. **前端巨石组件**：`OnboardingView.tsx` 约 89 KB，承载建项、上传、分组、WGCNA 参数与 DAG，状态耦合高。
5. **清理脚本参数敏感**：`tools/dev/clean_workspace.mjs` 在非默认保留天数下可能命中 Git 跟踪文件，属破坏性工具，必须保持人工触发。

### 10.2 中风险

6. **本地缺 Rscript**：静态门禁对 16 个 R 母版降级为警告，提交前拦不住 R 语法错误。CI 与设备侧有 R 环境。
7. **长尾图件**：92 个模板中 65 个仍是 Draft。冷门图件需求需要单模板准入、适配与真机预览，周期不可忽略。
8. **容器开销**：容器有 15% 至 30% 的 I/O 惩罚，高频并发连接可能触发进程树异常。轮询下限与降权执行是必要防护。
9. **测试必须单并发**：端口与临时目录独占假设强，误用多并发会大面积假红。
10. **AI 编排的控制面未落地**：租约、actor 留痕、AI 客户端仍停留在规格层；作业队列已在工作树落地。若直接让 AI 调管理员 API，当前缺少单权威约束。
11. **项目适配层缺机器约束**：`project_script_gate` 只禁止母版同名副本，项目脚本与母版的语义一致性没有检查。历史漂移事故的根因仍在。
12. **仓库体积**：参考库、取证区、归档区合计超过 3.6 GB，全仓约 5.8 GB。全仓文本扫描与克隆成本偏高。

### 10.3 低风险

13. **便携 Python 双份**：根目录 `Python/` 与应用内 `BioanalysDesktop/Python/` 各约 167 MB，容易在离线包中重复。
14. **临时目录膨胀**：`.tmp/` 当前约 2,555 个文件，缺少定期清理策略。
15. **无扩展名母版**：55 个母版无扩展名，Windows 编辑器需要手动语法映射，新人上手成本高。
16. **台账与快照混放**：`docs/runs/` 含大量历史证据，和活规范同目录，检索噪声大。

---

## 十一、建议一起讨论的八个问题

1. **是否上第二算力节点**：单设备风险已经明确。第二台设备的成本、镜像同步复杂度、调度策略，哪个更划算？
2. **产品化换轨如何收口**：174 个文件在途，是先提交再评审，还是按 T1 至 T6 拆成多个可回滚提交？
3. **AI 管理员边界**：AI 具备管理员权限后，哪些动作必须人工确认？租约 TTL 与强制接管是否足够？
4. **门禁数量与维护成本**：25 道门禁与 25 条变异反证，是否已经接近边际收益拐点？哪些可以合并或降级？
5. **项目适配层的机器约束**：是否要为 `workspace/projects/<id>/scripts/` 增加与母版的差异清单与哈希对账？
6. **Ready 图件目标线**：27 个 Ready 是否够当前商业交付？65 个 Draft 的孵化优先级由订单驱动还是由能力图谱驱动？
7. **文档真源与快照分离**：交接清单、项目情况汇总、架构全景三份文档口径不一。是否建立“活规范”和“历史快照”两个明确层级？
8. **总线因子**：单作者、单设备、单通道。是否需要至少一名能独立跑通全链与门禁的第二负责人？

---

## 十二、快速验证与入口

### 12.1 本地启动

```powershell
.\start_all.bat          # 同时拉起工作台 18787 与门户 8080
.\start_workbench.bat    # 仅工作台
.\start_portal.bat       # 仅门户
```

### 12.2 质量验证

```powershell
node tools/dev/run_all_gates.mjs --skip-tests   # 25 道快速门禁，约 16 秒
node tools/dev/run_all_gates.mjs                # 含全量测试，约 3 至 4 分钟
node tools/dev/metrics_sync.mjs --check         # 全量测试与基线一致性
cd BioanalysDesktop; npm test                   # 1996 用例
cd BioanalysDesktop; npm run test:e2e           # Playwright 27 用例
```

### 12.3 关键阅读顺序

1. `SPEC.md`：架构宪法。
2. `SCOPE.md`：范围与 12 条否决。
3. `docs/ARCHITECTURE_OVERVIEW.md`：目录、信息流、判定顺序、存储。
4. `docs/PRODUCTIZATION_SPEC.md`：工单、回执、作业 API。
5. `docs/AI_ORCHESTRATION_SPEC.md`：AI 管理员与租约。
6. `docs/WORK_ORDER_ORCHESTRATOR.md`：v1 与 v2 双版本兼容。
7. `docs/isolation.md` 与 `docs/coding-standards.md`：隔离与 Linux 运行面。

---

## 附录 A：术语速查

| 术语 | 含义 |
|---|---|
| 三线 | `line1_bulk`、`line2_scrna`、`line3_spatial`，数据与运行物理隔离 |
| Mod | 注册表中的一个可编排分析步骤，共 54 个 |
| 母版 | `tools/bio/<line>/scripts/` 下的通用分析脚本，无扩展名 |
| 项目适配层 | `workspace/projects/<id>/scripts/`，项目数据形态的差异层 |
| 工单 | `work_order/v2`，一次分析任务的正式输入契约 |
| 回执 | `receipt/v1`，一次作业的权威状态与证据聚合 |
| Ready 单图 | 通过真机预览、300 DPI 与 SHA-256 实证的图件模板 |
| 变异反证 | 对防线注入真实破坏，证明门禁会变红 |
| REJ | 已否决设计台账，每条绑定执行门禁与有效期 |
| 租约 | 全局单权威锁，保证同一时刻只有一个主体变更状态 |

## 附录 B：本文事实来源

| 结论 | 来源 |
|---|---|
| 架构三原则 | `SPEC.md` |
| 范围与否决 | `SCOPE.md` |
| 54 Mod 与阶段 | `tools/bio/workflows.json` |
| 25 道门禁 | `tools/dev/run_all_gates.mjs` |
| 测试与 SLOC 基线 | `BioanalysDesktop/README.md`、`tools/dev/metrics_sync.mjs --check` |
| 工单与回执契约 | `docs/PRODUCTIZATION_SPEC.md`、`docs/WORK_ORDER_ORCHESTRATOR.md` |
| AI 编排规格 | `docs/AI_ORCHESTRATION_SPEC.md` |
| 目录与路径双轨 | `docs/directories.md` |
| 信息流与判定链 | `docs/ARCHITECTURE_OVERVIEW.md` |
| 重构波次 | `MIGRATION.md` |
| 在途变更 | `git status`、`git diff --stat`、`git diff --cached --stat` |
| 资产体积 | 本地文件系统扫描 |

