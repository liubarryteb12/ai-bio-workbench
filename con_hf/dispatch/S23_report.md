# S23 回报 : portal 前端补齐 3 处过期上限（S22 §7 遗漏，主 Agent 已授权）

日期：2026-10-20 ｜ 子 Agent 按 SUBAGENT_CONTRACT.md 输出契约回报

## 1. 任务理解

只改 `portal/index.html` 一个文件，把 S22 §7 停工上报的 3 处数据文件相关旧上限
（other 下拉文案、`MAX_DATA_FILES_PER_ROLE` 常量、other hint 文案）对齐到
服务端现值 5；自检 grep + 内联脚本 `node --check` + 生产 8080 页面冒烟。
不碰 `serve.mjs`、`archive.mjs`、测试、`ops/`、`src/`、`BioanalysDesktop/`、
`portal/inbox/`；不起服务、不跑 npm test、不修 serve.mjs 的「同角色删旧」问题。

## 2. 任务项 1：archive.mjs 实际值（A1）

`portal/lib/archive.mjs` 第 31-36 行实际读到：

```js
export const MAX_DATA_BYTES = Number(process.env.PORTAL_MAX_DATA_BYTES) > 0
  ? Number(process.env.PORTAL_MAX_DATA_BYTES)
  : 5 * 1024 * 1024 * 1024;

export const MAX_DATA_FILES_PER_ROLE = 5;
```

结论：与派发单规格一致（默认 5 GiB 可被环境变量覆盖；`MAX_DATA_FILES_PER_ROLE = 5`），
**未触发停下上报，按规格执行**。

## 3. 实现摘要与文件变更清单

唯一变更文件：`portal/index.html`，共 3 处（+2 行注释，行号按改后文件）。
diff 对照（改前原文行 → 改后原文行）：

1. 行 1183（角色下拉选项）
   - 前：`    ['other', '其他补充文件（可不绑，最多 3 个）']`
   - 后：`    ['other', '其他补充文件（可不绑，最多 5 个）']`
2. 行 1189→1191（前端预检常量，功能性活拦截）
   - 前：`  var MAX_DATA_FILES_PER_ROLE = 3;`
   - 后：
     ```js
      // 与服务端 portal/lib/archive.mjs 的 MAX_DATA_FILES_PER_ROLE 保持一致（2026-10-20 起 5）；
      // 仅约束 other 角色，其余角色由绑定策略硬性每角色 1 个。
      var MAX_DATA_FILES_PER_ROLE = 5;
     ```
     注释按派发单规格逐字。
3. 行 1209→1211（other 角色 hint）
   - 前：`    other: '可不绑定；文件名含 GSE / GPL 编号时需与绑定编号一致；最多 3 个。'`
   - 后：`    other: '可不绑定；文件名含 GSE / GPL 编号时需与绑定编号一致；最多 5 个。'`

其余内容零变化（含参考文献 20MB/5 篇文案，见 §5 验证 D）。
注意：本仓库**不是 git 仓库**（`git status` 返回 `fatal: not a git repository`），
无法提供 `git diff`，以上对照基于改前 `read_file` 原文与 patch 工具返回的 unified diff。

## 4. 接口与交互实现说明

- `MAX_DATA_FILES_PER_ROLE = 5` 后，前端 1241 禁用选项、拦截警告、dfPrecheck
  对 other 第 4/5 个文件不再拦截，与服务端 `archive.mjs` 收 5 个的行为对齐，
  前端不再比服务端严。
- 两处文案与行 395 上传规则文案（S22 已改）口径一致，均为「最多 5 个」。

## 5. 测试与验证记录

- A）`grep -n "最多 3 个\|MAX_DATA_FILES_PER_ROLE = 3" portal/index.html`
  → **0 命中**（grep exit=1）。
- B）`grep -c "最多 5 个\|MAX_DATA_FILES_PER_ROLE = 5" portal/index.html` = **4**
  （≥3 达标；第 4 处为 S22 已改的行 395 上传规则文案，非本切片目标，行为正确）。
- C）内联 `<script>` 抽取（1 个块，68333 字符）→ 临时文件放
  `%LOCALAPPDATA%\Temp`（未落仓库）→ `node --check` → **NODE_CHECK_OK**（Node v24.19.0）。
- D）参考文献文案未动：行 538-539「最多 5 篇 / 单篇上限 20MB」、1116、1123
  （`超过 20MB`）grep 原样命中。
- E）真链冒烟：`curl -s http://127.0.0.1:8080/`（未起服务），生产 HTML
  118695 字节；旧值 grep **0 命中**；新值计数 = **4**，命中行 395 / 1183 / 1191 /
  1211，与本地文件一致；`cmp` 生产页与本地 `portal/index.html` **IDENTICAL**
  （佐证 serve.mjs 每请求读盘、新值已生效）。未打任何写接口。
- 未跑 npm test（派发单禁止）:标注：单元级回归未运行。
- 临时文件（抽出 js、生产页副本、抽取脚本）均已删除，仓库内无残留。

## 6. 假设与风险

- 生产页与本地文件 byte-identical，说明 8080 实例直接读盘吐出本文件，
  A4「生产生效」成立且无需重启。若后续运维改为内存缓存 HTML，此结论失效，
  需在重启后复验（本切片未重启，重启时机由主 Agent 决定）。
- `MAX_DATA_FILES_PER_ROLE` 前端常量改动影响 1241 禁用逻辑、1318-1319 拦截
  警告、dfPrecheck 拒绝三条路径，本切片仅做静态验证，未跑浏览器端交互
  （派发单未要求，标注未验证）。

## 7. 架构/接口变更建议 与 待主 Agent 决策事项

- serve.mjs 的「同角色删旧」latent 问题按派发单要求未动，维持另案处理。
- 建议主 Agent 择机重启/回归 portal（`BioanalysDesktop/tests/portal_archive.test.js`
  及相关 npm test），覆盖 other 第 4/5 个文件的端到端上传路径。

## 8. 建议下一步

1. 主 Agent 复核本报告 §3 diff 与 §5 grep/curl 证据，裁定重启时机。
2. 回归测试由具备 npm test 权限的切片执行（本切片被禁止）。
