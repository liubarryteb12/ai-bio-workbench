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
