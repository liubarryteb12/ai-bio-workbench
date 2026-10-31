# S32 报告：工作台上传断点续传（R5）

- 任务：共享任务板 task-4（切片 S32），owner=s32-upload-resume
- 派发单：`con_hf/dispatch/S32_upload_resume.md`
- 项目根：`D:\00.AIagent\codespace\AI辅助生信分析流程工作台`
- 完成时间：2026-10-21
- 结论：四件事全部落地:服务端导出 `uploadStatus`、`GET /api/upload/status` 返回断点、前端从 `nextIndex` 真正续传、D5 文档漂移收敛；新增 19 条测试全绿；`npm test` 381/381 全绿（本切片开工前实测基线 346/346，本切片 +19，其余 +16 来自并行切片在窗口内合入）；`npm run build` 成功；`npx tsc --noEmit` 零错误。未连 K40、未做任何 git 写操作。

## 1. 任务理解

目标（对应架构评审 A8 / R5）：

1. **R5 断点续传名不副实**：`aims/aims.txt` 写的是「分片断点续传」，但前端 `UploadPanel` 的流程是 init → 从第 0 片循环到最后一篇 → complete，全程不查任何状态；`GET /api/upload/status` 虽已存在，只回 `{uploadId, received}`，没有「下一片该从哪开始」的信息。1-3GB 原始数据一旦断线/刷新，只能整包重传。
2. **D5 文档漂移**：aims 写 5MB 分片，实现是 4MB（`CHUNK_SIZE = 4 * 1024 * 1024`）。

要求交付四件事：

- `server/upload.js` 导出纯函数 `uploadStatus(uploadId)`（不碰远端、可单测）；
- `GET /api/upload/status` 用上述纯函数返回 `nextIndex` 等续传信息，且**向后兼容**既有 `uploadId` / `received` 键；
- `src/App.tsx` 的 UploadPanel 改成「先查 status → 从 `nextIndex` 起传 → complete」，并给出可读的续传文案；
- `aims/aims.txt` 的 5MB 与断点续传描述改成与实现一致。

验收：新增 `BioanalysDesktop/tests/upload_resume.test.js`；`npm test` fail 0 且总数 >= 346；`npx tsc --noEmit` 与 `npm run build` 均 exit 0。

约束（全部遵守）：

- 只写 `server/upload.js`、`server/index.js`（仅新增/替换 upload status handler 一段）、`src/App.tsx`（仅 UploadPanel 与上传相关类型/工具函数）、`tests/upload_resume.test.js`、本报告、以及 D5 点名的那 1 行文档。
- **未改 `CHUNK_SIZE` 语义**（仍是 4MB；前端从 `init`/`status` 返回的 `chunkSize` 读，不硬编码），D5 改的是文档而不是常量。
- 未动 S28/S29 已接线代码：`server/index.js` 的 `/api/tasks/submit` 路径预校验块与 S28 桥接检查点块原样保留；`App.tsx` 的 TaskPanel 改动原样保留。
- 未连 K40、未下发任何远端命令（测试用 ssh 垫片，且有一条用例断言 status 端点 ssh 调用计数为 0）；未 git 提交/删除文件/装包；未引入前端依赖。

## 2. 实现摘要

### 2.1 服务端 `server/upload.js`

- 新增导出纯函数 `uploadStatus(uploadId)`（`:170-219`，`export function uploadStatus` 在 `:186`）：
  - 复用 `sanitizeFilename` 消毒 id（`:192`），`'..'` / 分隔符 / 隐藏名 / 空串一律 `reason: 'invalid_id'`，**绝不把可穿越的目录路径交给调用方**；
  - `fs.statSync(dir).isDirectory()` 判存在（`:195-200`），不存在返回 `reason: 'not_found'`；
  - 复用 `listChunks` 扫描（不另写一套），再去负序号与重复（`:204`）；
  - `receivedBytes` 逐片 `statSync` 求和，单片并发被清理时跳过该片不抛（`:205-212`）；
  - `nextIndex` = **最小缺失口径**：`while (present.has(nextIndex)) nextIndex += 1`（`:213-215`）；
  - 返回值形状：`{ok, uploadId, exists, reason?, chunks, nextIndex, receivedBytes, chunkSize}`，`chunkSize` 恒为 `CHUNK_SIZE`。

### 2.2 服务端 `server/index.js`

- 导入补 `uploadStatus`（`:31`）。
- `GET /api/upload/status` handler 重写（`:1345-1368`，仍是同一段位置，未新增路由、未改其他 handler）：
  - `invalid_id` → **400** `{ok:false, error:'uploadId 非法或缺失: ...'}`；
  - `not_found` → **200** `{ok:false, reason:'not_found', exists:false, received:[], chunks:[], nextIndex:0, receivedBytes:0, chunkSize}`。刻意不用 404：前端按 `response.ok` 分流，404 会把它推进错误分支，反而不能从 0 开始；
  - 正常 → 200 `{ok:true, uploadId, exists:true, chunks, nextIndex, receivedBytes, chunkSize, received: chunks}`，其中 `received` 与 `chunks` 同内容，保留既有调用方语义。

### 2.3 前端 `src/App.tsx`（UploadPanel 现位于 `:3194`）

- 新增类型 `UploadStatus`（`:274-286`）。
- 新增会话缓存工具（`:288-325`）：`UPLOAD_ID_STORE_PREFIX` / `uploadFingerprint(project, lineId, file)`（`project|lineId|name|size|lastModified`）/ `readStoredUploadId` / `storeUploadId` / `forgetUploadId`，全部 `try/catch`（隐私模式禁用 localStorage 时退化为不跨刷新续传，不抛给用户）。
- 新增纯工具 `resumeStartIndex(status, total)`（`:327-332`）：把服务端 `nextIndex` 夹到 `[0, total]`，非数字/负数/NaN 一律回 0（宁可重传，不越界）。
- 新增 `fetchUploadStatus(uploadId)`（`:3183-3191`）：网络错、400、非 JSON 一律返回 `null`，调用方按「没有会话」处理。
- `upload` 流程重写（`:3203-3280`）：
  1. 算指纹 → 先读本地缓存的 `uploadId`；
  2. 有缓存 id 就查 status：`exists` 且有 `chunkSize` → 用它的 `nextIndex`；否则（会话已被清理/服务端重启）忘掉旧 id 走新建；
  3. 无缓存 id → `POST /api/upload/init` 拿新 id，**随后仍查一次 status**（正常 `nextIndex=0`，边界情况能兜住），再把 id 写入本地缓存；
  4. `total = Math.ceil(size / chunkSize)`，`startIndex = resumeStartIndex(...)`，循环从 `startIndex` 起；
  5. complete 后：`comp.ok || comp.validation` 说明服务端已清理暂存目录 → 删缓存 id；只有 `error`（scp 失败时服务端**不**清理）→ 保留 id，重试可直接合并；
  6. `catch` 里提示「已传分片已保留，点「继续上传」从断点续传」，按钮文案随之从「开始上传」变「继续上传」。
- UI 文案：面板顶部两条 hint（`:3287-3288`，含「同一浏览器内中断后重试（含刷新页面）会先查 GET /api/upload/status」「换浏览器或清空本地存储后需从头传」的诚实边界）；续传中显示「已从第 N 片续传（共 M 片，跳过已收 K 片）」（`:3247-3250` 设置、`:3327` 渲染）；分片已齐时显示「分片已全部就绪，直接合并...」。

### 2.4 文档 D5

- `aims/aims.txt:83`：`**分片上传器**：支持 5MB 分片断点续传并自动校验 ...` → `**分片上传器**：4MB 分片断点续传（已实现：GET /api/upload/status 查询已落盘分片，前端从 nextIndex 续传）并自动校验 Bulk 与单细胞/空间数据格式。`
- 只改这一行，未重写 aims 主体（架构评审 C3）；`docs/` 复查 `分片|上传器|断点` 零命中，无需改。

### 2.5 测试 `tests/upload_resume.test.js`（新建，348 行，19 条）

沿用 `tests/task_submit_validation.test.js` 的 in-process 起真服务范式：`freePort()` → `process.env.BAD_PORT` → `mock.method(childProcess, 'spawnSync'/'spawn')` 垫片（记录调用、永不真连 K40）→ `await import('../server/index.js')` → 轮询 `/api/health` 10s；`after()` 关连接 + 清理本文件创建的会话目录。

## 3. 文件变更清单

| 文件 | 变更 | 规模 |
| --- | --- | --- |
| `BioanalysDesktop/server/upload.js` | 新增 `uploadStatus` 纯函数（`:170-219`） | +63 / -8 行（该文件仅本切片改动） |
| `BioanalysDesktop/server/index.js` | 导入补 `uploadStatus`（`:31`）；重写 `/api/upload/status` handler（`:1345-1368`） | 本切片约 +35 行（该文件 diff 总量含 S28/S29 未提交改动） |
| `BioanalysDesktop/src/App.tsx` | 新增 `UploadStatus` 类型 + 会话缓存/续传工具（`:274-332`）+ `fetchUploadStatus`（`:3183-3191`）+ upload 流程重写（`:3203-3280`）+ 文案与按钮（`:3287-3288` / `:3312` / `:3327`） | 本切片约 +118 / -19 行（该文件 diff 同时含 S29 未提交改动） |
| `BioanalysDesktop/tests/upload_resume.test.js` | 新建，19 条测试 | 新文件 348 行 |
| `aims/aims.txt` | 第 83 行 D5 漂移修正 | +1 / -1 行 |
| `con_hf/dispatch/S32_report.md` | 本报告 | 新文件 |

未改动（已核对）：`server/task.js`、`server/run.js`、`server/report.js`、`server/selfcheck.js`、`server/ledger.js`、`portal/`、`shared/`、`ops/`、`src/line*/`、`docs/`、其他任何测试文件、`package.json`。`npm run build` 会重写 `dist/`（构建产物，未跟踪），属预期副作用。

## 4. 接口与交互实现说明

### 4.1 续传口径（与 `assembleChunks` 既有判定对齐，未自造规则）

`nextIndex` 取**最小缺失口径**：从 0 开始第一个不存在的分片序号。`assembleChunks` 要求 `0..N` 连续，两种口径在 `[0,1,3]` 上分别给 3 / 2:给 2 才能既补齐空洞又不让已收的 3 白占；且 `writeChunk` 是覆盖写，重写同一片幂等（有专门用例）。代码注释（`server/upload.js:173-178`）与测试断言（「有空洞 [0,1,3] -> nextIndex 2」）写的是同一口径。

### 4.2 为什么前端必须缓存 `uploadId`

`POST /api/upload/init` 每次生成新的 `randomUUID`（`server/index.js:1286` 附近，本切片未改）。如果只按派发单字面的「init 后先查 status」，每次重试都会拿到一个空目录的新 id，status 永远 `nextIndex=0`:续传在真实断线场景下等于没做。因此实现是「init 后查 status」+「用 `localStorage` 记住 `文件指纹 → uploadId`」，重试（含刷新页面）先按旧 id 查，只有会话确实不存在时才重新 init。指纹含 `size` 与 `lastModified`，同名不同内容的文件不会误续传。这是本切片对派发单的一处必要加强，已在第 6 节标为假设/风险。

### 4.3 前后端契约

```
GET /api/upload/status?uploadId=<id>
  400 {ok:false, error}                                    uploadId 缺失/非法（'..'、分隔符、隐藏名）
  200 {ok:false, reason:'not_found', uploadId, exists:false,
       received:[], chunks:[], nextIndex:0,
       receivedBytes:0, chunkSize:4194304}                 从未 init 或已被清理
  200 {ok:true, uploadId, exists:true, chunks:[...], nextIndex, receivedBytes,
       chunkSize, received:[...]}                          received 与 chunks 同内容（向后兼容）
```

### 4.4 交互流程（UploadPanel）

```
选文件 → 开始上传
  → 读 localStorage 缓存 id
     ├─ 有 → GET status
     │        ├─ exists → nextIndex 来自服务端
     │        └─ 不存在 → 删缓存，走 init
     └─ 无 → POST init → GET status（正常 nextIndex=0）→ 缓存 id
  → total = ceil(size/chunkSize)，从 nextIndex 起逐片 POST /api/upload/chunk
  → POST /api/upload/complete
     ├─ ok 或 validation 存在 → 服务端已清理暂存 → 删缓存 id
     └─ 只有 error（scp 失败）→ 保留缓存 id，重试直接合并再 scp
  → 任一步抛错 → 文案「已传分片已保留，点「继续上传」从断点续传」，按钮变「继续上传」
```

## 5. 测试与验证记录

### 5.1 新增 19 条（`tests/upload_resume.test.js`）

- **纯函数（8 条）**：空会话；连续三片 `[0,1,2]`→3 与 `receivedBytes` 求和；空洞 `[0,1,3]`→2；缺第 0 片 `[1,2]`→0；脏文件名（`abc.part`/`notes.txt`/`1.part.part`/`-1.part`）被忽略且不影响判定；6 种路径穿越 id 全部 `invalid_id`；合法但不存在 → `not_found`；`CHUNK_SIZE === 4*1024*1024` 且 status 回报同值。
- **真 HTTP（5 条）**：缺 `uploadId`→400；`../etc`→400；从未传过→200+`not_found` 且 `received` 键存在；已传 0,1→200+`nextIndex:2`+`received:[0,1]`（向后兼容）；**status 端点 ssh 垫片调用计数为 0**。
- **HTTP 端到端（1 条）**：`POST init` → `POST chunk 0,1` → status `nextIndex=2`、`receivedBytes=8` → 从 2 补片 → status `nextIndex=3`、`receivedBytes=12` → `assembleChunks` 得 `AAAABBBBCCCC`。
- **本地端到端（5 条）**：init→0,1→status=2→补 2→assemble，**md5 与完整文件一致**；续传写入次数 = `total - nextIndex` 且最终 `[0,1,2,3,4]`；重写同一片幂等（`AAAABBBB` 而非 `AAAABBBB BB`）；空目录 assemble 仍报「没有任何分片」（既有行为不变）；测试会话可清理。

### 5.2 验证命令与尾行原文

`npm test`（cwd=`BioanalysDesktop`）：

```
ℹ tests 381
ℹ suites 0
ℹ pass 381
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
TEST_EXIT=0
```

本切片开工前同一命令实测基线：`ℹ tests 346 / ℹ pass 346 / ℹ fail 0 / EXIT=0`（380 → 381 的漂移来自并行切片在窗口内继续合入，非本切片）。

`node --test tests/upload_resume.test.js`：

```
ℹ tests 19
ℹ pass 19
ℹ fail 0
RESUME_EXIT=0
```

`npm run build`：

```
dist/index.html                   0.41 kB │ gzip:  0.31 kB
dist/assets/index-CcAp5K3Y.css   15.32 kB │ gzip:  3.40 kB
dist/assets/index-CID-vhHg.js   218.14 kB │ gzip: 71.34 kB
✓ built in 674ms
BUILD_EXIT=0
```

`npx tsc --noEmit`：

```
TSC_EXIT=0
```

### 5.3 失败与修复

- 本轮无失败用例（新文件首跑即 18/18，补 HTTP E2E 后 19/19；`tsc` 与 `build` 首跑即 0）。
- 唯一的设计返工：最初按派发单字面实现「init → status → 从 nextIndex 传」时发现 init 每次新 uuid 使续传恒为 0，改为「缓存 uploadId 后先查 status、无缓存才 init」（第 4.2 节），并在报告第 6 节如实标注为假设/风险。

## 6. 假设与风险

1. **续传依赖浏览器 localStorage**（本切片最大假设）：换浏览器、清站点数据、隐私模式下 `localStorage` 不可用时，只能从头传。UI 文案已明说边界，未假装「任意设备可续传」。
2. **指纹不含文件内容**：`name|size|lastModified` 相同但内容不同的文件（例如原地覆盖同名文件且时间戳一致）理论上会复用旧会话。概率极低，且 assemble 后服务端仍做格式校验与字节数校验，不会静默产出错误数据；若要更强，需加 sha256（代价是上传前整文件读一遍 1-3GB，不可接受）。
3. **陈旧会话无 TTL**：`.uploads/<uuid>/` 在 complete 成功/校验失败时被 `cleanupUpload` 清理，但用户中途放弃且不重试的会话会一直占磁盘（**既有行为**，本切片未扩范围做 GC）。1-3GB 数据下长期累积有实际风险，见第 7 节建议。
4. **scp 失败（complete 500）时不清理**：服务端既有行为（失败分支 `return` 在 `cleanupUpload` 之前），本切片利用它实现「scp 失败后重试直接合并」；但若用户换浏览器，这部分磁盘同样滞留。
5. **`/api/upload/status` 不校验 method**：GET/POST 都会进同一分支（既有风格，本切片未改）。副作用仅是可缓存性差，已在 `:1345` 注释中说明。
6. **前端续传分支无自动化测试**：`uploadFingerprint` / `resumeStartIndex` 等是 `.tsx` 模块私有函数，`node --test` 无法 import；未引入浏览器测试依赖（约束禁止装包）。覆盖手段为 `tsc` + 代码审阅 + 服务端等价 HTTP E2E（init→chunk→status→补片→assemble）。这是本切片测试覆盖的真实缺口，不掩饰。
7. **`uploadDir` 既有宽松消毒**（只剥非 `[A-Za-z0-9._-]`，`'..'` 能通过）未修：属既有代码，且 `uploadStatus` 走的是更严格的 `sanitizeFilename`；修它会牵动 init/chunk/complete 三条既有路径与既有用例，超出 S32 范围，见第 8 节。

## 7. 架构/接口变更建议

1. **会话 GC**：给 `.uploads/` 加 TTL（例如按目录 mtime 超 24h 清理），在服务启动与 init 时各跑一次；否则 1-3GB 数据的放弃会话会把磁盘吃满。优先级最高。
2. **确定性 uploadId**：让客户端用 `sha256(project|line|name|size|lastModified)` 前缀作为 uploadId 提交给 `init`，服务端 `init` 做成幂等（目录已存在就复用）。这样可以彻底去掉 localStorage 依赖，续传变成跨浏览器/跨设备可用。需改 `init` 语义，建议单开切片。
3. **complete 失败结构化返回**：scp 失败时返回 `{ok:false, canResume:true, error}`，前端不必靠「有 error 无 validation」推断是否保留 id。
4. **status 加 `Cache-Control: no-store`** 并补 method 校验（GET only）。
5. **修 `uploadDir` 消毒**（见 6.7）：与 `sanitizeFilename` 统一，加一条路径穿越回归用例。

## 8. 待主 Agent 决策事项

1. **5MB 还是 4MB**：本切片按派发单把文档改成 4MB（`CHUNK_SIZE` 语义明确不许动）。若产品确实要 5MB，需要改常量 + 全部相关断言（本切片测试已把 4MB 钉死），建议单开切片而不是顺手改。
2. **会话 GC 是否排进下一轮**（第 7.1 条）：这是本切片遗留的真实磁盘风险，需要主 Agent 排期。
3. **确定性 uploadId 是否做**（第 7.2 条）：做了才能摘掉 localStorage 假设，属于接口语义变更，需决策。
4. **`uploadDir` 宽松消毒是否修**（第 6.7 条）：既有代码，修了要回归 init/chunk/complete 既有用例。

## 9. 建议下一步

1. 下一轮（建议 S33）做「会话 GC + complete 失败结构化返回」:两者都不改既有对外形状，风险低、收益直接。
2. 再下一轮评估「确定性 uploadId + 幂等 init」，摘掉 localStorage 假设，同时天然解决跨浏览器续传。
3. 若引入浏览器测试（playwright 等）需装包，属约束外，等主 Agent 决定后再排；在那之前前端续传分支只能靠 tsc + 审阅 + 服务端 HTTP E2E 兜底。
4. 把 `uploadDir` 消毒与 `sanitizeFilename` 统一作为一次小的安全收敛，附路径穿越回归用例。
