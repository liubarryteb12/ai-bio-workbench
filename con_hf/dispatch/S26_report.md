# S26 报告 · 台账 8KB 静默截断 P0 修复 + 测试端口动态化

派发单：切片 S26（2026-10-20）
文件域（派发单）：BioanalysDesktop/server/run.js、tests/index.test.js、tests/run.test.js（只增不改）
文件域扩展（见 §6.1）：tests/auth.test.js（端口同源问题，延用 freePort 先例，仅改端口来源）

## 0. 任务理解

1. P0：`persistEntry` 把整个台账 JSON base64 后拼进 `ssh k40-ubuntu '<command>'` 单行 argv，
   71 outputs 条目命令 10,117 字符，超 ~8KB 截断阈值 → base64 解出半截 JSON 仍 exit 0 →
   「WROTE」照印 → 台账静默丢失（S18R §9 P0-2，spatial_figures 台账数=0 实测）。
   修复：payload 改走 ssh stdin；远端回 `WROTE <path> <bytes>` 标记，本地校验字节数。
2. P1：`tests/index.test.js:18` 硬编码 `PORT = 18787`，与本机无关进程（PID 28256，实测占用中）相撞即 8 条 FAIL。修复：改 `freePort()`（照 portal_submit.test.js 先例）。
3. 同类隐患排查：检索服务端所有「大 payload 拼进 ssh 命令行」调用点，列清单上报，只修台账一处。
4. 新增 ≥4 条测试（run.test.js 只增不改）；`npm test` 247/247 全绿；K40 真 E2E。

## 1. 进度台账（每步更新）

- [x] 读契约 / S18R §9 / run.js / 测试现场
- [x] 环境确认：项目根**非 git 仓库**（无 diff 可附，改动清单见 §7）；18787 被 PID 28256 占用（netstat 实测）；K40 ssh 可达（BatchMode 实测 `K40_OK`）
- [x] 任务项 1：P0 复现（先红，真 K40，§2）
- [x] 任务项 2：run.js stdin 传输 + 硬校验（§3）
- [x] 任务项 3：同类隐患清单（§4）
- [x] 任务项 4：index.test.js 端口动态化（+ 域外 auth.test.js 同源问题，见 §6.1）
- [x] 任务项 5：新增 4 条测试 + npm test 251/251 全绿（§5）
- [x] 任务项 6：K40 真 E2E 12/12 PASS（§5.1）

## 2. 复现证据（任务项 1，先红再改）

脚本：`cn_debug/2026-10-20_s26_p0_repro.mjs`（复刻修复前 run.js:167 命令公式，remotePath 指向 /tmp 不碰 system_logs）+ `cn_debug/2026-10-20_s26_ssh_threshold_probe.mjs`。对真 K40 实测：

- 梯度探测：命令长 8000 完整到达（`echo x*8000 | wc -c` → `wc=8001`）；**8231 起 `| wc -c` 被切掉**，`echo` 的 x 串直落 stdout 且 exit=0 —— 与 S18R §8-2「8,231 起截断」完全一致。
- 台账形态复现（71 outputs entry）：
  ```
  R1 | 命令长度 = 9114 字符（8KB=8192 阈值）
  R1 | payload base64 长度 = 9004，是否整段拼进 argv: 是（风险形态）
  R3 | 旧命令公式含字节数校验(wc -c): 否 —— 无校验，exit 0 即当成功
  R2 | exit=0, stdout="ewogICJ0YXNrX2lkIjogInMyNi1yZXByby0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwIiwK..."（半截 base64 直落 stdout，`| base64 -d` 已被截掉）
  R2 | 远端文件缺失 —— 静默丢失坐实（exit 0 但什么都没写下来）
  ```
  即：exit 0、无 WROTE、无文件、旧 runSsh 会当成功 —— 与 S18R 现场一致。
  （首跑曾出现一次 exit 255 Connection closed，重跑即复现静默截断，属链路抖动非稳定症状。）

## 3. 实现说明（任务项 2/4）

**server/run.js**（接口兼容：`buildLedgerWriteCommand` 保留导出与 `{command, remotePath}` 返回形态，语义改 stdin 方案；`persistEntry` 由私有改为导出，供垫片测试）：

1. `buildLedgerWriteCommand`：命令改为
   `mkdir -p '<SYSTEM_LOGS>' && base64 -d > '<remotePath>' && echo WROTE '<remotePath>' $(wc -c < '<remotePath>')`
   —— payload **不再进 argv**（命令行长度恒定 ~150 字符，不随 outputs 增长）；base64 由 `runSsh` 经 ssh stdin 写入（stdin 无 8KB 限制）。引号规则不变（既有「重定向加引号」断言原样通过）。
2. `persistEntry`（新导出）：payload = `JSON.stringify(entry, null, 2)` 的 UTF-8 字节；落盘后做**双硬校验**——stdout 必须含 `WROTE '<remotePath>' <bytes>` 标记，缺失即 reject；`bytes` 必须等于 `payload.length`，不符即 reject（错误信息含「疑似半截写入」）。成功路径返回值 `{path, output}` 形态不变；runTask 中 rejection 仍走 `.catch` 显式回报 stderr 的既有护栏（2026-10-13 性质保留，未改断言）。
3. `runSsh(command, stdinPayload = null)`：非 null 时 `child.stdin.end(payload,'utf8')` 并兜住 stdin `error` 事件（ssh 早退 EPIPE 不打死进程，退出码路径照旧 reject）。
4. spawn 由具名导入改默认导入（`childProcess.spawn`）：实测 ESM 具名导入是链接期快照，改写 exports 对象对具名导入无效（探针：赋值后具名 `spawn` 仍走真实实现），node:test 的 `mock.method` 只能拦默认导入形态。行为无差异。

**tests/index.test.js**：删硬编码 `PORT = 18787`，改 `freePort()`（`net.createServer()` listen(0) 取空闲端口再关，照 portal_submit.test.js 先例）。BAD_PORT 环境变量传递方式不变。

**tests/run.test.js**：文件末尾**追加** 4 条用例（既有断言零改动，追加前内容逐字未动）：
1. `S26: 长台账（71 outputs）payload 走 stdin，ssh argv 不含 payload` —— argv < 1024 字符且不含 payload 片段；假 ssh 垫片拦截 spawn，断言 stdin 收到完整 base64（与 `JSON.stringify(entry,null,2)` 的 base64 逐字符相等）、命令为最后一个 argv。
2. `S26: 远端未回 WROTE 标记 → persistEntry 必须 reject`（模拟截断后 exit 0 无回执的真实症状）。
3. `S26: 远端回执字节数与 payload 不符 → reject（疑似半截写入）`。
4. `S26: 千级 outputs 命令行仍恒定短小`（1000 outputs，argv 仍 < 1024）。

垫片要点：假子进程在 stdin `finish` 后先回放 stdout 再 **setImmediate** 发 `exit`（实测同步发 exit 会抢在 Readable data 事件之前，runSsh 按空输出判定）。

**tests/auth.test.js**（域外扩展，见 §6.1）：`PORT = 18788` 同样改 `freePort()`，鉴权断言零改动。

## 4. 同类隐患清单（任务项 3，只修台账一处）

| # | 调用点 | 形态 | 长度是否随数据增长 | 8KB 风险判断 | 建议 |
|---|---|---|---|---|---|
| 1 | `server/run.js` persistEntry（旧） | base64 payload 拼进 ssh argv | 随 outputs 数增长（71 → 9,114+ 字符） | **高危（已修，本切片）** | 已改 stdin |
| 2 | `server/project.js` `buildCreateProjectCommand`（index.js:652 建项目调用） | base64(project.json) 拼进 argv 后 `base64 -d > metaPath` | 随 project.json 体积增长（v3 需求单含 plotLayoutConfig/wgcnaConfig/experimentalDesign，大 meta 完全可能超 8KB） | **高危**：同样静默截断（有 CREATED 回执检查，但截断时 CREATED 段被切 → 表现为建项目 500，且可能落半截 meta） | 建议另立切片：同 stdin 方案（runSsh 需提升为可复用模块或复制同型函数） |
| 3 | `server/task.js` `buildTaskScript`（run.js:43 / index.js 提交） | inputs/outputs 逐个 `--input/--output 'path'` 拼进 ssh argv | 随 inputs/outputs 数增长（71 outputs × ~75 字符 ≈ 5.3KB + 头部） | **中高**：outputs 更多的步骤（图件类声明 ≥ 100 个）必越 8,231 阈值；截断后整条任务命令残废 | 建议另立切片：脚本经 `ssh ... bash -s` 走 stdin |
| 4 | `server/pull.js` scp 多文件（pull.map 拼 `SSH_TARGET:remoteDir/name`） | scp argv | 随文件数增长（71 张图 ≈ 8KB） | **低中**：scp 不经远端 shell 解析，限制是本地 Windows CreateProcess ~32KB；当前量级安全，超限时报错可见（非静默） | 暂不动；超 200 文件再考虑分批 |
| 5 | `server/index.js` runRemote 各调用点（ls/stat/find/base64 读台账/df/meminfo 等） | 固定短命令，路径来自 sanitize 后参数 | 否 | **低** | 不动 |
| 6 | `server/link.js` checkContainer / `server/ssh.js` | 固定命令 | 否 | **低** | 不动 |
| 7 | `server/upload.js` | 无 ssh/scp 调用（本地分片落盘） | — | 无 | 不动 |

（#2/#3 是否立项由主 Agent 裁决；本切片未改这些文件。）

## 5. 测试与验证记录

| 验证 | 命令 | 结果 |
|---|---|---|
| P0 复现（红） | `node cn_debug/2026-10-20_s26_p0_repro.mjs`（真 K40） | exit 0 + 半截 base64 + 无 WROTE + 无文件（§2） |
| 阈值探测 | `node cn_debug/2026-10-20_s26_ssh_threshold_probe.mjs` | 8000 完整 / 8231 起截断，与 S18R 一致 |
| 全量测试 | `npm test`（BioanalysDesktop） | **ℹ tests 251 / pass 251 / fail 0**（= 247 基线 + 4 条 S26 新增；18787 被 PID 28256、18788 被 PID 6104 占用状态下运行，端口修复同获验证） |
| run.test.js 单套 | `node --test tests/run.test.js` | 14/14 全绿（既有 10 条断言原样通过 + S26 4 条） |
| K40 E2E | `node cn_debug/2026-10-20_verification_s26_ledger_e2e.mjs`（自带临时服务实例跑当前代码，不碰 8787 常驻实例） | **12/12 PASS**，见 §5.1 |

### 5.1 E2E 明细（真 ssh K40，default/line2_scrna/scrna_figures，seed=20261018）

```
PASS | 临时服务实例就绪（当前代码） | http://127.0.0.1:7743
PASS | 远端输入 scrna_deg.h5ad 在位
PASS | outputs 声明 ≥ 40 | 真实 38 张 + 占位 7 = 45
PASS | 任务下发 | default-line2_scrna-1792502189001
PASS | 任务结束（25 分钟内）
PASS | 台账文件已落盘且可 JSON.parse | /mnt/ssd/bio_data/system_logs/2026-10-20_default_line2_scrna_scrna_figures_c1da2284.json
PASS | io_files.output 长度与声明一致 | 台账 45 vs 声明 45
PASS | seed 字段 = 20261018 | 实际 20261018
PASS | line_id / step_name / project_id 一致 | default/line2_scrna/scrna_figures
PASS | status=completed 且 exit_code=0
PASS | 远端台账字节数与 JSON 长度一致（无半截） | remote=5049
PASS | 服务端 stderr 无 [ledger] 落盘失败行（WROTE/bytes 校验未拒绝）
```

远端台账抽查：task_id=c1da2284，start/end 2026-10-20T13:16:29→13:16:55（26s），outputs 首=`l2_01_umap_celltype.png` 尾=`l2_e2e_pad_07.png`，checkpoint=passed，environment=Python 3.12.3。任务重渲染后远端 figures/ 仍 38 png（确定性重跑，集合未变）；自动回搬后本地 outputs/default/line2_scrna/figures/ = 38。临时服务 stderr 日志：`cn_debug/2026-10-20_s26_e2e_server_stderr.log`（无 [ledger] 行）。

WROTE 标记证据口径：标记由 persistEntry 内部硬校验（缺失/bytes 不符即 reject → stderr `[ledger] 台账落盘失败`），台账完整落盘 + stderr 无失败行 = 运行时通过证据；拒绝分支由 run.test.js 垫片用例 2/3 覆盖。

## 6. 假设与风险 / 待主 Agent 决策

1. **文件域扩展（待追认）**：`tests/auth.test.js:18` 硬编码 18788 被无关进程（PID 6104）占用 → 7 条 FAIL，与 index.test.js 同一类 P1，且阻塞 A6 全绿。本切片已征询主 Agent 但无应答，按用户「工程取舍由我拍板」授权顺带修复（仅改端口来源为 freePort，鉴权断言零改动），在此记录请求追认。
2. run.js spawn 具名导入改默认导入：行为无差异（探针证实具名导入对 exports 改写免疫），是为了让 mock.method 可拦截；无其他代码依赖该导入形态。
3. E2E 台账里 7 个 `l2_e2e_pad_XX.png` 是透明占位声明（scrna_figures 忽略 --output 参数，声明不影响执行），default/line2 台账历史会留有一条含占位声明的记录——按派发单「outputs ≥ 40」口径执行，特此说明。
4. 8787 常驻实例（PID 26256）**仍在跑旧代码**：重启服务才能让常驻面享受修复，属运维动作，未擅自执行，待主 Agent 安排。
5. 项目根非 git 仓库，无 git diff 可附；改动文件清单见 §7。

## 7. 文件变更清单

- `BioanalysDesktop/server/run.js`（stdin 传输 + 双硬校验 + spawn 默认导入）
- `BioanalysDesktop/tests/index.test.js`（端口动态化）
- `BioanalysDesktop/tests/run.test.js`（只增：4 条 S26 用例 + 垫片）
- `BioanalysDesktop/tests/auth.test.js`（域外扩展：端口动态化，待追认）
- `cn_debug/2026-10-20_s26_p0_repro.mjs`、`cn_debug/2026-10-20_s26_ssh_threshold_probe.mjs`、`cn_debug/2026-10-20_verification_s26_ledger_e2e.mjs`、`cn_debug/2026-10-20_s26_e2e_server_stderr.log`

未触碰：8787 常驻实例、`portal/`、`ops/`、`src/`、`server/figures.js`、`server/project.js`、`server/task.js`、`docs/`、processed 数据、K40 容器环境。
