[派发单 · 切片 S22] 子 Agent 任务：portal 前端 4 处硬编码上限与 S20 新值对齐（1GiB/3 → 5GiB/5）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\portal\index.html（**你只改这一个文件**）
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\portal\lib\archive.mjs
     （服务端新上限的权威来源：`MAX_DATA_BYTES` / `MAX_DATA_FILES_PER_ROLE`）
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【并行约束】S20 正在改 `portal/serve.mjs` 与 `portal/lib/archive.mjs`，
**你绝对不要碰这两个文件**；也不要碰任何测试、`ops/`、`src/`、`BioanalysDesktop/`。

【背景（主 Agent 已实测）】
S20 把服务端上限改为：`MAX_DATA_BYTES` = **5 GiB**（`5 * 1024 * 1024 * 1024`，
支持 `PORTAL_MAX_DATA_BYTES` 环境变量覆盖，默认 5 GiB）；
`MAX_DATA_FILES_PER_ROLE` = **5**（仅约束 `other` 角色）。
但 S19 写的 `portal/index.html` 把旧值**硬编码在前端**，共 4 处，现在全是过期值：

| 行 | 现状 | 问题 |
|---|---|---|
| 395 | 文案「同一角色只保留一个文件（other 最多 **3** 个）……单文件上限 **1 GiB**」 | 两个数字都过期 |
| 412 | hint「……单文件上限 **1 GiB**」 | 过期 |
| 1186 | `var MAX_DATA_BYTES = 1024 * 1024 * 1024;` | 前端预检常量，与服务端不一致（服务端已 5 GiB） |
| 1337 | `'单文件超过上限 ' + Math.round(MAX_DATA_BYTES / 1024 / 1024) + 'MB'` | 由过期常量推导，5GiB 会显示成莫名的"5120MB" |

**后果**：用户在前端看到"1 GiB"上限，服务端实际收 5 GiB:前端预检会**提前拒绝**
服务端本来能收的文件（如 2GiB 的 tar），属于"前端比服务端严"的阻断性不一致。

【主 Agent 已定死的改动规格（不许自行更改）】
1. `index.html:1186` 的常量改为 **`5 * 1024 * 1024 * 1024`**，并在该行上方加注释：
   `// 与服务端 portal/lib/archive.mjs 的 MAX_DATA_BYTES 保持一致（2026-10-20 起 5 GiB）；
   // 服务端另支持 PORTAL_MAX_DATA_BYTES 环境变量覆盖，若运维改过服务端默认值，这里要同步改。`
2. `index.html:1337` 的提示改为人类可读：上限 ≥ 1 GiB 时显示 `5GiB`，
   否则按 MiB 显示（例如覆盖成 1MiB 时显示 `1MiB`）。
   做法自定，但**不许出现"5120MB"这种误导单位**。
3. `index.html:395` 与 `index.html:412` 两处文案中的 `1 GiB` → `5 GiB`、
   `other 最多 3 个` → `other 最多 5 个`。其余文字一字不改。
4. **只改这 4 处**（含为第 1 项新增的注释行）。`index.html` 其他任何内容不许动。

【任务项】
1. 先读 `portal/lib/archive.mjs` 的 29-36 行，**把服务端当时的实际值贴进取要**
   （S20 可能仍在改动中，若你读到的值与上面规格不一致，**停下来上报**，不要按规格硬改）。
2. 按规格改 4 处。
3. 改完自检：
   - `grep -n "1 GiB\|最多 3 个\|1024 \* 1024 \* 1024" portal/index.html`
     → 数据文件相关处应为 0 命中（参考文献的 20MB/5 篇文案**应仍在**，那些不过期）
   - 提取内联 `<script>` 做 `node --check`（做法：正则抽出后写临时文件再检查，
     临时文件放 `$TMPDIR`，不要落在仓库里）
   - `grep -c "5 GiB\|5 \* 1024 \* 1024 \* 1024\|最多 5 个" portal/index.html`
     → 应 ≥ 3
4. 真链冒烟（不起服务、不打 HTTP，S20 正在改服务端不许干扰）：
   用 `curl -s http://127.0.0.1:8080/` 拉生产页面，确认 4 处新值已出现在
   服务端实际吐出的 HTML 里（serve.mjs 每请求读盘，即时生效），贴 grep 计数。
5. **不要跑 `npm test`、不要起 portal 服务、不要碰 `portal/inbox/`**。
6. 回报里贴改动前后的 4 处 diff 对照（前后各一行原文）。

【硬性禁止】
- 禁止改 `portal/serve.mjs`、`portal/lib/archive.mjs`（S20 在改）、
  `BioanalysDesktop/`、测试、`ops/`、`src/`。
- 禁止改 `index.html` 除这 4 处以外的任何内容（含参考文献的 20MB/5 篇）。
- 禁止把服务端上限改成从客户端"猜测"的值:以你读到的 `archive.mjs` 实际值为准。
- 禁止在仓库里留临时文件（脚本/抽出的 js 都放 `$TMPDIR`）。
- 禁止把"应该一致了"写成已验证；必须贴 curl 生产页面的 grep 证据。

【验收标准】
A1 `archive.mjs` 实际值已贴出，且与改动一致（不一致则已停下上报）。
A2 4 处全部改完，其余内容零变化（贴 diff 对照）。
A3 `node --check` 内联脚本通过；仓库无新增临时文件。
A4 生产 8080 页面 grep 证实新值已生效。
A5 参考文献 20MB/5 篇文案未动。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入
`con_hf/dispatch/S22_report.md`（每完成一步更新一次）。
