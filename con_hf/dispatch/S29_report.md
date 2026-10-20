# S29 报告：TaskPanel 契约化改造与提交层路径预校验

- 任务：共享任务板 task-1（切片 S29），owner=s29-taskpanel
- 派发单：`con_hf/dispatch/S29_taskpanel_and_pathvalidation.md`
- 项目根：`D:\00.AIagent\codespace\AI辅助生信分析流程工作台`
- 完成时间：2026-10-21
- 结论：三处前端改动 + 服务端 `validateTaskPaths` 与接线全部落地；新增 17 条测试全绿；`npm test` 339/339 全绿（基线 296，其余增量来自并行切片）；`npm run build` 成功；`npx tsc --noEmit` 零错误；E2E 全链未运行（原因见第 5 节），改为对 E2E 全部 11 个提交载荷做纯函数静态验证，11/11 放行。

## 1. 任务理解

目标（对应架构评审 R8 / R9 / R10）：

1. R8 种子违约：TaskPanel 的随机种子默认值是 `42`，与契约固定种子 20261013（aims §一.3）不符，导致默认下发不可复现。要求默认值改 20261013，并在种子框旁给出静态说明；输入框保持可编辑。
2. R9 无路径预校验：`POST /api/tasks/submit` 对 inputs/outputs 只校验"是字符串数组"，不校验路径归属，跨项目 / 含 `..` / 系统目录路径可以一路下发到远端。要求服务端新增纯函数 `validateTaskPaths` 并在提交层接线，前端加不阻断的形态预检。
3. R10 全自由文本：步骤名是纯手填 input，易拼错。要求改成下拉（数据源 `/api/projects/steps`），同时保留自定义手填入口。

目标文件与验收：

- `BioanalysDesktop/src/App.tsx`（TaskPanel）
- `BioanalysDesktop/server/index.js`（`/api/tasks/submit` 接线 + 导出 `validateTaskPaths`）
- `BioanalysDesktop/tests/task_submit_validation.test.js`（新建，>=8 条，含真 HTTP 用例）
- `con_hf/dispatch/S29_report.md`（本文件）

约束（全部遵守）：

- 只改上述文件；未动 `server/task.js`、`server/run.js`、`tests/task.test.js` 既有断言、`portal/`、`src/` 三线、`ops/`、`projects/`、`test_use_data/`、`reference/`。
- 未做任何 git 写操作（只跑过只读的 `git status` / `git diff --stat`），未删除文件，未安装包，未改远端环境或数据。
- S28 未提交改动完整保留：`server/index.js` 的「桥接四项断言检查点（S28 / 架构评审 D1）」块仍在 `:1496-1539`，本切片接线插在它之前的 `:1489-1494`。
- 兼容红线：历史形态 `/mnt/ssd/bio_data/<line>/...` 继续放行；`processed/` 下的裸相对文件名继续放行（既有 HTTP 用例依赖）。

## 2. 实现摘要

### 2.1 服务端 `server/index.js`

- 新增模块私有 `inspectTaskPath(pathLike, projectId, direction)`（`:220-267`）：单条路径归属判定，返回 `null`（放行）或 `{reason, detail}`。
- 新增导出纯函数 `validateTaskPaths(inputs, outputs, projectId)`（`:276-297`）：不读文件、不连远端，遍历两个字段，违规时返回 `{ok:false, error}`，`error` 形如 `inputs[0] 路径非法（跨项目）: <路径原文>，属于项目 X，当前项目为 Y`。
- `/api/tasks/submit` 接线（`:1489-1494`）：在 `auditCommand` 400 返回之后、S28 桥接检查块之前，越界直接 400。放在桥接之前是有意的：不为一条注定非法的路径白跑一次 ssh 往返（HTTP 用例已证明此时 ssh 垫片调用计数为 0）。
- 修一处本次改动引入的导入缺口：`server/index.js:16-19` 的 domain 导入补 `SSD_ROOT`（首轮测试报 `ReferenceError: SSD_ROOT is not defined`，见第 5 节"失败与修复"）。

### 2.2 前端 `src/App.tsx`（TaskPanel，`function TaskPanel` 现位于 `:2644`）

- 种子默认值 `'42'` 改 `'20261013'`（`:2648`），种子框下加静态说明（`:2825`）；输入框仍可编辑（`onChange` 保留）。
- 步骤名由 input 改 select（`:2797-2814`）：选项来自 `/api/projects/steps` 中当前线的步骤数组，末尾固定一项「自定义（手动输入命令名）」；选自定义时渲染手填 input（`:2815-2819`）。步骤清单拉取失败时下拉只剩空占位与自定义项，不阻塞下发。
- 换线时清空已选步骤（`:2784-2788`，仅在非自定义态清空），避免带着上一条线的步骤名提交。
- inputs/outputs 的 placeholder 改为现行形态 `/mnt/ssd/bio_data/projects/<project>/<line>/processed/...`（`:2838` / `:2845`），域下方加归属提示（`:2849-2852`）。
- 客户端形态预检 `pathShapeWarnings`（`:2637-2642`）+ 黄色提示块（`:2854-2864`）：每行非空且不含 `projects/` 时提醒，仅提示不阻断；文案明确说明"可能是历史三线形态或相对文件名"。

## 3. 文件变更清单

| 文件 | 变更 | 规模 |
| --- | --- | --- |
| `BioanalysDesktop/server/index.js` | 新增 `inspectTaskPath` + 导出 `validateTaskPaths`；`/api/tasks/submit` 插入 400 拦截；domain 导入补 `SSD_ROOT` | +约 95 行（该文件 diff 总量含 S28 未提交改动） |
| `BioanalysDesktop/src/App.tsx` | TaskPanel 三处改造 + 路径形态预检 | +90 / -10 行 |
| `BioanalysDesktop/tests/task_submit_validation.test.js` | 新建，17 条测试（13 纯函数 + 4 真 HTTP） | 新文件约 300 行 |
| `con_hf/dispatch/S29_report.md` | 本报告 | 新文件 |

未改动（已核对）：`server/task.js`、`server/run.js`、`server/ledger.js`、`server/files.js`、`server/audit.js`、`tests/task.test.js`、`tests/bridge_checkpoint.test.js`、`tests/index.test.js`、`portal/`、`src/line*/`、`ops/`。`npm run build` 会重写 `dist/`（构建产物，未跟踪），属预期副作用。

## 4. 接口与交互实现说明

### 4.1 口径来源（与既有服务端口径对齐，未自造规则）

**（a）`/api/projects/steps` 的返回形状**（读 handler 源码，未起服务）：

```js
// server/index.js:829-831
if (url.pathname === '/api/projects/steps') {
  return json(res, 200, { steps: LINE_STEPS, meta: PIPELINE_STEP_META });
}
```

- `steps`：`{ line1_bulk: string[], line2_scrna: string[], line3_spatial: string[] }`，步骤名即远端命令名（如 `prep_matrix`、`deg_limma`、`gsva_pathways`），定义在 `server/project.js:232-253`（14 / 22 / 17 步）。
- `meta`：`Record<stepName, {label, desc, tool, io, note}>`，定义在 `server/project.js:259-311`。
- 前端按 `stepsData[line]` 取当前线数组，与既有组件（`App.tsx:591` / `:1088`）同款用法。

**（b）`server/ledger.js` 的跨项目判据**（`:104-108`，原文）：

```js
// 项目段一致性：新结构路径必须落在本台账 project_id 指向的项目内
const pathProject = extractProject(pathLike);
if (pathProject !== null && pathProject !== projectId) {
  problems.push(`io_files.${direction} 跨项目: ${pathLike} 属于项目 ${pathProject}，但 project_id=${projectId}`);
}
```

- `extractProject`（`:30-37`）找小写 `/projects/`，取其后首段；不含 `/projects/` 返回 `null`，即按 legacy（迁移前顶层三线）处理。
- 项目段比对大小写敏感（`:24-28` 注释：转小写会误判合法台账），所以 `projects/DEFAULT` 与 `default` 不等价。
- `classifyPath`（`:42-50`）：`/public_references/` → `public`，`/system_logs/` → `logs`，含 `/<line>/` → 该线。
- `output` 写 `public_references` 判违规（`:101-103`），输入不判违规。

**（c）`server/audit.js` 的规则**（已通读全文件，65 行）：

- 它**不做路径归属规则**，只做命令文本审计：把整条待执行命令按行归一化（反斜杠转 `/`、转小写），只要出现其他两条线的 `line_id` 字面量就 `allowed:false`，reason 以「跨线引用被拒绝（line_id=...）」开头。
- 因此路径归属口径不在 audit.js，而在 `ledger.js`（台账审计）与 `files.js`（文件访问守卫）。本次 `validateTaskPaths` 与后两者同口径，并额外按派发单要求收紧 `..`。
- 交叉保护：`projects/<pid>/line2_scrna/...` 这类"同项目跨线"路径虽然 `validateTaskPaths` 放行，但 `auditCommand` 在更早位置就因命令文本含 `line2_scrna` 而 400（`tests/index.test.js:90` 既有断言覆盖）。

**（d）`server/files.js` 的路径规则**（文件头 `:1-6`、`assertPathInsideProject` `:34-77`）：

- 浏览限定"本项目本线"内；`public_references` 是唯一合法共享读入口。
- 越界一律拒：别的项目、别的线、数据根以外、`..` 穿越、绝对路径逃逸。

### 4.2 `validateTaskPaths` 规则表（`server/index.js:207-297`）

判定顺序（先禁 `..`，防止 `/projects/<pid>/../<other>` 借归一化绕过项目比对）：

| # | 条件 | 结果 | error 中的原因 |
| --- | --- | --- | --- |
| 1 | 任一段为 `..` | 拒 | `含 ..` |
| 2 | `^[A-Za-z]:/`（Windows 绝对路径） | 拒 | `Windows 绝对路径` |
| 3 | 不以 `/` 开头（裸相对路径，shell 在 `processed/` 下解析） | 放行 | 无 |
| 4 | 等于 `SSD_ROOT` | 拒 | `不是文件路径` |
| 5 | 不以 `/mnt/ssd/bio_data/` 开头 | 拒 | `不在数据根之下` |
| 6 | `projects` 后缺项目段 | 拒 | `缺少项目段` |
| 7 | 项目段 !== 当前 projectId（大小写敏感） | 拒 | `跨项目` + 实际项目与当前项目 |
| 8 | `projects/<当前项目>/...` 任意子路径 | 放行 | 无 |
| 9 | `public_references/...` 且 direction=output | 拒 | `输出不得写只读共享区` |
| 10 | `public_references/...` 且 direction=input | 放行 | 无（只读共享读入口） |
| 11 | `system_logs/...`（两个方向） | 拒 | `系统目录禁止作为任务输入/输出` |
| 12 | `<line>/` 开头（历史三线形态） | 放行 | 无（兼容红线） |
| 13 | 其他（`bin/`、`envs/`、`ops/` 等） | 拒 | `不属于本项目` |
| 14 | 空值 / 非字符串条目 | 拒 | `空值或非字符串`，并点名索引 |
| 15 | inputs/outputs 为空数组或非数组 | 放行 / 跳过 | 无（数组类型校验在 submit 更早返回 400） |

`error` 一律点名"第几个字段第几条 + 路径原文 + 原因"：`inputs[0] 路径非法（跨项目）: /mnt/ssd/bio_data/projects/PRJ_OTHER/line1_bulk/processed/expr.tsv，属于项目 PRJ_OTHER，当前项目为 default`。

### 4.3 接线位置（`server/index.js:1484-1496`）

```js
const audit = auditCommand(script, lineId);
if (!audit.allowed) { return json(res, 400, { error: audit.reason }); }

// S29 / R9：路径归属预校验，放在审计之后、桥接检查之前：
// 先拦越界路径，避免为一条注定非法的路径去跑远端桥接校验（白耗 ssh 往返）。
const pathCheck = validateTaskPaths(requested.inputs || [], requested.outputs || [], projectId);
if (!pathCheck.ok) { return json(res, 400, { error: pathCheck.error }); }

// ── 桥接四项断言检查点（S28 / 架构评审 D1）──────────────────────────
```

与派发单要求一致：audit 之后、S28 桥接块之前。S28 块（`:1496-1539`）一字未动，已逐行核对仍含母版缺失 warn、`needsBridgeCheck`、`buildBridgeCheckCommand`、exit 255/-1 → 503、引擎判死 → 400 全部逻辑。

### 4.4 前端交互

- 种子：默认 `20261013`，说明文案「契约固定种子 20261013（aims §一.3）；改动将使结果不可复现」，仍可编辑。
- 步骤：下拉（当前线步骤 + 「自定义（手动输入命令名）」）；自定义态才出现手填框；步骤清单拉取失败时仍可自定义，不阻塞下发。
- 路径：placeholder 用现行形态；提示「路径须属于当前项目 {project}；提交前会校验归属与形态（跨项目、含 ..、系统目录一律 400），存在性由远端任务自行报错。历史三线形态与 processed/ 下的相对文件名仍可提交。」（原文如实说明不做存在性校验，避免误导）
- 形态提醒：仅当某行非空且不含 `projects/` 时出现黄色提示块，列出条数与前 5 条，不阻断提交；文案提示可能是历史形态或相对文件名。

## 5. 测试与验证记录

### 5.1 新增测试 `tests/task_submit_validation.test.js`（17 条，全部通过）

垫片范式照抄 `tests/bridge_checkpoint.test.js`：`freePort()` → `BAD_PORT` → `mock.method(childProcess, 'spawnSync' / 'spawn')` 记录 `shim.calls` → `await import('../server/index.js')` → 轮询 `/api/health` 就绪；`after` 里 `closeAllConnections()` + `server.close()`。未改 `bridge_checkpoint.test.js` 与 `task.test.js` 任何断言。

纯函数 13 条：

1. 现行形态 `projects/default/line1_bulk/...` 输入与输出合法
2. 历史三线形态 `/mnt/ssd/bio_data/line1_bulk/...` 合法（兼容红线）
3. `processed/` 下的裸相对文件名 `pseudobulk.tsv` 合法（既有 HTTP 用例依赖）
4. 空数组 ok
5. 跨项目拒，且 error 点名 `inputs[0]`、路径原文、`PRJ_OTHER`、`当前项目为 default`
6. 项目段大小写敏感（`projects/DEFAULT` 拒）
7. 含 `..` 拒，error 点名路径原文
8. `system_logs` 作输入、作输出都拒
9. `public_references` 输入放行、输出拒（error 含 `只读`）
10. `/etc/passwd` 拒（`不在数据根之下`）
11. `C:\\Users\\...` 拒（`Windows 绝对路径`）
12. 空字符串条目拒，点名 `inputs[1]`
13. 数据根本身 `/mnt/ssd/bio_data` 拒（`不是文件路径`）

真 HTTP 4 条（in-process 真服务 + 假 ssh 垫片）：

14. 跨项目路径 → 400，`error` 含「跨项目」，且 `shim.calls` 中 `spawn` 计数为 **0**（证明提交前拦下，没有白跑远端）
15. 含 `..` 路径 → 400，`spawn` 计数为 0
16. 现行形态合法路径 → 200 + `taskId`，且垫片收到含 `s29_ok_probe` 的 spawn（任务正常下发），随后 `/api/tasks/stop` 收尾
17. 历史三线形态经 HTTP → 200 + `taskId`，垫片收到含 `s29_legacy_probe` 的 spawn（E2E 旧形态不被打断）

单跑结果（真实输出尾行）：

```
$ cd BioanalysDesktop; node --test tests/task_submit_validation.test.js
✔ S29: 跨项目路径提交 400，且 ssh 垫片调用计数为 0（提交前就拦下） (13.1239ms)
✔ S29: 含 .. 路径提交 400，且 ssh 垫片调用计数为 0 (3.1826ms)
[bridge] line1_bulk/s29_ok_probe 母版缺失，跳过桥接判定: 母版不存在: ...\src\line1_bulk\scripts\s29_ok_probe
✔ S29: 现行形态合法路径仍能下发（200 + taskId + 任务 ssh 已启动） (28.1376ms)
✔ S29: 历史三线形态经 HTTP 仍能下发（E2E 旧形态不被打断） (15.9627ms)
ℹ tests 17
ℹ pass 17
ℹ fail 0
```

### 5.2 全量回归、构建、类型检查（最终一次，全部通过）

```
$ cd BioanalysDesktop; npm run build
dist/index.html                   0.41 kB │ gzip:  0.31 kB
dist/assets/index-Dd0Zqcig.css   15.24 kB │ gzip:  3.38 kB
dist/assets/index-B3ManVat.js   216.79 kB │ gzip: 70.64 kB
✓ built in 739ms
BUILD_EXIT=0

$ cd BioanalysDesktop; npx tsc --noEmit
TSC_EXIT=0

$ cd BioanalysDesktop; npm test
ℹ tests 339
ℹ pass 339
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
TEST_EXIT=0
```

说明：基线 296 条，本次新增 17 条，其余增量（339 - 296 - 17 = 26 条）来自并行切片的测试文件（`bridge_checkpoint.test.js`、`data_format_parity.test.js`、`report_preflight.test.js` 等），不是本切片改动导致。`npm test` 的 `scripts.test` 是 `node --test tests/*.test.js`，新文件自动纳入。

### 5.3 失败与修复（如实记录）

- 首轮单跑 17 条全红：`ReferenceError: SSD_ROOT is not defined`，抛在 `server/index.js:233`（`inspectTaskPath` 内），连带 3 条 HTTP 用例 30s 超时（请求处理函数抛异常，响应永不返回）。
- 根因：`server/index.js:16-19` 从 `./domain.js` 的导入列表缺 `SSD_ROOT`（`domain.js:303` 有该导出）。
- 修复：在导入列表补 `SSD_ROOT`（一行），重跑 17/17 通过。这是本次改动引入的缺口，不是既有代码问题。

### 5.4 E2E 回归（`cn_debug/2026-10-19_e2e_run_pipeline.mjs`）：未运行

未运行原因（两条，任一即阻断）：

1. 脚本硬编码 `BASE = 'http://127.0.0.1:8787'`，要求有真实服务在跑；且每步等 60s 台账落盘，全链 11 步。
2. 脚本会对 K40 真实下发分析任务（prep_matrix / wgcna_modules / deg_limma 等），会在远端 `projects/PRJ_E2E_GSE277173/` 下写产物。派发单与本会话约束明确「远端只读探测可以，禁止改远端环境/数据」，因此不执行。

替代证据（静态验证，未提交、不连远端）：用 `validateTaskPaths` 对 E2E 脚本里 11 个步骤的全部 inputs/outputs（`PROJECT=PRJ_E2E_GSE277173`，含 `processed`、`figures`、`raw_data` 子路径，共 30 条路径）逐条判定：

```
$ cd BioanalysDesktop; $env:BAD_PORT='0'; node --input-type=module -e "<validate all E2E specs>"
PASS prep_matrix
PASS qc_matrix
PASS pca_matrix
PASS deg_limma
PASS wgcna_modules
PASS enrichment_bulk
PASS enrichment_figures
PASS ppi_string
PASS key_genes
PASS ml_hub_analysis
PASS bulk_figures
specs=11 fail=0
```

补充事实：该 E2E 脚本的路径形态其实是**现行形态**（`/mnt/ssd/bio_data/projects/PRJ_E2E_GSE277173/line1_bulk/...`），不是历史三线形态；历史形态的兼容性由纯函数用例 2 与 HTTP 用例 17 覆盖。

### 5.5 其他核对

- `git status --short`（只读）：本切片涉及 `BioanalysDesktop/server/index.js`、`BioanalysDesktop/src/App.tsx` 已修改，`BioanalysDesktop/tests/task_submit_validation.test.js` 新增；其余修改/新增文件属其他并行切片，未由本切片触碰。
- S28 桥接块逐行核对（`:1496-1539`）完整，含 4 项断言、母版缺失 warn、exit 255/-1 → 503、引擎判死 → 400。
- 未运行的部分：浏览器里的 UI 目视验收（未打开 GUI 逐项点击）；`/api/projects/steps` 的运行时返回未单独抓取（前端 useEffect 与既有组件同款调用，`npm run build` 与 `tsc` 通过；handler 形状由源码确认）。

## 6. 假设与风险

1. **未做存在性校验**：`validateTaskPaths` 是纯函数，不 ssh 远端 stat 文件。派发单的 UI 文案原本写「校验存在性与归属」，本切片改成如实表述「校验归属与形态，存在性由远端任务自行报错」，避免承诺未实现的能力。若验收要求"存在性也拦"，需要额外一次 ssh 往返（提交延迟增加约 1s，且 K40 不可达时提交会 503），属需要 Lead 决策的范围变更。
2. **同项目非三线子目录放行**：派发单明确「允许 projects/<projectId> 下任意子路径」，所以 `projects/<pid>/whatever/x.tsv` 会过预校验，但 `ledger.js` 的 `classifyPath` 对它会返回 `null`，台账审计可能判「路径不在任何合法根下」。这是既有口径差异，本切片按派发单未收紧。同项目跨线路径由 `auditCommand` 在更早位置拦下（命令文本含其他线 line_id）。
3. **裸相对路径放行**：既有 HTTP 用例（`bridge_checkpoint.test.js:314-328`，`pseudobulk.tsv` → 200）依赖它，shell 在 `<项目>/<线>/processed/` 下解析，天然落在本项目本线内。但台账审计对相对路径同样可能判「不在任何合法根下」（`classifyPath` 返回 null）。属既有口径，未在本次改动。
4. **`public_references` 输入放行**：与 `files.js` 文件头（唯一合法共享读入口）和 `ledger.js`（只禁 output 写 public）一致。如果未来策略收紧为"任务输入也不许引用共享区"，需同步改两处口径。
5. **前端提示可能误报**：`pathShapeWarnings` 只看"行内是否含 `projects/`"，历史形态与相对文件名都会被提醒（文案已说明"仅提示，不阻断"）。这是 R9 要求"不阻断"的必然结果，不是缺陷。
6. **测试端口竞争**：与既有 `bridge_checkpoint.test.js` 同款 `freePort()` 方案，理论上有极小概率端口被抢占；已实测多次稳定通过。
7. **并行切片干扰**：`npm test` 统计条数含其他切片新增测试，全绿说明互不冲突；但其他切片若同时改 `server/index.js` 或 `src/App.tsx`，需要 Lead 在合入前统一复核 diff（本切片改动区域：`index.js:16-19 / 207-297 / 1489-1494`，`App.tsx:2632-2664 / 2670-2682 / 2765-2766 / 2784-2819 / 2825-2864`）。

## 7. 架构/接口变更建议

1. **把 `validateTaskPaths` 移入独立模块**（如 `server/paths.js`）与 `files.js` 的 `assertPathInsideProject` 共用一套路径判定原语。本次受写范围限制留在 `index.js`，两套逻辑（files.js 折叠 `..`，本函数直接拒 `..`）存在漂移风险。
2. **台账审计与提交预校验共用判据**：建议抽 `classifyTaskPath(pathLike, {projectId, lineId, direction})` 供 `ledger.js`、`files.js`、`validateTaskPaths` 三处调用，消除"提交放行、落盘才判死"的口径差（例如 `projects/<pid>/other/` 与裸相对路径）。
3. **`/api/projects/steps` 增加 `project` 维度**（可选）：当前返回的是全量三线步骤清单，前端再按线取；若将来步骤按项目可配，接口形状需带项目过滤参数。

## 8. 待主 Agent 决策事项

1. 是否要求提交前做**远端存在性校验**（会增加一次 ssh 往返、K40 不可达时提交 503）。当前实现按派发单只校验归属与形态，UI 文案已如实说明。
2. 是否把"同项目非三线子目录"与"裸相对路径"在台账侧也判为合法（消除风险 2 / 3 的口径差）。这会改 `ledger.js`，超出本切片写范围，需要新切片。
3. E2E 全链回归是否安排：需要 Lead 授权一个允许真实跑 K40 分析任务的窗口（会写远端 `projects/PRJ_E2E_GSE277173/` 产物），本切片未执行。
4. 浏览器 UI 目视验收是否由 Lead 或另一队友补（本次只做到 build + tsc + 单测/HTTP 契约层）。

## 9. 建议下一步

1. Lead 复核 `git diff` 中本切片的三处改动与 S28 块完整性，确认无并行切片覆盖冲突。
2. 在合并前再跑一次 `cd BioanalysDesktop; npm test`（当前 339/339），确认并行切片收尾后仍全绿。
3. 若批准 E2E，按 `cn_debug/2026-10-19_e2e_run_pipeline.mjs` 全链跑一次，重点看第 1 步 `prep_matrix`（raw_data 输入）与 `wgcna_modules`（outputs 全在 `processed/`、`figures/`）是否能下发并落台账。
4. 后续切片按第 7 节建议 1 / 2 做路径判据统一，把本切片的 `validateTaskPaths` 与 `files.js`、`ledger.js` 收敛到同一实现。
