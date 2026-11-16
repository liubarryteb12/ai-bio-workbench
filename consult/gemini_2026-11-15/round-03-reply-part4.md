服务端原子处理逻辑（消除 179s vs 180s 竞态）：
尝试分支 A（180s 尚未触发）：执行 CAS UPDATE pi_sessions SET session_state='HUMAN_OVERRIDE', state_version=state_version+1, grace_deadline_ms=NULL WHERE session_id=:id AND session_state='AWAITING_PLAN_APPROVAL' AND state_version=:ver。若 rows_affected == 1，同事务将 leases 置为 holder='human'，返回 200 OK (intercept_mode: "PRE_DISPATCH")。
尝试分支 B（Timer 在 10 毫秒前刚胜出，rows_affected == 0 且当前状态已变为 PLAN_APPROVED 或 RUNNING_DAG）：不向前端报错，立即在同一请求内无缝升级为强制抢占（Preemption）：
在 SQLite 事务中强制更新 leases 表：holder='human', lease_epoch=lease_epoch+1，将 pi_sessions.session_state 置为 HUMAN_OVERRIDE，工单置为 blocked；
同步调用算力适配器执行 adb shell kill -TERM -{pgid}（清理刚启动不到 1 秒的容器进程）；
返回 200 OK (intercept_mode: "POST_DISPATCH_PREEMPTED")。
