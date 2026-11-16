继续。上一轮判决已开始执行：G1 内存红线已改为 12GB 设备 / 7.5GB 容器 / 6.5GB 单任务，worker 不超过 2；施工按 D4.9 → D2 → D0 → D1。本轮只审 D4.9 生产接线的接口与状态机。材料如下。

【材料 1：9 个受控工具】
tier1（只读/编排）：
inspect_requirement(package_id)
compile_work_order(project_id,line_id,selected_mods,params_override?)
dispatch_and_poll_dag(work_order_id,lease_id?)
read_step_metrics(project_id,mod_id)
remediate_step_param(work_order_id,mod_id,param_key,new_value,reason)
build_and_verify_report(project_id,narrative_payload_json)
tier2（沙盒适配，新增）：
propose_adaptation(project_id,mod_id,filename,content,purpose,reason)
run_validation(project_id,mod_id,entry_point)
dispatch_step(work_order_id,project_id,mod_id,entry_point,lease_id)

【材料 2：状态机与租约】
工单五态：queued→running→completed/failed/blocked，终态不可逆。
租约：SQLite 单表，TTL 120 秒，心跳 30 秒，人工可强制接管；三个工单写端点要求 X-Bio-Lease-Id；AI 接管返回 403。
Pi 会话态：DRAFT→AWAITING_PLAN_APPROVAL→PLAN_APPROVED→RUNNING_DAG→AWAITING_TARGET_APPROVAL→TARGET_APPROVED→REPORT_SIGNED。
检查点判定：宽限自动放行 / 零等待直通 / golden 跑批直通 / 人工硬闸门；吊销条件命中即转人工。

【材料 3：receipt/v1 现有字段】
schema_version,receipt_id(24hex),work_order_digest,work_order_id,project_id,line_id,status,started_at,finished_at,failure_stage,source_schema_version,seed,compute_adapter,dag,stages,upload_receipts,task_receipts,acceptance,delivery,artifacts,summary,error,sentinel,producer,actors,actor_trace
现状缺口：delivery_grade 只存在于 Pi 会话 context，未进 receipt；adaptation_trace 尚未定义；签名范围目前是交付 tar 的 Ed25519，不是整份 receipt。

【材料 4：12 条 REJ 摘要】
REJ-001 突破 Ready 白名单（被 012 接替）；REJ-002 项目层放母版副本；REJ-003 只改仓库不同步算力面；REJ-004 硬编码解释器；REJ-005 绕过 300DPI；REJ-006 生产链重型解卷积；REJ-007 便携包与源码分叉；REJ-008 跳过测试不写原因；REJ-009 只证修好变红不证改坏变红；REJ-010 测试共用共享资源；REJ-011 空间邻接图 200um 硬截断；REJ-012 突破 Ready 实证棘轮。

【材料 5：pull 式 sync 协议】
GET /api/sync/pending 列 pending；POST /api/sync/claim 认领，pending→running，返回 ticket 与 sha256；GET /api/sync/package?ticket= 下载 tar 并核对哈希；POST /api/sync/result 回写 done/failed/blocked。另有 trigger/status/results/file。缓存目录 .sync_cache。

【本轮问题】
1. dispatch_step 的执行归属：新增单步下发端点，还是回调编排器？租约在哪一层校验？如何保证与队列单消费者不打架？
2. OOM 或 ADB 闪断时，running 如何收敛为 failed/blocked？租约何时释放？如何避免僵尸 running 和回传最后 1% 被误判失联？
3. 检查点一 180 秒自动放行与人工 179 秒拦截的竞态，CAS 版本号放在哪张表、哪个字段？请给状态迁移表。
4. adaptation_trace 与 delivery_grade 在 receipt/v1 的位置、签名范围、第 28 道门禁的否决判据。
5. D2 接收器的轮询间隔、游标、幂等键与 result 回写失败语义。

输出格式固定：结论 / 接口契约 / 状态迁移表 / 风险 / 下一轮材料。
