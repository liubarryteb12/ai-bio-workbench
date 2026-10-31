[派发单 · 切片 S20] 子 Agent 任务：portal 上传上限调 5GiB + 每角色 5 + 流式写盘（用户已拍板）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\portal\serve.mjs
     （`handleDataFileUpload` 126-180 行是改造主体）
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\portal\lib\archive.mjs
     （`MAX_DATA_BYTES` 29 行、`MAX_DATA_FILES_PER_ROLE` 32 行及其注释）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\tests\portal_submit.test.js
     与 `BioanalysDesktop/tests/portal_archive.test.js`（契约护栏，一个不许红）
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【并行约束】另一子任务正在改 `portal/index.html`（S19），**你不要碰 index.html**。

【背景（用户 2026-10-20 拍板，全盘采纳主 Agent 建议）】
现行 `MAX_DATA_BYTES = 1 GiB` 已实测挡过真实客户数据（IS 项目 line3 的 tar 原始包
1.89GB，见 `con_hf/handoff.md:2471`）；且 `handleDataFileUpload` 用
`chunks.push()` 把整个文件攒在内存再 `Buffer.concat` 落盘:上限调大便等于
把 OOM 风险同比放大。本次一并解决。

【主 Agent 已定死的改动规格（不许自行更改）】

1. `portal/lib/archive.mjs:29`
   `MAX_DATA_BYTES = 1024 * 1024 * 1024` → **`5 * 1024 * 1024 * 1024`（5 GiB）**。
   同步更新该行上的注释：删掉"留 1 GiB 余量"的旧描述，改为记录
   "2026-10-20 用户拍板 5 GiB；依据：单细胞/空间 RAW tar 常见 1-3GB，
   IS 项目 line3 实际 1.89GB"。
2. `portal/lib/archive.mjs:32`
   `MAX_DATA_FILES_PER_ROLE = 3` → **`5`**。注释补明："仅约束 `other` 角色；
   其余角色由 validateDataFiles 硬编码为每角色 1 个"。
3. `portal/lib/archive.mjs` 顶部新增环境变量覆盖（**默认值必须是 5 GiB**）：
   ```js
   export const MAX_DATA_BYTES = Number(process.env.PORTAL_MAX_DATA_BYTES) > 0
     ? Number(process.env.PORTAL_MAX_DATA_BYTES)
     : 5 * 1024 * 1024 * 1024;
   ```
   （命名沿用 `PORTAL_PORT`/`PORTAL_INBOX` 既有约定。此覆盖**只为让超限负路径
   可被真测**，不改变默认行为；`validateDataFiles` 与 serve.mjs 都已 import 该常量，
   天然同步生效。）
4. `portal/serve.mjs` 的 `handleDataFileUpload` 改为**流式写盘**，硬要求：
   - 用 `fs.createWriteStream` 边收边写；**禁止再把整个文件攒进数组**
     （改完后函数内不得再有 `chunks`/`Buffer.concat`）。
   - 累加字节数，超过 `MAX_DATA_BYTES` 时：`req.destroy()` + 销毁写流 +
     **删掉半成品文件**（`fs.rmSync(target, { force: true })`，别留垃圾占盘）+
     返回 400。
   - 必须等写流 `finish` 后才回 200（否则响应先于文件落全，客户端会拿到
     不完整的 `path`）。
   - 客户端中途断传（`req` 在 `end` 前触发 `close`/`aborted`）：同样删半成品，
     且不得再往已发出的响应里写东西。
   - 写流出错：删半成品 + 500，error 文案保持既有格式
     `写入数据文件失败: <message>`。
   - 其余行为**一字不变**：入参校验（sid/role/name/扩展名）、
     "同 sid 下同角色先删旧的"那段逻辑（**照抄，不要修**，
     它是既有语义，另有一条 latent 问题见任务项 7）、
     `uniqueInDir` 碰撞追加 `_2`、成功响应 `{ok:true, name, path, size}`
     （`path` = `uploads/<sid>/<落盘名>`，`size` = 实际写入字节数）、
     以及 `console.log('[user-portal] 收到数据文件: ...')` 日志行。
   - 超限 400 的文案：把现在这个 `Math.round(MAX_DATA_BYTES / 1024 / 1024) + 'MB'`
     （5GiB 会显示成莫名的"5120MB"）改成人类可读：**`单文件超过上限 5GiB`**
     （环境变量覆盖时按覆盖值如实显示，如 `单文件超过上限 1MiB`）。
     `portal/lib/archive.mjs:130` 那条 `体积 ${size} 字节超过单文件上限 ${MAX_DATA_BYTES}`
     的文案**不要动**（有测试依赖其子串）。
5. **严禁改动的**：`MAX_BODY`（1MB，/api/submit 的 JSON 体上限）、
   `REF_MAX_BYTES`/`REF_MAX_FILES`（参考文献 20MB/5 篇）、`DATA_ROLES`、
   `DATA_EXT`、`/api/references`、`handleSubmit` 任何逻辑、`portal/index.html`。

【任务项】
1. 按上面规格改 `archive.mjs` 与 `serve.mjs` 两处（共 3 个代码点 + 2 条注释）。
2. 改前先 `grep -rn "单文件超过上限\|超过单文件上限\|other 角色最多\|写入数据文件失败\|读取上传内容失败\|上传内容为空" BioanalysDesktop/tests/`，
   把命中清单贴进取舍；任何被测试断言依赖的文案子串必须原样保留。
3. `node --check portal/serve.mjs && node --check portal/lib/archive.mjs`。
4. `cd BioanalysDesktop && npm test` 必须 **237/237 全过**（一个不许红；
   `portal_archive.test.js:181` 用 `MAX_DATA_BYTES + 1` 算 size，会自动跟着新值走）。
5. 写验证脚本 `cn_debug/2026-10-20_verification_s20_upload_limit.mjs`
   （起真进程、打真 HTTP，照 `portal_submit.test.js` 的做法：空闲端口 +
   临时 `PORTAL_INBOX`），必须覆盖：
   - **正路径**：上传一个 64MB 随机文件（`train_matrix` + bind 合法 GSE），
     断言 200、`size` 正确、**落盘文件 md5 与源一致**（流式写全的硬证据）。
   - **超限负路径**：起服务时设 `PORTAL_MAX_DATA_BYTES=1048576`（1MiB），
     上传 4MiB → 断言 400、error 含 `单文件超过上限 1MiB`、
     **且 uploads/<sid>/ 下没有残留半成品文件**。
   - **空文件**：0 字节 → 400 `上传内容为空`（既有行为不破）。
   - **扩展名拒绝**：`.exe` → 400 且不落盘（既有行为不破）。
   - **内存有界性**（"调大上限不吃内存"的直接证据）：正路径那个 64MB 上传前后，
     用 `powershell -NoProfile -Command "Get-Process -Id <pid> | Select -Expand WorkingSet64"`
     （或等价手段）读 portal 进程 RSS，断言**增量 < 64MB**
     （流式写盘的判据：RSS 不随文件体积增长）。取不到就明确写「未验证」并说明原因，
     **不许编数**。
   - **全链路**：再 POST `/api/submit` 带 `dataFiles` 断言 `PKG_*` 包生成、
     `raw_data/` 内文件 md5 与源一致、`package_manifest.json` 计数正确
     （确认流式改造没破坏归档链路）。
   脚本要能重复跑（幂等，用完清临时目录）。
6. 真服务冒烟：对**正在跑的 8080 portal**（`node portal/serve.mjs`，PID 5968）
   **不要重启**（它在服务真实收件箱）；只 `/health` 探活 + 确认代码文件语法通过即可。
   若需验证新上限在默认配置下生效，用脚本起独立端口的实例验证，
   并在回报里写明"默认配置（无 env）下 MAX_DATA_BYTES = 5368709120 字节"
   的实测输出（打印常量即可）。
7. 汇报时**单独列一条观察（不要修）**：`serve.mjs` 里"同 sid 下同角色只留一个"
   那段用 `n.startsWith(\`${role}__\`)` 找旧文件，但 `uniqueInDir(dir, name)`
   落盘的文件名**不带 role 前缀**，所以该过滤实际匹配不到任何文件:
   即"同角色重复上传先删旧的"目前是失效的（下游 `validateDataFiles`
   会在提交时以"角色只允许一个文件"拦住，所以不产生错误交付，只是上传目录会留垃圾）。
   这是既有 latent 问题，本切片不改，只上报给主 Agent。
8. **每完成一步就更新一次 `con_hf/dispatch/S20_report.md`**（硬要求）。

【硬性禁止】
- 禁止改 `portal/index.html`（S19 并行在改）、任何测试文件、`ops/`、`src/`、
  `BioanalysDesktop/`。
- 禁止改 `MAX_BODY`、`REF_MAX_*`、`DATA_ROLES`、`DATA_EXT`、`handleSubmit`。
- 禁止把整个文件读进内存（改完后不得有 `Buffer.concat(chunks)` 用于数据文件）。
- 禁止修任务项 7 的 latent 问题（上报即可）。
- 禁止重启生产 8080 服务。
- 禁止把"应该不占内存"写成已验证；RSS 必须实测或明确标注未验证。

【验收标准】
A1 `MAX_DATA_BYTES` 默认 5 GiB（5368709120），支持 `PORTAL_MAX_DATA_BYTES` 覆盖。
A2 `MAX_DATA_FILES_PER_ROLE` = 5，注释已更新。
A3 `handleDataFileUpload` 无整文件内存累积；超限/断传/出错三条路径都删半成品。
A4 响应时序正确（finish 后才回 200），64MB 文件 md5 逐字节一致。
A5 超限负路径 400 + 无残留 + 文案含覆盖值。
A6 RSS 增量 < 64MB 的实测证据（或明确未验证 + 原因）。
A7 `npm test` 237/237 全过；两个 `node --check` 通过。
A8 全链路 `/api/submit` → `PKG_*` 包 md5 一致。
A9 latent 问题已单独上报且未修。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
