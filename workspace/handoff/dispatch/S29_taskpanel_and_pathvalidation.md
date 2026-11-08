[派发单 · 切片 S29] 子 Agent 任务：TaskPanel 改造（R8 种子违约 + R9 无路径预校验 + R10 全自由文本）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S21_scout_workbench_gaps.md
     的「疑点 e」（任务执行的契约缺口，本切片的问题清单）
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\src\App.tsx
     的 `TaskPanel`（:2138-2349，含 :2266-2268 步骤文本域、:2284-2294 输入输出多行域、
     :2141 种子默认 `'42'`）与 `LINE_STEPS`（工程里既有常量，先找到它）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\server\index.js
     的 `/api/tasks/submit`（:1189-1322，inputs/outputs 的类型校验在 :1226-1235）
     与 `/api/projects/steps`（:700-705，步骤清单接口）
  5) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\aims\aims.txt §一.3
     （**契约种子固定 20261013**， R8 的规格依据）
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【文件域】你只改：`BioanalysDesktop/src/App.tsx`、`BioanalysDesktop/server/index.js`
（只加校验，不改既有端点契约）、`BioanalysDesktop/tests/task_submit_validation.test.js`（新建）。
**禁止碰**：`ops/`、`src/` 三线、`portal/`、`server/task.js`、`server/run.js`、
`server/report.js`、`tests/task.test.js` 既有断言。
【并行约束】S28 正在改 `server/task.js` 与 `server/index.js` 的 submit 链路
（桥接接线）——**你只许在 submit 的校验链里追加"路径预校验"这一段**，
若发现与 S28 的插入点冲突（同一处代码），**停下来上报**，不许覆盖它的改动。

【背景（主 Agent 已实测）】
- **R8（违反契约）**：`App.tsx:2141` 种子默认值 `'42'`，而 aims §一.3 固定
  `seed = 20261013`。用户不改种子就提交 → 违反固定种子铁律，结果不可复现。
- **R9（无语义校验）**：inputs/outputs 服务端只校验"字符串数组"类型
  （index.js:1226-1235）；指向**另一个项目**的同线路径提交时放行，
  要等任务跑完写台账才被 ledger.js 判"跨项目"拒绝——**任务已经真跑了**。
- **R10（全手工填写）**：TaskPanel 的 step 是自由文本、inputs/outputs 是多行自由文本；
  placeholder 是缺 `projects/<项目>` 段的旧路径（:2286、:2293），会误导用户填错。

【主 Agent 已定死的改动规格（不许自行更改）】

一、`App.tsx` TaskPanel（R8/R10）：
1. **种子默认值 `'42'` → `'20261013'`**；并在种子输入框旁加静态说明文字：
   "契约固定种子 20261013（aims §一.3）；改动将使结果不可复现"。
   **不改种子输入框本身的可编辑性**（运维可能真要改，但默认必须合规）。
2. **step 改为下拉选择**：选项来自 `/api/projects/steps`（该端点已存在，
   返回当前项目的步骤清单）；**同时保留自由文本入口**（下拉 + "自定义"项），
   因为新步骤可能还没进清单——不许把用户路堵死。
3. **inputs/outputs 的 placeholder 修正**：改为含 `projects/<项目>` 段的
   现行路径形态（照远端实际目录 `projects/<id>/<line>/processed/...`），
   并在域下方加一行提示："路径须属于当前项目 `<projectId>`；提交前会校验存在性与归属"。
4. **提交前的客户端预检**（减少无效提交，不是替代服务端校验）：
   inputs/outputs 每行非空时，提示"须为 `/mnt/ssd/bio_data/projects/<当前项目>/...`
   形态"——仅做**形态提示**（如明显缺 `projects/` 段时黄色警告），
   **不得阻断提交**（真正的校验在服务端，双保险不冲突）。

二、`server/index.js` 的 submit 校验链追加（R9）：
5. 新增**纯函数** `export function validateTaskPaths(inputs, outputs, projectId)` →
   `{ ok:true }` 或 `{ ok:false, error }`，规则：
   - 每条路径必须**属于当前项目**：形如
     `/mnt/ssd/bio_data/projects/<projectId>/...`（ projectId 精确匹配，
     大小写敏感；不允许 `..`、不允许指向别的项目目录、不允许绝对路径逃逸）；
   - 允许 `projects/<projectId>` 下的任意子路径；**不允许** `system_logs`、
     `public_references` 等非本项目产物目录（只读白名单思路：
     输入输出都应落在本项目 raw_data/processed/results/figures 之下，
     具体白名单以仓库既有约定为准，先读 ledger.js/audit.js 的路径规则再定）；
   - 负路径 error 必须**点名是哪一条路径、为什么非法**（跨项目/缺 projects 段/含 ..）。
6. 接线位置：**在 S28 的桥接检查之前**（路径归属是更基础的校验；
   若 S28 已插在类型校验之后，你插在它前面；若发现它插在最前，你退一位插它后面
   **并上报**）。
7. **兼容性红线**：历史上已有任务用 `/mnt/ssd/bio_data/<line>/processed/...`
   （旧形态）提交成功（E2E 脚本就是这么提交的）——新校验**必须兼容两种形态**：
   `/mnt/ssd/bio_data/projects/<pid>/<line>/...`（现行）与
   `/mnt/ssd/bio_data/<line>/...`（迁移前历史形态，视为 default 项目或按
   ledger.js 的兼容逻辑处理——**先读 ledger.js:105-108 的跨项目判据再定**）。
   不允许因新校验让 E2E 脚本或既有用法失效（`npm test` 里有 E2E 提交用例，
   全绿即证）。

三、测试 `tests/task_submit_validation.test.js`（新建，≥8 条，全绿）：
8. `validateTaskPaths` 单测：现行形态合法 / 历史形态合法 / 跨项目路径拒 /
   含 `..` 拒 / 缺 projects 段且非历史形态拒 / system_logs 越界拒 /
   空数组 ok / error 点名路径（≥8 条）。
9. 提交层真 HTTP（假 ssh 垫片）：合法路径走到下发；跨项目路径 **400 点名**
   且**不产生 ssh 下发**（垫片调用计数为证，证明是提交前拦下的）。

【任务项】
1. 读上述文件，贴出：`/api/projects/steps` 的返回形状、ledger.js:105-108 的
   跨项目判据、audit.js 的路径规则（你的校验要与它们同口径）。
2. 实现 App.tsx 三处改动 + 服务端 validateTaskPaths 与接线。
3. 写测试（≥8 条）。
4. `cd BioanalysDesktop && npm test` **全绿**（贴尾行）；`npm run build` 成功（贴尾行）。
5. 回归：`cn_debug/2026-10-19_e2e_run_pipeline.mjs` 若有提交环节，跑一次确认
   历史提交形态没被新校验打断（贴结果；跑不动就说明原因并标注未运行）。
6. **每完成一步更新一次 `con_hf/dispatch/S29_report.md`**（硬要求）。

【硬性禁止】
- 禁止改 `tests/task.test.js` 既有断言、`server/task.js`、`server/run.js`。
- 禁止把种子输入框改为不可编辑（堵死运维路径）。
- 禁止让新校验打断历史路径形态的提交（兼容两条形态是硬要求）。
- 禁止覆盖 S28 的 submit 插入点（冲突就停下上报）。
- 禁止把"应该能拦住"写成已验证；负路径必须真打 HTTP。

【验收标准】
A1 种子默认 20261013 + 说明文字；输入框仍可编辑。
A2 step 下拉（来自 /api/projects/steps）+ 自定义入口；placeholder 路径形态已修正。
A3 `validateTaskPaths` 导出，≥8 条单测含跨项目/`..`/越界/error 点名。
A4 提交层接线顺序正确且不与 S28 冲突（或已上报）。
A5 历史形态提交不破（E2E 或 npm test 既有用例为证）。
A6 `npm test` 全绿 + build 成功。
A7 跨项目路径真 400 且无 ssh 下发（垫片计数为证）。

【回报】按 SUBAGENT_CONTRACT.md 输出契约返回，并写入上述 report 文件。
