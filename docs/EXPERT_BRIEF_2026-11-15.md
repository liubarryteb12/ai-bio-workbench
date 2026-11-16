# 生信分析工作台全量技术简报（外部专家设计输入）

> 版本：2026-11-15 | 用途：交给外部资深专家做系统设计评审与后续架构设计。
> 编写口径：以当前工作树真源为准，静态扫描与本地实测；未连接算力设备做业务复跑。
> 脱敏纪律：本文不含设备型号、主机名、序列号、令牌、密钥与个人路径。
> 涉密值一律写 `<REDACTED>`。专家如有需要，在本地仓库按附录索引自行查证。
> 真源优先级：SPEC.md > SCOPE.md > workflows.json > receipt/v1 契约 > 各目标书。
> 本文是快照与导读，与真源冲突时以真源为准。

---

## 零、一页速览

| 维度 | 事实 |
|---|---|
| 项目本质 | 面向三条生信分析线的受控分析交付工作台，产出可审计、可复现、可验收的交付物 |
| 分析能力 | 3 条线，54 个分析 Mod，55 个无扩展名分析母版，122 条相邻兼容边 |
| 质量体系 | 29 道串联门禁，2229 个测试用例 0 失败，30 + 6 条变异反证，核心代码 33729 SLOC |
| 治理体系 | 架构宪法三原则，12 条已否决设计台账（REJ），12 条声明式路由，五类追加写台账 |
| 状态模型 | work_order/v2 唯一输入，receipt/v1 唯一权威回执，五态状态机，终态不可逆 |
| 交付安全 | 四关验收 + Ed25519 验签 + 实时哈希下载门禁 |
| 当前阶段 | 基线收口完成，两面产品化（对外填单 Web + 对内便携控制台）已裁定待施工 |
| 已知风险 | 单设备单点、单作者总线因子、在途变更未提交、单条 PI 用例全量串行偶发抖动 |

---

## 一、项目定位

### 1.1 使命

把客户的一次生信分析需求，变成一条可追溯、可复现、可验收、可追责的交付流水线。
确定性代码做执行与防线，模型只在约束范围内做路由匹配与参数抽取，过程全审计。

解决的四个核心问题：

1. 可追溯：每个产物能回答来自哪次工单、哪个 Mod、哪个 seed、哪个执行面。
2. 可复现：母版与算力侧逐字节同源，环境版本与随机种子冻结，项目层禁止私改母版副本。
3. 可验收：交付包先验后签，四关验收与 Ed25519 验签，下载门禁只认实时哈希。
4. 防退化：门禁不仅证明修好能变绿，还用变异反证证明改坏会变红。

### 1.2 明确不做的事（SCOPE.md 范围外）

1. 不做脱离明确退出判据的自主探索型 Agent。
2. 不做通用大模型问答窗口，产出必须是可追溯的分析结果。
3. 不承接与三条线无关的临时脚本需求。
4. 不在生产链引入重型算法（REJ-006，详见第七节）。

---

## 二、物理拓扑与运行形态

### 2.1 拓扑

```text
客户浏览器
   |
   v
[门户 portal/]            需求单填写、文件分块上传、黑名单筛查
   |
   v
[门户收件箱 inbox/]       PKG_<时间戳>_<项目名>/{requirement.json, package_manifest.json, raw_data, refs}
   |
   v
[管理员工作台]            审阅、选线选 Mod、排队、看回执（Electron 桌面壳 + 本地服务端）
   |
   v  ADB 单通道
[算力节点底座面]          编排、文件传输、通道管理，不跑分析
   |
   v
[Linux 容器计算面]        R 与 Python 科学计算执行
   |
   v
[数据盘 /mnt/ssd/bio_data] projects/<项目>/<线>/{raw_data,processed,results,figures}
```

关键事实：

1. 本地只做交互、编排与轻量回搬，不承担分析计算。
2. 计算与文件传输统一走 ADB 单通道。SSH 通道已整体封存到 `_archive/`，恢复需按其中 RESTORE.md 显式操作；工单里写 `compute_adapter=ssh` 或 `allow_ssh=true` 一律报 `ERR_SSH_DISABLED`。
3. admin 服务端只监听本机回环地址，出口统一一个端口；portal 是唯一面向客户的提交面。
4. 设备侧项目根与仓库侧项目根语义对应，路径互不推导。

### 2.2 四层职责边界

| 层 | 目录 | 职责 | 禁止 |
|---|---|---|---|
| 交互层 | `BioanalysDesktop/src/`、`portal/` | 表单、预览、任务状态、回执时间线 | 不直接跑分析 |
| 控制面 | `core/`、`schemas/`、`skills/`、`tools/`、`shared/`、`configs/` | 门禁、契约、路由、编排、报告与交付 | 不存客户原始数据 |
| 数据面 | `workspace/projects/`、`portal/inbox/`、设备数据盘 | 项目输入、中间态、结果、图件、交付物 | 不混控制面代码 |
| 算力面 | 设备容器与数据盘 | R/Python 计算、产物落盘、运行标记 | 不长期存仓库副本 |

隔离由三道机器校验守着：静态路径扫描、台账 io_files 路径合法性校验、运行时路径断言（浏览、出图、上传全部必须落在本项目本线目录或 public_references 内，穿越一律拒绝）。

### 2.3 顶层目录结构（当前真源）

```text
SPEC.md ROUTER.yaml SCOPE.md GLOSSARY.md MIGRATION.md INDEX.yaml   架构层真源
AGENTS.md / AGENT.md                                              AI 纪律与入口指针
core/          框架运行时与桥接守卫
schemas/       强类型契约网关（python + JSON schema）
skills/        SOP 规约资产（stable 分级）
tools/bio/     三线分析母版与 workflows.json（54 Mod 注册表）
tools/dev/     门禁与开发工具（29 道门禁真源 run_all_gates.mjs）
tools/reporting/  报告、交付验收、出图、事实核查
tools/ops/     本地运维 PowerShell（ADB 通道、部署、巡检）
shared/        前后端共享纯函数（工单归一化、数据格式白名单、上传会话指纹）
BioanalysDesktop/   管理员工作台（server + React dist + tests）
desktop/       Electron 壳（主进程、preload、构建、验证脚本）
portal/        客户填单 Web（serve.mjs + index.html + inbox/）
workspace/     数据面（projects/ 项目工作区、handoff/ 交接）
ledger/        五类追加写台账（actions/changes/errors/fixes/pitfalls 等 JSONL）
references/    只读参考资产库（含 2.69GB 生信参考代码库）
deliverables/  交付快照
desktop/release/  便携包 zip 产物
software/      B 路线绿色包构建输出（dist_parity 门禁对齐对象）
.ops_state/    单权威租约 SQLite 等运行状态
docs/          工程规范活文档（本文所在）
```

---

## 三、架构宪法与判定链

### 3.1 三原则（SPEC.md，每条绑定执行门禁）

| 原则 | 含义 | 执行门禁 |
|---|---|---|
| 三明治架构 | 确定性代码捕获触发；模型只在约束内匹配路由与抽参；工具执行前过强类型网关 | `schemas/schema_gateway.py`（短命文件 IPC，0=ALLOW、2=DENY、1=ERROR）、`task_fsm.js`、`router_gate.mjs` |
| 控制面与数据面物理隔离 | 代码、门禁、规约在控制面；客户数据、中间态、交付物只在数据面 | `02_check_isolation.ps1`、`test_isolation_gate.mjs` |
| Fail-Closed 与真源唯一 | 网关故障即拒绝；一个含义一个真源；已否决设计进 REJ 台账并绑定门禁与 180 天有效期 | `router_gate.mjs`（REJ 生命周期校验）、`mutation_gate.mjs`（变异反证） |

### 3.2 一次任务的 11 层判定链（越便宜越早失败）

| 序 | 判定点 | 位置 | 失败后果 |
|---|---|---|---|
| 1 | 鉴权 | admin 服务端入口 | 401（Basic 鉴权 fail-closed） |
| 2 | 请求体上限 | `http_body.js` | 413 |
| 3 | 参数合法性 | 各路由 sanitize | 400 |
| 4 | 命令审计 | `run.js` auditCommand | 400 |
| 5 | 算力节点选择 | `task.js` | 故障转移或拒绝 |
| 6 | 幂等锁 | 运维脚本层 | 退出码 4 |
| 7 | 内存闸门 | 内存守卫脚本 | 干净报错避免 OOM |
| 8 | 步骤自校验 | 各分析母版 | 退出码 1/2/3 |
| 9 | 产物回执 | 母版必须打 `WROTE <path> <bytes>` | 台账记 failed |
| 10 | 状态对账 | `reconcile.js` | succeeded/failed/interrupted/unknown |
| 11 | 交付验收 | `report.js` 四关 | 409 ERR_DELIVERY_UNVERIFIED |

### 3.3 三类存储与生命周期

| 类型 | 位置 | 内容 | 生命周期 |
|---|---|---|---|
| 台账 | `ledger/*.jsonl` | 每次执行的权威记录（actions/changes/errors/fixes/pitfalls 五类追加写） | 永久 |
| 产物 | `workspace/projects/<id>/results|figures`、设备 results/figures | 分析结果与图件 | 随项目 |
| 缓存 | `.tmp/`、`.ops_state/`、`node_modules/` | 临时与可重建 | 可随时删 |

任务台账 JSON schema 要点（每步一个文件，落设备 system_logs/）：
`project_id`、`line_id`（三值枚举）、`status`、`environment.random_seed`（必填，没设种子不得判 passed）、`io_files`（路径必须属于本项目本线或 public_references）、`checkpoint_status`（跨语言桥接检查点走这里）、`error_log` 失败必填。

---

## 四、三条分析线（54 Mod 注册表）

### 4.1 线表

| 线 | 名称 | 阶段 | Mod 数 | 主语言 | 末端 |
|---|---|---|---|---|---|
| line1_bulk | GEO bulk 常规挖掘 | 6 | 15 | R 为主 | ML 建模与独立 GEO 外部验证 |
| line2_scrna | 单细胞转录组 + 虚拟敲除 | 8 | 22 | Python 为主 | 虚拟敲除与 DR 后分析 |
| line3_spatial | 空间转录组 + 虚拟敲除 | 7 | 17 | Python 与 R | 空间虚拟敲除 |

注册表真源 `tools/bio/workflows.json`：每个 Mod 声明母版名、输入产物、输出产物、seed、退出码契约、必需上游阶段。编排器按它编译 DAG 并自动补齐必需上游闭包。54 模块消融矩阵（remove-one + 故障注入 486 场景）当前缺口为 0。

代表性母版链：

1. 线1：prep_matrix → qc_matrix / pca_matrix → deg_limma + wgcna_modules → enrichment_bulk / ppi_string → key_genes → ml_model / ml_diagnostics / external_validation / cox_analysis → bulk_figures。
2. 线2：ingest_counts → qc_cells → normalize_hvg → integrate_harmony → cluster_umap → annotate_celltypes → composition / deg_groups / subcluster → enrichment / pseudotime / cell_communication / gsva → scenic_tf / tf_activity → virtual_knockout → summarize_dr / dr_post_analysis → scrna_figures。
3. 线3：ingest_spatial → qc_spots → normalize_hvg → dim_reduce → 域识别与解卷积 → 空间虚拟敲除 → 空间图件。

### 4.2 硬约束

1. 三线默认互不交叉：不互取参考、不合并数据集、不跨线验证。唯一例外是受控桥接：线2 只导出冻结的细胞类型签名表到 `public_references/celltype_signatures/<project_id>/`，线3 只读冻结表，不碰线2 原始数据；由 `isolated_bridge_gate` 强制。
2. 虚拟敲除不是第四条线，它是线2/线3 的末端模块，产出 DR genes。DR genes 与 DEG 是两个概念，不允许混写。
3. R/Python 混用只发生在线内（工具层），每步台账记录实际语言。
4. 跨语言桥接必过四项检查点：基因名、矩阵方向、细胞名、embedding 保留，任一不符即停。
5. bulk 外部验证冻结：独立 GEO 验证集只做冻结评估，不重筛基因不调参，禁止训练集与验证集合并校正后再评估。

### 4.3 算力与内存红线（REJ-006）

1. 运行面为 12GB 物理内存设备；容器默认内存上限 7.5GB，单任务最高 8.0GB（`BIO_MEM_LIMIT_GB` 控制），纯 ARM CPU。
2. 空间与单细胞解卷积必须保持轻量 `scipy.optimize.nnls`（单步内存不超过 2.2GB）。
3. 严禁在生产流水线引入 `cell2location`、`Stereoscope`、`RCTD` 等深度学习或重型迭代回归算法（会直接 OOM Exit 137 或高温降频死锁）。
4. 反卷积精度提升只走零算力路线：上游 Top20 特异基因提纯 + 输出端低于 0.05 极低丰度硬截断。
5. 重型代码只作为外部 PC 资产或客户专属交付件，严禁合并进生产流水线。

### 4.4 算力接口契约（docs/COMPUTE_INTERFACE.md）

算力被定义为可配置接口：探活、执行、传输、观测四件事；不负责分析逻辑、不做参数决策、不持凭证、不在本地启动计算。适配器由 `BIO_COMPUTE_ADAPTER` 选择：`adb`（默认）或 `mock`（仅测试或显式允许，生产进程默认拒绝）。节点池经 `BIO_COMPUTE_NODES` JSON 声明（唯一 primary、id 白名单字符）。远端数据根 `BIO_REMOTE_DATA_ROOT`（默认 `/mnt/ssd/bio_data`）必须显式存在且可写，不存在时一切数据操作显式失败。健康探针按设备、命令通道、资源、数据根四层返回结论，不做自愈。

---

## 五、全链数据流：从客户提交到交付下载

### 5.1 门户提交（portal/serve.mjs）

1. 客户在填单页完成四段需求：基本信息（项目名、物种、疾病领域、数据类型）、数据来源（GSE/GPL 数据集行或自有上传）、分组设计与对比、分析阈值与图件选择。
2. 内置肿瘤黑名单筛查：命中即禁用提交（试剂、公司、立项背景多路关键词）。
3. 文件分块上传：4MB 分片，init/chunk/status/complete 四端点；uploadId 由「项目 + 归属线 + 文件名 + 大小 + 修改时间」指纹确定性派生（`shared/upload_session.mjs` 唯一真源），刷新或换浏览器都能断点续传；扩展名白名单 + magic bytes 校验 + 路径穿越拒绝；会话级预留额度 + 全局配额 + 24h TTL 自动 GC。
4. 提交成功归档为 `inbox/PKG_<时间戳>_<项目名>/`：requirement.json（v3 intake 契约四段）、package_manifest.json（data_files[] 与 references[] 登记字节数与 SHA-256）、raw_data、refs。
5. 内置按来源限流与重复提交防护（阈值实现见 serve.mjs）。

### 5.2 同步协议（已实现，待接消费端）

portal 内置 pull 式工单包同步协议，Bearer token（`SYNC_TOKEN`，仅本机使用，不对外）：

| 端点 | 方法 | 行为 |
|---|---|---|
| `/api/sync/pending` | GET | 列待取工单包（状态 pending） |
| `/api/sync/claim` | POST | 认领一单，状态 pending 转 running，返回 ticket 与 sha256 |
| `/api/sync/package?ticket=` | GET | 下载 tar 包，实时哈希与登记 sha256 比对 |
| `/api/sync/result` | POST | 消费端回写 done/failed/blocked 终态与结果摘要 |

另有 trigger/status/results/file 辅助端点。状态机 pending → running → done/failed/blocked，终态不可再 claim。下载缓存于 `inbox/.sync_cache`，sha256 复核。该协议有契约测试覆盖（`portal_sync.test.js`）。当前缺一个常驻消费端（轻量接收器）把 claim 到的包解到 admin 工作台的收件箱，这是新形态 D2.1 的施工对象。

### 5.3 收件箱到工单（from-package）

`BioanalysDesktop/server/portal_inbox.js` 读取 `PORTAL_INBOX` 下的 PKG 目录，校验 requirement.json 与 package_manifest.json，经 `/api/work-orders/from-package` 生成 `work_order/v2` 工单草稿（require_admin_review 默认 true，管理员确认预览后才入队）。

### 5.4 工单契约（work_order/v2）

| 字段组 | 内容 |
|---|---|
| 外壳 | schema_version=work_order/v2、work_order_id、project_id、source_package、controls |
| requirement | basicInfo、dataSource、groupingDesign、analysisCutoffs、figure_templates（四段原样承接门户需求单） |
| inputs[] | 包内相对路径 + role + filename + size + sha256（64 位小写十六进制），禁止绝对路径与 .. 段 |
| execution | line_id、mod_ids（按注册表补上游闭包）、figure_selections（只允许 Ready 单图）、seed、compute_adapter=adb、species_scope |
| delivery | 报告与交付包命名约定 |

归一化真源在 `shared/work_order_v2.mjs`，schema 在 `schemas/work_order_v2.schema.json`。v1 camelCase 老工单经兼容层映射进同一编译与执行链。所有输入走流式分片上传（内存峰值约一个分片），complete 回执 sha256 与工单声明不符报 `ERR_UPLOAD_HASH_MISMATCH`。

### 5.5 队列与执行（work_order.service.js）

1. 作业元数据逐单落盘（`workspace/projects/<id>/work_orders/<id>.meta.json`），五态 queued/running/completed/failed/blocked。
2. 单消费者 FIFO 泵按 approved_at 升序取单；inflight 集合 + 状态双重防线挡并发重入（终态重跑 409，执行体单次调用有变异反证钉死）。
3. 入队记录 `approved_by`（服务端认证主体，请求体伪造一律覆盖）与 `lease_id`。
4. 崩溃恢复：启动时同步 `recoverInterruptedRunning`，把孤儿 running 标 failed 并写 `recovery_reason=server_restart`，queued 原样保留。
5. 执行体调用编排器 `runWorkOrder`（同进程 import，无第二写者），执行体转发 actors 留痕给权威回执（2026-11-15 已收口 T1.7）。
6. 执行失败不静默重试，按 failed/blocked 语义停（ADB 断开语义 T3.7 待收口）。

### 5.6 编排器八步闭环（tools/dev/work_order_orchestrator.mjs）

1. 静态校验工单（项目 ID、线、Mod、图件、上传名、seed、通道开关，任一不合法即拒）。
2. 按注册表编译 DAG，自动补必需上游，DAG 任务数与执行计划必须 parity。
3. 建项 + 流式上传（每个文件 sizeMatch=true 才继续）。
4. 逐任务提交并串行等待任务与台账回执，核对项目、线、步骤、状态、退出码、seed、台账回执与产物清单。
5. 上游失败立即停止派发，下游保持 blocked，不写部分成功。
6. 报告构建 + 四关验收。
7. 写权威回执与项目汇总（只含业务状态、产物名与脱敏相对路径；机器名、运行环境、绝对路径、内部脚本目录一律不进回执正文）。
8. CLI 哨兵：成功 `WORK_ORDER_ORCHESTRATOR_OK`。

### 5.7 权威回执 receipt/v1（BioanalysDesktop/server/receipt_v1.js）

1. 状态机：queued → running → completed/failed/blocked；queued 亦可直转 failed/blocked；终态不可逆；转移违规报 `ERR_RECEIPT_TRANSITION`。
2. `receipt_id` = sha256(work_order_digest + started_at) 前 24 位十六进制；`work_order_digest` = 工单 canonical JSON（键排序）的 SHA-256，回执与输入绑定。
3. 成功哨兵 `PRODUCTIZATION_RECEIPT_OK`；completed 必须带 delivery 对象（tar_sha256、verified_count、coverage_ok、verifier_version）。
4. 双落盘：权威回执 `report/receipt.v1.json`（成功、失败、阻塞都写）+ 兼容投影 `work_order.receipt.json`（仅成功，哨兵 WORK_ORDER_ORCHESTRATOR_OK）；另有按工单号单存副本 `work_orders/<id>.receipt.v1.json`，同项目多单不互相覆盖。
5. 可选 `actors` 与 `actor_trace`：记录 created_by / approved_by / last_updated_by 与动作序列（action、actor、时间、lease_id、request_id），旧回执无此字段继续有效（2026-11-15 T1.7 接线完成：执行体把入队主体转发给编排器）。
6. 原子写：先临时文件再 rename，异常清理临时件；回执写盘失败时 fail-closed，不留旧成功投影。

### 5.8 交付验收与下载门禁

1. 四关验收真源在 `tools/reporting/delivery_acceptance_core.mjs`（纯 Node，进程接缝门禁禁止 server 起子进程）：tar 哈希与侧车一致 → 解包三件套 → 清单逐文件哈希 + Ed25519 验签 → 幽灵/漂移双向差集 + CHECKSUMS 覆盖 + counts 一致。任一红整体红。
2. 验收是打包链路的内联后置条件：全绿才写验收回执，红时 500 且回执绝不落盘。
3. 下载门禁：`report.routes.js` 放行前校验回执存在且 `tar_sha256` 等于当前包实时哈希，否则 409 `ERR_DELIVERY_UNVERIFIED`；`/api/report/files` 带 `delivery_verified` 供前端先显示再点。
4. 实测性能：真实项目 356 文件 / 36.7MB tar 打包签名验收约 4.5 秒。
5. Ed25519 公私钥路径由环境变量显式提供，缺失即 exit 1 不产包（fail-closed，不是 bug）。

---

## 六、AI 管理员编排与受控模型接入

### 6.1 全局单权威租约（已在生产代码 + 门禁）

1. 存储：`.ops_state/` 下 SQLite 单表，判定与写入同一 `BEGIN IMMEDIATE` 事务（解决 JSON 锁读写窗口双写问题），库文件必须在本地盘。
2. 规则：全局唯一；TTL 120 秒、心跳 30 秒；被持有时获取 409 `ERR_AUTHORITY_HELD`；心跳与释放只认当前持有者；人工强制接管始终允许并留 takeover_from/at/reason，AI 调接管端点 403。
3. 强制范围：三个工单写端点（创建、from-package、run）要求 `X-Bio-Lease-Id` 与当前租约一致；过期 409 `ERR_AUTHORITY_EXPIRED`。任务中止与报告构建是后续扩展票。
4. 身份模型：`human`（管理员凭证）、`ai_assist`（AI 编排凭证）、`local_dev`（仅本地信任环境）三类 actor，固定 `{kind,id,role}`；身份真源是服务端认证结果，请求体里的 actor 字段只作展示并被服务端覆盖。
5. 门禁：`authority_lease_gate`（租约过期双写、伪造 actor、接管后旧 lease 失效、缺 header 拒绝）+ 变异反证 escaped=0。

### 6.2 Pi 驱动的受控工作台（在途，护栏门禁已绿）

接入形态：模型不直接执行，只通过九工具白名单（tier1 六 + tier2 三）操作，声明面与运行时由 `pi_guardrail_gate` 双向比对，不一致即红。

| 工具 | 能力 | 边界 |
|---|---|---|
| inspect_requirement | 读需求单摘要 | 只回摘要字段 |
| compile_work_order | 编译 DAG 拓扑 | 校验契约只回摘要 |
| dispatch_and_poll_dag | 轮询执行进度 | 只读 |
| read_step_metrics | 读指标卡 | 严格小于 32KB |
| remediate_step_param | 受控调参 | 只在注册表允许区间，写台账 |
| build_and_verify_report | 报告核验 | 给可否签发判定 |

硬禁令：shell/powershell 执行、自由读写文件、网络访问、直接签报告，全部禁止；白名单模块静态扫描不得出现通用执行能力（shell/spawn/eval）；未声明参数拒绝不静默丢弃；裸写 p 值/AUC/n 一律拦截，只允许引用槽位真值；非 Ready 白名单图件必须拦。

两道人工检查点（硬状态机闸门）：

1. 检查点一：Pi 提交方案与 DAG 预审后，人工点批准入队（必须留 actor），未批准下发 DAG 报 `INVALID_STATE_TRANSITION`。
2. 检查点二：Pi 提交 1 到 3 个待锁定靶点（每个带证据字段）后，人工确认，才允许报告渲染、事实核查、Ed25519 签名。

指标卡契约 step_metrics/v1：mod_id 必须在注册表登记（幽灵 Mod 拒绝）、QC 旗标受控枚举（info/warn/block）、槽位压平支持数组下标、同名槽位真值冲突必须报。

---

## 七、图件体系（v2.3 单图制）

1. 生产母版默认只输出单图（一张图一个论点），组合图已退役（3 个组合模板永久 draft，不得进 Ready）。
2. 图件只落 `<线>/figures/`，静态图统一 PNG，300 DPI 必须显式声明（R `res=300`，Python rcParams/dpi 参数，源级判据 C8/C9），禁止 PDF/SVG 交付。
3. 图例置右侧、图注置坐标轴框外左下角、字号不低于 8pt、分类色板 Okabe-Ito、连续量 viridis、禁彩虹色、二分类固定冷蓝/暖红标准色。
4. 空间类图逐样本绘制（跨样本像素坐标不可比）、内嵌比例尺（从 scalefactors 换算，缺失时降级不崩）、坐标口径入标题。
5. 虚拟敲除产出标题强制带 `[Virtual KO - DR Genes]` 角标防与 DEG 混淆；图内禁中文；每脚本出图后 close all 防内存泄漏。
6. 模板库：92 个图件模板登记于 `tools/bio/figure_templates.json`，其中 27 个 Ready 单图进入实证棘轮（REJ-012）：Ready 基线只升不降，每条必须 producing_mod 存在于注册表、300 DPI 渲染产物与 SHA-256 吻合；预览与渲染产物溯源哈希分叉即红（防「预览来自另一次渲染」）。
7. 出图溯源诚实性门禁：每份出图脚本显式声明 DERIVED/INSPIRED/INDEPENDENT，声称派生却不引用参考库即红。
8. 出图源码规范门禁：C1 到 C14（字号、后端、配色、close、Agg 顺序等）blocking 级违例即红。

---

## 八、质量防线体系

### 8.1 29 道串联门禁（唯一真源 run_all_gates.mjs 的 GATES 数组）

| 序 | id | 名称 | 说明 |
|---|---|---|---|
| 1 | preflight | 宿主机依赖预检 | 越便宜越靠前 |
| 2 | static_gate | 静态语言门禁 | 缺工具可显式降级警告并逐条打印 |
| 3 | test_isolation | 测试与门禁临时目录隔离 | 递归删除必须带隔离标记 |
| 4 | dist_parity | 便携包关键资产同源 | dist 存在则逐字节比对，缺失 SKIP_NO_DIST |
| 5 | skip_static | 跳过原因白名单（静态面） | skipped 必须写原因 |
| 6 | project_script | 项目层脚本边界 | 禁母版同名副本分叉真源 |
| 7 | project_content_ablation | 项目内容消融 | 删旧报告旧图旧配置后接口仍自洽 |
| 8 | work_order_orchestrator | 结构化工单编排闭环 | mock HTTP 全链 |
| 9 | skills_contract | skills 规约资产契约 | 字段、引用、exit_criteria 双射 |
| 10 | module_ablation_matrix | 54 模块消融与兼容性矩阵 | 486 场景缺口 0 |
| 11 | isolated_bridge | 受控桥接事实源 | 唯一合法跨线读入口 |
| 12 | router | 路由与边界台账一致性 | 路由引用与 REJ enforced_by 全部真实存在 |
| 13 | ledger | 台账与真源一致 | ledger_gen --check |
| 14 | figure_registry | 图件注册表与证据同步 | build_figure_templates --check |
| 15 | preview_provenance | 预览与渲染产物溯源 | 防预览造假 |
| 16 | ready_matrix | Ready 模板实证矩阵 | 27 条棘轮逐条 sha256 |
| 17 | figure_provenance | 出图溯源诚实性 | DERIVED/INSPIRED/INDEPENDENT |
| 18 | python_interpreter | 母版解释器解析 | 禁硬编码解释器路径 |
| 19 | figure_spec | 出图规范合规 | 直读 PNG pHYs 判 300 DPI |
| 20 | figure_code | 出图源码规范 | C1 到 C14 |
| 21 | audit_summary | 交付审计流可解析 | |
| 22 | mutation_gate | 变异门禁 | 30 条防线反证 escaped=0 |
| 23 | 设备脚本同源 | 母版与算力侧逐字节同源 | 设备离线时带标签 SKIP（exit 2） |
| 24 | q3q2_mutation | 状态机与路由变异反证 | 6 条 |
| 25 | authority_lease | 单权威租约准入 | 含变异自证 |
| 26 | pi_guardrail | Pi 护栏 | 九工具白名单（tier1 六 + tier2 三）+ 防幻觉 |
| 27 | work_order_queue | 队列单消费者 | 含变异自证 |
| 28 | production_wiring | 生产接线与适配封板（G28） | 适配溯源与降级等级进回执签名范围 |
| 29 | metrics | 全量测试 + skip 白名单 + 基线一致 | 900 秒上限，防外层截断假红 |

变异反证原则：不证明「修好能让门禁红」而证明「改坏能让门禁红」；两层故障定界（infra/behavior），任一层出现存活即整体 FAIL；变异只在临时副本上做，不碰工作树；判据锚定到具体语句，禁裸正则与关键词出现。

### 8.2 已否决设计台账（SCOPE.md，12 条）

| 编号 | 被否决方案 | 要点 |
|---|---|---|
| REJ-001 | 突破 Ready 白名单 | 已被 REJ-012 动态实证棘轮接替 |
| REJ-002 | 项目目录放母版副本改一版 | 分叉真源，事故不可复现 |
| REJ-003 | 只改仓库母版不同步算力面 | 代码与设备不同源结果无法回溯 |
| REJ-004 | 母版硬编码解释器路径 | 静默用错环境 |
| REJ-005 | 出图绕过 300 DPI 与非 PNG | 期刊排版要求物理尺寸可复现 |
| REJ-006 | 生产链引入重型解卷积 | OOM 137 或降频死锁；精度走 Top20 + 0.05 截断 |
| REJ-007 | 便携包与源码各改各的 | 陈旧快照等于未知版本产物 |
| REJ-008 | 条件跳过测试不写原因 | 区分环境缺失与悄悄关防线 |
| REJ-009 | 只证明修好变红不证明改坏变红 | 变异反证缺位即空断言 |
| REJ-010 | 两个测试进程共用共享资源 | 并发互删假红假绿 |
| REJ-011 | 空间邻接图加 200um 物理截断 | 标定后剔除率约万分之一，零收益且有收缩风险 |
| REJ-012 | 突破 Ready 实证棘轮或引入幽灵 Mod | 当前基线 27，只升不降 |

每条绑定真实门禁脚本（enforced_by），路径不存在即 router_gate 报红；状态、复审依据、有效期字段机器可读；编号不复用。

### 8.3 实测基线（2026-11-15）

| 指标 | 值 |
|---|---|
| 测试用例 | 2229（2223 pass / 0 fail / 6 skip，274 个测试文件） |
| 门禁 | 29 道全绿（--skip-tests 快检 20 秒，全量含测试 287 秒） |
| 核心代码 | 33729 SLOC（124 个核心文件，非空行口径） |
| 变异反证 | 30 + 6 条，escaped=0 |
| 模块消融 | 54 Mod，122 兼容边，486 场景，缺口 0 |
| 图件 | 92 模板 / 27 Ready / 3 退役组合图 |

---

## 九、产品化现状与两面新形态

### 9.1 绿色便携包（形态已裁定：只有便携版）

1. 整个应用就是一个文件夹：入口 exe + 自带 Python venv + resources（Electron 主进程、node 运行时、server + dist、better-sqlite3 原生模块、shared/schemas/tools、图件模板资产、随包 adb）+ index.json（整机 sha256 引用关系索引）+ data（唯一可写目录：config、logs、raw_data、workspace/projects、inbox、.ops_state、ledger）。
2. 安全面：后端只监听本机回环随机端口，每次启动随机口令经壳注入；preload 白名单能力无 Node 直通；退出时优雅停机清理进程树。
3. 构建链：React build → electron-builder zip → 运行时完整性校验 → 12 项功能矩阵（用仓库内置基准数据真跑：健康、自检、注册表、图件目录、建项走随包 venv 真 pydantic 网关、负路径拒绝、项目列表、分块上传、任务下发 SSE、工单四端点、门户收件箱；报告构建无真机时如实 SKIP）→ 部署脚本（复制、校验 venv、建 data 脚手架、生成索引、快捷方式）。
4. 同源纪律：包重建必须过 `dist_parity_gate` 与 verify，索引不新鲜即红（REJ-007）。

### 9.2 两面产品化目标（docs/GOAL_2026-11-15.md，用户已裁定）

用户裁定（2026-11-15）：

1. 控制端做成绿色免安装桌面软件，双击即用，单管理员自用，不开浏览器。
2. 对外只暴露客户填单 Web，内网穿透由用户自行完成；服务端与算力面永不出公网。
3. 两面之间只靠 PKG 工单包单向载体连接（收件箱真源不变）。
4. 部署形态 A 方案：填单 Web 与收件箱同机。
5. PKG 回传走自动通道：portal 经既有 sync 协议出包，本地轻量接收器轮询消费，到包即落收件箱并回写 result。
6. 客户访问凭证采用白名单文件制：管理员录入凭证，portal 热加载；每个凭证映射客户身份进入 PKG 留痕。初步设想是把凭证写进一个 markdown 白名单文档按行解析（每行 token、客户名、备注，# 注释），文件放便携包 data 目录并进 gitignore，仓库只留 example 模板。

里程碑：

| 里程碑 | 内容 | 判据 |
|---|---|---|
| D0 | 桌面壳收尾成日用控制台 + 绿色包正式产物 | 双击 exe 完成收发工单、看进度、导出产物 |
| D1 | portal 对外档安全加固（白名单凭证、按凭证限流、映射负清单） | 白名单外被拒；只有 portal 端口可映射 |
| D2 | 轻量接收器 + 兜底导出（完成页可下载工单包手动导入） | 契约测试先红后绿，解包产物与直提一致 |
| D3 | 端到端验收：一张真单从外部填单走到产物导出 | 全程只在填单页与桌面软件内操作 |

红线：admin 与算力面禁止暴露；两面只走 PKG；凭证文件属机密不进日志台账提交信息；本轮不做独立部署与多管理员体系。

### 9.3 目标书 GOAL_2026-11-11 收口状态

| 里程碑 | 状态 |
|---|---|
| T0 在途变更 7 主题提交 | 已完成 |
| T1 单权威租约 + actor 留痕 | 已完成（T1.7 于 2026-11-15 收口：回执区分人类与 AI，2 条契约用例） |
| T2 Uppy 上传前端 | 已完成（T2.4 续传 e2e 于 2026-11-15 收口：断连、续传、哈希一致） |
| T3 队列受控化 | 完成（T3.6 kill 重启验收于 2026-11-15 收口；T3.7 ADB 断开语义已由 `ERR_DEVICE_OFFLINE` 收敛 failed 不自动重试） |
| T4 两道新门禁 + 变异反证 | 已完成 |
| T5 便携包封板 | 已完成 |
| T6 Caddy 公网收口（可选） | 未开工，两面新形态下转为 D1.4 可选票 |

---

## 十、已知风险与未决问题（专家评审重点输入）

1. 单设备单点 + 单作者总线因子：算力面单节点，无第二执行面；文档与工程高度依赖单作者。
2. 在途工作树未提交：86 个已跟踪文件改动（+3041 / -271），另有 197 项未跟踪新增。主体是 Pi 编排（runner、supervisor、tools bridge、orchestrator 路由、护栏门禁、黄金集）、桌面壳（DesktopShell、desktop.ts、paths.js、桌面文档）、两面产品化文档与 2026-11-15 的 T1.7/T2.4/T3.6 改动。
3. PI 护栏 HTTP 会话用例曾出现串行跑抖动，2026-11-15 全量两连跑均为 0 失败，仍需持续观察。
4. 对外凭证与限流尚无实现：现有 portal 是单一 client token（内部口径），白名单文件制待设计施工。
5. 轻量接收器已建（D2.1/D2.2：双模态轮询、幂等键、`.part` 流式哈希、原子解包、result 重试队列），仍缺 D2.3 手动兜底导出入口。
6. T3.7 已收口：ADB 断开收敛 `ERR_DEVICE_OFFLINE` 并标 failed，不自动重试。
7. 公网穿透拓扑下的整体安全策略（哪些端口可映射、Caddy 是否前置、凭证轮换、提交限流阈值）待专家给方案。
8. 桌面壳视图矩阵与真实契约的逐项核对（D0.1）未完成：四视图框架已在，缺口清单待盘。

## 十一、用户补充构想：AI 主力化三层自主模型（2026-11-15，评审重点）

### 11.1 用户裁定方向（原始意图）

用户明确：受控辅助不是终点。Pi 级 AI 的定位是**接替人成为推进分析的主力**：
凡是宏观架构框架（三条线、状态模型、契约、门禁体系）不动的事，AI 都应该能自主完成，
包括但不限于：判断某些原始数据与现有分析代码不适配、自行做代码适配与调整、
参数调优、失败自诊断与重试。不能把 AI 限制成只读旁观者，否则无法发挥其真实实力。

### 11.2 现状与本构想的差距

第六节所述双轨（租约编排 + Pi 工具层）已从保守第一阶段推进到受控自主阶段：
tier2 三工具（propose_adaptation / run_validation / dispatch_step）已落地，
真机闭环跑通「读指标 → 提适配 → 3.5GB 验证 VERIFIED_OK → 6.5GB 下发 completed」。
检查点一改为 180 秒宽限自动放行，检查点二保留人工签发硬闸门。
当前缺口不再是「能不能写」，而是「写的边界有多宽」与「生产接线覆盖面」。

### 11.3 三层自主模型（拟议设计，待专家评审）

| 层 | 范围 | 机制 | 落点 |
|---|---|---|---|
| 自主层 | 数据适配、参数调优、失败自诊断与重试、代码适配验证 | AI 全权执行，免审批；所有动作进台账与回执 | 仓库已预留的项目适配层正规缝：`workspace/projects/<id>/scripts/` + `scripts_manifest.json` 登记（第 6 道门禁本就允许登记后的项目层脚本，禁止的只是母版同名副本 REJ-002） |
| 通知层 | 立项方案、靶点锁定等原硬闸门 | 两道检查点策略化：通知 + 宽限期自动放行，人只在异常时介入 | `pi_supervisor.js` 状态机加 autonomy_policy 策略层，不拆状态机本体 |
| 红线层 | 大框架不可变项 | 保留锁死，AI 只能提案 | 三条：母版真源修改走提案流（AI 出 patch 人工一键合入）、内存红线 REJ-006、交付 Ed25519 签名与四关验收 |

### 11.4 自主层三个新工具（已落地，2026-11-15）

| 工具 | 能力 | 边界 |
|---|---|---|
| propose_adaptation | 产出适配脚本并登记 scripts_manifest | 只写项目适配层，不碰母版 |
| run_validation | 在受控通道跑该步验证 | 必须过相关门禁与桥接检查点，内存红线内 |
| dispatch_step | 走既有任务 FSM 下发执行 | 复用 11 层判定链与产物回执，非裸 shell |

### 11.5 设计立场（给专家的前提输入）

1. 审计链（台账、回执、种子、哈希、逐字节同源）不是限制 AI，而是放权的基础：
   有了证据链，AI 适配出错可精确回滚，调参历史可复现对比，这才敢给自主权。
2. 红线层三条保留的理由：它们是「结果可信」的地基。松了它们，AI 干得再多
   也无法对客户背书交付。
3. 本构想不改动 work_order/v2、receipt/v1、五态状态机、租约体系与追加台账。

### 11.6 请专家评审的具体问题

状态（2026-11-15）：问题 1 与 3 已由外部专家裁定并落地（三层自主矩阵 + 检查点 C 方案）；
问题 2 的降级签名分级已落地，重试上限仍需按项目类型细化；问题 4 的提案审批界面已有靶点卡片与签发步进器，最小可用集仍待评审。

1. 自主级别矩阵按什么维度切（阶段、数据模态、失败次数、成本）才既放得开又收得住？
2. 自主层失败语义：适配验证失败的重试上限、降级策略与人工介入触发条件。
3. 通知层宽限期默认值与豁免清单形态。
4. 提案流的 patch 审批界面最小可用集（在桌面壳里完成，不开终端）。

## 十二、请专家重点给方案的问题清单

1. 对外凭证体系：白名单文件热加载 vs 每客户独立 token vs 轻量账号；凭证如何映射身份进 PKG 留痕；提交限流与上传配额按什么口径设计。
2. 穿透安全：只暴露 portal 的前提下，是否前置 Caddy（GOAL T6 预案）、管理面如何零暴露、凭证轮换与审计。
3. 轻量接收器形态：随桌面服务常驻轮询 vs 独立进程；轮询间隔、重试、幂等与 result 回写的失败语义；与工作台租约体系的关系。
4. 桌面壳收尾优先级：视图矩阵核对、产物导出入口、日志视图与设置页的最小可用集。
5. 扩展路径：在不换状态模型（work_order/v2 + receipt/v1 + 五态 + 追加台账）前提下，未来多管理员、多算力节点、独立部署 portal（B 方案）的演进缝。
6. PKG 包结构演进：requirement.json + package_manifest + data_files sha256 的向后兼容扩展点。
7. AI 主力化三层自主模型（见第十一节）：自主层工具边界、通知层策略参数、
   与现有 Pi 护栏门禁（第 26 道）的兼容演进路径。

## 十三、附录：真源文件索引（专家本地查证用）

| 问题域 | 真源 |
|---|---|
| 架构原则 | SPEC.md |
| 范围与否决台账 | SCOPE.md |
| 术语 | GLOSSARY.md |
| 路由 | ROUTER.yaml（12 条：三线全链、线1 差异富集、线1 ML、线2 敲除、线3 域、线3 解卷积、图件重渲、Pi 监督、交付报告、门禁分诊、设备离线） |
| 迁移契约 | MIGRATION.md（W1 到 W10 已完成） |
| 模块注册表 | tools/bio/workflows.json |
| 门禁真源 | tools/dev/run_all_gates.mjs（GATES 数组） |
| 工单契约 | schemas/work_order_v2.schema.json + shared/work_order_v2.mjs |
| 回执契约 | BioanalysDesktop/server/receipt_v1.js |
| 编排器 | tools/dev/work_order_orchestrator.mjs + docs/WORK_ORDER_ORCHESTRATOR.md |
| 队列与租约 | BioanalysDesktop/server/services/work_order.service.js、authority.service.js |
| 租约规格 | docs/AI_ORCHESTRATION_SPEC.md |
| Pi 契约 | docs/PI_CLI_INTEGRATION.md + pi_tools_bridge.js + pi_supervisor.js |
| 交付验收 | tools/reporting/delivery_acceptance_core.mjs + docs/delivery_acceptance_spec.md |
| 图件规范 | docs/figure_spec.md（v2.3） |
| 算力接口 | docs/COMPUTE_INTERFACE.md |
| 隔离约束 | docs/isolation.md |
| 台账 schema | docs/ledger-schema.md |
| 门户实现 | portal/serve.mjs（提交、上传、sync 协议） |
| 收件箱读取 | BioanalysDesktop/server/portal_inbox.js |
| 桌面壳 | docs/DESKTOP_APP.md + desktop/ + BioanalysDesktop/src/desktop/ |
| 便携包构建 | desktop/package.json + tools/dev/build_portable_package.mjs |
| 两面新目标 | docs/GOAL_2026-11-15.md |
| 收口目标 | docs/GOAL_2026-11-11.md |
| 全景快照 | docs/PROJECT_PANORAMA_2026-11-11.md |
| 指标基线 | tools/dev/metrics_sync.mjs（实测口径） |

（简报完）
