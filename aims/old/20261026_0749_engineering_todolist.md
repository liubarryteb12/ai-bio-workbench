# AI 辅助生信分析工作台（BioanalysDesktop）全域统一工程任务清单（TodoList v3.0）

> **文档角色**：工程可执行任务清单与验收核对表（Engineering TodoList）
> **版本与时间戳**：`v3.0` | 生成时间戳：`2026-10-26 07:49:17 -04:00`（文件标识：`20261026_0749`）
> **对齐基线**：与规范总纲 `20261026_0749_aims_v3.0_spec.md` 及执行计划 `20261026_0749_execution_plan.md` 1:1 严格对齐
> **核心施工准则**：
> 1. 严格按照 **「第一阶段：基础落地 → 第二阶段：相关配套 → 第三阶段：功能实现」** 顺序推进，**严禁跨阶段跳跃干活**。
> 2. 每个工作包（`WP-X.Y`）和子任务（`T-X.Y.Z`）均明确标注：**当前状态、前置依赖、独占修改文件域（`write_scopes`）、具体可执行动作、完成判据（DoD）与台账回写落点**。

---

## 一、 全局进度总览（按三阶段工程规范对齐）

| 工程阶段 | 阶段定位 | 包含工作包 | 子任务总数 | 已完成基线 | 待办/硬化项 | 阶段准入与准出硬门槛 |
| :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| **第一阶段：基础落地**<br>*(Foundation Landing)* | 契约收口、双平面目录、K40 防崩底座、R 4.5.3 与离线公共库验证 | `WP-1.1` ~ `WP-1.4` | 12 项 | 12 项 | 0 项 | **准出**：SSOT 契约零分叉、`local_projects/` 目录就绪、R 4.5.3 三层验证与离线库 100% 落盘 |
| **第二阶段：相关配套**<br>*(Supporting Facilities)* | JSONL 台账与索引器、桥接与配额守卫、图模板注册表、Sync 通道与 CI | `WP-2.1` ~ `WP-2.4` | 13 项 | 13 项 | 0 项 | **准入**：第一阶段 100% 绿灯<br>**准出**：台账迁移零丢数、守卫单测全绿、模板入册、Sync 骨架跑通 |
| **第三阶段：功能实现**<br>*(Feature Implementation)* | 三线 55 步生信闭环、8080/8787 视图、Sync 全链路、真实交付与高可用 | `WP-3.1` ~ `WP-3.4` | 13 项 | 13 项 | 0 项 | **准出**：三线真机 `exit 0`、12 条 E2E 全绿、真实交付包签名验签通过 |

---

## 二、 第一阶段：基础落地（Phase 1: Foundation Landing）任务清单

> **阶段铁律**：本阶段解决所有“底层契约、物理目录、容器环境、公共参考库”问题。在本阶段 12 项子任务全部勾绿前，严禁编写上层 Sync 接口、图模板选择器 UI 或启动全流程跑批。

### 【WP-1.1】全局单一事实源（SSOT）基础契约收口
* **前置依赖**：无（工程起点）
* **独占 `write_scopes`**：`BioanalysDesktop/server/tumor_blacklist.js`、`shared/data_formats.mjs`、`BioanalysDesktop/server/ledger.js`、`portal/serve.mjs`、`BioanalysDesktop/tests/*_parity.test.js`

- [x] **T-1.1.1 [已完成基线] 锁定 20 条非肿瘤黑名单规格正本**
  * **执行内容**：在 `server/tumor_blacklist.js` 固化英文 16 条 + 中文 4 条黑名单（含 `PD-1`/`PD-L1` 左右边界正则），彻底废除旧文档中“8 条”或“27 条”残留口径。
  * **验收 DoD**：`tests/tumor_blacklist_parity.test.js` 通过，`GPD1`/`SLC40A1` 不误判。
- [x] **T-1.1.2 [已完成] 8080 门户黑名单与数据格式白名单动态注入改造**
  * **执行内容**：修改 `portal/serve.mjs`，在读取响应 `portal/index.html` 时动态 import `../shared/data_formats.mjs`（14 类扩展名、`5GiB` 上限）与 `../BioanalysDesktop/server/tumor_blacklist.js`（20 条正本），通过占位符 `__INJECT_SHARED_CONTRACTS__` 实时序列化注入前端 `<script>`，废除 HTML 内手工维护字面量副本。
  * **验收 DoD**：修改 `tumor_blacklist.js` 任一条目无需手改 `portal/index.html`，`npm test` 中 `tumor_blacklist_parity.test.js` 与 `data_format_parity.test.js`（11 条用例）100% 绿灯。
  * **台账回写**：`con_hf/ledger/changes.jsonl` 追加 `CHG-20261026-001`。
- [x] **T-1.1.3 [已完成基线] 路径合法根四形态契约固化**
  * **执行内容**：在 `server/ledger.js` 固化 `analyzePath` / `inspectTaskPath`（当前项目路径、只读 `public_references`、历史兼容路径、裸相对文件名），拦截 `processed/x.tsv` 与 `..` 路径穿越。
  * **验收 DoD**：`tests/ledger.test.js` 22 条用例全绿。

### 【WP-1.2】远端与本地双平面物理目录落地
* **前置依赖**：`WP-1.1`
* **独占 `write_scopes`**：`docs/directories.md`、`ops/check_storage_and_isolation.sh`、`ops/init_project_scaffold.py`、`ops/local_project_workspace.py`、`BioanalysDesktop/tests/project_scaffold.test.js`、`BioanalysDesktop/tests/aims_drift_guard.test.js`

- [x] **T-1.2.1 [已完成] 远端 `/mnt/ssd/bio_data/` 原生分区与 FUSE 红线门禁**
  * **执行内容**：`ops/check_storage_and_isolation.sh` 校验 `df -T` 为 `ext4`/`f2fs`（拒绝 `fuse`/`sdcardfs`）、可用空间 $\ge 20\%$、三线目录硬隔离。
  * **验收 DoD**：远端实测 `check_storage_and_isolation.sh` 退出码 `0`。2026-10-26 22:37 实测 f2fs、剩余 87%、`line1_bulk` 门禁通过，动作见 `con_hf/ledger/actions.jsonl` 的 `ACT-20261026-001`。
- [x] **T-1.2.2 [已完成] 更新 `docs/directories.md` 合法化 `local_projects/` 与 `con_hf/sync/`**
  * **执行内容**：在 `docs/directories.md` 正式增补本地项目自包含根 `local_projects/<项目>/`（含 `project.json`、`handoff.md`、`README.md`、`INDEX.json`、`data/`、`figures/{<line>,adapt}`、`deliverables/`、`debug/`、`ledger/`）及同步运行态目录 `con_hf/sync/{inbox,outbox,daemon.log}`。
  * **验收 DoD**：文档条款与 `20261026_0749_aims_v3.0_spec.md` §2.2.2 完全一致。
- [x] **T-1.2.3 [已完成] 编写项目自包含结构初始化脚手架 `ops/init_project_scaffold.py`**
  * **执行内容**：编写幂等脚手架脚本，给定 `--project <id> --line <line> [--ticket <id>]`，自动创建 `local_projects/<项目>/` 下全部标准子目录、初始化 5 个空的 `.jsonl` 台账文件、写入首条 `kind: "init"` 的 `actions.jsonl` 记录，并初始化全局 `con_hf/ledger/*.jsonl` 与 `con_hf/sync/{inbox,outbox}`。
  * **验收 DoD**：新增 `BioanalysDesktop/tests/project_scaffold.test.js` 验证目录树、工作区 root 边界、幂等重跑与首条 `init` JSONL 格式 100% 符合 §3.1.2 Schema。

### 【WP-1.3】红米 K40 算力底座防崩与长任务守护硬化
* **前置依赖**：`WP-1.2`
* **独占 `write_scopes`**：`ops/bio_limits.sh`、`ops/run_throttled_task.sh`、`ops/00_link_check.ps1`、`ops/bio_memory_guard.py`、`ops/bio_r_header.R`、`ops/layout_autoload/sitecustomize.py`、`ops/layout_autoload/Rprofile`、`docs/termux_keepalive.md`、`BioanalysDesktop/server/{task.js,run.js,index.js,audit.js}`、`cn_debug/lib/chain_runner.mjs`、受影响母版与对应测试

- [x] **T-1.3.1 [已完成] 容器 3 线程封顶与 7.5GB 内存软熔断配置**
  * **执行内容**：`/etc/profile.d/bio_limits.sh` 锁死 3 线程与 `MPLBACKEND=Agg`；Python `RLIMIT_AS=7.5GB` 与 R `future.globals.maxSize=6.0GB` 防崩头就位。
  * **验收 DoD**：K40 实测线程环境为 `3/3/3/3/3`，Python `RLIMIT_AS=8053063680`，Rprofile 生效后 data.table 线程为 3；所有部署母版不再覆盖为 4 线程。
- [x] **T-1.3.2 [已完成] EAS 动态调度与高温自适应冷却循环**
  * **执行内容**：`ops/run_throttled_task.sh` 默认不静态绑核，采用 `nice -n 10 ionice -c 2 -n 4`；启动前检测温度 $\ge 90^\circ	ext{C}$ 自动 `sleep 30` 直至 $< 78^\circ	ext{C}$。
  * **验收 DoD**：K40 用假温度源实测 `95.0C -> 95.0C -> 70.0C`，冷却 2 秒后才启动任务，台账记录 completed 与热参数。
- [x] **T-1.3.3 [已完成] 固化长任务队列 P-26 / P-27 / P-29 三条容器守护铁律**
  * **执行内容**：在远端派发脚本与 `run_throttled_task.sh` 中强制落地：① `setsid nohup` 脱离本机进程树（P-26）；② 台账等待分档，`l2_tf_scenic` 与 `l2_ko_scrna` 设 40 分钟档，其余设分钟档（P-27）；③ 锁死 SSH 轮询间隔 $\ge 60$ 秒、重试 $\le 2$ 次，并在门禁中拦截容器内 `find` / `ps` / `grep -r` 调用（P-29）。
  * **验收 DoD**：生产长步骤改走 `setsid nohup`，服务端每 60 秒单次轮询 `/tmp` 状态文件；提交层加全局 SSH 并发 409 闸门；P-29 关键字门禁和 runner 参数钳制均通过 89 项定向回归。

### 【WP-1.4】容器 R 4.5.3 环境升级验证与离线公共参考库落盘
* **前置依赖**：`WP-1.3`
* **独占 `write_scopes`**：`reference/05.可参考出图代码/_meta/`、`ops/prepare_line1_benchmark.py`、`ops/verify_r453_l2.py`、`ops/verify_r453_figures.py`、`ops/verify_public_references.py`、`ops/tests/`、远端 `/mnt/ssd/bio_data/public_references/`

- [x] **T-1.4.1 [已完成] 执行 K40 容器 R 4.5.3 三层递进兼容性验证（17 个已验图型）**
  * **执行内容**：严格按 `reference/05.可参考出图代码/_meta/端到端验证框架.md` 在 K40 容器内执行：① L1 环境层（R 4.5.3 版本、PNG 魔数 `89504e47`、PDF 落盘、22 个 R 包 `requireNamespace` 全 TRUE）；② L2 桥接层（h5ad 四项断言、CSV 中文列头、17 位精度 bit-exact）；③ L3 闭环层（逐一复跑 17 个已验证图型，生成探测报告，通过标 `ready`，失败标 `blocked_r453` 并记录原因）。
  * **验收 DoD**：产出 `_meta/r453_verification_report.json`，刷新 `_meta/bizard_index.csv` 的“本库状态”列，零带病放行。已完成：L1 `22/22`，L2 `6/6`，L3 `16 ready + 1 blocked_r453`；KEGG 通路图没有 `pathview` 母版，明确标记阻塞而未以富集气泡图冒充。
  * **台账回写**：失败图型记入 `con_hf/ledger/pitfalls.jsonl`；验证动作记入 `con_hf/ledger/actions.jsonl`。
- [x] **T-1.4.2 [已完成] 部署离线 STRING v12.0 互作库至远端只读公共库**
  * **执行内容**：将 `Homo sapiens` (9606) 与 `Mus musculus` (10090) 的 STRING v12.0 核心互作表（`protein.links.v12.0.min700.tsv.gz` 及 `protein.info`）上传至 `/mnt/ssd/bio_data/public_references/stringdb/` 并设只读权限。
  * **验收 DoD**：远端文件 SHA256 校验通过，无外网条件下 R `igraph` 可直接读取建网。已完成：人类图 16,201 节点 / 473,860 边，小鼠图 15,971 节点 / 403,720 边。
- [x] **T-1.4.3 [已完成] 部署 Line 1 独立外部验证基准双数据集**
  * **执行内容**：将标准微阵列/转录组独立 train/val 双数据集部署至 `/mnt/ssd/bio_data/public_references/benchmarks/line1/`，并同步分拆项目内 `processed/{train,val}` 目录。
  * **验收 DoD**：远端只读挂载正常，满足 Line 1 Step 9 冻结模型外部验证输入要求。已完成：GSE16561 训练集 63 样本，GSE58294 验证集 92 样本，共 13,528 个交集基因，输入与 processed 产物哈希全部匹配。

---

## 三、 第二阶段：相关配套（Phase 2: Supporting Facilities）任务清单

> **阶段铁律**：本阶段搭建“台账索引、桥接与配额守卫、图模板注册表、Sync 传输通道与 CI 门禁”。必须在第一阶段完成后启动，且在本阶段全部绿灯前严禁上线第三阶段业务功能。

### 【WP-2.1】全生命周期 JSONL 台账体系、索引生成器与存量项目迁移
* **前置依赖**：`WP-1.2` 完成
* **独占 `write_scopes`**：`ops/ledger_indexer.py`、`ops/migrate_to_local_projects.py`、`con_hf/ledger/*.jsonl`、`local_projects/**`

- [x] **T-2.1.1 [已完成] 编写 JSONL 台账聚合渲染与索引生成器 `ops/ledger_indexer.py`**
  * **执行内容**：实现按 `id` 聚合 Append-Only JSONL（取最后一条状态，按 `refs` 串联 `errors.jsonl` 与 `fixes.jsonl` 生成统一 issue 视图），自动扫描项目目录生成机读 `local_projects/<项目>/INDEX.json`（同时索引 `ledger/` 与 `outputs/system_logs/`）、人读 `README.md` 及全局汇总 `local_projects/INDEX.md`。
  * **验收 DoD**：`tests/jsonl_ledger_index.test.js` 验证追加覆盖语义、`refs` 多对多关联及 `INDEX.json` 产物计数 100% 准确。
- [x] **T-2.1.2 [已完成] 迁移全局 `con_hf/pitfalls_ledger.md` 与 `ops_ledger.md` 至 `con_hf/ledger/*.jsonl`**
  * **执行内容**：将现有 Markdown 台账无损转换为 `con_hf/ledger/pitfalls.jsonl` 与 `actions.jsonl`，**严格保留 `P-01` ~ `P-29` 全部原始编号**（`SPEC_DECISIONS.md` 的 `D-XX` 保持原文件不动）。
  * **验收 DoD**：转换前后条目数 1:1 对齐，所有历史 `P-XX` 引用不断链。
- [x] **T-2.1.3 [已完成] 存量项目（`PRJ_20261019_IS_lactylation` 与 `default`）及真实图件零损迁入 `local_projects/`**
  * **执行内容**：将分散在 `outputs/<项目>/`、`deliverables/`、`cn_debug/` 及 `outputs/figures/`（108 张母版真实结果图 + `index.html`）的存量资产，按自包含结构整体迁入 `local_projects/<项目>/` 对应子目录，前后比对文件数与总字节数。
  * **验收 DoD**：迁移前后文件数与 SHA256 100% 一致，生成的 `local_projects/INDEX.md` 可一键检索全部存量项目。实际源集为 108 个文件，其中 107 张 PNG 与 1 个索引 HTML，已整体零损迁移；`PRJ_20261019_IS_lactylation` 113 个源文件全部复制并通过 SHA256 复核。

### 【WP-2.2】静态扫描去注释、阶段感知桥接守卫与上传硬配额闸门
* **前置依赖**：`WP-1.1`、`WP-1.3` 完成
* **独占 `write_scopes`**：`BioanalysDesktop/server/task.js`、`ops/verify_bridge_checkpoint.py`、`src/bridge_guard.sh`、`BioanalysDesktop/server/upload.js`

- [x] **T-2.2.1 [已完成] `server/task.js` 合入 `stripShellAndCodeComments` 剥离注释行**
  * **执行内容**：在 `inspectBridgeNeed` 正则匹配前剥离全部 `#` 纯注释行与行尾注释（仅保留 `#!` shebang），并在 `ops/check_storage_and_isolation.sh` 跨线扫描中同步保持去注释口径。
  * **验收 DoD**：含 `# Rscript` 或 `# python` 注释的单语言脚本不再被误判为 bilingual，`tests/task_submit_validation.test.js` 全绿。
- [x] **T-2.2.2 [已完成] `ops/verify_bridge_checkpoint.py` 与 `src/bridge_guard.sh` 合入 `--stage` 阶段感知模式**
  * **执行内容**：为 `verify_bridge_checkpoint.py` 增加 `--stage {pre-dimred,post-dimred}`（默认 `post-dimred`）；`src/bridge_guard.sh` 锁死本机优先（`MODE=local`）执行并支持透传 `--stage` 参数。
  * **验收 DoD**：`tests/bridge_guard_invariant.test.js` 覆盖 `post-dimred` 缺 `obsm` 阻断（exit 1）与 `pre-dimred` 显式放行（`[BRIDGE WARN]` exit 0）双场景。
- [x] **T-2.2.3 [已完成] `server/upload.js` 升级 20GiB `reservedBytes` 写盘前原子硬闸门**
  * **执行内容**：在 `POST /api/upload/init` 将声明的 `fileSize` 写入 `meta.json` 的 `reservedBytes` 进行原子预留；在 `POST /api/upload/chunk` 写盘前强制检查 `receivedBytes + chunkBuffer.length <= reservedBytes`，超限立即回 `413` 阻断。
  * **验收 DoD**：`tests/upload_quota.test.js` 并发超额分片压测 100% 精准返回 `413`/`507`，绝不写穿配额。

### 【WP-2.3】出图规范 v2.1 配套与图级模板库注册表构建
* **前置依赖**：`WP-1.4`（特别是 `T-1.4.1` R 4.5.3 验证完成）
* **独占 `write_scopes`**：`src/figure_templates.json`、`BioanalysDesktop/server/figure_graph.js`、`BioanalysDesktop/tests/figure_templates_parity.test.js`

- [x] **T-2.3.1 [已完成基线] 15 条出图版式判据与无头渲染主题套件**
  * **执行内容**：`ops/fig_theme.py`、`ops/fig_theme.R` 与 `ops/audit_figure_layout.py` 就位，137 张历史图件 100% PASS。
- [x] **T-2.3.2 [已完成] 建立图级模板注册表单一事实源 `src/figure_templates.json`**
  * **执行内容**：基于 `T-1.4.1` 的 R 4.5.3 实测结论，将验证通过的图型率先入册 `src/figure_templates.json`，由脚本自动写入 `source_sha256`、`preview_sha256`、`verified` 与 `deps_status`（`ready` / `partial` / `blocked_r453`），明确声明 `adapt_vars` 与 `linked_mods`。
  * **验收 DoD**：注册表 JSON Schema 校验通过，所有 `verified: true` 条目的 `_verified.png` 均在磁盘存在且 `preview_sha256` 100% 匹配。
- [x] **T-2.3.3 [已完成] 实现服务台图级校验器 `BioanalysDesktop/server/figure_graph.js` 与预览防漂移断言**
  * **执行内容**：参照 `workflow_graph.js` 实现 `figure_graph.js`，校验：① `linked_mods` 存在性与线匹配；② `adapt_vars` 必填项齐全且**实参值严禁跨项目/跨线取值**；③ 编写 `tests/figure_templates_parity.test.js`，当母版代码修改但未同批重跑 `_verified.png` 更新 `preview_sha256` 时立即报红；当母版被引用 $> 3$ 次时强制拦截原地覆写。
  * **验收 DoD**：`tests/figure_templates_parity.test.js` 全绿，跨线传参 100% 被拒。

### 【WP-2.4】单向 Sync 通道配套、远端双落点同步工具与 CI 自动化门禁
* **前置依赖**：`WP-2.1`、`WP-2.2` 完成
* **独占 `write_scopes`**：`portal/serve.mjs`、`ops/sync_daemon.ps1`、`ops/serve_guard.ps1`、`ops/sync_and_verify_remote.ps1`、`.github/workflows/ci.yml`

- [x] **T-2.4.1 [已完成] 门户 `portal/serve.mjs` 实现 Sync 六接口、`sync_status` 状态机与 60s 限流**
  * **执行内容**：为 `portal/inbox/` JSON 增加 `sync_status`（`pending → running → done / failed / blocked`，无此字段判 `legacy` 跳过）；实现 `GET /api/sync/pending`、`POST /api/sync/claim`、`GET /api/sync/package`、`POST /api/sync/result`（`SYNC_TOKEN` 鉴权）与 `POST /api/sync/trigger`（60 秒内存 Map 限流）、`GET /api/sync/status`（客户鉴权）。
  * **验收 DoD**：`BioanalysDesktop/tests/portal_sync.test.js` 覆盖幂等 claim、60s 限流返回 `{ok:false, retry_after:N}`、`legacy` 跳过与 `blocked` 状态流转。
- [x] **T-2.4.2 [已完成] 编写编排面单向同步守护进程骨架 `ops/sync_daemon.ps1` 并接入 `serve_guard.ps1`**
  * **执行内容**：强制配置 `NO_PROXY=127.0.0.1,localhost`（不走 `7890` 代理），实现单票 `claim → 下载至 con_hf/sync/inbox/ 并验 sha256 → 防 zip-slip 解包 → 推结果` 骨架（导入与派发留标准 seam 桩，3 次退避重试，自身动作记 `con_hf/ledger/actions.jsonl`）；将 `sync_daemon.ps1` 进程探活并入 `ops/serve_guard.ps1` 30 秒周期。
  * **验收 DoD**：桩模式下单票拉取、验签、解包与异常回退 `failed`/`blocked` 全通，`netstat` 证实 8787 仅监听 `127.0.0.1`。
- [x] **T-2.4.3 [已完成] 编写远端双落点原子同步与对账脚本 `ops/sync_and_verify_remote.ps1`**
  * **执行内容**：自动完成 LF 归一化，将 `src/bridge_guard.sh`、`ops/verify_bridge_checkpoint.py` 及三线母版同步推送至远端 `src/`（审计镜像）与 `bin/<line>/`（PATH 实际执行落点），核对本地与远端双落点 SHA256，支持 `-FailOnDrift`，写入 `system_logs/sync_manifest.json` 与 `con_hf/ledger/actions.jsonl`。
  * **验收 DoD**：执行 `ops/sync_and_verify_remote.ps1 -FailOnDrift` 退出码 `0`，五维自检第 4 维版本一致性灯全绿。
- [x] **T-2.4.4 [已完成] 接入 CI 自动化门禁流水线（GitHub Actions / 本地 Runner）**
  * **执行内容**：配置每次 `git push` 自动执行三连检：`npm test`（500+ 断言）→ `npx tsc --noEmit` → `npm run build`。
  * **验收 DoD**：CI 流水线配置落盘并实测全绿通过，测试覆盖率 $\ge 85\%$。

---

## 四、 第三阶段：功能实现（Phase 3: Feature Implementation）任务清单

> **阶段铁律**：在第一阶段（基础底座）与第二阶段（相关配套）100% 验收通过后，本阶段执行三条生信分析线闭环、门户与工作台视图组装、Sync 全链路贯通及真实客户数据商业交付。

### 【WP-3.1】三条平行生信分析线（55 个步骤脚本）全闭环实现与内存削峰
* **前置依赖**：`WP-1.4`、`WP-2.2`、`WP-2.4`（特别是 `T-2.4.3` 远端同步工具就绪）
* **独占 `write_scopes`**：`src/line1_bulk/scripts/`、`src/line2_scrna/scripts/`、`src/line3_spatial/scripts/`

- [x] **T-3.1.1 [已完成] Line 2 `06_gsva_pathways.R` 切换输入源与 Pseudo-bulk 内存削峰（根治 #1 硬阻塞）**
  * **执行内容**：修改 `src/line2_scrna/scripts/06_gsva_pathways.R`，将输入源从无 `obsm` 的 `scrna_norm.h5ad` 切换为已过【桥接检查点 #1】的 `00_sc_harmony.h5ad` / `05_subcluster.rds`；在调用 `GSVA::gsva()` 前先执行 `Seurat::AggregateExpression(seu, group.by = c("celltype", "sample"))` 聚合为 Pseudo-bulk 矩阵。
  * **验收 DoD**：通过 `sync_and_verify_remote.ps1` 部署至 K40 真机跑通 `gsva_pathways`，退出码 `0`，桥接守卫 `PASS`，内存峰值 $< 3.5	ext{GB}$。
- [x] **T-3.1.2 [已完成] Line 2 `10_virtual_ko.R` 虚拟敲除 3 种子循环显式 GC 削峰**
  * **执行内容**：在 `10_virtual_ko.R` 的 `seeds <- c(20261013, 20261014, 20261015)` 循环体内，每轮提取显著 `DR genes` 后立即执行 `rm(res); gc(verbose = FALSE)` 释放大张量；输出图件强制带 `[Virtual KO Perturbation - DR Genes]` 角标。
  * **验收 DoD**：K40 真机跑通 3 轮虚拟敲除 `exit 0`，峰值内存 $< 4.2	ext{GB}$，绝不触发 7.5GB 熔断。
- [x] **T-3.1.3 [已完成] Line 1 Step 4 离线 PPI 与 Step 9 独立外部验证集真机闭环**
  * **执行内容**：修改 `src/line1_bulk/scripts/04_enrich_ppi.R` 对接 `/mnt/ssd/bio_data/public_references/stringdb/` 离线互作表；修改 `09_external_val.R` 读取 `processed/val/` 独立验证集并严格使用训练集冻结系数计算 `pROC` AUC。
  * **验收 DoD**：无外网条件下 Line 1 全部 9 步（16 个脚本）在 K40 真机 `exit 0`，产出完整图件与台账。
- [x] **T-3.1.4 [已完成基线] Line 3 全 Python 空间域、通讯、NNLS 自签名反卷积与虚拟敲除闭环**
  * **执行内容**：Line 3 17 个全 Python 脚本就位，下游第 7 步采用空间域 Marker Top 5 + `scipy.optimize.nnls` 自签名无监督反卷积（不借用 Line 2 数据）。

### 【WP-3.2】8080 客户门户视图、出图选择器实现与 Playwright E2E 验收
* **前置依赖**：`WP-1.1`、`WP-2.3`、`WP-2.4` 完成
* **独占 `write_scopes`**：`portal/index.html`、`portal/serve.mjs`、`BioanalysDesktop/tests/e2e/portal.spec.ts`

- [x] **T-3.2.1 [已完成] 8080 门户上线图级模板选择器 UI 与预览图/真实图双区隔离展示**
  * **执行内容**：在 `portal/index.html` 模块 C 增加图级模板选择器（按 L1/L2/L3 与分类展示 `_verified.png` 缩略图、语言标识；`deps_status !== "ready"` 置灰并显示原因；`preview_sha256` 不符提示「预览图与模板不同步」；选中后展开 `adapt_vars` 表单）；在结果查看区将「内置示例预览」与 Sync 推回的「本项目真实结果图」物理分区展示并醒目标注。
  * **验收 DoD**：前端交互符合 §4.2 规范，客户绝不会将示例图误认为项目结果。
- [x] **T-3.2.2 [已完成] 编写并跑通 8080 门户 12 条 Playwright E2E 自动化测试**
  * **执行内容**：基于 `@playwright/test` 编写 12 条 E2E 用例，覆盖：20 条肿瘤词红字拦截、`PD-1` 边界基因放行、跨组 GSM 样本防重、勾选虚拟敲除强制弹出 `target_ko_gene`、图型选择器置灰与 `adapt_vars` 提交、4MB 分片中断后基于 `nextIndex` 断点续传、60 秒同步触发限流提示。
  * **验收 DoD**：`npx playwright test` 12 条 E2E 用例 100% 绿灯。

### 【WP-3.3】8787 工作台四大视图、适配副本打包、HTML 交付报告与 Sync 全链路贯通
* **前置依赖**：`WP-3.1`、`WP-3.2` 完成
* **独占 `write_scopes`**：`BioanalysDesktop/src/App.tsx`、`BioanalysDesktop/server/{index,selfcheck,report,task}.js`、`ops/build_client_report.py`、`ops/sync_daemon.ps1`

- [x] **T-3.3.1 [已完成基线] 8787 五维环境自检控制台（含 `runSshStrict` 与 `mergeIsolationChecks`）**
  * **执行内容**：`server/selfcheck.js` 实现五维自检灯，第 4 维合并跨线隔离与 SHA256 版本漂移检查，空输出或非 0 退出码一律判 `unknown` 杜绝假绿灯。
- [x] **T-3.3.2 [已完成] 实现图模板派生副本生成（`figures/adapt/`）并纳入 `01_Adapted_Code/` 交付**
  * **执行内容**：当 8787 `resolvePlan` 解析到客户勾选的图型模板时，将 `reference/05.` 母版复制至 `local_projects/<项目>/figures/adapt/<fig_id>.R/.py`，在文件头部自动写入 `# Master-Source: <path> | Master-SHA256: <sha256>`，按 `adapt_vars` 改写变量后派发 K40 出图至 `figures/<line>/`；修改 `ops/build_client_report.py` 将 `figures/adapt/` 随 `01_Adapted_Code/` 一起打包并写入 `_report.txt` 对账说明。
  * **验收 DoD**：母版文件 SHA256 零变化，交付包 `01_Adapted_Code/` 内含完整派生代码与母版对账头。
- [x] **T-3.3.3 [已完成] 实现单文件出版级 HTML 项目交付报告自动生成器**
  * **执行内容**：在 `ops/build_client_report.py` 与 `server/report.js` 中增加单文件 HTML 报告渲染模块（内联 CSS、零外部字体/脚本依赖、含架构拓扑、五维自检快照、台账统计、DEG vs DR Genes 强标签区分与 300 DPI 图廊缩略预览），随 `.tar.gz` 与双 SHA256 凭证一同落入 `local_projects/<项目>/deliverables/`。
  * **验收 DoD**：生成的 `.html` 单文件在断网浏览器打开排版完美，无任何外部请求报错。
- [x] **T-3.3.4 [已完成] 拔除 `ops/sync_daemon.ps1` seam 桩，接通「门户提交 → 8787 建项派发 → K40 计算 → 回搬打包 → 推回门户」全链路**
  * **执行内容**：将 `sync_daemon.ps1` 的导入派发桩替换为真实调用 `POST /api/projects/create`、`POST /api/tasks/submit`、`ops/07_pull_outputs.ps1`（落 `local_projects/<项目>/data/` 与 `figures/<line>/`）、`POST /api/report/build`（四道闸不过则推 `blocked`）与 `POST /api/sync/result`。
  * **验收 DoD**：从 8080 门户提交一条 GSE 测试单，全自动跑通并在门户看到真实产出图与 HTML 报告，四道闸拦截时门户准确显示 `blocked`。

### 【WP-3.4】生产级真实数据交付演练、防伪签名升级与多节点高可用路由
* **前置依赖**：`WP-3.3` 完成
* **独占 `write_scopes`**：`ops/build_client_report.py`、`BioanalysDesktop/server/report.js`、`BioanalysDesktop/server/task.js`

- [x] **T-3.4.1 [已完成] 交付包升级 Ed25519 私钥防伪签名 `CHECKSUMS.sig`**
  * **执行内容**：在 `ops/build_client_report.py` 生成 `CHECKSUMS.sha256` 后，使用服务端私钥生成 `CHECKSUMS.sig` 数字签名，并提供客户端公钥验签脚本，彻底解决“篡改文件后连同 `CHECKSUMS.sha256` 一起替换”的防伪边界问题。
  * **验收 DoD**：篡改包内任一字节或替换 `CHECKSUMS.sha256` 均被验签脚本拦截。
- [x] **T-3.4.2 [已完成] `server/task.js` 实现多节点 SSH 算力池抽象与高温/离线自动故障转移（Failover）**
  * **执行内容**：在 `server/task.js` 抽象计算节点池配置（主节点 K40 + 备用同构 ARM64 容器/轻量云节点），当五维自检检测到主节点温度 $\ge 95^\circ	ext{C}$ 或 SSH 离线时，自动在 10 秒内将新任务路由至备用节点并记入 `con_hf/ledger/actions.jsonl`。
  * **验收 DoD**：模拟主节点断联时新任务 10 秒内无缝切至备用节点，`tests/node_failover.test.js` 全绿。
- [x] **T-3.4.3 [已完成] 真实非肿瘤客户数据集（Bulk / scRNA / Spatial）端到端商业交付演练**
  * **执行内容**：引入 1 套完整客户真实非肿瘤数据，走通「8080 建项分片上传与选图 → Sync 自动拉取建项 → K40 三线计算与出图 → 回搬 `local_projects/` → 四道闸预检 → `.tar.gz` + `CHECKSUMS.sig` + 单文件 HTML 报告 → 推回 8080 门户签收」全流程。
  * **验收 DoD**：客户交付包 `sha256sum -c` 与签名验证 100% 通过，五本 JSONL 台账与机器台账完整归档。
