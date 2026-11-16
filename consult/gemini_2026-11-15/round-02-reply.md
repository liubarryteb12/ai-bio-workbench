结论
dispatch_step 严禁新增独立 HTTP 写端点，必须作为编排器（Orchestrator）内部受控子例程回调。工单队列消费权与单步重试权必须统一收口在同一个 work_order_id 的 running 态下，通过 X-Bio-Lease-Id + lease_epoch 在编排器入口层做唯一校验，队列消费者只消费 queued 态，天然与处于 running 态的 dispatch_step 物理隔离，绝不打架。
异常收敛与防误杀采用“退出码分层映射 + 传输期心跳旁路（Transfer Lease Extension）”：OOM（Exit 137 / VmRSS 超限）若还有重试预算则留存 running 态内消化，预算耗尽转 blocked；ADB 闪断经 3 次重连失败转 blocked；租约只能在工单落入终态（completed/failed/blocked）的同一个 SQLite 事务中释放。大文件回传时，根据 ADB I/O 字节增量自动顺延租约，彻底消灭“最后 1% 误判失联”。
180 秒竞态通过 pi_sessions 表的 state_version 乐观锁（CAS）裁决：人工拦截与定时器自动放行平权竞争同一个 UPDATE ... WHERE state_version = ?，败者静默丢弃或报错退出。
delivery_grade 与 adaptation_trace 必须提升为 receipt/v1 顶层字段，且必须纳入 Canonical JSON 的 Ed25519 签名范围。同时，propose_adaptation 的沙盒脚本严禁在项目层复制母版（防触犯 REJ-002），必须经临时 Overlay 同步至算力面（防触犯 REJ-003），且必须先过 run_validation 拿到 validation_digest 才能调用 dispatch_step。
D2 接收器采用“双模态轮询（空闲 15s / 活跃 3s）+ 本地持久态 SYNC_FINALIZING 回写重试队列”：以 (package_id, sha256) 为全局幂等键，彻底解耦“本地算完”与“远端回写成功”。
接口契约
1. dispatch_step 内部执行契约與 REJ 防护锁
调用归属：Pi Agent → 编排器内部 RPC (internal_step_dispatcher) → 算力适配器 (compute_adapter)。不暴露外部 REST 写端点，复用现有 3 个受控写端点的底层 Lease Guard。
前置强校验（Hardware & REJ Guards）：
租约校验：校验传入的 lease_id 与 SQLite leases 表中当前活跃的 lease_id、holder_id='pi_agent'、且 expires_at 晚于当前时间完全一致（若人工已接管，表内 holder_id='human'，直接抛出 403 LEASE_PREEMPTED）。
REJ-002 / REJ-003 铁律：propose_adaptation 产出的 filename 只允许存放在 data/workspace/runs/{project_id}/adaptations/{mod_id}/ 沙盒增量目录，严禁拷贝 54 个模块的母版代码；下发前必须通过 ADB 同步至容器 /tmp/bio_adapt/{work_order_id}/{mod_id}/。
先验后发锁：dispatch_step 必须校验 SQLite 中同一 (project_id, mod_id, content_sha256) 存在状态为 PASSED 的 run_validation 记录，否则直接拒绝执行（412 PRECONDITION_FAILED）。
2. receipt/v1 新增字段与双层签名契约
在 receipt/v1 顶层补齐 delivery_grade、adaptation_trace（置于 acceptance 与 delivery 之间），并在 sentinel 下新增整单级签名：

```json
{
  "schema_version": "receipt/v1",
  "receipt_id": "a1b2c3d4e5f60123456789ab",
  "work_order_digest": "sha256:...",
  "delivery_grade": "STANDARD | EXPLORATORY_DEGRADED",
  "adaptation_trace": [
    {
      "seq": 1,
      "mod_id": "sc_qc_filter",
      "action_type": "PARAM_REMEDIATION | SANDBOX_ADAPTATION",
      "target": "min_genes | patch_qc.R",
      "before_digest": "sha256:...",
      "after_digest": "sha256:...",
      "validation_run_id": "val_987654",
      "validation_passed": true,
      "purpose": "relax mitochondrial threshold for degraded tissue",
      "reason": "raw median mt_pct > 22%",
      "timestamp": "2026-11-15T05:30:00Z"
    }
  ],
  "sentinel": {
    "archive_ed25519_sig": "base64:...",
    "receipt_canonical_sha256": "sha256:...",
    "receipt_ed25519_sig": "base64:..."
  }
}
```

签名范围升级：
archive_ed25519_sig：保持原有对交付物 .tar（或 CHECKSUMS.sha256）的签名。
receipt_ed25519_sig：对除去 sentinel.receipt_canonical_sha256 和 sentinel.receipt_ed25519_sig 之外的整份 receipt/v1.json 进行 RFC 8785 (JCS) 规范化序列化后计算 SHA-256 并执行 Ed25519 签名。
3. 第 28 道门禁（GATE_28_ADAPTATION_AND_GRADE_INTEGRITY）一票否决判据
任一条件命中即刻判定 GATE_28_FAIL：
delivery_grade 缺失，或不在 ["STANDARD", "EXPLORATORY_DEGRADED"] 枚举内。
adaptation_trace 数组长度大于 2（超出单工单重试预算）。
adaptation_trace 非空，或 remediate_step_param 被调用过，但 delivery_grade 仍为 STANDARD（只要发生过运行时参数退化或沙盒脚本适配，必须强制降级为 EXPLORATORY_DEGRADED，除非在 PLAN_APPROVED 前的静态编译期完成）。
adaptation_trace 中任意一项的 validation_passed != true，或 validation_run_id 在运行库中查无实据。
sentinel.receipt_ed25519_sig 验签失败，或 work_order_digest 与输入 work_order/v2 原文哈希不匹配。
扫描 adaptation_trace 关联脚本发现触犯 REJ-004（硬编码解释器路径）、REJ-005（DPI 低于 300）、REJ-006（引入重型解卷积包）或 REJ-011（200um 硬截断）。
4. D2 接收器拉取与回写契约
轮询策略：空闲态固定 15s（带 ±2s 随机抖动）；一旦 /api/sync/pending 返回非空列表或本地存在运行中工单，切换至活跃态 3s；远端 5xx/断网时指数退避（最大 120s）。
游标机制：无状态水位游标。因 /api/sync/claim 会将远端状态从 pending 置为 running，消费端每次拉取 /api/sync/pending 均按 (created_at ASC, package_id ASC) 取队首即可，无需维护易失的 offset 游标。
幂等键：idempotency_key = sha256(package_id + ":" + package_sha256)，落盘于本地 SQLite sync_inbox_ledger 表（唯一索引）。
回写失败语义：工单进入终态后，本地状态记为 SYNC_FINALIZING，以指数退避（5s, 15s, 30s, 60s, 300s）重试 POST /api/sync/result（Header 携带 X-Idempotency-Key: {ticket}）。
返回 200 OK 或 409 ALREADY_FINALIZED：本地标记 SYNC_ACKED，清理 .sync_cache/{ticket}.tar。
返回 404/410 TICKET_EXPIRED 或连续重试超过 24 小时：本地标记 SYNC_DEAD_LETTER，触发桌面控制台告警横幅，等待人工一键重推，绝不触发本地工单重跑。
状态迁移表
表 1：检查点一（180s 自动放行 vs 179s 人工拦截）CAS 状态迁移表
锚定位置：SQLite pi_sessions 表
核心字段：session_id (PK), work_order_id (UNIQUE), session_state (TEXT), state_version (INTEGER NOT NULL DEFAULT 1), grace_deadline_ms (INTEGER), approval_actor (TEXT)
并发铁律：任何状态跃迁必须执行 UPDATE pi_sessions SET session_state = :new_state, state_version = state_version + 1, approval_actor = :actor WHERE session_id = :sid AND session_state = 'AWAITING_PLAN_APPROVAL' AND state_version = :expected_ver。检查 rows_affected == 1 方为成功。

运行期事件 探针信号 / 退出码 重试预算状态 工单五态迁移 租约 (leases) 动作 防僵尸 / 防误杀机制
单步 OOM (6.5GB/7.5GB) Exit 137 或 mem_guard 捕获 MEM_LIMIT_EXCEEDED 剩余预算大于 0（adaptation_count < 2） 保持 running 保持持有（心跳继续） 先发 adb shell kill -9 -PGID 清理容器残留进程组，再允许 AI 调 remediate_step_param（如降 worker 至 1）重发 dispatch_step
单步 OOM 预算耗尽 同上 剩余预算等于 0（adaptation_count == 2） running → blocked (failure_stage=mod_id) 同事务释放 (DELETE/EXPIRE) 写入 receipt/v1 (status=blocked, error=OOM_EXHAUSTED)，禁止转为 failed 以免丢失已完成前序步骤缓存，留待人工接管
代码/数据硬错误 Exit 非 0 且非 OOM，且非白名单可调参错误 不消耗自适应预算（不可自愈） running → failed 同事务释放 (DELETE/EXPIRE) 收集 stderr 尾部写入 receipt/v1，执行容器临时目录清理
ADB 瞬时闪断 adb exec-out / forward 10022 Socket 断开 重连窗口内（3 次，间隔 5s/10s/20s） 保持 running 保持持有（本地编排器代维持心跳） 容器内任务由 nohup/setsid 托管写本地 pidfile 与 exitfile；重连成功后先探查 /proc/{pid} 与 exitfile，实现断点续接
ADB 永久失联 3 次重连（共 35s）全部失败 不适用 running → blocked (error=ADB_LOST) 同事务释放 (DELETE/EXPIRE) 标记算力节点 OFFLINE，阻断队列后续工单下发，待设备重插恢复后人工或巡检清理远端孤儿进程
大文件流式回传中 处于 ARCHIVE_PULLING 阶段（10022 端口满载） 正常传输中 保持 running 传输旁路自动续期 只要本地接收流每 10s 内 bytes_received 增量大于 64KB，编排器直接在本地 SQLite 刷新 leases.expires_at = now + 120s，不发 ADB 命令探活，彻底免疫末段带宽饥饿
守护进程崩溃 编排器自身进程挂掉（expires_at < now） 不适用 巡检器扫出超时工单：running → blocked Reaper 强制回收 独立 Watchdog 每 30s 扫描 work_orders.status='running' AND leases.expires_at < now，先尝试 ADB 杀远端进程组，再原子置为 blocked

风险
propose_adaptation 触犯 REJ-007（便携包与源码分叉）与 REJ-012（突破 Ready 实证棘轮）的风险：
如果 AI 用 propose_adaptation 生成的补丁脚本非常有效，但只留在单项目的 runs/{project_id}/adaptations/ 里，久而久之线上靠 AI 临时打补丁混过关，而底层 54 个模块母版得不到反哺；反之如果直接自动写回母版，又直接违反 REJ-002/007/012。裁定：propose_adaptation 产出的代码生命周期严格限制在单次 work_order_id 内，随交付包归档备查，严禁自动合入 references_db 或模块母版。
D2 接收器 .sync_cache 磁盘打满与半包污染：
若 GET /api/sync/package?ticket= 下载中途断流，残留的半截 .tar 会占满桌面端磁盘。裁定：下载必须先写 .sync_cache/{ticket}.tar.part，流式计算 SHA-256 与 claim 返回的 sha256 严格比对一致后，再 rename 为 .tar 并入库 sync_inbox_ledger；不一致立刻 unlink 并重试下载。
单消费者队列与人工强制接管（Human Preemption）的容器侧踩踏：
当人工在 UI 点击“强制接管”抢走 Lease 时，SQLite 层面毫秒级切换完成，但如果容器内 AI 刚才下发的 R/Python 进程还在跑，人工紧接着下发新指令就会在容器内形成双进程争抢 7.5GB 内存。裁定：人工强制接管 API 在更新 SQLite leases.holder='human' 后，必须同步触发一次 adb shell kill -TERM -{pgid}（2 秒后 -KILL），确保容器算力面净空后再把控制权交给人工。
下一轮材料
D4.9 与 D2 的核心接口、状态机与防线已全部锁定。下一轮进入 D0（便携 Electron 桌面壳收尾）与 D1（门户加固） 的架构审查，请提供：
D0 桌面控制台架构现状：
Electron 主进程（Main）、渲染进程（Renderer）与本地 Python/Node 编排器后端的通信拓扑（是内置子进程托管、本地 HTTP Loopback，还是纯 IPC？）。
2 个关键人工交互面（检查点一 180 秒倒计时拦截面板、检查点二报告人工签发与 EXPLORATORY_DEGRADED 探索版签章确认界面）的现有状态流与 API 绑定情况。
D1 门户（Portal）与 PKG 打包规范：
门户生成 PKG 提交包的目录结构、Schema 校验规则，以及门户侧如何防止恶意大文件上传或畸形 GSM 映射注入。

