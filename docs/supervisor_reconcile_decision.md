# 生产引擎接入监督器：决策与适配方案（2026-10-25）

## 现状事实（已核实）

1. `BioanalysDesktop/server/run.js` 的 `runTask` 用 `childProcess.spawn('ssh', ...)` 常驻连接
   执行远端命令，`child.on('exit')` 拿退出码写台账，`code !== 0` 一律记 `failed`。
2. 任务经 `ops/run_throttled_task.sh` 执行，该 wrapper 在
   `/mnt/ssd/bio_data/system_logs/_running/<task_id>.json` 写运行中标记，
   正常结束写完台账后删除；异常终止会残留（pitfalls P-23）。
3. 远端 `_running/` 当前 0 残留，标记机制本身工作正常。
4. `run_throttled_task.sh` 内置 `find _running -mtime +7 -delete` 清理 7 天前残留。

## K40 算力面的核心风险

手机 SSH 链路不稳（本轮多次遇到 `Connection closed by 127.0.0.1 port 10022`）。
长任务如 SCENIC 需 4 分钟以上，`runTask` 的常驻 ssh 一旦断开：

- 引擎收到 exit，退出码为 255 或 null，记成 `failed`。
- 但远端任务可能仍在运行，或已跑完并写出产物。
- 引擎此时会把「链路抖动」误报成「任务失败」，用户看到的是假失败。
- 反向情况也存在：引擎认为还在跑，远端其实已被 Android Phantom Process Killer 杀死。

## 决策

接入点选 **`runTask` 的 exit 回调之后、台账判定之前**，形态为**独立回收模块**，
不侵入引擎主流程与既有测试。

理由：K40 场景下真正缺的不是「跑任务」，而是「任务状态与远端真相对账」。
引擎已有 `onExit(code)`，但没有一步去问远端「你到底活没活、产物出没出」。
在 exit 回调处插入一个 reconcile 步骤，用远端 `_running` 标记 + 产物存在性
两个独立信号判定真实状态，就能把假失败纠正为真失败或真成功。

不选在 task.js 状态机轮询里做：那会让引擎在任务运行期间反复 SSH 探活，
对手机链路是额外负担，且与既有 SSE 流式模型冲突。

## 实现范围（本期）

新增 `BioanalysDesktop/server/reconcile.js`，导出纯函数 + 一个同步执行器：

1. `classifyRemoteState({ exitCode, runningMarkers, expectedOutputs })`
   纯函数，输入退出码、远端 `_running` 标记列表、期望产物存在性，输出：
   - `completed`：exit 0 或产物齐备
   - `link_lost_still_running`：exit 非 0 但 `_running` 有本任务标记
   - `link_lost_output_present`：exit 非 0、标记已消失、但产物存在
   - `failed`：exit 非 0、标记消失、产物缺失
   - `unknown`：信号不足，不猜
2. `reconcileTask(entry, remoteProbe)` 同步执行器，调一次远端只读命令取信号，
   返回修正后的台账字段（status、checkpoint_status、reconcile_note）。
3. 在 `run.js` 的 `child.on('exit')` 里，`buildLedgerEntry` 之后调用 reconcile，
   仅当判定为 `link_lost_*` 时改写 status 并追加 `reconcile_note` 字段；
   `failed` 与 `completed` 保持原判，不改既有行为。

## 明确不做（本期）

- 不做任务重试。重试是策略层决策，需用户确认，且重复跑 SCENIC 级别任务代价高。
- 不改 `run_throttled_task.sh`。标记机制已验证可用，动它风险大于收益。
- 不做前端展示改造。reconcile 结果先落台账，前端后续再接。
- 不引入轮询循环。一次性对账，符合 K40 链路负担约束。

## 验收

- 纯函数单测覆盖四种判定加 unknown，用 `node --test` 在 K40 实跑。
- 用现有 `ops/run_k40_node_test_workspace.ps1` 通道验证，不新增 SSH 通道。
- 台账自审计（ledger.js）必须仍通过：新增 `reconcile_note` 字段要先确认
  `auditLedgerEntry` 不会因未知字段拒绝，若拒绝则该字段走 error_log 而非新字段。

## 遗留风险

- 远端只读命令本身也可能因链路抖动失败，此时 reconcile 必须返回 `unknown`
  并保持原判，绝不把「探不到」升级成「已失败」。
- `_running` 标记只在任务经 wrapper 时存在，直跑模式没有信号，此时只能靠产物判断。
