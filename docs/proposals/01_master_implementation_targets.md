# AI 辅助生信分析流程工作台 v2.0 · Agent 实施总目标与垂直切块单

本文件供 Coding Agent 直接读取并按顺序推进。
执行过程严格遵循根目录 `AGENTS.md` 与 `docs/mattpocock-workflow-spec.md`：按 **Slice 1 到 Slice 6** 垂直切块推进，每个切块坚持 **先写会变红的测试，再写实现代码把测试变绿，最后核对完成判据**。前一切块未变绿前，停留在本切块闭环。

## 全局终态目标（End-State Target）

建成「四大板块目录解耦、服务端与 AI 进程内合体、手机端纯粹算力自治、双阶段终验与五类追加式台账闭环」的 v2.0 生信自动化工作台：

1. **契约与角色就位**：`schemas/` 下四大 JSON Schema 与 `.agents/prompts/` 下 Role 0 到 Role 5 提示词全量落盘，通过 Schema 元校验。
2. **中枢隔离与台账就位**：`03_server_orchestrator` 实现三线物理隔离断言、前置算力准入筛、PNG/PDF 首尾二进制魔数核验、以及带 `prev_record_sha256` 哈希链的 `con_hf/ledger/*.jsonl` 追加式台账。
3. **边缘算力与热保护就位**：`01_mobile_compute` 实现 `ext4` 分区断言、3 线程与 `seed=20261013` 封印、`.lock`/`.done` 原子幂等执行器、三联产物组装器，以及 43.0°C `SIGSTOP` / 39.0°C `SIGCONT` 遥测边车。
4. **AI 编排与终验中间件就位**：`04_ai_automation` 作为进程内异步中间件挂载进 `03_server_orchestrator`，跑通 Role 0 门禁、Role 1 管线规划、Role 3 自愈补丁（单步最多重试 2 次）、Role 4 双阶段终验（75 分放行）与 `deliverables/` 客户四大件打包。
5. **三视图控制台就位**：`02_client_ui` 接入 Schema 动态表单（含 `_attribution` 归因）、三线台账监控台与 K40 算力沙盒视图。

---

## 垂直切块执行清单（Vertical Slices）

### Slice 1：四大 JSON Schema 契约与 Role 0~5 提示词底座

* **目标**：建立全系统唯一数据契约真源与智能体角色指令库。
* **落盘文件**：
  1. `schemas/requirement.schema.json`（含模式 A/B、样本重复数 `minItems: 3`、`_attribution` 渠道字段）
  2. `schemas/execution_manifest.schema.json`（含三线枚举、`seed: 20261013`、`max_threads: 3`、`compute_sieve_report`、`dag_steps`）
  3. `schemas/artifact_triad.schema.json`（含 `exit_code`、`from_idempotent_cache`、`outputs_ledger`、`log_digest`）
  4. `schemas/acceptance_card.schema.json`（含机械核验布尔值、生物学评分 `0~100`、`final_decision`）
  5. `.agents/prompts/role0_intake_gatekeeper.md` 至 `role5_ledger_chaos_auditor.md`（共 6 份角色提示词）
  6. `tests/test_slice1_schemas.py`
* **先红后绿测试环**：
  * 编写 `tests/test_slice1_schemas.py`，构造合法样本与 4 类非法样本（生物学重复 `n=2`、含特殊字符样本名、随机种子非 `20261013`、缺失 `_attribution`），断言合法样本通过校验，非法样本全部触发 `jsonschema.ValidationError`。
* **完成判据（Done Criteria）**：
  * 运行 `pytest tests/test_slice1_schemas.py` 退出码为 `0`。
  * 运行破折号扫描脚本确认 `.agents/prompts/*.md` 与 `schemas/*.json` 含 `0` 个 em dash。

---

### Slice 2：三线物理隔离守卫、算力准入筛与二进制魔数核验器

* **目标**：在服务端落盘静态安全防线与产物二进制核验核心模块。
* **落盘文件**：
  1. `03_server_orchestrator/core/isolation_guard.py`
  2. `tests/test_slice2_isolation_and_magic.py`
* **核心实现要求**：
  * `assert_three_line_isolation(isolation_line, target_paths)`：校验路径归属 `line1_bulk`、`line2_scrna` 或 `line3_spatial` 对应沙箱，拦截 `..` 路径上溯与跨线引用，违例抛出 `IsolationViolationError`。
  * `evaluate_compute_sieve(isolation_line, n_genes, n_cells_or_samples, max_ram_mb=5500)`：当单细胞数超 20,000 或预估峰值内存超 5,500MB 时，自动标记 `downsampling_applied: True` 并将 `target_cell_cap` 设为 `15000`。
  * `verify_artifact_binary_integrity(filepath, expected_sha256)`：核对文件 SHA256，校验 PNG 首部 `89504e470d0a1a0a` 加尾部 `IEND\xaeB`\x82`（体积 `>= 4KB`），校验 PDF 首部 `%PDF-` 加尾部 `%%EOF`（体积 `>= 2KB`）。
* **先红后绿测试环**：
  * 测试跨线路径（如 `line1_bulk` 引用 `../line2_scrna/ref.rds`）触发 `IsolationViolationError`。
  * 测试 30,000 细胞单细胞输入触发 `downsampling_applied == True`。
  * 构造完整 PNG、截断 PNG（缺失 `IEND`）、0 字节文件与哈希篡改文件，断言只有完整且哈希匹配的 PNG 返回 `(True, "OK")`。
* **完成判据（Done Criteria）**：
  * 运行 `pytest tests/test_slice2_isolation_and_magic.py` 退出码为 `0`。

---

### Slice 3：双层五类追加式防篡改 JSONL 台账引擎

* **目标**：实现带文件排他锁与 SHA256 哈希链的单真源治理台账。
* **落盘文件**：
  1. `03_server_orchestrator/core/ledger_engine.py`
  2. `tests/test_slice3_ledger_chain.py`
* **核心实现要求**：
  * 支持 `tasks`、`isolation`、`compute`、`audit`、`attribution` 五类台账写入 `con_hf/ledger/*.jsonl`。
  * 每次追加使用文件锁保护，自动读取上一行 `record_sha256` 写入当前行 `prev_record_sha256`（首行使用 64 个 `0`），并计算当前行规范化 JSON 的 `record_sha256`。
  * 提供 `verify_ledger_chain(category)` 函数，逐行校验哈希链完整性。
* **先红后绿测试环**：
  * 连续写入 10 条台账记录，断言 `verify_ledger_chain` 返回 `True`。
  * 模拟篡改第 5 行 payload 中的一个字符，断言 `verify_ledger_chain` 立即返回 `False` 并指出断裂行号。
* **完成判据（Done Criteria）**：
  * 运行 `pytest tests/test_slice3_ledger_chain.py` 退出码为 `0`。

---

### Slice 4：手机端算力封印、原子幂等执行器与热熔断遥测边车

* **目标**：完成 `01_mobile_compute` 容器内纯 Linux 运行面的幂等计算与温度保护闭环。
* **落盘文件**：
  1. `01_mobile_compute/runtime/bio_limits.sh`（755 权限，LF 行尾）
  2. `01_mobile_compute/runtime/pi_idempotent_runner.sh`（755 权限，LF 行尾）
  3. `01_mobile_compute/runtime/pi_telemetry_sidecar.py`（755 权限，LF 行尾）
  4. `tests/test_slice4_mobile_runner.py`
* **核心实现要求**：
  * `bio_limits.sh`：设置 3 线程环境变量、`BIO_GLOBAL_SEED=20261013`、`NO_PROXY="100.64.0.0/10,127.0.0.1,localhost"`，拦截 `/sdcard`、`/storage/emulated` 与 `/mnt/shared` 路径（违例退出码 `91`）。
  * `pi_idempotent_runner.sh`：通过 `setsid` 启动独立进程组，维护 `.lock` 与 `.done`；截取 `stdout` 首尾 40 行与 `stderr` 尾部 60 行组装 `.triad.json`；二次调用同一已完成任务时直接返回缓存（`from_idempotent_cache: true`）。
  * `pi_telemetry_sidecar.py`：实现 `ThermalCircuitBreaker` 状态机，电池温度 `>= 43.0°C` 时向活动 `.lock` 进程组发 `SIGSTOP`，`<= 39.0°C` 时发 `SIGCONT`，并通过 `ProxyHandler({})` 向服务端发送心跳与未同步的 `.triad.json`。
* **先红后绿测试环**：
  * 测试传入 `/sdcard/test_work` 目录时，`pi_idempotent_runner.sh` 立即拒绝并返回退出码 `91`。
  * 测试正常任务首次执行生成 `.done` 与 `.triad.json`（`from_idempotent_cache == False`），第二次执行耗时小于 0.5 秒且 `from_idempotent_cache == True`。
  * 测试 `ThermalCircuitBreaker` 在注入 `43.5°C` 时切换为 `THROTTLED_PAUSED` 并递增 `throttle_count`，注入 `38.5°C` 时恢复为 `RESUMED_ACTIVE`。
* **完成判据（Done Criteria）**：
  * 运行 `pytest tests/test_slice4_mobile_runner.py` 退出码为 `0`，且所有 `.sh` 文件行尾均为 `LF`。

---

### Slice 5：服务端与 AI 进程内合体编排、A2A 派单与客户四大件打包器

* **目标**：打通从 `requirement.json` 准入、Manifest 规划、A2A 派单、两阶段终验、最多 2 次自愈重试到 `deliverables/` 四大件打包的完整后端流水线。
* **落盘文件**：
  1. `04_ai_automation/agents/pipeline_middlewares.py`（内嵌 Role 0、Role 1、Role 3、Role 4 处理器及 Excel 日期基因名修复器、物种基因符号大小写规范器）
  2. `03_server_orchestrator/core/a2a_dispatcher.py`（管理 Tailscale JSON-RPC 2.0 派单、心跳接收、热挂起超时顺延与优先级队列 `PRO_URGENT > STANDARD > TRIAL`）
  3. `03_server_orchestrator/core/deliverables_packager.py`（组装报告、图表、表格与 `04_Reproducibility_Capsule.zip`）
  4. `tests/test_slice5_e2e_pipeline.py`
* **先红后绿测试环**：
  * 测试输入基因含 Excel 污染名 `1-Mar` 与 `2-Sep` 时，Role 0/1 自动将其修复为标准 HGNC 符号 `MARCHF1` 与 `SEPTIN2`。
  * 测试模拟算力端首次返回 `exit_code = 137`（OOM）时，Role 3 生成降采样补丁重跑（第 1 次自愈）并成功通过；模拟连续 3 次失败时，在第 2 次自愈后准时熔断转人工工单。
  * 测试终验通过后，`deliverables_packager.py` 产出完整四大件且 `04_Reproducibility_Capsule.zip` 内包含 `execution_manifest.locked.json`、`acceptance_scorecard.json`、`sha256_manifest.txt` 与 `runtime_session_info.txt`。
* **完成判据（Done Criteria）**：
  * 运行 `pytest tests/test_slice5_e2e_pipeline.py` 退出码为 `0`。

---

### Slice 6：统一工作台三视图前端与端到端联调

* **目标**：在 `02_client_ui` 与 `BioanalysDesktop` (`127.0.0.1:18787`) 落地三视图控制台。
* **落盘文件**：
  1. `02_client_ui/src/views/PortalIntakeAndDeliveryView.*`（视图 1：基于 `requirement.schema.json` 的动态表单与四大件预览下载）
  2. `02_client_ui/src/views/HubIsolationAndLedgerView.*`（视图 2：三线物理隔离状态灯、DAG 队列与 `con_hf/ledger/*.jsonl` 审计表）
  3. `02_client_ui/src/views/EdgeComputeAndAgentSandboxView.*`（视图 3：K40 电池温度/内存卡片、热熔断状态灯与 Manifest/Acceptance 对比沙盒）
  4. `tests/test_slice6_workbench_api.py`
* **完成判据（Done Criteria）**：
  * 启动本地服务端后，健康检查、任务提交（`/api/v1/requirements`）、遥测心跳（`/api/v1/a2a/heartbeat`）、台账查询（`/api/v1/ledger`）与交付包下载接口全部返回 HTTP 200 且通过 Schema 校验。
  * 全仓运行 `pytest` 全量测试集 100% 变绿，全仓文档无破折号（em dash）、无未打码凭证。
