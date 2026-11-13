# 产品化实现票

> version 0.1 | 2026-11-10
> 状态：待用户逐票开工
> 规则：每票先写会红的契约测试，再实现。每票收口跑自己的验收命令，最后统一跑总门禁。
> 写范围内的文件按票隔离，公共文件改动写明兼容方案。

## 依赖关系

```text
T0 契约对齐
  -> T1 work_order/v2 schema + 运行时校验
     -> T2 文件引用上传
     -> T3 统一回执 receipt/v1
        -> T4 作业 API + 作业中心视图
           -> T5 门户提交包到工单
              -> T6 便携包封板与全量验收
```

## T0：需求单三真源对齐

- 范围：
  - `shared/requirement_schema.json`
  - `shared/requirement_schema.mjs`
  - `schemas/schema_gateway.py`
  - `tools/dev/work_order_orchestrator.mjs` 中建项 `name` 的读取顺序
- 目标：
  1. 示例工单的 `requirement` 段能过三个校验器。
  2. `dataSource.source`、`groupingDesign.mode`、`group.sampleIds`、`contrast.name`
     在 JSON 声明面、手写校验器与 Pydantic 网关同值。
  3. 建项 `name` 优先读 `basicInfo.name`，保留中文项目名。
  4. 历史档位名只做导入映射，不写回新需求单。
- 红测：一个合法样例在三个校验器各自可放行，字段缺失或枚举不一致各自可拒。
- 验收：`node --test BioanalysDesktop/tests/requirement_schema_contract.test.js`、
  `node --test BioanalysDesktop/tests/schema_gateway.test.js`、
  `node tools/dev/work_order_orchestrator_gate.mjs`。

## T1：`work_order/v2` 契约

- 新文件：
  - `schemas/work_order_v2.schema.json`
  - `shared/work_order_v2.mjs`
  - `tools/examples/work_order_v2.example.json`
- 范围：
  - `tools/dev/work_order_orchestrator.mjs`：接受 v2 输入，内部继续复用现有编译与执行
  - `docs/WORK_ORDER_ORCHESTRATOR.md`：登记双版本兼容规则
- 判据：
  1. v1 与 v2 样例均可跑 mock 契约测试。
  2. v2 校验 `inputs[].sha256`、相对路径、枚举、`compute_adapter` 与 `allow_ssh`。
  3. `requirement.figure_templates[].adapt_vars` 不丢。
  4. 旧 CLI 与契约测试保持绿。
- 红测：非法版本、非法路径、哈希缺失、跨线 Mod、SSH 未显式放行均拒。
- 验收：新增 v2 契约测试、既有 `work_order_orchestrator_contract.test.js`、编排器门禁。

## T2：文件引用与流式上传

- 范围：
  - `tools/dev/work_order_orchestrator.mjs`：`inputs[]` 读取、流式哈希、流式分片
  - `BioanalysDesktop/server/routes/upload.routes.js`：complete 回执补 `sha256`
  - `portal/serve.mjs`、`portal/index.html`：归档清单登记哈希
- 判据：
  1. 10MB 级测试文件不再整包 base64 进 JSON。
  2. 上传回执哈希与工单 `inputs[].sha256` 不一致即停。
  3. `package_manifest.json` 含相对路径、大小、SHA-256。
  4. 上传大小与扩展名继续沿用现有白名单。
- 红测：篡改哈希拒收，路径越界拒收，回执 `sizeMatch=false` 拒收。
- 验收：上传契约测试、门户归档契约测试、编排器 mock 闭环。

## T3：统一回执 `receipt/v1`

- 新文件：
  - `schemas/receipt_v1.schema.json`
  - `BioanalysDesktop/server/receipt_v1.js`
- 范围：
  - `tools/dev/work_order_orchestrator.mjs`：在关键阶段与终态更新权威回执
  - 旧 `work_order.receipt.json` 改为成功投影，文件名不变
- 判据：
  1. 权威文件在 `workspace/projects/<project_id>/report/receipt.v1.json`。
  2. 使用 `BioanalysDesktop/server/atomic_write.js` 原子写。
  3. 成功、失败、阻塞三态均落盘。
  4. 回执含 `receipt_id`、`work_order_digest`、五态、阶段、证据、交付引用与产物清单。
  5. 产物路径全部相对，正文不含设施信息。
  6. 旧文件投影与现有哨兵、文件名、关键字段保持兼容。
- 红测：缺字段、非法状态、绝对路径、非原子写可拒。
- 验收：新增回执契约测试、既有编排器契约测试、编排器门禁。

## T4：作业 API 与作业中心视图

- 新文件：
  - `BioanalysDesktop/server/routes/work_orders.routes.js`
  - `BioanalysDesktop/server/services/work_order.service.js`
  - `BioanalysDesktop/src/views/WorkOrderCenterView.tsx`
- 范围：
  - `BioanalysDesktop/server/index.js`：挂路由
  - `BioanalysDesktop/src/App.tsx`：挂视图
- 判据：
  1. 路由走声明式分发器并声明 `bodyLimit`。
  2. 服务端不直接起子进程，执行仍经 `runWorkOrder` 的 HTTP 编排。
  3. 六个端点行为符合规格第五节。
  4. 作业页显示五态、阶段时间线、错误码、证据摘要、产物清单与下载入口。
  5. `require_admin_review=true` 时必须先确认预览，再触发执行。
  6. 错误响应脱敏。
- 红测：重复执行、终态重跑、非法工单、未审核执行均拒。
- 验收：新增 API 契约测试、路由表测试、视图最小渲染测试。

## T5：门户提交包到工单

- 范围：
  - `BioanalysDesktop/server/services/work_order.service.js`：从 `PKG_` 提交包生成工单草稿
  - `WorkOrderCenterView`：需求包列表、预览、选线、选 Mod、选 Ready 单图、生成工单
- 判据：
  1. 合法提交包能生成通过 v2 校验的草稿。
  2. `source_package` 记录包目录、需求路径、清单路径与 SHA-256。
  3. 非法包 fail closed，只报业务原因。
  4. 工单预览与最终落盘字节一致。
- 红测：包路径越界、缺 manifest、缺数据文件、图件非 Ready 均拒。
- 验收：新增生成器测试、门户收件箱契约测试、端到端 mock 闭环。

## T6：便携包封板与总验收

- 范围：
  - `tools/dev/build_portable_package.mjs`：登记新增 schema、运行时校验器、视图产物与入口
  - 重建 `dist/portable/BioanalysWorkbench`
- 判据：
  1. `dist_parity_gate` 全绿。
  2. `MANIFEST.sha256` 覆盖新增文件。
  3. 便携包内可启动工作台，作业中心可用。
  4. `run_all_gates --skip-tests` 25 道全绿。
  5. 全量测试与既有基线一致。
- 验收命令：

```powershell
node tools/dev/dist_parity_gate.mjs
node tools/dev/run_all_gates.mjs --skip-tests
cd BioanalysDesktop; npm test
```

## 已知风险与对策

1. 门禁静态匹配旧回执文件名：投影文件名保持 `work_order.receipt.json`。
2. 回执版本号历史复用工单版本：权威文件独立用 `receipt/v1`，旧投影沿用现有值。
3. 失败作业不落盘导致无法对账：T3 起权威回执三态落盘。
4. 大文件 base64 内存峰值：T2 改流式，测试用 10MB 级夹具。
5. 门户归档路径与工单读取路径漂移：以 `package_manifest.json` 为唯一归档路径真源。

## T6 收口记录

日期：2026-11-10

### 本轮改动

1. `tools/dev/build_portable_package.mjs` 新增 `PENDING_CORE_ASSETS`：打包真源仍是 `git ls-files`，但未入库的核心资产显式登记，缺文件、命中排除前缀或落到 L1 之外都当场失败。实测修复前 18 个新资产全部漏包。
2. `BioanalysDesktop` 重新执行 `npm run build`。首次重建哈希与上一版一致，说明前端已含作业中心；修复空态锚点后再次构建，产物哈希变为 `index-D_Efm_fl.js`。
3. 重建 `dist/portable/BioanalysWorkbench`：1921 个文件，约 251 MB，含 18 个显式登记的新资产。

### 四道验收

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| `dist_parity_gate` | 通过 | 5 个关键资产分叉 0、缺失 0，重建后三处旧分叉消失 |
| `MANIFEST.sha256` 覆盖 | 通过 | 抽查 10 项全部命中，含两份新 schema、运行时校验器、作业服务、路由与视图 |
| 包内加载与门禁 | 通过 | 包内 Node 加载四个新模块无错；设置包内 `.tmp` 后编排器门禁输出 `WORK_ORDER_ORCHESTRATOR_GATE_OK` |
| `run_all_gates --skip-tests` | 22 通过、3 红 | 通过项含 `dist_parity` 与 `work_order_orchestrator`；3 红均非本轮引入，见下 |
| `npm test` 全量 | 2017 用例，1998 通过、17 失败、2 跳过 | 本轮 3 条已修复，剩余 17 条为既有基线，见下 |

`--skip-tests` 三红：

1. `module_ablation_matrix`：`figure_ready_allowlist.json` 被改为 27，契约测试仍断言 39。
2. `ledger`：`ledger/actions.jsonl` 追加 217 行后未重跑 `ledger_gen --write`。
3. `k40_parity`：设备本轮在线，`bulk_figures`、`pca_matrix`、`spatial_figures` 三个工作区脚本未同步到设备。

本轮曾失败的 3 条已修复并复验：

1. `portal_sync.test.js`：两组夹具补 `sampleIds`，提交回到 200 且 `sync_status=pending`。
2. `work_order_v2_inputs.test.js`：删除符号链接逃逸用例的跳过分支，测试真跑；本机 junction 可创建，逃逸仍按 `ERR_INPUT_FILE` 拒收。
3. `WorkOrderCenterView.tsx`：`package-empty-state` 改为 `empty-state`，用 `data-empty-kind="no-packages"` 与工单列表空态区分。

三条修复由 78 条目标测试复验，全部通过、0 跳过。剩余 17 条为既有基线：图件 Ready 基线 39 对 27 共 9 条、`node_failover` 三条与 ADB 通道迁移后的 ssh 断言不符、`run_all_gates` 三条因上述红项连带、`task_fsm_receipt_wiring` 两条与工作区 `run.js` 改写的台账通道不符。另有 `run.test.js` 与 `report_preflight.test.js` 未计入本次全量：前者在默认 ADB 下真实 ssh 垫片不生效会挂起，后者在默认 ADB 下 5 条失败，显式 `BIO_COMPUTE_ADAPTER=ssh` 时 22 条全绿。

### 遗留风险

1. 打包真源仍是 Git 索引，未入库资产靠 `PENDING_CORE_ASSETS` 手工登记。新票完成时须同步登记，否则默认路径会漏包；漏登记无法被任何门禁发现。
2. 三红与剩余 17 条失败均为他人未提交改动造成，本轮无写权限，未修。合并这些改动前，封板结论只覆盖便携包与工单链路。
3. 包内 `.tmp` 在首次运行前不存在，直接跑 `work_order_orchestrator_gate` 会因 `mkdtemp` 收到 `EPERM`。`gate.cmd` 会先建 `.tmp`，手工直调需先建目录。
4. 便携包当时落在 `dist/portable`，是构建产物，不是可复现的冻结件。改动主仓后必须重建，否则 `dist_parity` 会报红。（2026-11-11 落点已迁至 `software/`，见下方落点迁移记录）
5. 便携包尚未提供 `start-portal.cmd`，客户门户仍需系统 Node。桌面壳按规格留在第二阶段。

## T7/T8 收口记录

日期：2026-11-10

### 队列机制

1. 一个工单对应一个需求。创建后状态为 `queued`，管理员确认后写入 `approved=true` 与 `approved_at`，接口返回 202。
2. 队列真源是磁盘 meta，按 `created_at` 升序构成 FIFO，只收 `approved=true` 且 `status=queued` 的作业。
3. 单进程单并发泵顺序执行，前一个完成后自动取下一个。单个作业失败或工单损坏时泵继续执行后续作业。
4. 服务重启时把无 inflight 的 `running` 作业标为 `failed`，写 `recovery_reason=server_restart`，随后继续排空队列。
5. 作业中心显示等待中、执行中、最近完成三个区，队列存在时每 3 秒轮询，直到终态。
6. 队列只调度已审核作业，门户提交不会自动执行。

### 遗留清理

1. 19 个新增资产已 `git add`，`build_portable_package.mjs` 的 `PENDING_CORE_ASSETS` 手工清单已移除，打包真源回到 `git ls-files`。
2. 图件基线测试与 `SCOPE.md`、`docs/ARCHITECTURE_OVERVIEW.md` 统一读 allowlist 的 27 条基线，`run_all_gates` 标签去掉硬编码数字。
3. `ledger_gen.mjs --write` 重建台账，`--check` 返回一致。
4. `task_fsm_receipt_wiring`、`node_failover`、S26 台账、`report_preflight`、`preview_mods` 改为 ADB 默认语义或显式 SSH 特殊开关，生产逻辑未放宽。
5. 算力节点 三个分叉脚本经 ADB 推送并 chmod 755，57 个脚本双向逐字节同源。
6. 便携包重建 1922 个文件，`MANIFEST.sha256` 校验通过，`dist_parity` 5 个关键资产分叉 0、缺失 0。
7. `run_all_gates --skip-tests` 25 道全绿。
8. 全量测试 2062 用例，2060 通过，0 失败，2 跳过。

### 保持边界

1. 队列泵是进程内单并发，没有跨进程文件锁。正式部署保持单工作区单服务实例。
2. `run` 从同步完成改为 202 入队，调用方按作业状态轮询。
3. 发布包仍是构建产物，主仓改动后需要重建并由 `dist_parity` 复核。

## 落点迁移记录

日期：2026-11-11

1. 发布包唯一落点由 `dist/portable/BioanalysWorkbench` 迁至 `software/BioanalysWorkbench`。
2. 落点真源是 `tools/dev/build_portable_package.mjs` 的 `DEFAULT_OUT`；
   `tools/dev/dist_parity_gate.mjs` 改为 import 该常量，两边不可能各指一处。
3. 迁移后删除旧包目录，仓库内不留第二份会各自漂移的快照（REJ-007 同一条理由）。
4. `.gitignore` 增 `/software/`，`/dist/` 条目保留以覆盖历史工作树。
5. 包形态是解压即用，不需要安装程序。入口 `software\BioanalysWorkbench\start-workbench.cmd`。

## T9 收口记录

日期：2026-11-11

### 裁定

Pi Agent 收口为只读监控，保留观测面，关闭让算力节点侧 agent 独自干活的派单能力。
理由：派单产出的结论仍需 Codex 侧逐条复核，复核成本高于边做边审。

### 关闭端点

1. `POST /api/pi-agent/dispatch` 默认拒绝，返回 403 与 `ERR_PI_DISPATCH_DISABLED`。
2. 闸门排在读请求体之前，关闭态不接收正文、不触达 adb 或 ssh、不写台账。
3. 显式开关 `BIO_ALLOW_PI_DISPATCH=1`，只认严格等于 `1`，不设 CI 或测试环境豁免。
4. 前端移除派单面板、派单状态、任务轮询与 `task/cancel` 调用，并删除 `PiAgentChat` 对话入口。

### 保留面

1. overview、calls、daemon logs、模型白名单与切换、遥测侧车。
2. `/api/pi-agent/model` 切换仍写 `ledger/actions.jsonl`，属受控配置动作。
3. `Pi Agent 监控` 视图保留 loading-state、error-state、empty-state 三态锚点。

### 删除文件

1. `BioanalysDesktop/src/PiAgentChat.tsx`
2. `BioanalysDesktop/src/pi_chat_state.js`
3. `BioanalysDesktop/tests/pi_chat_state.test.js`

### 验收结果

1. `node --test BioanalysDesktop/tests/pi_agent_routes.test.js`：23 通过，0 失败。
2. `node --test BioanalysDesktop/tests/pi_agent.test.js`：通过。
3. `node --test BioanalysDesktop/tests/pi_agent_telemetry.test.js`：通过。
4. `node --test BioanalysDesktop/tests/a2a_query_contract.test.js`：通过。
5. `node --test BioanalysDesktop/tests/t3_ui_three_state_all_views_contract.test.js BioanalysDesktop/tests/t35_empty_state_contract.test.js`：通过。
6. `node tools/dev/run_all_gates.mjs --skip-tests`：全绿。

## T10 收口记录

日期：2026-11-11

### 背景

T9 删除 Pi 对话入口后，e2e 用例与样式表里各留一处无宿主的死引用。

### 改动

1. `BioanalysDesktop/tests/e2e/portal.spec.ts`：删除两条 Pi 对话 e2e 用例及其专属桩与变量，文件由 738 行变为 630 行。
2. `BioanalysDesktop/src/app.css`：删除全部 `.pi-chat-*` 规则与媒体查询内对应引用，文件由 1573 行变为 1434 行。
3. 未触发 `:root` token 清理，被删规则引用的颜色变量在别处仍有宿主。

### 验收结果

1. `rg 'pi-chat|PiAgentChat|pi_chat'` 在 src 与 tests 下为空。
2. CSS 三份契约与视图三态契约全绿。
3. `pi_agent_routes.test.js`、`pi_agent.test.js`、`pi_agent_telemetry.test.js`：45 通过，0 失败。
4. `tsc --noEmit` 退出 0，`run_all_gates --skip-tests` 25 道全绿。

## T11 退场记录

日期：2026-11-11

### 裁定

Pi Agent 整体退场。算力节点侧自主执行体与 ADB 主通道并存会形成第二套命令入口，
用户裁定全部删除，不留开关，不留只读残骸。

### 删除范围

1. 服务端：`pi_agent.js`、`pi_agent_routes.js`、`a2a_state.js`。
2. 前端：`views/PiAgentView.tsx`，以及 `App.tsx` 的视图键、导航项与渲染分支。
3. 测试：`pi_agent.test.js`、`pi_agent_routes.test.js`、`pi_agent_telemetry.test.js`、
   `a2a_query_contract.test.js`、`e2e/pi_agent_poll.spec.ts`。
4. 运维：`tools/dev/diagnostics/probe_pi.mjs`、`tools/ops/pi_seed_settings.sh`、
   `tools/ops/k40/pi_a2a_daemon.sh`、`pi_a2a_launch.sh`、`pi_telemetry_sidecar.py`、
   `tools/ops/k40/sv/pi-a2a/` 整个目录。
5. 运行时接缝：`proc.js` 的 `adb基础用户空间`、`domain.js` 的 9910 与 9911 隧道与
   `REVERSE_PAIRS`、`link.js` 的 `checkReverseForwards`、心跳的 `pi-a2a` 服务位。
6. 设备侧脚本：`ensure_runsvdir.sh` 服务清单与 `heartbeat.sh` 的 9910 探针与
   两个 wire 字段。

### 设备侧收口（已执行）

设备侧文件统一归置到 `$HOME/pi_retired_20261111/`，保留可回滚证据。

1. `sv down pi-a2a` 后把 `$PREFIX/var/service/pi-a2a/` 整体移入归置目录，
   `sv status pi-a2a` 转为「service directory does not exist」。
2. `tmux kill-session -t pi-a2a` 结束会话与遥测侧车窗口。
3. `$HOME/bin/` 下 8 个 pi 与 a2a 脚本连同 `$HOME/.pi/` 一并移入归置目录。
4. 同步 `k40_heartbeat.sh` 与 `ensure_runsvdir.sh` 两份设备脚本，
   逐字节 SHA256 与仓库一致（`a1d7232b` 与 `1325b42a`），权限 755。
5. 设备侧心跳实测输出只剩四个服务位，`9910` 与 `9911` 无监听。
6. `runsv pi-a2a`（pid 12324）留在 基础用户空间 的 PID namespace 里，`run-as com.termux kill`
   报 Permission denied，属该层级的已知权限形态。它的 `run` 与 `log/run` 已改名禁用，
   监督目录也已移走，因此无法再 exec 任何 pi 组件，重启后由新服务表自然消失。

### 验收结果

1. 仓库级终检 `rg` 在 `BioanalysDesktop/{server,src,tests,tools}`、`tools/{dev,ops}` 为空。
2. 新增 `pi_retirement_contract.test.js` 6 条，锁住删除清单、隧道表、心跳服务表与入口。
3. `link`、`heartbeat`、`runit_sv_contract`、`http_body_limit` 合并 58 通过。
4. 视图三态、内部术语三份 34 通过；计算适配三份 19 通过；工单与队列两份 15 通过。
5. `tsc --noEmit` 退出 0，`vite build` 通过。
6. `static_gate` 通过（宿主无 Rscript，按 `--allow-missing` 显式降级并留档）。
7. `dist_parity_gate` 5 个关键资产分叉 0、缺失 0。
8. `ledger_gen --check` 与真源一致。

## 门禁外层上限修正

日期：2026-11-11

`run_all_gates` 的 `runGate` 对每道门禁统一用 300 秒上限，而 `metrics` 那道内部
跑全量 `node --test` 的自限是 600 秒。慢机上外层先动手，TAP 会被截成半截，
`metrics` 报出的 `not ok` 与 SKIP 违规属假红，掩盖真实用例状态。

1. 门禁清单支持按道声明 `timeoutMs`，`metrics` 显式设 900 秒，宽于内部自限。
2. `run_all_gates.test.js` 增加断言：`metrics.timeoutMs` 必须大于 600000。
3. 缺省仍是 300 秒，快检总耗时不受影响。
