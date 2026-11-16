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
