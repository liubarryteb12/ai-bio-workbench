服务端硬门禁：
若工单实际 delivery_grade === 'EXPLORATORY_DEGRADED'（即 adaptation_trace 非空或发生过参数降级），必须强制要求 expected_delivery_grade === 'EXPLORATORY_DEGRADED' 且 ack_exploratory_degraded === true 且 degraded_justification.trim().length >= 10，否则直接返回 422 EXPLORATORY_ACK_REQUIRED。
校验第 1–28 道门禁全绿（GATE_ALL_OK），特别是 300 DPI（REJ-005）、字体 ≥ 8pt（C4）、脱敏扫描零泄漏。
调用本地密钥库，根据 delivery_grade 选择对应的签名通道（标准版密钥槽或带 EXPLORATORY_DEGRADED 强声明的载荷），写入 sentinel.archive_ed25519_sig 与 sentinel.receipt_ed25519_sig，工单落入不可逆终态 completed，释放租约，同时触发 D2 接收器的 POST /api/sync/result 回写队列。
