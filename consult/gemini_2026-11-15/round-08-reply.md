# 第八轮回复（Gemini Argon，2026-11-15）

## 四项最终裁定

1. **工具暴露**：方案 C 锁死。宿主受控 JSON Tool-Loop，单阶段上限 6 轮。Pi 以 `--mode rpc --no-session --no-builtin-tools` 无状态拉起，零 MCP、零扩展。所有工具调用由宿主校验阶段白名单与 JSON Schema 后，在宿主内存直接调 `piToolsBridge` 闭环。
2. **Stage 2 自愈**：3.5GB `run_validation` 通过后，`adaptation_epoch < 2` 时允许免人工弹窗直接 `dispatch_step`（6.5GB），直至耗尽 2 次预算转 blocked 或跑通全链路停在检查点二。
3. **擦除**：报告签发且本地 tar 与 `CHECKSUMS.sig` 验签为 true 后立即擦除，0 TTL，只留 `WIPE_TOMBSTONE.json`，失败入 `pending_remote_wipes`。
4. **模型降级**：默认严格 fail-closed。SenseNova 超时、5xx 或连续 2 次非法 JSON 即阻断新工单或置 blocked（`PI_ENDPOINT_UNAVAILABLE`）并告警；`BIO_PI_MODE=DETERMINISTIC_FALLBACK` 只作管理员显式开关。

## 两条微调护栏

1. **护栏 A**：自动自愈免除人工弹窗后，`PiProposalsModal` 必须改为运行期只读审计视图，仅在 blocked 或 HUMAN_OVERRIDE 态激活批准/驳回按钮，防止自动 `dispatch_step` 时人工驳回引发状态机撕裂。任何自动 `remediate_step_param` 或 `propose_adaptation` 执行后，同事务把 `delivery_grade` 锁为 `EXPLORATORY_DEGRADED`，不可逆。
2. **护栏 B**：擦除脚本必须同时覆盖逻辑角色目录（`raw_data/processed/figures/results`）与工单沙箱目录（`00_input/01_work/02_output/adaptations`），以及 `/tmp/bio_val_{work_order_id}` 与 `/tmp/bio_adapt/{work_order_id}`；项目目录下除墓碑外全部清空。

## P0/P1/P2 实施顺序

### P0 控制面

- P0.1 阶段 Prompt 与静态清单：`server/prompts/pi_stages/v1/`，含三阶段 Prompt 与 `prompts_manifest.json`。
- P0.2 改造 `pi_runner._dispatchRpcStage` 与 `pi_tools_bridge`：阶段白名单、Max-6-Turns、累积历史、`finish_stage` 熔断。
- P0.3 单会话合龙：检查点一审批通过后置 `dispatch_ready`、签发初始 `pi_agent` 租约、唤醒队列单消费者；DAG 单步失败且预算未耗尽时挂起并回调 Stage 2；全绿后自动进入 `AWAITING_TARGET_APPROVAL`。

### P1 物理算力面

- P1.1 `tools/ops/wipe_project_sandbox.sh`，纳入 preflight 哈希同源。
- P1.2 挂载 `completeStage3PullAndWipe` 到 sign-report 验签成功后置钩子，失败入重试表。
- P1.3 新增 `M-Pi-13`（Stage 1 越权 `dispatch_step` 拦截）与 `M-Pi-14`（未验签提前擦除拦截），并入 G28。
- P1.4 真机端到端：真 Pi + 真自愈 + 真擦除一单。

### P2 产品化

- P2.1 锁定 `@earendil-works/pi-coding-agent@1.5.2`，落地 `tools/bin/pi-wrapper.js`。
- P2.2 接入 `BIO_PI_API_KEY` 环境变量与 Electron `safeStorage`，日志脱敏。
- P2.3 合入 `TICKET-D0-01` 与 `TICKET-OPS-01`。

## 每阶段验收

- P0：无人工点提交，Pi 在 Stage 1 调通两工具，180 秒后自动拉起 K40 跑完 4 模块，停在检查点二。
- P1：注入单步失败，Pi 自动读指标、提适配、3.5GB 验证、6.5GB 下发，`adaptation_trace` 与 `EXPLORATORY_DEGRADED` 入回执；签发后四目录归零并有墓碑。
- P2：拔掉全局 pi 与 node 后便携包仍能拉起 Pi RPC；断网 fail-closed；强杀 Electron 后 2 秒内后端退出且 SQLite 无残留锁。

## 最容易翻车的两个点

1. 模型 JSON 损坏或夹带 Markdown 代码块：宿主必须做容错剥离与 Schema 校验，连续失败走显式降级，不能静默。
2. 擦除脚本路径与目录契约不一致：必须同时覆盖两套命名与 `/tmp` 残留，且失败入重试队列，不能影响本地交付。
