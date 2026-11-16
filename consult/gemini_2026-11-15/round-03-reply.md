结论

D0 通信拓扑保持 child_process.spawn + 127.0.0.1 随机端口 + Basic 口令，严禁改为 Electron 主进程内嵌或纯 IPC。理由：第一，直接命中 REJ-007（便携包与源码分叉） 防线——保持 HTTP Loopback 能让便携桌面壳与无头（Headless）CLI/Web 调试端 100% 共享同一套 server/index.js 路由与测试集，改纯 IPC 会导致两套 API 分叉；第二，Node 后端涉及 SQLite native 绑定、大文件 .tar 流式解包及 ADB 子进程高频调度，一旦内嵌进 Electron 主进程，任何重度 I/O 停顿或未捕获异常都会直接卡死窗口甚至拖垮整个 GUI；第三，service.restart 在独立子进程架构下可实现秒级热重启而不闪退界面。仅需补齐 “同机 SSRF / 跨源 CSRF 防护（X-Bio-Local-Token 自定义头 + Sec-Fetch-Site: same-origin 强校验）” 与 “Windows Job Object / 死亡管道 (stdio: ['pipe', ...]) 双重防孤儿进程机制” 即可达到最小攻击面。

180 秒倒计时面板采用“服务端 grace_deadline_ms 单一真源 + 1 秒级轻量轮询（复用 /api/pi/sessions/active）”，不引入 SSE（避免长连接假死与重连状态断层）。人工在最后 1 秒点击拦截直接走 “统一拦截并接管接口（POST /api/pi/sessions/:id/intercept）”：无论此时服务端 CAS 处于 AWAITING_PLAN_APPROVAL（179s 拦截成功）还是刚在 180.001s 跃迁至 PLAN_APPROVED / RUNNING_DAG（Timer 刚胜出），服务端在同一个接口、同一个事务内自动降级/升级为“强制夺取 Lease + adb kill -PGID 净空容器”，对管理员承诺“只要点下拦截按钮，100% 停机交权”。

报告签发 UI 必须将“靶点锁定（AWAITING_TARGET_APPROVAL）”与“报告签发（REPORT_SIGNED）”收口为两阶段同屏单向步进器。当 delivery_grade === 'EXPLORATORY_DEGRADED' 时，前端强制锁死标准签发按钮，要求管理员勾选 ack_exploratory_degraded 并填写降级放行批注（不少于 10 字符），后端校验通过后方可执行整单 receipt/v1 (JCS) + 归档 .tar 的双层 Ed25519 签名。

D1 门户最小加固集唯一优先级：① 表型与 GSM 映射前置流式预检（防命令/公式注入与样本错位） → ② 文件头魔数（Magic Bytes）与压缩流炸弹拦截（破除扩展名伪造） → ③ 分块上传磁盘配额与僵尸会话清理（防磁盘打满 DoS） → ④ Token 级并发锁与滑窗限流。

D2 解包硬化（extractTarGz）必须补齐 6 项硬指标：拒绝非普通文件类型（Symlink/Hardlink/FIFO/Device 一律拦截）、单包最大条目数 ≤ 64、单文件解压上限 ≤ 5GB、整包解压总字节上限 ≤ 12GB、动态膨胀率上限（解压字节 / 已读压缩字节 ≤ 25 倍，前 10MB 豁免）、路径深度 ≤ 4 层且文件名仅限 ASCII 安全字符集。

接口契约

1. D0 Loopback 安全加固契约（防本机恶意网页 CSRF / 端口扫描）

虽然监听 127.0.0.1 随机端口并注入了 Basic Auth，但若管理员浏览器打开了恶意网页，可通过 WebRTC/Timing 探测端口并发起 Simple Request POST。必须在 server/index.js 全局中间件强制执行：

禁止 CORS：不返回任何 Access-Control-Allow-* 响应头。

强制预检与来源校验：所有非 GET/HEAD 请求必须同时满足：

Sec-Fetch-Site 为 same-origin（或 none）；

携带自定义 Header X-Bio-Client: electron-d0（促使浏览器跨域时必发 OPTIONS 预检并被直接 403 拦截）；

Electron 主进程将 spawn 时的 stdin 设为 'pipe'，后端 server/index.js 监听 process.stdin.on('end', () => process.exit(0))，确保 Electron 进程被任务管理器强杀时，Node 后端瞬间殉职，绝不残留僵尸监听端口。

2. 检查点一：180 秒倒计时与“无死角拦截” API

轮询接口：GET /api/pi/sessions/active（轮询间隔：当存在 AWAITING_* 或 RUNNING_DAG 会话时 1000ms，否则 5000ms）{ "server_now_ms": 1794721800123, "sessions": [ { "session_id": "ses_01", "work_order_id": "wo_20261115_001", "session_state": "AWAITING_PLAN_APPROVAL", "state_version": 2, "grace_deadline_ms": 1794721980000, "remaining_ms": 179877, "auto_pass_eligible": true, "revocation_reasons": [] } ] } 注：前端严禁使用本地 new Date() 直接对比 grace_deadline_ms，必须以响应中的 remaining_ms = Math.max(0, grace_deadline_ms - server_now_ms) 作为倒计时起点，彻底消除前后端时钟漂移。

统一拦截/接管接口：POST /api/pi/sessions/:session_id/intercept

Request Body：{ "expected_state_version": 2, "reason": "manual_review_on_group_mapping" } 

服务端原子处理逻辑（消除 179s vs 180s 竞态）：

尝试分支 A（180s 尚未触发）：执行 CAS UPDATE pi_sessions SET session_state='HUMAN_OVERRIDE', state_version=state_version+1, grace_deadline_ms=NULL WHERE session_id=:id AND session_state='AWAITING_PLAN_APPROVAL' AND state_version=:ver。若 rows_affected == 1，同事务将 leases 置为 holder='human'，返回 200 OK (intercept_mode: "PRE_DISPATCH")。

尝试分支 B（Timer 在 10 毫秒前刚胜出，rows_affected == 0 且当前状态已变为 PLAN_APPROVED 或 RUNNING_DAG）：不向前端报错，立即在同一请求内无缝升级为强制抢占（Preemption）：

在 SQLite 事务中强制更新 leases 表：holder='human', lease_epoch=lease_epoch+1，将 pi_sessions.session_state 置为 HUMAN_OVERRIDE，工单置为 blocked；

同步调用算力适配器执行 adb shell kill -TERM -{pgid}（清理刚启动不到 1 秒的容器进程）；

返回 200 OK (intercept_mode: "POST_DISPATCH_PREEMPTED")。

3. 检查点二：靶点锁定与报告签发 API

阶段 2A — 靶点锁定审批：POST /api/pi/sessions/:session_id/approve-targets

Headers：X-Bio-Lease-Id: <human_or_session_lease>

Request Body：{ "expected_state_version": 5, "locked_targets": ["ENSG00000141510", "TP53"], "selected_figure_templates": ["fig_volcano_v3", "fig_enrich_dot_v3"], "operator_note": "Confirmed top DEGs match literature baseline" } 

前置校验：校验 selected_figure_templates 全部在 40 个 Ready 白名单内（防触犯 REJ-001 / REJ-012），且 producing_mod_id 与当前分析线严格匹配。通过后状态跃迁：AWAITING_TARGET_APPROVAL → TARGET_APPROVED，触发 build_and_verify_report。

阶段 2B — 报告终审与 Ed25519 签发：POST /api/pi/sessions/:session_id/sign-report

Request Body：{ "expected_state_version": 7, "work_order_id": "wo_20261115_001", "expected_delivery_grade": "STANDARD | EXPLORATORY_DEGRADED", "ack_exploratory_degraded": true, "degraded_justification": "Sample GSM123456 RIN<6.0, relaxed min_genes via adaptation #1, approved for exploratory delivery.", "signer_id": "hyl" } 

服务端硬门禁：

若工单实际 delivery_grade === 'EXPLORATORY_DEGRADED'（即 adaptation_trace 非空或发生过参数降级），必须强制要求 expected_delivery_grade === 'EXPLORATORY_DEGRADED' 且 ack_exploratory_degraded === true 且 degraded_justification.trim().length >= 10，否则直接返回 422 EXPLORATORY_ACK_REQUIRED。

校验第 1–28 道门禁全绿（GATE_ALL_OK），特别是 300 DPI（REJ-005）、字体 ≥ 8pt（C4）、脱敏扫描零泄漏。

调用本地密钥库，根据 delivery_grade 选择对应的签名通道（标准版密钥槽或带 EXPLORATORY_DEGRADED 强声明的载荷），写入 sentinel.archive_ed25519_sig 与 sentinel.receipt_ed25519_sig，工单落入不可逆终态 completed，释放租约，同时触发 D2 接收器的 POST /api/sync/result 回写队列。

4. D2 解包器（extractTarGz）硬限额表

在流式读取 .tar.gz（zlib.createGunzip() → tar-stream）过程中，必须在内存中维护实时累加器，任一阈值突破立即销毁流、unlink 半成品目录，并将 sync 状态回写为 failed (error: ARCHIVE_POLICY_VIOLATION)：

防护维度硬限额阈值拦截动作与防攻击目标条目类型 (header.type)仅允许 'file' 与 'directory'遇到 'symlink', 'link' (hardlink), 'fifo', 'character-device', 'block-device' 立即 abort()（彻底封死通过软硬链接逃逸出解包目录读写宿主机文件）路径结构与字符集深度 ≤ 4 层；仅允许 ^[a-zA-Z0-9_.\-/]+$拒绝任何 ..、前导 /、Windows 盘符 :、反斜杠 \、控制字符及 Unicode 同形异义字最大条目总数≤ 64 个条目（含目录）契约规定 5 个固定角色各 1 文件 + other 最多 5 个 + references 最多 5 个 + 2 个 JSON，正常包绝不超过 25 个条目；超 64 即判定为 Inode 耗尽攻击单文件解压后大小≤ 5,368,709,120 Bytes (5 GiB)同时校验 header.size 声明值与实际写出字节流 bytesWritten（防止伪造 tar header 小尺寸绕过检查）整包解压累计总字节≤ 12,884,901,888 Bytes (12 GiB)保护桌面端 .sync_cache 与 data/workspace/inbox 所在磁盘分区压缩膨胀率（防炸弹）累计 uncompressed_bytes > 10MB 后，uncompressed / compressed_read ≤ 25实时拦截全零填充的 .tar.gz 压缩炸弹（正常生信矩阵 gzip 压缩比在 3x–10x 之间） 

状态流

D0 控制台双检查点与适配弹窗统一状态流

[PKG 入箱 / 编译 work_order/v2] │ ▼ ┌──────────────────────────────────────────────────────────────────────┐ │ 检查点一面板 (PiCheckpointsPanel - 180s 倒计时态) │ │ 态: AWAITING_PLAN_APPROVAL (state_version=V) │ │ UI: 展示分析线、选定模块、参数摘要 + 顶部醒目 180s 倒计时进度条 │ └──────┬───────────────────────────┬───────────────────────────┬───────┘ │ [180s 归零 Timer 胜出] │ [人工点击"立即放行"] │ [人工点击"拦截/修改"(含第179s)] ▼ ▼ ▼ (auto-pass CAS V+1) (manual-pass CAS V+1) (POST /intercept: CAS 或 抢占+kill) │ │ │ └─────────────┬─────────────┘ ▼ ▼ [HUMAN_OVERRIDE / blocked] ┌────────────────────────────────────────────────┐ (人工改参或调 PiProposalsModal) │ DAG 执行与自愈期 (RUNNING_DAG) │ │ │ - 若遇可自愈异常 → 触发 propose_adaptation(≤2) │◄────────────┘ │ - 弹出 PiProposalsModal (展示验证哈希与 diff) │ │ - 标记 delivery_grade = EXPLORATORY_DEGRADED │ └────────────────────┬───────────────────────────┘ │ (全部模块跑通，进入靶点确认) ▼ ┌──────────────────────────────────────────────────────────────────────┐ │ 检查点二阶段 A：靶点与图表模板锁定面板 (TargetLockStep) │ │ 态: AWAITING_TARGET_APPROVAL │ │ UI: 勾选候选靶点卡片 + 校验 Ready 图表白名单 → 点击 [锁定并生成报告] │ └────────────────────┬─────────────────────────────────────────────────┘ │ (调用 build_and_verify_report + 28道门禁扫描) ▼ ┌──────────────────────────────────────────────────────────────────────┐ │ 检查点二阶段 B：报告终审与 Ed25519 签发面板 (ReportSignStep) │ │ 态: TARGET_APPROVED (待签发) │ │ 分支 1 [STANDARD]: 绿底徽章 → 直接点击 [生成正式版 Ed25519 签章] │ │ 分支 2 [EXPLORATORY_DEGRADED]: 琥珀色警告横幅 + 展开 adaptation_trace│ │ → 强制勾选"确认降级交付" + 填写原因 → 点击 [签发探索版报告] │ └────────────────────┬─────────────────────────────────────────────────┘ │ ▼ [REPORT_SIGNED / 工单 completed / 触发 D2 Result 回写] 

D1 门户最小加固集（按唯一优先级排序的 6 项改造清单）

P0 — sample_sheet 与 group_map 流式结构与注入消毒（防 GSM 错位与 R/Python 注入）：

问题：客户上传的 CSV/TSV 若包含 =cmd|...（公式注入）、反引号/分号/换行符、UTF-8 BOM、\r\n 混用，或者 group_map 里的 GSM 编号与 sample_sheet 不呈双射（存在孤儿样本、重复 GSM、单组样本数 < 3 导致 DESeq2/limma 直接崩溃），会把脏数据一路带进 K40 容器。

加固：门户在合并最后一块分片后，必须对 sample_sheet 和 group_map 执行同步解析：强制 GSM ID 匹配 ^[A-Za-z0-9_.\-]{1,64}$，分组名匹配 ^[A-Za-z0-9_]{1,32}$（严禁空格、中文标点、R 保留字如 TRUE/FALSE/NA/NULL），校验两边样本集合 100% 相等且每组样本数满足对应分析线最低统计学要求（如 bulk 每组 ≥ 3）。

P1 — 文件头魔数（Magic Bytes）强校验与 Gzip/Zip 预检（防内容类型伪造）：

问题：仅靠 14 项扩展名白名单无法阻止攻击者将恶意脚本或损坏的二进制重命名为 .csv、.tsv、.rds、.h5ad 上传。

加固：读取每個上传文件的前 4096 字节做精确嗅探：.gz / .rds 必须以 1F 8B 开头；.h5 / .h5ad 必须以 HDF5 签名 89 48 44 46 0D 0A 1A 0A 开头；文本表格（.csv/.tsv/.txt/.mtx）前 4KB 必须为合法 UTF-8/ASCII 且不含 0x00 空字节（Null Byte）及 <!DOCTYPE html（防把 GEO 报错网页当成数据矩阵上传）。

P2 — 路径穿越、Symlink 与归档嵌套封堵（防门户侧 Zip-Slip）：

加固：门户禁止客户直接上传 .tar / .zip 复合包逃避角色检查（只允许单文件 .gz 压缩如 .csv.gz / .mtx.gz）；落盘文件名不使用客户原始文件名，统一重命名为 {role}_{index}.{validated_ext}，原始文件名仅经正则消毒后记录在 package_manifest.json 的 original_name 字段中。

P3 — 分块上传磁盘水位熔断与未完成分片 GC（防超大文件耗尽门户磁盘）：

加固：在接收第一个 4MB 分块前，先校验门户宿主机剩余磁盘空间（必须 > 25GB 才允许开启新上传会话）；每个客户 token 同一时刻最多允许 1 个活跃上传会话，累计暂存分片上限 10GB；后台定时任务每 15 分钟 清理一次超过 2 小时 无心跳的孤儿分片目录。

P4 — requirement.json 肿瘤/超纲黑名单的归一化绕过防护：

加固：在进行肿瘤黑名单及重型解卷积（REJ-006）关键词筛查前，必须先对用户输入文本执行 Unicode NFKC 归一化 + 零宽字符剥离 + 大小写折叠 + 常见同义缩写展开（如 TCGA, tumor, carcinoma, malignant, cell2location, RCTD），防止通过全角字母或零宽空格绕过筛查。

P5 — Token + IP 双层滑窗限流与打包幂等锁：

加固：单个客户 Token 限制每小时最多成功生成 3 个 PKG；点击“最终提交”时对 token 加内存/文件互斥锁，防止客户连击按钮产生双份 PKG_<时间戳>_<项目名> 脏包。

风险

Electron Basic Auth 口令在渲染层 URL 或日志中泄漏（低危但需闭环）： 如果渲染层或后端日志把带有口令的请求头、或将 token 拼在 URL query 中打印到 logs 面板，而 preload 又暴露了 logs 读取接口，会导致凭证落地。裁定：Basic Auth 仅通过 Electron app.on('login') 底层回调在 Chromium 网络栈内静默应答，URL 中严禁出现任何 token，后端日志中间件脱敏 Authorization 头。

靶点锁定（2A）与报告构建（2B）之间的耗时阻塞感： build_and_verify_report 需要渲染 300 DPI 高清图并过 28 道门禁，耗时可能达十余秒至数十秒。若做成同步 HTTP 请求，UI 会看似卡死且容易触发超时重发。裁定：approve-targets 成功后立即返回 202 Accepted，会话进入过渡子态 BUILDING_REPORT，UI 经由现有的 1 秒轮询展示门禁逐项通关进度，全部通过后再点亮最终的 [签发报告] 按钮。

D1 门户拒绝含中文/特殊符号分组名后的客户体验摩擦： 生物医学客户习惯在 Excel 里写 "实验组-1 (给药)" 或 "Control Group"。如果门户直接硬报错拒绝，客户容易反复卡在提交页。裁定：门户前端在解析 group_map 时，自动生成 sanitized_group_id（如自动映射为 Group_A / Group_B 并在界面高亮提示映射关系：显示标签: "实验组-1" → 内部计算标识: "Group_A"），将两组映射同时写入 requirement.json，做到“計算层绝对安全，展示层保留原意”。

下一轮材料

至此，D2（已落地）、D0（通信与双检查点 UI）、D1（门户 6 项加固） 的架构裁定已全部闭环。全系统只剩最后、也是最核心的一块拼图——D4.9 生产执行器、租约与授权的最终实装接线（从 fail-closed 切向生产可跑通）。

下一轮我们将完成 D4.9 生产接线终审与上线点火（Go-Live）核查，请提供：

D4.9 待接线点的代码/模块级现状：

目前处于 fail-closed 桩代码（Stub）的具体函数签名或模块列表（即：生产执行器 compute_adapter、租约守卫 lease_guard、授权校验 auth_guard 各自卡在哪一步还没接通？）。

K40 容器侧执行包装器（Wrapper）现状：

dispatch_step 与 dispatch_and_poll_dag 下发到 ADB 10022 后，容器内是如何拉起 R/Python 脚本、如何捕获 mem_guard (6.5GB/7.5GB) 状态以及如何回传单步 task_receipts 的？

测试与门禁现状：

将 D4.9 切换为真接线后，需要新增哪几条变异反证（Mutation Tests）以确保不会破坏现有的 28 道门禁和 2168 个绿灯用例？


