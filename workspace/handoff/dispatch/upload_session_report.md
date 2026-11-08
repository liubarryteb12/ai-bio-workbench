# upload-session 切片报告（task-6）

切片范围：确定性 uploadId（前后端同一纯函数）+ `.uploads` 陈旧会话 GC + 前端续传逻辑可测化。

## 改了什么

### 1. `shared/upload_session.mjs`（新增，205 行，零依赖 ESM）

全仓唯一权威定义，前端、服务端、测试都从这里取：

- `uploadFingerprint({project, lineId, name, size, lastModified})` -> `project|lineId|name|size|lastModified`（:164）。字段里的 `%` 转义为 `%25`、`|` 转义为 `%7C`，数字用 `Math.trunc`，非负有限数以外的值归 `0`，缺字段归空串/0，保证同一输入永远同一指纹。
- `uploadIdFromFingerprint(fp)` -> `'up-' + sha256(fp).slice(0,16)`（:181），空指纹返回 `''` 由调用方回落 randomUUID。
- `isSafeUploadId(id)`（:197）：只允许 `[A-Za-z0-9._-]`、长度 1..128，拒绝 `.` / `..` / 任何含 `..` / 以 `.` 开头的隐藏名。服务端目录判定、GC 过滤、前端缓存校验共用这一个函数。
- `sha256Hex`（:76）自带同步 SHA-256（TextEncoder + 手写 UTF-8 兜底），不 import `node:crypto`，所以浏览器与 node 都能用。

### 2. `BioanalysDesktop/server/upload.js`（改 3 处 + 新增 GC 段）

- `uploadDir`（:144）改为严格版：不过 `isSafeUploadId` 直接返回 `null`。旧实现会先剥掉非法字符再判定，`'a/b'` 被静默改写成 `'ab'`，指向另一个会话目录；现在由调用方报 400。
- `resolveUploadId`（:170）三条分支：请求里出现 `fingerprint` 键就必须是 1..1024 字符、不含控制字符的字符串，否则 `{uploadId:'', reason:'invalid_fingerprint'}`（显式 `null` / 空串也算非法，避免客户端算错指纹时悄悄回落 UUID）；否则 `size` + `lastModified` 都是非负有限数时用同一纯函数重算指纹再派生（兼容脚本/老客户端）；都没有才 `randomUUID()`，`deterministic:false`。
- GC 段（:344-455）：`DEFAULT_UPLOAD_TTL_HOURS=24`（:353）、`GC_MIN_INTERVAL_MS=10min`（:356）、`uploadTtlMs(env)`（:359）读 `BIO_UPLOAD_TTL_HOURS`（正数小时，非法值回落 24h）、`gcStaleUploads({root,now,ttlMs,fsImpl,logger})`（:380，返回 `{scanned,removed,kept,errors}`）、`resetUploadGcThrottle`（:428）、`maybeGcStaleUploads`（:440）。
- GC 口径：只看 `UPLOAD_ROOT` 一级目录且目录名必须过 `isSafeUploadId`；`now - mtimeMs <= ttlMs` 保留（`age === ttlMs` 也不删）；`UPLOAD_ROOT` 不存在（ENOENT）按正常空状态返回；单目录 stat/rm 失败只进 `errors`，rm 失败额外 `logger.warn`，绝不抛；`maybeGcStaleUploads` 用模块级 `lastGcAt` 节流，任何异常 catch 后返回 `null`。

### 3. `BioanalysDesktop/server/index.js`（只改上传 handler 与 import）

- import 区（:36）补 `resolveUploadId, gcStaleUploads, maybeGcStaleUploads`；`node:crypto` 只剩 `timingSafeEqual`（`randomUUID` 移进 upload.js）。
- `POST /api/upload/init`（:1291-1343）：参数校验之后调 `resolveUploadId`（:1317），空 id 返回 400 `fingerprint 非法：必须是 <=1024 字符的字符串且不含控制字符`（:1326）；随后 `maybeGcStaleUploads()`（:1330，放在校验之后、建目录之前，清理失败不影响请求）；响应新增 `deterministic` 字段（:1339），其余字段与旧契约一致。
- `server.listen` 之前跑一次启动 GC（:1696-1708），`try/catch` 只打日志，不影响启动。
- `/api/tasks/submit` 区域（:1451 起）未触碰。

### 4. `BioanalysDesktop/src/lib/uploadSession.ts`（新增，132 行，只用可擦除语法）

- 从 `../../../shared/upload_session.mjs` 导入并转出 `UPLOAD_ID_PREFIX / isSafeUploadId / uploadFingerprint / uploadIdFromFingerprint`，前端与服务端共用同一实现。
- `UPLOAD_ID_STORE_PREFIX='bioanalys.uploadId.'`（:22）、`UploadStatus` 类型（:25）、`StorageLike` 最小接口（:40）、`browserStorage()`（:50，非浏览器/隐私模式返回 `null`）、`fileFingerprint`（:60）、`readStoredUploadId`（:80，缓存值必须过 `isSafeUploadId` 否则当损坏）、`storeUploadId`（:95，返回 boolean）、`forgetUploadId`（:110）、`resumeStartIndex`（:126，夹到 `[0, total]`，非数/负数/非有限一律 0）。
- 全部 storage 访问包 `try/catch`：隐私模式写不进去只退化为「不跨刷新续传」，不影响上传。

### 5. `BioanalysDesktop/src/App.tsx`

- 顶部新增 `import { fileFingerprint, forgetUploadId, readStoredUploadId, resumeStartIndex, storeUploadId, uploadIdFromFingerprint } from './lib/uploadSession'` 与 `import type { UploadStatus }`（:6-9）。
- 删除原来内联的 `UploadStatus` 类型、会话缓存函数、`resumeStartIndex`（原 :274-332），改为说明注释。
- upload 流程（:3167-3259）：`fingerprint = fileFingerprint(project, lineId, file)` -> `deterministicId = uploadIdFromFingerprint(fingerprint)` -> 先 `fetchUploadStatus(deterministicId)` 命中即续传（未命中置 null）-> 再用 `readStoredUploadId` 的旧 randomUUID 做一次升级兼容探测（`legacyId !== deterministicId` 且 `exists` 才用，否则 `forget`）-> 都没有才 `POST /api/upload/init`（body 带 `fingerprint`）-> 再查一次 status -> 仅当 `uploadId !== deterministicId` 时写 localStorage -> 从 `resumeStartIndex` 开始补传。
- complete 之后：`comp.ok || comp.validation` 时 `forgetUploadId`（scp 失败保留 id 以便直接重试合并）。
- 提示文案（:3268）改为「上传会话 id 由「项目 + 归属线 + 文件名 + 大小 + 修改时间」确定性派生，刷新、换浏览器、换设备都会先查 GET /api/upload/status，从已落盘分片之后继续；服务端 24 小时没动过的会话会被自动清理。」

### 6. `BioanalysDesktop/tests/upload_session.test.js`（新增，564 行，31 个 test）

- A 段 6 个：`sha256Hex` 与 `node:crypto` 逐条对拍（空串/中文/emoji/55/56/64/1000 字符）；指纹格式与数字取整；`%`/`|` 转义不撞指纹；id 确定性/前缀/长度/空串；`isSafeUploadId` 白名单边界。
- B 段 8 个：直接 `import '../src/lib/uploadSession.ts'`（Node 24 类型擦除），覆盖与 shared 指纹一致、随 size/lastModified/name/project/line 变化、`resumeStartIndex` 12 个边界、Map 假 storage 读写、缓存损坏 4 种退化、storage 抛异常退化、`storeUploadId` 拒绝非法值、node 下 `browserStorage() === null`。
- C 段 12 个：GC 全部注入临时 root 或假 fs（TTL 边界 `age===ttl` 保留、`ttl+1ms` 删；真文件系统 `mkdtemp` + `utimesSync` 造 mtime；ENOENT 不记错；stat/rm 失败只记 errors；节流 1/1/2 次 readdir；logger 抛异常被吞；`resolveUploadId` 三分支 + 非法指纹；`uploadTtlMs` 6 组；`uploadDir` 严格版）。
- D 段 6 个：in-process 真服务（`freePort` + `childProcess.spawn/spawnSync` 垫片 + `/api/health` 轮询），验证带同一 fingerprint 两次 init 得同一 id 且 `deterministic=true`、status `nextIndex=0`；size 或 lastModified 变化得到不同 id；只给 size+lastModified 与带指纹派生同一 id；都不给回落 UUID 且 `deterministic=false`；非法 fingerprint（数字 / `null` / 含 NUL / 1025 字符）400 且不返回 uploadId；`mock.method(fs,'readdirSync')` 抛 EACCES 时 init 仍 200 且确认 GC 被触发。全程 `childCalls.length === 0` 断言，不真连 K40。

## 为什么

- **确定性 id**：原来的 uploadId 是服务端 `randomUUID()`，前端只能把 id 存在 localStorage，刷新换浏览器就丢，同一个文件要重传。把「项目 + 归属线 + 文件名 + 大小 + 修改时间」用纯函数派生 id，前后端各算一次就一致，续传不再依赖浏览器本地状态；size/lastModified 进指纹保证「同名但内容已变」不会误续传旧会话。
- **HTTP 契约兼容**：不带 `fingerprint` 的请求仍走原 `randomUUID` 路径，响应只多一个 `deterministic` 字段（旧调用方忽略），脚本与老前端零改动。
- **GC**：中断上传会永久留下 `<uploadId>/` 目录，既占磁盘又让「这个 id 还有没有分片」失真。会话目录 mtime 随每个分片写入刷新，所以 `mtime < now - ttl` 就是可靠的「没人动了」信号。启动跑一次 + init 惰性触发（10 分钟节流），成本是每 10 分钟一次 `readdir`；清理是旁路动作，任何失败都只能记日志，绝不能把上传请求变成 500。
- **前端逻辑可测化**：原来 `uploadFingerprint / resumeStartIndex / localStorage 缓存` 都是 App.tsx 里的模块私有函数，node --test 无法 import .tsx，只能靠浏览器手测（S32 报告第 5 节如实记录过这个洞）。抽到 `src/lib/uploadSession.ts` 后 node 直接 import（类型擦除），指纹稳定性、nextIndex 夹取、缓存损坏退化全部变成自动断言。
- **严格 id 判定**：`isSafeUploadId` 同时用于目录创建、GC 过滤、前端缓存校验，避免 `..` 跳出上传根，也避免脏缓存触发无效请求。

## 验证尾行原文

新测试文件单独跑（`cd BioanalysDesktop && node --test tests/upload_session.test.js`）尾行原文：

```
ℹ tests 31
ℹ suites 0
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 280.6084
```

全量（`cd BioanalysDesktop && npm test`，即 `node --test tests/*.test.js`）尾行原文：

```
ℹ tests 445
ℹ suites 0
ℹ pass 445
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4424.2157
```

说明：全量 445 里包含本切片新增的 31 个，其余增量来自并行切片（task-5 `server/tumor_blacklist.js`、task-7 `server/ledger.js`）；本切片落地前的基线是 397/397。全量 0 fail 说明并发改动与上传切片互不干扰。

类型检查（不构建，只做只读检查）：`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` 退出码 0，无输出。说明 App.tsx 的新 import、`src/lib/uploadSession.ts` 与 `shared/upload_session.mjs` 的 JS 导入都能通过 tsc（`allowJs` 生效）。

自检：本切片新增/改动的文件全部 LF（CRLF=0）；新增文件 em dash 计数 0；`server/upload.js` 与 `server/index.js` 里剩余的 em dash 都在未改动的既有注释里（upload.js:327、index.js:334/1455/1537/1558）。

## 已知边界

1. **vite dev 下前端 import 仓库根 `shared/*.mjs` 会被 403**（本切片唯一「不修就不完整」项）。`src/lib/uploadSession.ts` 从 `../../../shared/upload_session.mjs` 导入，`npm run build` + `npm start` 正常（vite 打包会把它内联），但 `npm run dev` 下 vite 的 `server.fs.allow` 默认只含 `BioanalysDesktop` 根，请求仓库根的 shared 文件会 403。修法在 `vite.config.js`（不在本切片 write scopes），见「建议改动」第 1 条。
2. **确定性 id 冲突概率**：sha256 前 16 hex = 64 bit，同项目文件量下可忽略；不同项目/归属线已经在指纹字段里区分。
3. **客户端指纹依赖 `File.lastModified`**：复制/同步工具改了 mtime 会被当成新文件重传（这是预期行为，宁可重传不误续传）。
4. **服务端信任客户端给的 fingerprint 字符串**（只在「只给 size+lastModified」时自己重算）：如果以后改指纹算法，旧会话会找不到，但 24h 后自动被 GC 收敛，不会永久残留。
5. **TTL 粒度**：mtime 精度 + 10 分钟节流，最坏情况陈旧会话多留约 24h10min；`BIO_UPLOAD_TTL_HOURS` 可覆盖。
6. **GC 只处理 `.uploads` 一级目录**，且只碰合法 id 的目录；普通文件、非法名、隐藏目录一律不动。
7. **启动 GC 是同步的、在 listen 之前**：`.uploads` 目录数极大（十万级）时会拖慢启动，当前规模可忽略。
8. **localStorage 只保留升级兼容用途**：确定性 id 由指纹现算不落盘；隐私模式下写不进去只退化为不跨刷新续传。
9. **GC 单测不对共享 `.uploads` 跑小 TTL**：`node --test` 各文件是并行进程且共用 `UPLOAD_ROOT`，对真根跑清理会误删别的测试文件的会话，所以 GC 行为测试全部注入临时 root/假 fs（已写进测试文件头注释）。
10. **未做磁盘配额**：`.uploads` 没有总量上限，只有 TTL 清理。

## 建议改动（范围外，请 Lead 落地）

1. **必改**：`BioanalysDesktop/vite.config.js` 增加 `server.fs.allow`，让 dev server 能读仓库根的 shared 模块，例如：

   ```js
   import { defineConfig, searchForWorkspaceRoot } from 'vite';
   // ...
   server: {
     port: 5173,
     strictPort: true,
     proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
     // allow 里的相对路径按项目根（BioanalysDesktop）解析，'..' 即仓库根；
     // 保留 searchForWorkspaceRoot 是为了不丢掉 vite 的默认白名单。
     fs: { allow: [searchForWorkspaceRoot(process.cwd()), '..'] },
   },
   ```

   注意 `vite.config.js` 是 ESM（package.json `type: module`），不要用 `__dirname`；上面的写法不需要任何 path 计算。

   不加这一条，`npm run dev` 打开页面时 `shared/upload_session.mjs` 请求 403，前端模块加载失败（build/start 不受影响）。因为本切片被要求不碰范围外文件，这里只上报不动手。
2. 可选：README / 部署文档补 `BIO_UPLOAD_TTL_HOURS` 与 `/api/upload/init` 的 `fingerprint` / `deterministic` 字段说明（目前只在代码注释里）。
3. 可选：`/api/upload/init` 的 400 错误体是 `{error}`，而 `/api/upload/status` 是 `{ok:false, error}`。统一会让前端错误处理更省事，但会动既有调用方，建议单列切片，不在本切片顺手改。
4. 可选：`src/App.tsx` 里 4 处既有 em dash（1378/2192/2511/2532）属于历史代码，本切片未动；若要全仓符合「不用 em dash」规范，可单独清理。
5. 可选：若担心 `.uploads` 被大文件占满，可加「总量上限 + 超限拒绝新会话」策略，需要新的 env 与错误码，建议单列。
