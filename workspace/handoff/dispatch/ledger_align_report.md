# ledger 合法根对齐报告（task-7）

日期：2026-10-21。写范围：BioanalysDesktop/server/ledger.js、BioanalysDesktop/tests/ledger.test.js。未改 server/index.js、package.json、git。

## 改了什么

### 1) server/ledger.js
- 新增导出 `analyzePath(pathLike, options)`：合法根判定的单一事实源。返回 `{ok:false, reason, detail}` 或 `{ok:true, kind, head, lineId, projectId, legacy?}`。判定顺序：空路径 → 含 `..` → Windows 绝对路径 → SSD_ROOT 之内/之外 → 相对路径形态（裸文件名 / projects/<pid>/... / 其他拒绝）。
- 新增导出 `classifyPath(pathLike, lineId=null)`：审计归属分类（`analyzePath.ok ? kind : null`），历史兼容分支默认开。
- 新增导出 `isPathUnderLegalRoot(pathLike, options)`：严格口径（强制 `allowLegacyOutsideRoot:false`），历史路径不算合法根。
- 新增导出 `inspectTaskPath(pathLike, projectId, direction)`：提交侧单路径校验，严格合法根 + ownership 规则（跨项目 / system_logs / public 输出 / 非数据根目录），返回 null 或 `{reason, detail}`，文本与 S29 `validateTaskPaths` 的错误消息兼容。
- `extractProject` 支持相对形态 `projects/<pid>/...`（先补前导斜杠再找 `/projects/`）；大小写敏感语义不变。
- `auditLedgerEntry` 改用 `analyzePath(pathLike, { lineId })`：`projects/<pid>/` 任意子路径、裸相对文件名、相对 `projects/...` 不再判"不在任何合法根下"；跨线 / 跨项目 / 只读共享区三类消息文本保持不变（既有测试正则依赖）。
- 文件头注释补 2026-10-21 对齐说明；注释中文、无 em dash；LF 换行（实测 CRLF=0）。

### 2) tests/ledger.test.js
- 既有 12 条未改；新增 10 条，导入 `analyzePath / classifyPath / isPathUnderLegalRoot / inspectTaskPath`。
- 覆盖：合法根正反例、相对形态、历史兼容分支（`analyzePath.legacy=true`、`classifyPath` 非 null、`isPathUnderLegalRoot` false、`inspectTaskPath` 拒绝）、审计对 `projects/<pid>/whatever` 与裸相对文件名放行、相对跨项目仍拒、相对多级与 `..` 仍拒、`analyzePath` 返回字段。
- `SUBMIT_SAMPLES` 一致性表（19 条样例）：断言 `classifyPath` 与 `isPathUnderLegalRoot` 同结论、`inspectTaskPath` 放行结论与拒绝原因精确匹配、放行⇒合法根、非法根⇒拒绝、合法根下的拒绝必须是 ownership 原因（跨项目 / 系统目录 / 只读共享区 / 不属于本项目）。

## 为什么

- S29 报告遗留风险 2、3：`validateTaskPaths` 对 `projects/<pid>/` 任意子路径与裸相对文件名放行，但 `ledger.classifyPath` 只认 `/<line>/`、`/public_references/`、`/system_logs/` 标记，返回 null，台账审计判"路径不在任何合法根下"。同一条台账提交时通过、审计时违规。
- 根因是"合法根"有两套实现：审计按 marker（与 `ops/03_check_logs_remote.sh` 同口径），提交按 SSD_ROOT 加一级目录。修复方式是抽 `analyzePath` 做单一事实源，两个调用方各取所需字段：
  - 审计要"归属"（kind），必须保留 marker 历史兼容分支，否则 `cn_debug/samples/system_logs` 里 `/data/data/.../bio_data_logs_test/<line>/...` 样例与服务器 bash 判定漂移，`consistency.test.js` 会红；
  - 提交要"严格合法根 + ownership"，显式关掉历史分支，并保留 S29 对 `bin/envs` 等非数据根目录的拒绝。
- 结果：审计放行 `projects/<pid>/whatever` 与裸相对文件名，提交侧结论不变（S29 的 15 条纯函数断言已逐条核对，见下）。

## 验证尾行原文

命令 1：`cd BioanalysDesktop; node --test tests/ledger.test.js`（exit 0）

```text
✔ 两处口径一致：classifyPath 的合法根结论与提交预校验结论同批样例一致 (0.4532ms)
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 122.5953
```

命令 2：`cd BioanalysDesktop; npm test`（exit 0）

```text
ℹ tests 414
ℹ suites 0
ℹ pass 414
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3687.2847
```

说明：414 条含其他切片并行新增的测试；本切片贡献 ledger.test.js 22 条（12 既有 + 10 新增）。`consistency.test.js`（真 ssh k40-ubuntu 跑 ops/03 比对）在 npm test 中通过。

补充核对（不写文件，只 import ledger 并模拟报告给出的 validateTaskPaths）：S29 的 15 条纯函数断言全部成立，含 error 文本 `跨项目`、`含 ..`、`system_logs`、`只读`、`Windows 绝对路径`、`不是文件路径`、`inputs[1]` 空值点名等。最后一行：

```text
15/15 S29 期望在 ledger.inspectTaskPath 上成立
```

## 已知边界

1. 历史兼容分支只给审计，提交层不继承。SSD_ROOT 之外但含 marker 的路径：审计合法、提交拒绝（`不在数据根之下`）。这是有意的：服务器 bash 口径不能漂移，新任务输入输出不得用历史路径。测试已固定该差异。
2. 合法根不等于提交放行。四类 ownership 拒绝保留：跨项目、system_logs、public 输出、SSD_ROOT 下非数据根目录（bin/envs/ops 等）。测试断言这四类拒绝原因不是根问题。注意 `bin/line1_bulk/...` 这类路径 `kind` 按 marker 判成 `line1_bulk`（与 bash 一致），但提交侧按 `head=bin` 拒绝。
3. 相对路径收紧：以前提交侧放行任意相对路径，现在只接受裸文件名（无目录分隔符）与 `projects/<pid>/...`。仓库内提交用例只用裸文件名或绝对路径（已 grep tests，无依赖），但外部脚本若传 `processed/x.tsv` 形态会被拒，原因为 `相对路径缺少合法根`。这是有意收紧，避免相对多级路径绕过归属校验。
4. 裸文件名 `projects`（无斜杠）按裸相对文件名放行；绝对 `/mnt/ssd/bio_data/projects` 判 `缺少项目段`。
5. 空路径 / 非字符串：`analyzePath` 返回 `空路径`，但 `validateTaskPaths` 在调用前已有自己的空值分支，S29 行为不变。
6. 未连 算力节点 真机；新增测试无 ssh/spawn。`consistency.test.js` 是既有测试，跑真 ssh，属既有基线行为。
7. index.js 未改，且当前工作树里 index.js 还有其他切片的并行改动（git status 显示 M）。建议改动请按内容锚点应用，不要按行号硬贴。
8. 全量测试数字会随并行切片变化：本次 414/414 是 2026-10-21 本次运行的值。

## 建议改动（server/index.js，由 Lead 落地）

1. import（当前第 27 行）：

```diff
-import { summarizeLedger, auditLedgerEntry } from './ledger.js';
+import { summarizeLedger, auditLedgerEntry, inspectTaskPath } from './ledger.js';
```

2. 删除 S29 本地实现整块：从注释首行 `// ── 任务提交路径预校验（S29 / R9）` 起，到私有 `function inspectTaskPath(pathLike, projectId, direction) { ... }` 的结尾 `}` 止（当前 213-273 行；函数右花括号后空一行接 `validateTaskPaths` 的 JSDoc）。用下面 3 行注释替代：

```js
// ── 任务提交路径预校验（S29 / R9）────────────────────────────────────
// 单路径归属判定已收敛到 server/ledger.js 的 inspectTaskPath（合法根单一事实源，
// 与台账审计共用 analyzePath）。这里只保留批量校验与错误消息格式。
```

3. `validateTaskPaths`（当前 275-303 行）一字不改：`inspectTaskPath` 变成 import 进来的函数，行为等价（唯一差异见"已知边界"3）。它调用 `inspectTaskPath(raw.trim(), ...)`，ledger 版内部也会 trim，重复无害。
4. 可选清理：该块删除后 `SSD_ROOT` 在 index.js 不再被使用（grep 确认仅 233-271 行用到），可从 domain.js 的 import 列表（当前第 18 行）移除；不移除也不影响运行。
5. 落地后跑 `cd BioanalysDesktop; npm test`：`task_submit_validation.test.js` 的 15 条纯函数断言与 4 条 HTTP 接线断言应保持绿（已用同一实现逐条核对），`ledger.test.js` 22 条应保持绿。
