结论

当前证据链足以签发“代码与契约级封板（Code Freeze & Contract Sign-Off）”，但暂不签发“全量生产放量（Full Production Go-Live）”；目前唯一缺失的最后一项硬判据是：连真机（K40 容器）跑通 1 单端到端 Golden 冒烟工单并产出真实经签名的 receipt/v1。

D4.9 真实工单端到端（连真机）严禁被门禁、变异或 Mock 契约测试替代。必须连真机跑通 1 单最小闭环，才能最终下达 Final Go-Live 签发令。理由：直接受 REJ-003（只改仓库不同步算力面） 与 REJ-012（突破 Ready 实证棘轮） 约束——本轮新增了 6.5GB/3.5GB 内存档位切换、/tmp/bio_adapt 增量脚本推送与 WROTE '<path>' <bytes> 真实解析，Mock 测试只能证明 Node.js 编排器内部逻辑自洽，无法验证 ADB 10022 管道、proot 容器权限、shell 信号组清理（-PGID）及真实文件 I/O 的物理耦合。

D0 stdin 管道孤儿进程防护批准豁免于本次封板阻塞项，正式列为封板后第一张补丁票（Post-Go-Live Ticket #1）。在单管理员可控桌面环境下，当前已有的“正常退出进程树清理 + 随机端口”已覆盖 95% 场景，不构成上线红线。

首周三大运行期可观测性指标已锁定：围绕租约生命周期、硬件热节流（Exit 5）与算法自适应预算（OOM/Adaptation）建立硬性告警阈值，一旦越界立即退回人工硬闸门。

封板判据

1. 已达成封板标准（Code & Governance Freeze — PASS）

门禁与防线完整性：29 道串联门禁全绿（G1–G28 静态与运行时快检 18s 通关 + G29 全量测试门禁通过），G28 生产接线无桩化、内存双水位同源性及适配链完整性已锁死。

反证强度：28 条变异反证（8 infra + 20 behavior，含新增 M-Pi-10/11/12）实现 escaped = 0，证实租约抢占、跨代哈希校验与静默空输出防线不可绕过。

测试覆盖与回归基线：267 个测试文件、2204 条用例 0 fail（6 条跳过均符合 REJ-008 显式原因规范），且成功捕获并修复了 D1 GSM 校验引发的 portal_sync 跨模块真实回归，证明契约收紧已在全链路生效。

四面加固到位：D0（Sec-Fetch-Site + 180s 倒计时 + 探索版 10 字强批注）、D1（GSM 格式与跨组去重 + 10次/10min 滑窗）、D2（.tar.gz 6 项硬指标 + 幂等回写）、双检查点红线（409 ERR_DEGRADED_STATS_REQUIRE_OVERRIDE 强制拦截与探索版声明）全部闭环。

2. 距离 Final Go-Live 的最后一项硬判据（Physical Smoke Gate — PENDING）

必须在不修改任何业务代码的前提下，连接 K40 算力节点完成 1 次真实物理点火（Physical Smoke Run），同时满足以下 4 个观测点：

链路全通：D1 生成 PKG → D2 拉取解包 → 检查点一 180s 倒计时（或批准） → D4.9 经 ADB 10022 调起 run_throttled_task.sh (6.5GB) → 检查点二签发 → D2 回写 done。

账实相符：容器真实回传 WROTE '<path>' <bytes>，receipt/v1.task_receipts 非空，且 sentinel.archive_ed25519_sig 与 sentinel.receipt_ed25519_sig 双签名验签通过。

算力面同步核验：确认 K40 容器内的 tools/ops/run_throttled_task.sh 与 core/mem_guard.py 物理文件哈希与仓库主干 100% 一致（彻底防死 REJ-003）。

降级与验证分支实测（二选一即可）：在冒烟单中触发 1 次 run_validation (3.5GB) 或确认 EXPLORATORY_DEGRADED 探索版签章能正常落入 PDF/HTML 交付物封面与 Methods 章节。

必补项

1. 封板前必做（Go-Live Blocker — 仅 1 项）

[BLKR-01] 真机单工单端到端冒烟验收（Physical Golden Smoke）：

执行要求：取体量最小的 Line 1 (Bulk RNA-seq) 标准 Golden 样本集（如 6 样本极小矩阵），挂接 K40 跑完完整生命周期，留存生成的 receipt/v1.json 归档入库作为 V1.0 封板黄金凭证。

2. 封板后第一顺位补丁票（Post-Go-Live Ticket #1 — 非阻塞）

[TICKET-D0-01] Electron 主从进程死亡管道（Death-Pipe）与端口残留兜底：

触发场景：Windows 任务管理器强杀 electron.exe 或桌面端崩溃时，exit 事件不触发，导致 Node 子进程 (server/index.js) 成为后台孤儿进程，持续占用 SQLite 写锁（WAL lock）与 ADB 轮询通道，致使下次启动控制台报 SQLITE_BUSY 或双消费者抢单。

施工规格（约 15 行代码）：

Electron 主进程 spawn(nodeBin, ['server/index.js'], { stdio: ['pipe', 'pipe', 'pipe'] })，保持 child.stdin 打开但永不写入；

server/index.js 顶层注册 process.stdin.resume(); process.stdin.on('end', () => gracefulShutdownAndExit(0)); process.stdin.on('error', () => process.exit(1));；

新实例启动挂载 SQLite 前，若检测到残留 .server.lock PID 存活，先执行本地进程清理再接管数据库。

风险

D1 门户“全量强制 GSM 前缀”对自有测序数据的误伤风险（中危）： 材料 4 注明“D1：GEO 公共库样本 ID 强制 GSM”。需特别确认：该规则是否仅在客户勾选数据源为 GEO_PUBLIC 时生效？如果客户上传的是医院/实验室自测的私有 Bulk/单细胞 FASTQ/Matrix（样本名通常为 Patient_01、Ctrl_Rep1），若一刀切强制要求 ^GSM\d+，会导致私有数据客户无法提单。裁定：^GSM[0-9]+$ 正则强校验仅绑定 source_type == 'GEO'；自测数据走通用安全标识符正则 ^[A-Za-z0-9_.\-]{2,64}$。

golden_regression: true 免审直通检查点二的权限逃逸风险（低危但需加固）： 材料 5 明确检查点二仅在 golden_regression == true 且全绿跑批时豁免人工硬闸门。必须确保 D1 门户提交的 requirement.json 或外部 PKG 绝对无法注入 golden_regression: true——该标志位只能由内网 CLI 回归测试套件在本地构造 work_order/v2 时通过受保护内部参数置位，D2 接收器从外部拉取的包一律强制覆写 golden_regression = false。

下一步

一、封板后第一周（Day 1 – Day 7）三大核心观察指标与熔断红线

请将以下 3 条 SQL/日志聚合指标接入 D0 控制台首页或每日巡检脚本：

观察维度指标定义与采集口径健康基线 (Green)预警水位 (Yellow)熔断红线与架构动作 (Red)1. 僵尸锁与租约抢占率 (Lease & Lock Hygiene)① watchdog_reaped_leases_count（因超时被 Reaper 强行回收的租约数） ② step_lock_held_seconds_max（单步锁最长持有时间 vs 实际任务耗时差值） ③ post_dispatch_preemptions（179s/180s 压线抢占次数）① = 0 次/周 ② 锁滞留差值 < 5s ③ 抢占后容器残留进程 = 0① 1–2 次/周（且均由人为拔线引起）① 出现任何 1 次非拔线引起的 watchdog_reaped 或 step_lock 死锁：立即排查大文件回传旁路续期是否失效。 ② 抢占后容器内残留 R/Python 进程 > 0：说明 -PGID 信号未穿透 proot，立即暂停自动放行。2. Exit 5 热节流与冷却分布 (Thermal & Env Throttle)① exit5_event_rate（触发 run_throttled_task.sh Exit 5 的步骤占比） ② cooling_wait_recovery_rate（经 30s/60s/120s 冷却后重试成功率） ③ blocked_by_env_throttled（3 次冷却仍失败转 blocked 的工单数）① < 5% 步骤触发 ② 冷却自愈率 = 100% ③ 转 blocked 数 = 0① 5%–15% 触发（说明连续跑批散热吃紧） ② 单步平均冷却耗时 > 90s若 blocked_by_env_throttled > 0 或 exit5_event_rate > 20%：说明 K40 物理散热器衰退或后台有吸血进程，必须在编排器将连续工单之间的冷却间隙（Inter-Job Cooldown）从 0s 上调至 45s。3. OOM 命中率与适配预算消耗 (OOM & Adaptation Budget)① adaptation_epoch_distribution（工单完成时 epoch = 0 / 1 / 2 的比例） ② val_3.5g_reject_rate（在 3.5GB 验证态被拦截的劣质补丁占比） ③ exploratory_degraded_ratio（探索版降级交付占比）① epoch=0 占比 ≥ 80% ② epoch=2 耗尽转 blocked 占比 < 5% ③ 探索版占比 ≤ 20%① epoch ≥ 1 占比超过 35%（说明母版默认参数过于激进，频繁触发 6.5GB OOM）若某一个特定模块（mod_id）触发 OOM 或 adaptation_epoch >= 1 的频率 > 30%：禁止依赖 AI 每次临时打补丁，必须触发母版升级工单，将该模块的默认 worker 或内存策略下调并合入 _v3_masters。 

二、最终行动指令

立即执行 [BLKR-01]：连接 K40 跑完 1 单真机端到端冒烟测试，核对 receipt/v1 双签名与 WROTE 台账。

真机冒烟绿灯即刻生效：无需再发起第六轮会审——只要真机冒烟一单跑通且 29 道门禁保持全绿，本架构师即刻授权系统正式封板上线（Final Go-Live Approved）。

上线后第一顺位合入 [TICKET-D0-01]（stdin 孤儿进程防护） 并开启首周三大指标监控。


