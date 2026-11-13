# 如果是我来改：对第三方建议的取舍与落地方案

> 对象：用户带来的《第三方改造建议：逐条裁定与修订落地方案》。
> 立场：以本仓库当前工作树与 `SPEC.md`、`SCOPE.md`、`workflows.json`、`receipt/v1` 为真源。
> 性质：我的技术裁定与实施顺序，不新增第二真源，不把讨论文档变成规范。
> 基线：2026-11-11 工作树，25 道门禁全绿，1995 个测试用例通过。
> 目标正本：本文裁定已收成 AIM、里程碑与待办清单，见 `docs/GOAL_2026-11-11.md`（冲突处以目标书为准）。

---

## 零、一句话结论

第三方裁定稿的主干我采纳：**不换状态模型，租约先行，交付门禁不松，拒绝重写 `node:http`，不引 Redis 或 K8s**。

但我不按它的组件清单施工，也不接受它把全景快照当成代码事实的几处推断。我的方案是：

1. **先把 174 个在途文件拆成可回滚提交**，保住现有 25 道门禁与 1995 测试基线。
2. **不引 `better-queue`、不引 `better-sqlite3`、不引 Uppy、不装 Snakemake**。
3. **沿用已经在途的磁盘元数据队列与单消费者泵**，先补齐租约、重启恢复、并发与故障反证。
4. **Caddy 只做可选的外网收口**，放到产品化封板之后，不进第一里程碑。
5. **四象限只收目录分层的直觉，不收可写 `TODO.md`、不收 TTL 知识账、不收 Aider。**

一句话：**先把已经写出来的控制面收口，再谈加组件。**

---

## 一、我会先纠正裁定稿的事实基线

裁定稿明确写「本地 `d:/00.AIagent/...` 与私有仓库仍未读取，不写成已核实代码」。这是它的诚实之处，也决定了它有几处结论只能算外部推断。我对当前工作树的核实结果：

| 裁定稿说法 | 工作树事实 | 我的处理 |
|---|---|---|
| `portal/inbox`、`portal_inbox.js` 是臆造路径 | `portal/serve.mjs` 默认 `INBOX=portal/inbox/`，归档成 `inbox/PKG_<时间戳>_<项目名>/{requirement.json,package_manifest.json,raw_data,refs}`；`BioanalysDesktop/server/portal_inbox.js` 存在；`index.js` 注入 `PORTAL_INBOX` | **退**。收件箱路径是真的，自动侦测点应以 `portal/inbox/PKG_` 加 `requirement.json` 为准 |
| 队列缺「持久化待执行列表 + 单消费者 + 重启恢复」 | `work_order.service.js` 已实现 meta 落盘、五态、`listQueue`、`enqueueWorkOrder`、单消费者 `pumpQueue`、`recoverInterruptedRunning`，`index.js` 启动后 `startQueue` | **改成「补齐验证与租约」**，不再重新造队列 |
| 自动拉起 orchestrator 需要另写 spawn 链 | 当前队列直接 `import` 编排器的 `runWorkOrder`，在同一进程内调用，没有第二个进程写者 | 租约仍必须先落地，但理由从「防止第二个 spawn 写者」改为「防止人工与 AI 两个 HTTP 主体并发改状态」 |
| 18787 需要改成仅 `127.0.0.1` 监听 | `index.js` 已经是 `server.listen(PORT, '127.0.0.1', ...)`，注释说明由 frp 回连本机 | **退**。Caddy 的价值只剩「把公网入口收口到 443 与网关层 403」，不是修监听地址 |
| 「完工自动生成 deliverable.zip，开放外网下载」危险 | `report.routes.js` 下载前调用 `deliveryGateStatus`，校验回执 `tar_sha256` 与当前 tar 实时哈希，失败返回 409 `ERR_DELIVERY_UNVERIFIED` | 方向收，但现有门禁已经存在。短期单次令牌可增强，不是补洞 |
| 项目适配层与历史数据混杂 | 当前全景文档只说 `workspace/projects/<id>/scripts/` 是项目适配层；`project_script_gate` 已禁母版同名副本 | 可做增量目录约定，但**不要一次性迁移 13 个项目** |

外部组件事实我也复核了 GitHub 官方仓库：`diamondio/better-queue` v3.8.12，MIT，默认内存 store 不持久化，参数是 `concurrent` 不是 `maxConcurrent`，SQLite store 要另装 `better-queue-sql` 或 `better-queue-sqlite`；Aider 官方是 `Aider-AI/aider`，README 明确「AI Pair Programming in Your Terminal」且自动提交 Git。裁定稿这几处纠错成立。

---

## 二、我会怎样改总体架构

### 2.1 不换状态模型

保留：

- `work_order/v2` 为正式输入。
- `receipt/v1` 为唯一权威回执。
- 五态 `queued`、`running`、`completed`、`failed`、`blocked`。
- `ledger/*.jsonl` 永久追加写。
- 25 道门禁的既有顺序与 `GATES` 唯一真源。
- 11 层判定链，尤其第 9 层产物回执与第 11 层交付验收。
- `SCOPE.md` 的 12 条 REJ，尤其 REJ-006 轻算力红线与 REJ-012 Ready 单图棘轮。

拒绝：

- 可写 `TODO.md` 或 `PROGRESS_DASHBOARD` 作为第二状态源。
- `EXPERIENCE_MASTER_LEDGER.md` 与 180 天 TTL 知识账。
- 把四象限 Agent 平台的状态语义灌进本仓库。
- 人可打勾跳过 `verification_receipt` 或放行 `02_output`。

四象限只保留一个物理直觉：项目目录将来可以按 `00_input`、`01_work`、`02_output` 做**新增目录约定**。当前 13 个历史项目不动，由新项目先走新布局，旧布局只读兼容。这不是第一里程碑。

### 2.2 控制面当前真正缺什么

不是缺队列，不是缺网关，不是缺 SQLite。真正缺的是：

1. **在途变更未提交**：174 个文件、7 项未跟踪资产，远端 `master` 与工作树不是同一个系统。
2. **AI 与人工并发写状态没有单权威约束**：`authority.service.js`、`auth_principal.js`、`X-Bio-Lease-Id` 仍只在规格里。
3. **actor 不可追责**：`created_by`、`approved_by`、`actor_trace` 未落地，回执里还区分不出人和 AI。
4. **队列已有实现但缺防线级反证**：重启恢复、单消费者、重复执行、终态重跑、输入哈希不符需要变成会红的门禁。
5. **交接文档漂移**：交接清单写 19 道门禁与 1852 测试，现状是 25 道与 1995。

所以我的投入顺序是「收口、租约、反证、再谈边界增强」。

---

## 三、组件取舍：我的决定

| 组件 | 第三方裁定 | 我的决定 | 理由 |
|---|---|---|---|
| `better-queue` | 方向收，实现改 | **退** | 当前磁盘队列已在途；引入低活跃老库还要额外 SQLite store 与 `sqlite3` 原生依赖，收益只剩 `filter`、`priority` 等暂不需要的能力 |
| `better-sqlite3` | 收，存租约与队列 | **暂退** | 租约是单个 JSON 文件即可原子写的小状态；当前 `atomic_write.js` 已有能力。SQLite 留到确实出现多表事务与查询压力时再评估 |
| Snakemake | 只借模式 | **退引擎，收一句话** | 现有 `WROTE '<path>' <bytes>`、size 与 sha256 回执已经比 `touch` 更严。只在文档里保留「文件目标驱动」这个设计解释 |
| Caddy | 收，443 与网关层 403 | **收为可选第二阶段** | 方向对，但 18787 已仅本地监听，现有部署可经 frp 回连。外网关属于部署形态变更，不应压在未提交的产品化换轨上 |
| Uppy | 改，需定 Tus 或 XHR | **暂退** | 现有 `upload.js` 有 4 MB 分块、会话指纹与大小校验；产品化 T2 已规划 `inputs[]` 流式上传。先收口 T2，再评估前端体验 |
| Aider | 退 | **退** | 终端结对编程工具，自动 Git commit，与本仓库的可回滚主题提交策略冲突 |
| LangGraph `interrupt` | 收模式 | **只收语义** | 「遇人工判断暂停」已经写在 `AI_ORCHESTRATION_SPEC.md` 的停机条件里，不引新运行时 |

我的原则：**能用一个 JSON 文件与现有原子写解决的，不引数据库；能用现有 HTTP 与分块契约解决的，不引协议网关；能用现有契约测试解决的，不引第三方库。**

---

## 四、我的落地次序

### 第 0 步：把工作树变成可讨论的基线

目标：让任何评审者拉取仓库后看到的就是本文讨论的系统。

按主题拆提交，不做一个 174 文件大 commit：

1. `retire(pi/a2a)`：退役 Pi Agent 与 A2A 观测面，保留 `pi_retirement_contract.test.js`。
2. `archive(ssh)`：封存 SSH 通道，ADB 单通道导航与 `RESTORE.md` 对齐。
3. `feat(work-order-v2)`：schema、运行时校验、样例、编排器兼容层。
4. `feat(receipt-v1)`：权威回执、兼容投影、原子写、失败与阻塞落盘。
5. `feat(work-order-api)`：作业 API、作业中心视图、提交包转工单、磁盘队列与单消费者泵。
6. `docs(sync)`：交接清单、项目情况汇总、架构全景的口径统一到 25 道门禁、1995 测试、27 个 Ready、92 个模板、`tools/` 路径。

每一步判据：`node tools/dev/run_all_gates.mjs --skip-tests` 全绿；最后跑 `node tools/dev/metrics_sync.mjs --check`。任何一步不能把门禁断言改宽松换绿。

### 第 1 步：单权威租约与 actor 留痕

按 `docs/AI_ORCHESTRATION_SPEC.md` 落地，但存储改简：

- 租约文件仍为 `.ops_state/orchestration_authority.json`，用现有 `atomicWriteFileSync` 原子写。
- 不建 SQLite 表。文件字段照规格：`lease_id`、`holder`、`acquired_at`、`heartbeat_at`、`expires_at`、`mode`。
- `auth_principal.js` 把认证主体映射为 `human`、`ai_assist`、`local_dev`，请求体里的 actor 一律由服务端覆盖。
- `X-Bio-Lease-Id` 中间件先覆盖三个写端点：`POST /api/work-orders`、`POST /api/work-orders/from-package`、`POST /api/work-orders/:id/run`。
- 人工强制接管写 `takeover_from`、`takeover_at`、`reason`，AI 调接管返回 403。
- `receipt/v1` 增加 `actors` 与 `actor_trace`，旧回执继续通过校验。

必须先红后绿的测试：伪造 actor、租约冲突、过期、续租、释放、人工接管、缺 lease 的写请求、接管后旧 lease 失效。

### 第 2 步：把在途队列变成受控队列

不重写，做四件小事：

1. 把 `startQueue` 的恢复行为写成契约：服务重启时 `running` 且无 inflight 标记 `failed` 与 `recovery_reason=server_restart`，`queued` 不丢。
2. 把单消费者写成反证：注入「两个泵同时取同一工单」的变异，判据必须红。
3. 把 `run` 与租约绑定：每次入队都带第 1 步的有效 lease，队列内部执行不再需要重复租约，但 meta 记 `approved_by` 与 `lease_id`。
4. 把 `PKG_` 包侦测收口到现有 `portal_inbox.js` 与 `from-package`，不新增 watcher 进程。

验收补充：kill 进程后重启，队列与 `receipt.v1` 一致；重复 `run` 幂等；终态重跑 409；ADB 断开后按现有失败与 blocked 语义停，不静默重试。

### 第 3 步：补新门禁与变异反证

新增 2 道，不拆散现有 25 道：

| 新门禁 | 覆盖 |
|---|---|
| `authority_lease_gate` | 租约过期双写、伪造 actor、接管后旧 lease、缺 `X-Bio-Lease-Id` |
| `work_order_queue_gate` | 单消费者、重启恢复、终态重跑、重复触发、回执不重复 |

每道都配变异反证，判据仍是 `escaped === 0`。`GATES` 数组、`metrics_sync` 基线、`BioanalysDesktop/README.md` 同步更新。新增门禁不是「额外保险」，是新组件的准入条件。

### 第 4 步：产品化 T6 封板

- 便携包重建，`MANIFEST.sha256` 覆盖新增资产。
- `node tools/dev/dist_parity_gate.mjs` 分叉与缺失为 0。
- 全量 `npm test`、Playwright e2e、`run_all_gates.mjs` 三件套全绿。
- 收口记录写明改动文件、证据、遗留风险、未纳入本轮的扩展点。

### 第 5 步：可选的外网边界增强

只有真的要公网交付时才做，单独一张票：

- Caddy 只监听 443，反代到本机 18787，网关层 403 阻断 `/api/diagnostics/*` 与内控路由。
- Caddyfile 入版本库，新增 `caddy validate` 门禁。
- 下载仍以服务端四关验收与实时哈希为准，不把发件箱静态映射成可枚举 URL。
- 短期单次下载令牌只作为增强，不替代 `deliveryGateStatus`。
- Windows 常驻用服务管理器，Caddy 启动与工作台启动分开留痕。

### 第 6 步：目录分层与前端体验，排最后

- 新项目可选 `00_input`、`01_work`、`02_output`，旧项目不动。
- 只有 T2 流式上传稳定后，再评估 Uppy XHR 或 Tus。
- `OnboardingView.tsx` 拆分与 65 个 Draft 图件另立技术债票，不混进控制面收口。

---

## 五、我不会做的事

1. 不会把 `TODO.md` 做成可写状态源。人可以看只读投影，不能靠打勾改变放行。
2. 不会为了「重启不丢」引入默认内存队列，再补一层 SQLite store。
3. 不会让 Aider 或任何自动提交工具在这棵工作树上直接改代码。
4. 不会把下载做成「生成完就开放静态 URL」。
5. 不会改 11 层判定链、五态状态机、`receipt/v1` 唯一权威、`ledger/` 追加写。
6. 不会在未收口 174 个在途文件时讨论公网暴露。
7. 不会为了让新组件变绿而放宽既有 25 道门禁。

---

## 六、我会拿去和别人讨论的五个判据

1. **提交粒度**：是否同意按六个主题拆提交，而不是一次大 commit？
2. **队列路线**：是否同意保留在途磁盘队列，不引 `better-queue` 与 SQLite？
3. **AI 边界**：是否同意租约只覆盖工单三个写端点，任务中止与报告构建后续再扩？
4. **外网形态**：是否同意 Caddy 是产品化封板后的独立部署票，不是当前里程碑？
5. **目录演进**：是否同意 `00_input`、`01_work`、`02_output` 只对新项目生效，历史 13 个项目不动？

这五个问题定了，才能把第三方建议从「好想法」变成「可验收的改动」。

---

## 七、与第三方裁定稿的关系

| 主题 | 第三方 | 我 |
|---|---|---|
| 前提纠错 | 四象限 85% 契合只成立在目录层 | 同意 |
| 六项目事实纠错 | better-queue、Aider、Uppy 等纠错成立 | 同意，并已用官方仓库复核关键项 |
| 租约先行 | 同意 | 同意，但理由改为人工与 AI 两个 HTTP 写者 |
| 自动拉起链 | 认为还要新建 spawn 链 | 已由 `startQueue` 在同进程落地，改为补租约与验证 |
| 队列实现 | 建议 SQLite 单表或 better-queue | 保留现有磁盘 meta 队列，不引新存储 |
| 收件箱路径 | 认为 `portal/inbox` 臆造 | 真实存在，已核 `serve.mjs`、`portal_inbox.js`、`from-package` |
| Caddy | 第 2 步 | 产品化封板后的可选部署票 |
| 下载门禁 | 严防静态放行 | 同意，且现有 `deliveryGateStatus` 已经是实时哈希门禁 |
| 拆提交 | 按 T1 至 T5 拆 | 同意，并细化成六个主题提交 |

最终取舍：**采纳它的风险意识，删掉它的组件冲动，补上它没读到的本地代码事实。**

---

## 八、时间优先修订：哪些轮子直接买（2026-11-11 用户裁定补充）

> 起因：用户明确「想节约时间，不想重复造轮子，想直接用别人成熟的项目」。
> 本节修订第三节的部分裁定。冲突处以本节为准。
> 新增硬筛子：**绿色便携包**。交付形态是单目录自足运行，任何要求常驻服务端的组件（Redis、Postgres、Temporal）都进不来；单二进制与纯 npm 库可以进。

### 8.1 先分清：哪里根本没有轮子可买

| 自研件 | 有没有成熟轮子 |
|---|---|
| 三条生信线、54 Mod 注册表、55 母版 | 没有，这是产品本体 |
| `receipt/v1` 语义、五态状态机 | 没有，通用工作流引擎表达不了「先验后签 + 实时哈希」这套验收语义 |
| 四关验收、Ed25519 交付链、报告脱敏 | 没有 |
| 算力节点 ADB 执行面、内存闸门、幂等锁 | 没有，拓扑太特殊 |

这些继续自研不是造轮子，是造车。能买的只有通用件。

### 8.2 采买清单（按便携包兼容性与省时程度排序）

| 通用件 | 成熟轮子 | 裁定 | 理由与时机 |
|---|---|---|---|
| 上传前端（分块、重试、进度、暂停） | **Uppy + `@uppy/xhr-upload`** | **现在就买** | 纯前端，对接现有 `/api/upload/init/chunk/complete`，服务端零改动，是省时杠杆最大的一件 |
| 租约与队列状态存储 | **better-sqlite3** | **现在就买** | 手写 JSON 锁在过期与接管时刻的竞态是经典坑；SQLite `BEGIN IMMEDIATE` 一个事务解决，同步 API 免回调地狱 |
| 公网入口、路由收口、TLS | **Caddy** | 暴露公网时买 | 单二进制进便携包，15 行 Caddyfile 换掉 frp 加自写边缘逻辑 |
| 门户后端（鉴权、文件、实时、管理面板） | **PocketBase** | **Plan B 首选切入点** | v0.40.x，纯 Go 单文件、零外部依赖，一个二进制替换门户大半自研面；先迁门户，管理端后迁或不迁 |
| 断点续传协议 | tus（`@uppy/tus` + tus server） | 客户抱怨断传再买 | 现有指纹会话已覆盖大部分；tus 要服务端新端点 |
| 多消费者、退避重试、定时任务 | BullMQ + Redis | 需要时再买 | 成熟且活跃（v6.x），但 Redis 常驻进程与便携包冲突；单消费者场景收益不抵运维，等出现第二执行节点或重试策略需求再上 |
| 持久工作流引擎 | Temporal / Restate | 退 | 单 PC 加单算力节点拓扑撑不起这套运维 |
| DAG 引擎 | Snakemake / Nextflow | 退引擎借语义 | 换引擎要碰 55 母版与 25 道门禁 |
| UI 组件库 | Mantine 或 Ant Design | 可选 | 给作业中心等新视图提速，低风险增量；旧视图不动 |
| 前端框架、构建、e2e | React / Vite / Playwright | 已在用 | 最大的面早就在成熟轮子上，无需动作 |

### 8.3 为什么不把已写完的自研件也换掉

已经写完、有契约测试、被 25 道门禁锁住的自研件（`node:http` 路由、磁盘队列泵、分块上传服务端），**本身就是你已经拥有并验收过的轮子**。替换它们的成本是：集成适配、契约测试重写、`dist_parity` 与便携包重打包、门禁基线同步。省时不一定为正。

所以采买原则定为：**只买还没造的，和造了但竞态风险高的（租约锁）。已经造好且门禁全绿的不动。**

### 8.4 「直接用」的落地协议（绞杀者模式）

每引入一个轮子都必须过同一道闸，避免成熟组件变成新的失控面：

1. 轮子只能躲在既有契约后面：`work_order/v2`、`receipt/v1`、`PKG_` 收件箱、五态状态机对外不变，只换实现。
2. 先写会红的契约测试（上传断点、租约竞态、Caddy 403），再接组件。
3. 进便携包的件过 `dist_parity_gate`，新增二进制与依赖进 `MANIFEST.sha256`。
4. `GATES` 数组与 `metrics_sync` 基线同步更新，不为变绿放宽断言。
5. 一次只换一个组件，单独成提交，可回滚。

### 8.5 修订后的组件时间线

```text
第 0 步  174 个在途文件按六个主题提交（不变，这是所有采买的前置）
第 1 步  better-sqlite3 落租约与队列状态（替换手写 JSON 锁）
第 2 步  Uppy + xhr-upload 替换门户上传前端（服务端不动）
第 3 步  Caddy 收口公网入口（若此时确有外网交付）
第 4 步  PocketBase 迁移门户收件与鉴权（Plan B，按订单压力决定）
第 5 步  BullMQ + Redis（仅当出现第二算力节点或重试策略需求，且接受放弃便携包单进程形态）
```
