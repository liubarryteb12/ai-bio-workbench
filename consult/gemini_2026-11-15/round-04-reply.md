结论

四个依赖的唯一接线顺序：assertLease → autonomyGrantsProvider → runValidationFn → dispatchStepFn。遵循“先锁租约与授权边界，再开 3.5GB 沙盒验证，最后放开 6.5GB 生产单步下发”的安全解封律。严禁跳过前两者直接暴露 dispatchStepFn。

dispatch_step 与队列单消费者防冲突机制：dispatchStepFn 严禁走 POST /api/tasks/submit HTTP 路由入队，必须直接调用 run.js 的底层 runTask 核心函数。队列单消费者只拉取 work_orders.status == 'queued' 的整单任务；而 dispatch_step 触发时，工单早已处于 running 态且 DAG 主循环正处于单步挂起等待（Awaiting Remediation）窗口。通过在工单 meta 中引入 step_lock（互斥锁）、adaptation_epoch（适配代数）和 attempt（单步尝试序号），即可在内存中实现零冲突单步重入。

容器退出码分层收敛铁律：

Exit 5（run_throttled_task.sh 前置温度过高或宿主机瞬时内存余量不足）：属于算力环境瞬态繁忙，不消耗 AI 的 2 次适配预算，在编排器层执行 3 次退避重试（30s / 60s / 120s）；3 次仍 Exit 5 则转 blocked (ENV_THROTTLED)。

Exit 137 / MEM_LIMIT_EXCEEDED（运行期击穿 6.5GB/7.5GB）：属于算法负载超限，若 adaptation_epoch < 2，保持 running 态交由 AI 调参/适配重跑（消耗 1 次预算）；若 adaptation_epoch == 2 仍爆内存，立即转 blocked (OOM_EXHAUSTED)。

未输出 WROTE '<path>' <bytes> 契约行或 bytes == 0：即使退出码为 0，也一律视为静默失败（Silent Failure），按单步异常拦截。

防线扩容：切换真接线后，必须在现有 25 条变异基础上新增 3 条行为级变异反证（M-Pi-10 租约抢占逃逸、M-Pi-11 跨代数过期验证重放、M-Pi-12 静默空文件伪造成功），并将原 27 道门禁正式封顶为 第 28 道门禁（G28_PRODUCTION_WIRING_AND_ADAPTATION_SEAL）。

接线契约

1. 四个依赖的接线顺序、目标模块与函数签名

在 server/index.js 实例化 piToolsBridge 时，按以下严格顺序注入真实实现（替换 fail-closed 桩）：

接线顺位依赖注入项对接目标模块与底层函数入参契约返回值 / 异常契约第 1 步assertLease对接 SQLite 租约守卫模块（同 3 个受控写端点共用的 leaseGuard.verifyActiveLease）({ work_order_id, lease_id, expected_holder = 'pi_agent' })校验 leases 表中 work_order_id 对应 lease_id 一致、holder_id == expected_holder 且 expires_at > now_ms。成功返回 { lease_epoch, expires_at }；若人工已接管或超时，直接抛出 Error('403_LEASE_PREEMPTED')第 2 步autonomyGrantsProvider对接项目授权与会话状态查询器（读取 pi_sessions + work_order/v2 + 项目级策略表）({ project_id, work_order_id })返回 { tier_allowed: 2, checkpoint_mode: 'GRACE_180S' | 'ZERO_WAIT' | 'GOLDEN_BATCH' | 'HUMAN_HARD_GATE', revoked: boolean, adaptation_budget_remaining: 2 - meta.adaptation_epoch }。若 revoked == true，工具桥直接拒绝 tier2 调用第 3 步runValidationFn对接 run.js 的受限沙盒入口 runTask（强制绑定 core/mem_guard.py --mode=validation 即 3.5GB 档位）({ project_id, work_order_id, mod_id, entry_point, content_sha256, lease_id })内部先调 assertLease；再将 runs/{project_id}/adaptations/{mod_id}/{entry_point} 经 ADB 推送至容器 /tmp/bio_val_{work_order_id}/，以 MEM_LIMIT_GB=3.5 执行 dry-run / 最小子集验证。返回 { validation_run_id, passed: boolean, exit_code, wrote_files: [], content_sha256, stderr_tail }第 4 步dispatchStepFn对接 run.js 的生产执行核心 runTask（绑定 run_throttled_task.sh 6.5GB 档位 + 落盘 task_receipts）({ work_order_id, project_id, line_id, mod_id, entry_point, lease_id, validation_run_id })内部先调 assertLease → 核验 validation_run_id 对应的 (mod_id, content_sha256) 为 passed: true → 获取 meta.step_lock → 调用 runTask 经 ADB 执行并解析 WROTE '<path>' <bytes> → 写入 task_receipts 与 ledgerAppend → 释放 step_lock 

2. 工单 meta 新增并发与溯源字段契约

为确保 dispatch_step 单步重入与 DAG 主循环、队列消费者绝对互斥，在 work_orders 表的 meta JSON（或独立扩展列）中强制维护以下 4 个字段：

{ "step_lock": { "locked": true, "mod_id": "sc_qc_filter", "holder_lease_id": "lease_998123", "acquired_at_ms": 1794722100000 }, "adaptation_epoch": 1, "step_attempts": { "sc_qc_filter": 2 }, "env_throttle_retries": 0 } 

step_lock（单步互斥锁）：同一 work_order_id 下，无论是 DAG 正常推进还是 dispatch_step 补丁重跑，进入 runTask 前必须原子检查 step_lock.locked == false 并置为 true。防止 AI 并发发出两个 dispatch_step 导致容器内双进程对撞。

adaptation_epoch（全局适配代数，上限 2）：每次调用 propose_adaptation 或 remediate_step_param 后尝试 dispatch_step，adaptation_epoch 自增 1。同时，所有 run_validation 产出的验证凭据必须绑定当时的 adaptation_epoch，防止跨代重放旧验证结果。

step_attempts[mod_id]（单模块累计执行次数，上限 3）：记录该模块（1 次初始运行 + 最多 2 次适配重跑）的执行序号，用于生成唯一 task_receipt_id = "{work_order_id}_{mod_id}_att{attempt}"，避免覆盖首次失败的 task_receipts 证据。

env_throttle_retries（环境限流重试计数，上限 3）：专用于吸收 run_throttled_task.sh 返回 Exit 5（温度/余量预检未过）的硬件冷却等待，与算法级 adaptation_epoch 物理隔离。

状态迁移

容器包装器 (run_throttled_task.sh) 与 mem_guard 返回码收敛矩阵

底层执行现象退出码 / 探针特征故障定性是否扣减 adaptation_epoch 预算编排器与状态机动作 (running 内部消化 vs 终态收敛)正常完结且产出合规Exit 0 且 stdout 匹配 WROTE '<path>' <bytes> (bytes > 0)成功 (STEP_OK)否追加 task_receipts，释放 step_lock，若来自 dispatch_step 则置 delivery_grade='EXPLORATORY_DEGRADED'，继续推进 DAG 下一节点假成功（静默空跑）Exit 0，但缺失 WROTE 行，或声明 <bytes> == 0，或容器内实测文件不存在契约违约 (SILENT_EMPTY_OUTPUT)是（若在自愈流中）视为单步执行失败；若 adaptation_epoch < 2 允许 AI 检查并修复脚本；若已满 2 次则 running → blocked (CONTRACT_WROTE_MISSING)，同事务释放 Lease包装器前置拒载（高温/低余量）Exit 5（run_throttled_task.sh 检测到电池/CPU 温度超阈值，或当前空闲内存 < 6.5GB 拒绝拉起进程）硬件环境瞬态保护 (ENV_THROTTLED)否（代码本身没错，绝不让 AI 瞎改参数）保持 running 态与当前 Lease；若 env_throttle_retries < 3，编排器本地休眠冷却（30s → 60s → 120s）后原样重发该步；若连续 3 次（共 210s）仍 Exit 5，转 running → blocked (DEVICE_OVERHEAT_OR_BUSY) 并释放 Lease沙盒验证期超 3.5GBrun_validation 期间触发 core/mem_guard.py (3.5GB) 或 Exit 137候选补丁内存膨胀 (VAL_OOM)否（尚未进入 dispatch_step）runValidationFn 返回 { passed: false, reason: 'VAL_MEM_3.5G_EXCEEDED' }；禁止调用 dispatch_step，要求 AI 重新提交更轻量的适配方案生产单步超 6.5GB / 7.5GBdispatch_step 或常规步骤触发 Exit 137 (SIGKILL) 或 mem_guard 7.5GB 熔断生产负载 OOM (STEP_OOM)是先发 adb shell kill -9 -PGID 净空容器残留；若 adaptation_epoch < 2，保持 running 态向 AI 返回 OOM_6.5G_LIMIT，允许降采样/降 worker 重试；若 adaptation_epoch == 2，立即 running → blocked (OOM_EXHAUSTED) 并同事务释放 Lease母版或参数不可自愈硬错误非 0/5/137 退出码，且命中不可调参错误（如输入矩阵损坏、R 包缺失）致命错误 (FATAL_EXEC_ERROR)否立即 running → failed (failure_stage=mod_id)，写入 receipt/v1 错误摘要，同事务释放 Lease 

变异清单

为确保 D4.9 四个依赖真接线后不出现防守漏洞，在现有 25 条变异（8 infra + 17 behavior）基础上，强制新增以下 3 条行为级变异反证（M-Pi-10 至 M-Pi-12），目标全部 KILLED (escaped=0)：

变异编号变异名称注入靶点（把代码改坏的方式）期望防线响应（如何杀死变异）M-Pi-10租约抢占后工具桥逃逸 (LeasePreemptionBypass)注释掉 dispatchStepFn 或 runValidationFn 入口处的 await assertLease(...) 调用，模拟人工已在 UI 强制接管（leases.holder='human'）但 AI 仍在后台惯性下发单步任务测试套件模拟人工抢占 Lease 后触发 dispatch_step：必须捕获 403_LEASE_PREEMPTED 且 runTask 调用次数为 0；若 runTask 被调用则变异逃逸（テスト变红）M-Pi-11跨代过期验证凭据重放 (StaleValidationReplay)在 dispatchStepFn 中只检查 validation_passed == true，注释掉对 validation.content_sha256 == current_adaptation.content_sha256 的比对（即：验证了 A 脚本，却偷梁换柱下发未验证的 B 脚本）测试套件先跑通 A 脚本的 run_validation，随后调 propose_adaptation 覆盖为 B 脚本并直接调 dispatch_step：必须被 412_PRECONDITION_FAILED (HASH_MISMATCH) 拦截M-Pi-12伪造 Exit 0 绕过 WROTE 契约 (SilentEmptyWroteBypass)篡改 run.js 对 run_throttled_task.sh 标准输出的解析器，使其在子进程返回 Exit 0 但未输出 WROTE '<path>' <bytes>（或 <bytes> == 0）时依然生成 status: 'completed' 的 task_receipt测试套件注入一个只 exit 0 不写文件的假脚本：必须触发 SILENT_EMPTY_OUTPUT 异常并阻断 task_receipts 落盘 

第 28 道门禁（G28_PRODUCTION_WIRING_AND_ADAPTATION_SEAL）新增判据

在上一轮定义的 delivery_grade 与 adaptation_trace 判据基础上，补齐针对 D4.9 真接线与容器执行链 的 3 条硬核查：

无桩化静态与运行时断路检查（No-Stub Ratchet）：扫描 server/index.js 及生产启动配置，piToolsBridge 的 4 个依赖（runValidationFn, dispatchStepFn, assertLease, autonomyGrantsProvider）必须全部为绑定实体的 Function 引用，严禁残留默认的 fail-closed 匿名空桩。

task_receipts 与 WROTE 账实相符率 100%：遍历 receipt/v1.task_receipts，每一个成功步骤必须包含非空的 wrote_artifacts 数组（记录路径、字节数、SHA-256），且必须与 adaptation_trace 中最终生效的 validation_run_id 哈希链闭环。

内存双水位配置同源校验：静态扫描 tools/ops/run_throttled_task.sh（必须为 6.5）、core/mem_guard.py（容器 7.5 / 验证 3.5）与 piToolsBridge 默认回报值（6.5），三处数值若出现任何漂移，G28 直接红灯阻断。

风险

runValidationFn (3.5GB) 与生产任务 (6.5GB) 在容器内并发叠加爆 7.5GB 的风险（高危）： 如果某个工单内部（或异常重入时）生产任务还没完全退出，AI 就调起了 run_validation（3.5GB），6.5GB + 3.5GB = 10.0GB 会瞬间击穿容器 7.5GB 顶棚。裁定：runValidationFn 也必须受工单 meta.step_lock 保护！即同一个时刻，K40 容器内无论是跑 6.5GB 的 dispatch_step 还是跑 3.5GB 的 run_validation，全局只能有 1 个活跃进程组，严禁边跑边验。

run_throttled_task.sh 返回 Exit 5 时的租约（TTL 120s）过期风险： 当手机端温度过高触发 Exit 5，编排器进入 30s → 60s → 120s 冷却等待时，如果等待期间停止了租约心跳，120 秒后 Watchdog 会误以为编排器崩溃而强行回收租约。裁定：在 Exit 5 冷却 sleep 期间，本地编排器的 30 秒定时租约续期（Heartbeat）必须照常运行，并在 pi_sessions 状态栏更新子状态为 COOLING_DOWN_WAIT，让 D0 桌面端管理员清晰看到“设备降温等待中”，而非卡死。

下一轮材料

至此，D4.9 生产接线、D2 同步接收器、D0 桌面控制台、D1 门户加固 四大模块的架构设计、接口契约、状态机与变异防线已全部完成闭环。

当你将 D4.9 四个依赖实装并补齐 M-Pi-10/11/12 与 D0/D1 改造后，下一轮我们将进行 全系统最终验收与封板签发（Final Go-Live Sign-Off）。届时请提供：

D4.9 实装与门禁成绩单：28 道门禁（G1–G28）、28 条变异反证（25 + 3）及全量测试套件的最新运行输出摘要。

D0 与 D1 落地进度：180s 倒计时拦截、检查点二签发 UI 以及 D1/D2 解包硬化的实装核对表。

任何在实装接线过程中浮现的边界冲突或需要临场裁定的工程取舍。


