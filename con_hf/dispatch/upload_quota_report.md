# task-8 交付报告：.uploads 总量配额 + 上传链路错误体统一

- 负责人：teammate upload-quota
- 日期：2026-10-21
- 任务板：task-8（claim 时 revision 3，完成时见文末）
- 改动文件（全部落在我的 write_scopes 内）：
  - BioanalysDesktop/server/upload.js
  - BioanalysDesktop/server/index.js
  - BioanalysDesktop/tests/upload_quota.test.js（新增）
  - con_hf/dispatch/upload_quota_report.md（本文件）
- 未碰：src/App.tsx、src/lib/、server/report.js、ops/。未 git add / commit / push。
- 由 Lead 代为同步的一处（见「遗留事项」）：BioanalysDesktop/tests/upload_session.test.js:277-286 的 deepEqual 期望值。

## 1. 改动清单

### A. .uploads 总量配额（server/upload.js）

| 项 | 内容 |
|---|---|
| 新增常量 | `DEFAULT_UPLOAD_QUOTA_BYTES = 20 * 1024 * 1024 * 1024`（20GiB = 21474836480） |
| 新增导出 | `uploadQuotaBytes(env = process.env)` |
| 新增内部函数 | `sessionUsageBytes(dir, name, fsImpl, errors)` |
| 改造 | `gcStaleUploads` 增加 `quotaBytes` 参数与第二阶段（配额淘汰）；报告新增 5 个字段 |
| 透传 | `maybeGcStaleUploads(options)` 原样把 options（含 quotaBytes）转交 `gcStaleUploads` |

环境变量只选一个：**BIO_UPLOAD_QUOTA_BYTES（字节）**。没有同时提供 GB 变体，避免出现两个可信来源（配了 GB 又配 Bytes 时以谁为准没有正确答案）。`uploadQuotaBytes` 对缺省、空串、纯空白、非数字、负数、NaN、Infinity、超出 Number 范围的值一律回落默认值；显式 `0` 视为合法配置（语义为「一个会话都不收」），不被当作非法值。小数按 `Math.round` 取整。

配额统计口径（server/upload.js:382-415 的 `sessionUsageBytes`）：累加会话目录下**普通文件的 size**，不取 `statSync(dir).size`。理由写进了代码注释：`dir.size` 在 Linux 常见文件系统上只是目录项自身大小（ext4 上长期恒为 4096，只随目录项数量增长），与里面装了多少数据无关，拿它当配额等于没配。只扫一层，因为本模块往会话目录写的全是扁平文件（`initUpload` 建目录、`writeChunk` 写 `<index>.part`、`assembleChunks` 写合并后的原文件），不会建子目录。单次 readdir / stat 失败按 0 字节计并记 `errors`：宁可低估占用，也不能因为一次测量失败把用户正在传的会话删掉。

第二阶段淘汰逻辑（server/upload.js:504-536）：

1. 第一阶段（TTL）语义完全不变，只把幸存会话从「直接 push 进 kept」改为收集进局部 `survivors` 数组，末尾再统一算 kept；
2. 对 survivors 逐个测量占用，求和得 `totalBytes`；
3. `totalBytes > quotaBytes` 时，取 `now - mtimeMs >= GC_MIN_INTERVAL_MS` 的会话（即**非活跃**）按 `mtimeMs` 升序（mtime 相同按名字）淘汰，每淘汰一个就从 `totalBytes` 里扣掉它的占用，直到不超配额或没有可淘汰对象；
4. 活跃会话（`now - mtimeMs < GC_MIN_INTERVAL_MS`）一律不淘汰：它正在被写入，删掉等于丢用户数据。宁可超配额也不能删。这类会话计入 `kept`，并在 `report.active` 里单列，便于运维看清「为什么清了还超」；
5. 淘汰的 rm 失败只记 `errors` 并继续尝试下一个，不中断。

报告字段语义（9 个键，在**所有**返回路径上都齐备，包括 ENOENT 早返回与 readdir 报错早返回）：

- `scanned` / `removed` / `kept` / `errors`：沿用旧语义，`removed` 只装第一阶段（TTL）删掉的会话；
- `evicted`：第二阶段淘汰掉的会话 id，与 `removed` 互斥；
- `totalBytes`：第二阶段测量到、清理完成后**仍然存活**的会话总占用字节（淘汰后的值，不是淘汰前）；
- `quotaBytes`：本次生效的配额；
- `overQuota`：清完仍然超配额（`true` 表示没得可删了，磁盘压力还在）；
- `active`：存活且判定为活跃的会话。

### B. 上传链路错误体统一（server/index.js）

新增单一出口（server/index.js:212-224）：

```js
function uploadError(res, status, message) {
  return json(res, status, { ok: false, error: String(message ?? '') });
}
```

四个上传端点的 4xx/5xx 全部改走它：

- `POST /api/upload/init`（:1253-1300）：JSON 解析失败、lineId 非法、projectId 非法、filename 非法、fingerprint 非法（消息文本一字未改：`fingerprint 非法：必须是 <=1024 字符的字符串且不含控制字符`）、initUpload 抛错 500；
- `POST /api/upload/chunk`（:1325）：writeChunk 抛错 400；
- `GET /api/upload/status`（:1342）：invalid_id 400；
- `POST /api/upload/complete`（:1365-1399）：JSON 解析失败、lineId 非法、projectId 非法、assembleChunks 失败 400、scp 失败 500。

成功响应体一个字节没动：chunk 200 仍是 `{ok:true, index, received}`，complete 200 仍是 `{ok, validation, remotePath, localSize, remoteSize, sizeMatch, hint}`，status 200 仍是 `{ok:true, uploadId, exists, chunks, nextIndex, receivedBytes, chunkSize, received}`（含向后兼容的 `received`），status 的 not_found 仍是 200 + `{ok:false, reason:'not_found', received:[]}`。

### C. init 的配额拒绝（行为变化，需要重点评审）

`maybeGcStaleUploads()` 之后新增闸门（server/index.js:1282-1291）：

```js
const gcReport = maybeGcStaleUploads();
if (gcReport && gcReport.overQuota === true) {
  return uploadError(res, 507,
    `上传暂存空间已满：当前占用 ${gcReport.totalBytes} 字节，超过配额 ${gcReport.quotaBytes} 字节；`
    + `请等待进行中的上传完成或清理旧会话后重试`);
}
```

**状态码选 507（Payload Too Large）而不是 400**，理由：

- 请求本身是合法的（参数、fingerprint、lineId、projectId、filename 全部通过了校验），用户改请求参数也解决不了问题；
- 失败原因是服务端存储配额耗尽，这正是 507 的语义（RFC 4918 定义它是「存储配额不足导致无法处理」）；
- 400 会暗示「客户端请求有误」，把运维问题伪装成调用方 bug，前端与用户都会被误导去改不该改的东西；
- 507 是 5xx，天然落在前端的错误分支里，不会与现有的 400 参数校验混淆。

防御性：`gcReport` 可能为 `null`（`maybeGcStaleUploads` 自己吞掉所有异常并返回 `null`），所以先做真值判断再读 `overQuota`，清理异常永远不会把上传端点打成 500。

错误体同时给出当前占用字节数与配额字节数，前端可以直接展示，不必猜。

## 2. 测试

新增 BioanalysDesktop/tests/upload_quota.test.js，24 个用例，node --test，分四段：

- **A（5 个）**：配额常量默认值、`uploadQuotaBytes` 的 env 覆盖与非法回落、显式 0 合法；
- **B（6 个）**：第一阶段 TTL 语义不回退（超 ttl 删、`age === ttlMs` 留、点段/含分隔符/隐藏名/散落文件一律不碰、单会话 stat 或 rm 失败只记 errors、UPLOAD_ROOT 不存在与 readdir 报错的空状态九键齐备）；
- **C（11 个）**：第二阶段配额（最旧优先淘汰、活跃会话不淘汰且单列 active、全是活跃会话时宁超配额也不删、可淘汰对象清完仍超配额、淘汰 rm 失败不阻断下一个、测量失败按 0 计、真临时 root 写真文件按真实字节求和、`maybeGcStaleUploads` 透传 quotaBytes）；
- **D（4 个）**：真 HTTP（init 超配额回 507 + `{ok:false,error}` 且错误体含字节数、init 配额正常时不误伤、四个端点各至少一条错误体形状断言、status 200 not_found 成功体不变）。

离线保证：D 段把 `childProcess` 的 `spawnSync` / `spawn` 全部垫片并计数，每个用例断言 `childCalls.length === 0`，即没有任何真实 ssh/scp。init 的配额用例把配额压到 32 字节并在 UPLOAD_ROOT 下种一个 64 字节的活跃会话，`after()` 里统一清理。

## 3. 真实命令输出（未加工）

### node --check（两个改动文件）

```text
$ node --check server/upload.js
EXIT=0
$ node --check server/index.js
EXIT=0
```

### node --test tests/upload_quota.test.js

```text
$ node --test tests/upload_quota.test.js
[bioanalys-desktop] backend listening on http://127.0.0.1:3624
[bioanalys-desktop] adb = C:/adb/platform-tools/adb.exe
✔ A: 默认配额 20GiB（20*1024^3 = 21474836480） (0.9562ms)
✔ A: uploadQuotaBytes 无 env 回落默认 (0.1526ms)
✔ A: uploadQuotaBytes 合法 env 覆盖（含小数四舍五入） (0.1671ms)
✔ A: uploadQuotaBytes 非法值回落默认（空串/非数字/负数/NaN/Infinity/超范围） (0.1491ms)
✔ A: uploadQuotaBytes 允许 0（一个会话都不收）这是显式配置而非非法值 (0.1631ms)
✔ B: TTL 语义不变：超过 ttl 删、age===ttl 留、点段/含分隔符/隐藏名不碰 (3.9097ms)
✔ B: 非法目录名（点段/含分隔符/隐藏名）与散落文件一律不碰 (0.5141ms)
✔ B: UPLOAD_ROOT 不存在：正常空状态，且报告九键齐备 (0.5874ms)
✔ B: readdir 非 ENOENT 失败：只记 errors 不抛，报告九键齐备 (0.3293ms)
✔ B: 单会话 stat 失败只记 errors，不影响其余会话 (0.4953ms)
✔ B: 单会话 rm 失败只记 errors，其余会话照常处理 (0.3819ms)
✔ C: 超配额按 mtime 最旧优先淘汰，直到降到配额内 (0.616ms)
✔ C: 活跃会话（now - mtime < GC_MIN_INTERVAL_MS）不淘汰，计入 kept 并单列 active (0.3412ms)
✔ C: 全是活跃会话：宁可超配额也不删，overQuota=true 且 active 列出全部 (0.336ms)
✔ C: 可淘汰对象清完仍超配额：overQuota=true，剩余全为活跃会话 (0.339ms)
✔ C: 淘汰 rm 失败只记 errors 并继续尝试下一个 (0.3384ms)
✔ C: 会话内 readdir 失败：占用按 0 计并记 errors，不会误删 (0.3074ms)
✔ C: 真临时 root：写真文件，占用按真实文件字节求和 (8.4286ms)
✔ C: maybeGcStaleUploads 把 quotaBytes 透传给 gcStaleUploads (3.0269ms)
✔ C: GC_MIN_INTERVAL_MS 与 isSafeUploadId 常量仍可导入（回归） (0.1182ms)
✔ D: init 配额超限（活跃会话占满）=> 507 + {ok:false,error}，错误体含占用与配额字节数 (46.784ms)
✔ D: init 配额正常时可以创建会话（不误伤） (4.8524ms)
✔ D: 四端点错误体统一为 {ok:false,error}（init / chunk / status / complete 各至少一条） (49.3434ms)
✔ D: 成功响应体不变（status 200 not_found 仍带 received 与 ok:false） (12.7742ms)
ℹ tests 24
ℹ suites 0
ℹ pass 24
ℹ fail 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 294.3567
```

### npm test（全量）

```text
$ npm test
...
✔ A: 默认配额 20GiB（20*1024^3 = 21474836480） (2.1173ms)
✔ D: init 配额超限（活跃会话占满）=> 507 + {ok:false,error}，错误体含占用与配额字节数 (74.0184ms)
✔ D: 四端点错误体统一为 {ok:false,error}（init / chunk / status / complete 各至少一条） (52.3991ms)
✔ D: 成功响应体不变（status 200 not_found 仍带 received 与 ok:false） (5.2149ms)
ℹ tests 486
ℹ suites 0
ℹ pass 486
ℹ fail 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4297.1836
```

基线对比：task-8 派单时基线 453；Lead 提交 task-9/task-10 后为 462；本次新增 24 个用例后为 **486**，全绿。（Lead 侧同步 tests/upload_session.test.js 的那 5 行不计入新增用例数。）

### 风格自检（LF / 破折号）

```text
server/upload.js CRLF=0 EMDASH=0
server/index.js CRLF=0 EMDASH=0
tests/upload_quota.test.js CRLF=0 EMDASH=0
```

## 4. 新测试抓到的真实缺陷

写测试过程中发现并修掉了 server/upload.js 里一个只在配额淘汰路径上触发的崩溃：淘汰 rm 失败时的 warn 用了作用域内不存在的标识符 `name`（应为 `item.name`），会抛 `ReferenceError: name is not defined`。这条路径旧代码里不存在，是本任务新加的，没有测试就发现不了。已修为 `item.name`，测试用例「C: 淘汰 rm 失败只记 errors 并继续尝试下一个」专门覆盖。

## 5. 行为变化与兼容性（需要 Lead 合并时知悉）

1. **init 可能回 507**：仅在 .uploads 存活总占用超过配额且没有可淘汰会话时发生。前端 src/App.tsx:3213 是 `if (init.error) throw new Error(init.error)`，只读 `error` 字段，会直接把消息抛给用户，不影响渲染逻辑。
2. **complete 的 500 响应体少了 validation 与 localSize 两个字段**：scp 失败时旧代码回 `{error, validation, localSize}`，为满足「所有 4xx/5xx 走统一形状」改为 `{ok:false, error}`。src/App.tsx:3252-3253 读的是 `comp.error` / `comp.ok` / `comp.hint`，不读 `validation` / `localSize`，前端不受影响；这是本次统一形状的必然代价。
3. **init / chunk 的 4xx 响应体多了 `ok:false`**：新增字段，纯增量，前端不读。
4. **gcStaleUploads 报告多了 5 个字段**：只影响对该报告做整体 `deepEqual` 的测试（仓库里只有 tests/upload_session.test.js 一处，已由 Lead 同步）；其余使用方按字段名读取，不受影响。
5. **GC 报告里 totalBytes 是清理后的存活占用**，不是清理前的测量值。这是有意的：调用方（init 闸门）关心的是「清完之后还剩多少」，据此判断是否拒绝新会话。

## 6. 遗留事项与边界

- **tests/upload_session.test.js:277-286 由 Lead 同步**：该文件不在我的 write_scopes 内，但 `gcStaleUploads` 报告新增字段后，原有的整报告 `deepEqual(report, {scanned, removed, kept, errors})` 会因键集变严而失败。我已把需要改的一行同步给 Lead，由 Lead 落地（改动为 import `DEFAULT_UPLOAD_QUOTA_BYTES` 并把期望值补上 5 个零值字段）。本次全量 486/486 已包含该同步后的结果。
- **BioanalysDesktop/README.md:55 记录了 BIO_UPLOAD_TTL_HOURS 默认 24h**：README 不在我的 write_scopes 内，未追加 BIO_UPLOAD_QUOTA_BYTES 的说明。建议 Lead 合并时补一行「BIO_UPLOAD_QUOTA_BYTES 默认 20GiB」。
- **启动时的一次全量 GC**（server/index.js:1645-1657）未显式传 quotaBytes，走 `gcStaleUploads` 的默认参数 `uploadQuotaBytes()`，即同样读环境变量。行为一致，无需改动。
- **配额是「软闸门」**：只在 init 入口检查，不限制单个 chunk 的大小（chunk 上限仍是 `CHUNK_SIZE * 2`）。也就是说已经通过 init 的会话可以把磁盘写到超过配额，第二阶段 GC 要等到该会话的 mtime 老过 `GC_MIN_INTERVAL_MS`（10 分钟）才会淘汰它。这是为了不删正在写入的数据而有意接受的设计边界，不是缺陷。
- **配额淘汰不看项目/归属线**：.uploads 是三条分析线（line1_bulk / line2_scrna / line3_spatial）共用的暂存区，淘汰按 mtime 全局最旧优先，不保证某个项目的会话一定活着。若后续需要「每项目保底配额」，要在报告里再加维度，属新任务。
- **未验证项**：K40 远端链路（scp 实际落盘）未在本任务中跑，测试全程垫片；配额数字只在小配额（32/60/80 字节）下验证，20GiB 默认值只验证了常量与取整，没有真写 20GiB 数据。
- **环境清理**：调试用的探针临时文件（BioanalysDesktop/err.txt、out.txt）已删除，`git status` 干净，只剩上述 4 个预期改动。
