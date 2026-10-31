# S22 回报 : portal 前端 4 处硬编码上限与 S20 新值对齐

日期：2026-10-20 ｜ 子 Agent 按 SUBAGENT_CONTRACT.md 输出契约回报

## 1. 任务理解

只改 `portal/index.html` 一处文件，把 S19 硬编码的旧上限（1 GiB / other 3 个）
对齐到 S20 服务端新上限（5 GiB / other 5 个），共 4 处；自检（grep + 内联脚本
node --check）+ 生产 8080 页面冒烟；不碰 `serve.mjs`、`archive.mjs`、测试、
`ops/`、`src/`、`BioanalysDesktop/`；不起服务、不跑 npm test、不碰 inbox。

## 2. 服务端实际值（任务项 1，A1）

`portal/lib/archive.mjs` 第 31-36 行当时实际读到的原文：

```js
export const MAX_DATA_BYTES = Number(process.env.PORTAL_MAX_DATA_BYTES) > 0
  ? Number(process.env.PORTAL_MAX_DATA_BYTES)
  : 5 * 1024 * 1024 * 1024;

export const MAX_DATA_FILES_PER_ROLE = 5;
```

结论：与派发单规格一致（默认 5 GiB，可被 `PORTAL_MAX_DATA_BYTES` 覆盖；
`MAX_DATA_FILES_PER_ROLE = 5`），**无需停下上报，按规格执行**。

## 3. 实现摘要与文件变更清单

唯一变更文件：`portal/index.html`，共 4 处改动（+2 行注释）。diff 对照
（改前原文行 → 改后原文行）：

1. 行 395（上传规则文案）
   - 前：`同一角色只保留一个文件（other 最多 3 个），重复上传会替换此前的文件。支持 .tsv .csv .txt .gz .zip .xlsx .h5ad .rds .mtx，单文件上限 1 GiB。`
   - 后：`同一角色只保留一个文件（other 最多 5 个），重复上传会替换此前的文件。支持 .tsv .csv .txt .gz .zip .xlsx .h5ad .rds .mtx，单文件上限 5 GiB。`
2. 行 412（文件选择 hint）
   - 前：`支持 .tsv .csv .txt .gz .zip .xlsx .h5ad .rds .mtx；单文件上限 1 GiB。上传后的文件名需与所选角色对得上。`
   - 后：`支持 .tsv .csv .txt .gz .zip .xlsx .h5ad .rds .mtx；单文件上限 5 GiB。上传后的文件名需与所选角色对得上。`
3. 行 1186→1188（前端预检常量）
   - 前：`  var MAX_DATA_BYTES = 1024 * 1024 * 1024;`
   - 后：新增两行注释 + `  var MAX_DATA_BYTES = 5 * 1024 * 1024 * 1024;`（注释原文按派发单规格逐字）
4. 行 1337（超限报错，dfPrecheck 内）
   - 前：`      return '单文件超过上限 ' + Math.round(MAX_DATA_BYTES / 1024 / 1024) + 'MB: ' + file.name;`
   - 后：
     ```js
      var limitText = MAX_DATA_BYTES >= 1024 * 1024 * 1024
        ? (MAX_DATA_BYTES / 1024 / 1024 / 1024) + 'GiB'
        : Math.round(MAX_DATA_BYTES / 1024 / 1024) + 'MiB';
      return '单文件超过上限 ' + limitText + ': ' + file.name;
     ```
     5 GiB 精确整除显示 `5GiB`；若运维覆盖为 1 MiB 显示 `1MiB`；不再出现"5120MB"。

其余内容零变化（含参考文献 20MB/5 篇文案，见 §5 验证 C）。

## 4. 接口与交互实现说明

- 前端预检常量与服务端 `MAX_DATA_BYTES` 默认值对齐为 5 GiB；预检不再是
  "前端比服务端严"。注释里写明了两端同步义务。
- 超限报错单位随常量自适应：≥1 GiB 显示 GiB，否则 MiB。`5 * 1024**3` 经
  三次整除 `1024` 在 IEEE754 下精确得 `5`，无浮点尾巴。

## 5. 测试与验证记录

- A）`grep -n "1 GiB\|最多 3 个\|1024 \* 1024 \* 1024" portal/index.html`：
  4 处数据文件目标已无 `1 GiB`；`1024 * 1024 * 1024` 命中的 1188/1339 是
  新值表达式子串（非残留）。但 **1183 与 1209 仍有"最多 3 个"**（见 §7）。
- B）`grep -c "5 GiB\|5 \* 1024 \* 1024 \* 1024\|最多 5 个" portal/index.html`
  = **4**（≥3 达标）。
- C）参考文献文案未动：行 538-539「最多 5 篇 / 单篇上限 20MB」、1116、1123 原样。
- D）内联 `<script>` 提取（1 个块）→ `$TMPDIR` 写盘 → `node --check`
  → **NODE_CHECK_OK**；临时文件（抽出 js + 提取脚本 + 生产页副本）均已删除，
  仓库内无新增文件（`git status` 仅 `portal/index.html` 与本报告变更）。
- E）真链冒烟：`curl -s http://127.0.0.1:8080/`（未起服务，S20 的实例），
  生产 HTML 共 118506 字节，新值 grep 计数 = **4**，命中行 395 / 412 / 1186 /
  1188 与本地一致；`1 GiB` 在生产页 **0 命中**。未打任何写接口。
- 未跑 npm test（派发单禁止）:标注：单元级回归未运行。

## 6. 假设与风险

- 假设 8080 即 S20 所述 portal 实例且 serve.mjs 每请求读盘（实测页面内容与
  本地文件一致，佐证成立）。
- 风险：§7 的两处文案 + 一处功能性常量未对齐，是派发单 4 处清单的遗漏；
  其中常量项是活拦截，当前前端对 other 第 4/5 个文件仍比服务端严。

## 7. 架构/接口变更建议 与 待主 Agent 决策事项

派发单规格内部矛盾：任务项 3 要求自检 grep「数据文件相关处 0 命中」，但
以下 3 处**数据文件相关**的"最多 3 个"/旧常量不在 4 处清单内，而硬性禁止
「除这 4 处以外任何内容不许动」。二者冲突，按契约停下上报，未擅自扩大改动：

| 行 | 内容 | 影响 |
|---|---|---|
| 1183 | `['other', '其他补充文件（可不绑，最多 3 个）']` | 角色下拉选项文案过期 |
| 1189 | `var MAX_DATA_FILES_PER_ROLE = 3;` | **功能性**：1241 禁用选项、1318-1319 拦截警告、1360-1361 dfPrecheck 拒绝:前端仍拒第 4/5 个 other 文件，服务端已收 5 个 |
| 1209 | `other: '可不绑定；……；最多 3 个。'` | other 角色 hint 文案过期 |

建议：授权把这 3 处对齐（1189 → `5`，两处文案 `3 个` → `5 个`），改动模式
与本切片完全相同，可作 S23 或本切片追加授权。

## 8. 建议下一步

1. 主 Agent 裁决 §7 三处的处理（对齐/另开切片）。
2. S20 落定后由其回归 `BioanalysDesktop/tests/portal_archive.test.js` 及
   portal 相关 npm test（本切片被禁止运行，未验证）。
