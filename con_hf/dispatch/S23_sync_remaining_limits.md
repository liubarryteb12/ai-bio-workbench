[派发单 · 切片 S23] 子 Agent 任务：portal 前端补齐 3 处过期上限（S22 发现的清单遗漏，主 Agent 已授权）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S22_report.md
     的 §7（三处遗漏的定位依据）
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\portal\index.html（**只改这一个文件**）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\portal\lib\archive.mjs 的
     `MAX_DATA_BYTES` / `MAX_DATA_FILES_PER_ROLE`（权威值来源，只读）
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【并行约束】S18R/S21 可能仍在跑；**你只改 `portal/index.html`**，
其他任何文件（含 serve.mjs / archive.mjs / 测试 / ops / src / BioanalysDesktop）不许碰。

【背景（主 Agent 已裁决）】
S22 按契约停在派发单清单外又发现的 3 处过期值，主 Agent 现授权补齐：
服务端现为 `MAX_DATA_BYTES = 5 GiB`、`MAX_DATA_FILES_PER_ROLE = 5`（仅约束 other）。
前端 3 处仍持旧值：

| 行 | 现状 | 性质 |
|---|---|---|
| 1183 | `['other', '其他补充文件（可不绑，最多 3 个）']` | 下拉选项文案过期 |
| 1189 | `var MAX_DATA_FILES_PER_ROLE = 3;` | **功能性活拦截**：前端仍拒第 4/5 个 other 文件 |
| 1209 | `other: '可不绑定；……；最多 3 个。'` | hint 文案过期 |

【主 Agent 已定死的改动规格（不许自行更改）】
1. `index.html:1189` → `var MAX_DATA_FILES_PER_ROLE = 5;`，行上方加注释：
   `// 与服务端 portal/lib/archive.mjs 的 MAX_DATA_FILES_PER_ROLE 保持一致（2026-10-20 起 5）；`
   `// 仅约束 other 角色，其余角色由绑定策略硬性每角色 1 个。`
2. 1183 与 1209 两处文案中的 `最多 3 个` → `最多 5 个`，其余文字一字不改。
3. **只改这 3 处**（含第 1 项的注释）。改完全文件内不得再有任何
   `最多 3 个` 或 `MAX_DATA_FILES_PER_ROLE = 3`（数据文件相关）；
   参考文献的 20MB/5 篇不得动。

【任务项】
1. 改前先读 `portal/lib/archive.mjs` 29-36 行贴实际值（若与你预期不符立即停下上报）。
2. 按规格改 3 处。
3. 自检：
   - `grep -n "最多 3 个\|MAX_DATA_FILES_PER_ROLE = 3" portal/index.html` → 0 命中
   - `grep -c "最多 5 个\|MAX_DATA_FILES_PER_ROLE = 5" portal/index.html` → ≥ 3
   - 抽内联 `<script>` 做 `node --check`（临时文件放 `$TMPDIR`，不落仓库）
4. 真链冒烟：`curl -s http://127.0.0.1:8080/` 拉生产页面，
   确认 3 处新值已出现在服务端实际吐出的 HTML 里（grep 计数贴原文）。
   **不要起服务、不要打任何写接口、不要碰 `portal/inbox/`、不要跑 npm test。**
5. **不要修 serve.mjs 的「同角色删旧」latent 问题**（另案处理）。
6. 回报贴 3 处前后 diff 对照。

【硬性禁止】
- 禁止改 `portal/serve.mjs`、`portal/lib/archive.mjs`、`BioanalysDesktop/`、
  测试、`ops/`、`src/`；禁止改 `index.html` 除这 3 处以外的任何内容。
- 禁止重启 8080（重启时机由主 Agent 决定）。
- 禁止把"应该一致了"写成已验证；必须贴 curl 生产页面的 grep 证据。
- 禁止在仓库里留临时文件。

【验收标准】
A1 `archive.mjs` 实际值已贴出且一致。
A2 3 处全部改完，其余内容零变化（贴 diff 对照）。
A3 `node --check` 通过；`最多 3 个`/`= 3` 全文件 0 命中（数据文件相关）。
A4 生产 8080 页面 grep 证实新值生效。
A5 参考文献 20MB/5 篇未动。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入
`con_hf/dispatch/S23_report.md`。
