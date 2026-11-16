# 第一轮判决提炼（Gemini Argon，2026-11-15）

> 原始回复见 `round-01-reply.md`。用户裁定：Gemini 的判决即最终判决。

## 一、路线判断

1. 两面物理隔离（PKG 契约桥接）+ 三层 AI 自主受控（C 方案检查点）成立。
2. 当前处于「高危悬空期」：最大风险是 D4.9 生产接线后的状态撕裂与僵尸锁（dispatch_step 触发 OOM 或 ADB 闪断时，租约与五态状态机的异常收敛）。

## 二、施工优先级（唯一顺序）

`D4.9 生产接线` → `D2 同步接收器` → `D0 桌面壳收尾` → `D1 门户加固`

理由：D4.9 是最大的未验证架构假设；D2 接上才能跑通无头端到端闭环；D0 只做状态映射与人工签发 UI；D1 是边缘模块，随时可加固。

## 三、必须立即执行的 3 项架构修正

### 3.1 内存水位红线（废除单任务 8GB）

三级严格递减：物理设备 12GB → 容器硬上限 7.5GB → 单任务硬上限 6.5GB。
单细胞/空间模块的 MulticoreParam/future 并发 worker 不得超过 2。

### 3.2 AI 自适应边界

1. 每个工单生命周期内 `propose_adaptation` 最多 2 次，超过强制 `blocked` 转人工。
2. 参数单调降级律：只能向更保守/探索版方向调整，且触发 `EXPLORATORY_DEGRADED` 标记。
3. 严禁篡改 work_order/v2 的样本分组映射、物种、主分析线类型。

### 3.3 自适应审计链

1. 任何 `propose_adaptation` 引发的参数偏离生成 `adaptation_trace` 数组。
2. 除运行期 SQLite 外，`adaptation_trace` 作为受保护字段写入最终 `receipt/v1.json`，纳入 Ed25519 签名范围。
3. 立项后发生未签名授权的参数漂移，第 28 道门禁一票否决。

## 四、四个风险命门

1. 参数倒挂导致容器级死锁（致命）。
2. AI 合法死循环与统计欺诈（高危）。
3. 180 秒宽限期重入竞态，需要 CAS 版本号原子状态跃迁（中危）。
4. ADB 大文件回传抢占心跳，需区分「传输中」与「节点失联」（中危）。

## 五、下一轮需提供的材料

1. 9 个受控工具的 JSON Schema 与入参出参契约。
2. A1 到 A8 与五态状态机、单权威租约的状态映射与时序。
3. work_order/v2 与 receipt/v1 完整字段（含 `EXPLORATORY_DEGRADED` 与冻结签名桥）。
4. 12 条 REJ 台账简表。
5. pull 式 sync 协议的数据包格式、游标与幂等去重设计。

---

# 第二轮判决提炼（Gemini Argon，2026-11-15）

> 原始回复见 `round-02-reply.md`（含 receipt 代码块与状态迁移表）。

## 六、D4.9 生产接线

1. `dispatch_step` 严禁新增独立 HTTP 写端点，作为编排器内部受控子例程 `internal_step_dispatcher` 回调；租约校验在编排器入口层做唯一校验（`X-Bio-Lease-Id` + `lease_epoch`）。
2. 队列消费者只消费 `queued` 态，与 `running` 态的 dispatch_step 物理隔离，天然不打架。
3. 适配脚本沙盒：`data/workspace/runs/{project_id}/adaptations/{mod_id}/`，下发前经 ADB 同步到 `/tmp/bio_adapt/{work_order_id}/{mod_id}/`；严禁复制母版（REJ-002/003）。
4. 先验后发锁：dispatch_step 必须校验同一 `(project_id, mod_id, content_sha256)` 存在 PASSED 的 run_validation 记录，否则 412 `PRECONDITION_FAILED`。

## 七、异常收敛与防误杀

1. OOM（Exit 137 / mem_guard 捕获）且有预算：保持 running 消化；预算耗尽转 blocked。
2. ADB 闪断：3 次重连失败转 blocked。
3. 租约只在工单落入终态的同一个 SQLite 事务中释放。
4. 大文件回传：按 ADB I/O 字节增量顺延租约（Transfer Lease Extension），避免最后 1% 被误判失联。
5. 人工强制接管：先 `kill -TERM -{pgid}`（2 秒后 `-KILL`）清空容器算力面，再交接控制权。

## 八、检查点竞态

`pi_sessions` 表加 `state_version` 乐观锁；任何状态跃迁执行
`UPDATE ... WHERE session_id=? AND session_state='AWAITING_PLAN_APPROVAL' AND state_version=?`，
检查 `rows_affected == 1`。人工拦截与定时器自动放行平权竞争，败者静默丢弃或报错。

## 九、receipt/v1 扩展与签名

1. `delivery_grade` 与 `adaptation_trace` 提升为 receipt/v1 顶层字段（置于 acceptance 与 delivery 之间）。
2. `adaptation_trace` 每条含 seq、mod_id、action_type、target、before/after digest、validation_run_id、validation_passed、purpose、reason、timestamp。
3. 双层签名：`archive_ed25519_sig` 保留对交付 tar 的签名；新增 `receipt_canonical_sha256` 与 `receipt_ed25519_sig`，对整份 receipt 的 Canonical JSON 签名。
4. 第 28 道门禁否决判据：立项后存在未签名授权的参数漂移即一票否决。

## 十、D2 接收器

1. 双模态轮询：空闲 15 秒，活跃 3 秒。
2. 幂等键 `(package_id, sha256)`；本地持久态 `SYNC_FINALIZING` 回写重试队列，解耦「本地算完」与「远端回写成功」。
3. 下载先写 `.sync_cache/{ticket}.tar.part`，流式 SHA-256 与 claim 返回值比对一致后 rename；不一致立即删除并重试。

## 十一、下一轮材料

1. D0：Electron 主进程、渲染进程与本地编排器后端的通信拓扑（子进程托管 / 本地 HTTP / 纯 IPC）。
2. D0：检查点一倒计时拦截面板、检查点二签发与探索版签章界面的状态流与 API 绑定。
3. D1：门户 PKG 目录结构、Schema 校验、恶意大文件与畸形 GSM 映射注入的防护。

---

# 第三轮判决提炼（Gemini Argon，2026-11-15）

> 原始回复见 `round-03-reply.md`（10,265 字，含完整状态流图）。

## 十二、D0 通信拓扑

1. 保持 `child_process.spawn + 127.0.0.1 随机端口 + Basic 口令`，禁止改为主进程内嵌或纯 IPC。理由：与无头 CLI/Web 共享同一套路由与测试集，避免 API 分叉；隔离 SQLite、tar 解包与 ADB 子进程的重 I/O；支持秒级热重启。
2. 加固：禁止 CORS；所有非 GET/HEAD 请求校验 `Sec-Fetch-Site: same-origin`（或 none）并携带 `X-Bio-Client: electron-d0`；Electron spawn 用 `stdio: ['pipe', ...]`，后端监听 stdin end 立即退出，防孤儿进程。

## 十三、检查点一倒计时面板

1. 服务端 `grace_deadline_ms` 单一真源，UI 1 秒轮询 `/api/pi/sessions/active`，不引 SSE。
2. 统一拦截接口 `POST /api/pi/sessions/:id/intercept`：同一事务内 CAS 抢占；若 180.001s 定时器已胜出，则强制夺取租约并 `adb kill -PGID` 净空容器，对管理员承诺「点下拦截即 100% 停机交权」。

## 十四、报告签发 UI

1. 「靶点锁定」与「报告签发」收口为两阶段同屏单向步进器。
2. `delivery_grade === EXPLORATORY_DEGRADED` 时锁死标准签发按钮，必须勾选 `ack_exploratory_degraded` 并填写不少于 10 字批注；后端校验后执行整单 receipt/v1 (JCS) + 归档 tar 的双层 Ed25519 签名。

## 十五、D1 门户最小加固集（唯一优先级）

1. 表型与 GSM 映射前置流式预检（防命令/公式注入与样本错位）。
2. 文件头魔数与压缩流炸弹拦截（破扩展名伪造）。
3. 分块上传磁盘配额与僵尸会话清理（防磁盘打满 DoS）。
4. Token 级并发锁与滑窗限流。

## 十六、D2 解包硬化六项硬指标

1. 拒绝 Symlink / Hardlink / FIFO / Device，只允许普通文件与目录。
2. 单包最大条目数 ≤ 64。
3. 单文件解压上限 ≤ 5GB。
4. 整包解压总字节 ≤ 12GB。
5. 动态膨胀率 ≤ 25 倍（前 10MB 豁免）。
6. 路径深度 ≤ 4 层，文件名仅限 ASCII 安全字符集。

## 十七、下一轮材料（D4.9 生产接线终审）

1. 仍处 fail-closed 的桩函数/模块清单：compute_adapter、lease_guard、auth_guard 各自卡在哪一步。
2. 容器侧执行包装器现状：ADB 下发后如何拉起 R/Python、如何捕获 mem_guard 状态、如何回传单步 task_receipts。
3. 切换真接线后需要新增哪几条变异反证，确保不破坏 28 道门禁与 2168 个绿灯用例。

---

# 第四轮判决提炼（Gemini Argon，2026-11-15）

> 原始回复见 `round-04-reply.md`（7,666 字）。

## 十八、接线顺序（唯一）

`assertLease → autonomyGrantsProvider → runValidationFn → dispatchStepFn`

先锁租约与授权边界，再开 3.5GB 沙盒验证，最后放开 6.5GB 生产单步下发。

## 十九、工单 meta 新增字段

1. `step_lock`：单步互斥锁，进入 runTask 前原子检查并置位。
2. `adaptation_epoch`：全局适配代数，上限 2；验证凭据绑定代数，防跨代重放。
3. `step_attempts[mod_id]`：单模块累计执行次数，上限 3；task_receipt_id 带 attempt。
4. `env_throttle_retries`：环境限流重试计数，上限 3，与算法预算隔离。

## 二十、退出码收敛矩阵

| 现象 | 定性 | 扣预算 | 动作 |
|---|---|---|---|
| Exit 0 且 WROTE 字节数 > 0 | STEP_OK | 否 | 写 task_receipts，释放 step_lock，dispatch 来源打 EXPLORATORY_DEGRADED |
| Exit 0 但缺 WROTE 或 0 字节 | SILENT_EMPTY_OUTPUT | 是 | 单步失败；epoch<2 允许修复，否则 blocked 并释放租约 |
| Exit 5（高温/低余量） | ENV_THROTTLED | 否 | 保持 running 与租约；30/60/120 秒退避；3 次后 blocked (DEVICE_OVERHEAT_OR_BUSY) |
| 验证期超 3.5GB / Exit 137 | VAL_OOM | 否 | 返回 passed:false，禁止 dispatch |
| 生产单步超 6.5/7.5GB | STEP_OOM | 是 | 先杀 PGID 净空；epoch<2 留 running，epoch=2 转 blocked (OOM_EXHAUSTED) |
| 其他非 0/5/137 硬错误 | FATAL_EXEC_ERROR | 否 | 立即 failed，写错误摘要，释放租约 |

## 二十一、新增变异与门禁

1. M-Pi-10 租约抢占后工具桥逃逸：人工接管后 dispatch_step 必须 403，runTask 调用次数 0。
2. M-Pi-11 跨代过期验证重放：A 验证后覆盖为 B，dispatch 必须 412 HASH_MISMATCH。
3. M-Pi-12 伪造 Exit 0 绕过 WROTE：无 WROTE 或 0 字节必须阻断 task_receipts。
4. G28 生产接线门禁：四依赖无桩检查、task_receipts 与 WROTE 账实相符 100%、内存三处数值同源（6.5/7.5/3.5）。

## 二十二、两个高危风险

1. 3.5GB 验证与 6.5GB 生产并发叠加会击穿 7.5GB：runValidationFn 也必须受 step_lock 保护，同一时刻容器内只允许一个活跃进程组。
2. Exit 5 冷却期间租约 TTL 120 秒会过期：冷却 sleep 期间心跳照常，pi_sessions 子状态置 `COOLING_DOWN_WAIT`。

## 二十三、实施状态（2026-11-15 收口）

| 项 | 状态 | 证据 |
|---|---|---|
| 四依赖接线 | 完成 | `assertLease` / `autonomyGrantsProvider` / `runValidationFn` / `dispatchStepFn` 全部绑定 |
| 适配脚本 Overlay | 完成 | `pushAdaptationScript` 经 ADB scp 到项目线 scripts/ |
| 3.5GB / 6.5GB 档位 | 完成 | 任务脚本前缀 `BIO_TASK_MEM_LIMIT_GB` 注入 |
| meta 四字段 | 完成 | `pi_step_dispatcher.test.js` 7 条 |
| 退出码矩阵 | 完成 | Exit 5 退避、137 预算、静默 WROTE 拦截 |
| M-Pi-10/11/12 | 完成 | 28 条变异 escaped=0 |
| G28 门禁 | 完成 | 29 道门禁全绿 |

---

# 第五轮判决提炼（Gemini Argon，2026-11-15）

> 原始回复见 `round-05-reply.md`（约 4,800 字）。

## 二十四、结论：分两级签发

1. **代码与契约级封板（Code Freeze & Contract Sign-Off）：PASS。** 29 道门禁、28 条变异 escaped=0、2204 用例 0 失败，四面加固闭环。
2. **全量生产放量（Full Production Go-Live）：暂不签发。** 唯一硬缺口是 BLKR-01 真机 Golden 冒烟。

## 二十五、BLKR-01 真机冒烟（唯一 Go-Live Blocker）

取最小 Line 1 Bulk RNA-seq Golden 样本（6 样本极小矩阵），连真机跑完整生命周期，同时满足四个观测点：

1. **链路全通**：D1 生成 PKG → D2 拉取解包 → 检查点一 180 秒倒计时或批准 → D4.9 经 ADB 10022 调起 `run_throttled_task.sh`（6.5GB）→ 检查点二签发 → D2 回写 done。
2. **账实相符**：容器真实回传 `WROTE '<path>' <bytes>`，`receipt/v1.task_receipts` 非空，`sentinel.archive_ed25519_sig` 与 `sentinel.receipt_ed25519_sig` 双签名验签通过。
3. **算力面同步**：真机容器内 `tools/ops/run_throttled_task.sh` 与 `core/mem_guard.py` 的物理文件哈希与仓库一致（防 REJ-003）。
4. **降级或验证分支实测**：冒烟单中触发 1 次 `run_validation`（3.5GB），或确认 `EXPLORATORY_DEGRADED` 探索版签章落入 PDF/HTML 封面与 Methods。

真机冒烟一单跑通且 29 道门禁保持全绿，即视为 Final Go-Live Approved，不需要第六轮会审。

## 二十六、封板后第一张票

`TICKET-D0-01` stdin 死亡管道与端口残留兜底（非阻塞，约 15 行）：

1. Electron 主进程 `spawn(nodeBin, ['server/index.js'], { stdio: ['pipe','pipe','pipe'] })`，保持 `child.stdin` 打开但不写入。
2. `server/index.js` 顶层 `process.stdin.resume()` 加 `end` 走优雅退出、`error` 走 exit 1。
3. 新实例挂 SQLite 前检测 `.server.lock` PID 是否存活，残留则先清理再接管。

## 二十七、两项风险裁定

1. **GSM 强校验必须只绑 GEO（中危）**：`^GSM\d+$` 仅在数据源含 GEO 或数据集 GSE 前缀时生效；自测/私有数据走通用安全标识符 `^[A-Za-z0-9_.-]{2,64}$`。已按此落地并加契约测试。
2. **`golden_regression` 不得由外部注入（低危）**：门户提交面与外部 PKG 一律无权置位；服务端宽限扫描强制 `goldenRegression=false`，豁免只留给内部 CI 构造的会话。

## 二十八、首周三指标（熔断线）

1. **租约与僵尸锁**：活跃租约数不超过 1；`step_lock` 持有超 10 分钟无心跳即告警；`blocked` 占比不超过 5%。
2. **Exit 5 热节流**：`exit5_event_rate` 不超过 15%；冷却自愈率 100%；`blocked_by_env_throttled` 为 0。越线则工单间隔从 0 秒上调到 45 秒。
3. **OOM 与适配预算**：`epoch=0` 占比不低于 80%；`epoch=2` 转 blocked 占比低于 5%；探索版交付占比不超过 20%。单模块触发 OOM 或 `epoch>=1` 超过 30% 时必须发母版升级工单。

## 二十九、本轮实装补丁（咨询后自查发现）

Gemini 未看到的一处缺口：检查点一 180 秒自动放行只有 `autoPassDuePlans` 方法，没有服务端定时器，面板也不会代批。已补：`index.js` 每 15 秒扫描一次，`grace_deadline_ms` 作为到期唯一真源，CAS 冲突单会话跳过不中断整批；并加契约测试。

## 三十、BLKR-01 真机冒烟结果（按 Gemini 指令执行）

> 完整证据见 `blkr01-evidence.md`。

1. **算力面先修后跑**：真机 R site-library 的 43,228 个文件是指向空目录的断链，`library(limma)` 不可用。用冷备卷恢复后 `limma 3.68.5` 可加载，Python venv 的 numpy / pandas / scipy / scanpy 正常。
2. **同源补齐**：真机包装器从 11 月 6 日旧版同步到仓库版；`run_throttled_task.sh` 与 `core/mem_guard.py` 两侧 SHA256 一致。
3. **生产母版真跑**：`prep_matrix` + `deg_limma` 在黄金样本上跑通，6.5GB 与 3.5GB 两档都成功，24 个显著基因，`WROTE` 字节数与磁盘一致。
4. **D1 到 D2**：门户生成 `PKG_2026-11-15_152638_BLKR01_PKG`，D2 拉取解包，门户侧 `sync_results/sync_result.json` 为 `done`。
5. **工单闭环**：`WO_BLKR01_02` 78 秒完成，4 个任务全部 exit 0，交付 5 项，验收 19 项全绿，`PRODUCTIZATION_RECEIPT_OK`。交付包 `CHECKSUMS.sig` Ed25519 验签 true。
6. **双检查点**：检查点一在第 180 秒由 `autonomy_policy` 自动放行；检查点二保持人工，`approve-targets` 后才允许 `report-signed`，最终 `delivery_grade=STANDARD_VERIFIED`。
7. **冒烟中发现并修掉的生产 bug**：执行计划的 counts/matrix 角色正则只认 `.txt/.tsv`，不认 `.csv`，导致 CSV counts 上传后 `series_matrix` 角色解析不到，`prep_matrix` 只收到 grouping 并退出 2。已加 `csv` 并补 2 条契约测试。

---

# 第六轮判决提炼（Gemini Argon，2026-11-15）

> 原始回复见 `round-06-reply.md`。

## 三十一、Final Go-Live 已签发

**V1.0 生产封板令生效，0 Blockers。** 依据：四组观测点实证闭环，2207 用例 0 失败，29 道门禁全绿，28 条变异 escaped=0。

## 三十二、签名结构裁定

1. 认可现状：交付包 `CHECKSUMS.sig` 加包内 `receipt_v1.json.ed25519_signature`，`sentinel` 保持字符串。
2. 废除第二轮“把 sentinel 改成对象放双签名”的设计，理由是破坏向下兼容，属于形式对齐制造回归。
3. 唯一要求：签名覆盖 `delivery_grade` 与 `adaptation_trace`。已落：`delivery_packager.js` 的签名载荷新增两个字段，`receipt_v1.json` 本身纳入 `CHECKSUMS.sha256`；`milestone4` 测试断言两个字段存在。

## 三十三、单会话裁定

1. 当前证据已足够封板，不要求为合并单会话重跑冒烟。
2. `[TICKET-D4.9-02]`：把 `PLAN_APPROVED` 到 DAG 下发的自动钩子接上，列为封板后第二顺位。

## 三十四、封板后三张票（严格顺位）

1. `[TICKET-OPS-01]`：K40 算力面开机自检门禁。1 秒级 ADB 探针校验 `run_throttled_task.sh` 与 `core/mem_guard.py` 哈希，执行 `library(limma)` 探活，不一致自动推送；同时固化挂载点检查或把 site-library 改为实体目录。
2. `[TICKET-D4.9-02]`：Pi 单会话与生产 DAG 胶水合龙。
3. `[TICKET-D0-01]`：Electron stdin 死亡管道防孤儿锁。

## 三十五、两项风险

1. **冷备恢复持久性（中危）**：断链可能随重启复发，必须进 OPS-01。
2. **扩展名长尾（低危）**：把 Line 2/Line 3 的角色正则与门户 14 项扩展名白名单对齐，重点 `.csv.gz`、`.tsv.gz`、`.mtx.gz`、`.h5`、`.h5ad`、`.rds`。

## 三十六、下一步

1. 打 `v1.0.0-go-live` 标签，并把 BLKR-01 的 PKG 与签名回执归档为永久基线。
2. 按顺序合入三张票，开启首周三大指标观察。

---

# 第七轮补记：Pi CLI 实装（2026-11-15）

## 三十七、Pi CLI 不存在的问题已解决

1. 原状态：`pi` 不在 PATH，`BIO_PI_CLI_BIN` 为空，`desktop/runtime/picli` 只有配置与提示词，没有可执行体。之前跑通的只是 Pi 监督器状态机，不是 Pi agent 本体。
2. 已安装 `@earendil-works/pi-coding-agent@1.5.2` 到 `desktop/runtime/picli/node_modules`，CLI 入口是 `dist/bundle/cli.js`。
3. 已建 `desktop/runtime/picli/agent/models.json` 与 `settings.json`，走 SenseNova 的 OpenAI 兼容端点 `https://token.sensenova.cn/v1`，默认模型 `sensenova/glm-5.3`。
4. `.env.local` 写入 `BIO_PI_CLI_BIN`、`PI_CODING_AGENT_DIR`、`SENSENOVA_API_KEY`，服务端启动时自动加载。
5. `pi --print --no-session` 与 `pi --mode rpc --no-session` 均已实测，RPC 返回 `finalText=OK`。

## 三十八、同时修掉 Pi RPC 的 stdin 早关 bug

`runPiRpc` 原来发送 prompt 后立刻 `stdin.end()`，真 Pi 会把它当成有序退出信号，模型还没回答就收工，实测 `finalText` 为空。已改为保持 stdin 打开，收到 `agent_settled` 后再关；助手正文从 `message_end.message.content` 的 text 片段提取。`milestone3` 的 mock 同步改为单行读取并补 `agent_settled`。

---

# 第八轮判决提炼（Gemini Argon，2026-11-15）

> 用户授权 Codex 与 Gemini 自行商定四项决策，完成前不打扰用户。原始回复见 `round-08-reply.md`。

## 三十九、四项最终裁定

1. **工具暴露**：方案 C 锁死。宿主受控 JSON Tool-Loop，单阶段上限 6 轮；Pi 以 `--mode rpc --no-session --no-builtin-tools` 无状态拉起，零 MCP、零扩展。
2. **Stage 2 自愈**：3.5GB 验证通过后，`adaptation_epoch < 2` 时允许自动 `dispatch_step`（6.5GB）；耗尽 2 次预算转 blocked，跑通后停在检查点二。
3. **擦除**：签发且本地 tar 与 `CHECKSUMS.sig` 验签为 true 后立即擦除，0 TTL，只留 `WIPE_TOMBSTONE.json`；失败入 `pending_remote_wipes`。
4. **模型降级**：默认严格 fail-closed；端点超时、5xx 或连续 2 次非法 JSON 即阻断或 blocked（`PI_ENDPOINT_UNAVAILABLE`），`DETERMINISTIC_FALLBACK` 只作管理员显式开关。

## 四十、两条微调护栏

1. **护栏 A**：自动自愈期间 `PiProposalsModal` 只读；仅在 blocked 或 HUMAN_OVERRIDE 态激活批准/驳回。任何自动 `remediate_step_param` 或 `propose_adaptation` 执行后，同事务把 `delivery_grade` 锁为 `EXPLORATORY_DEGRADED`，不可逆。
2. **护栏 B**：擦除脚本同时覆盖逻辑角色目录（`raw_data/processed/figures/results`）与工单沙箱目录（`00_input/01_work/02_output/adaptations`），以及 `/tmp/bio_val_*` 与 `/tmp/bio_adapt/*`；项目目录下除墓碑外全部清空。

## 四十一、P0/P1/P2 顺序

1. **P0**：阶段 Prompt 与清单、受控 Tool-Loop、检查点一自动入队、Stage 2 自愈。
2. **P1**：擦除脚本、签发后置钩子、M-Pi-13/14、真机端到端。
3. **P2**：便携包内置 Pi CLI、密钥安全、D0 stdin 死亡管道与 K40 哈希自检。

## 四十二、每阶段验收

1. P0：无人工点提交，Pi 在 Stage 1 调通两工具，180 秒后自动拉起 K40 跑完 4 模块，停在检查点二。
2. P1：注入单步失败，Pi 自动完成读指标、提适配、3.5GB 验证、6.5GB 下发，`adaptation_trace` 与 `EXPLORATORY_DEGRADED` 入回执；签发后四目录归零并有墓碑。
3. P2：拔掉全局 pi 与 node 后便携包仍能拉起 Pi RPC；断网 fail-closed；强杀 Electron 后 2 秒内后端退出且 SQLite 无残留锁。
