[派发单 · 切片 S24] 子 Agent 任务：建项向导补 v3 intake 录入 + IN_HOUSE 通道 + 服务端校验补齐（解 R2/R11/R12/R13）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S21_scout_workbench_gaps.md
     的「疑点 b/c」「风险 R2/R11/R12/R13」「切片建议 #1」:**本切片的缺口清单与验收思路**
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\tests\v3_intake.test.js
     （**30 条用例 = 服务端 v3 intake 四块的契约形状，你的表单字段必须与之对齐**）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\tests\dualmode.test.js
     （IN_HOUSE 建项的服务端契约）
  5) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\src\App.tsx
     （OnboardingPortal :430-1700 一带、submit body :840-877、LAYOUT_TEMPLATE_LABEL :203-207）
  6) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\server\project.js
     与 `server/domain.js`（buildProjectMeta :329-457、normalizePlotLayoutConfig :123-146）
  7) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\aims\ 下规格
     （intake 四块的字段语义以规格为准）
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【文件域】你只改：`BioanalysDesktop/src/App.tsx`、`BioanalysDesktop/server/project.js`、
`BioanalysDesktop/server/domain.js`（如需）、`BioanalysDesktop/tests/*.test.js`（新增/扩展用例）。
**禁止碰**：`portal/`、`ops/`、`src/`、`server/index.js` 路由挂载（除非新增端点，下面规格没让你加）、
其他 server 模块、`docs/`、`con_hf/`（报告除外）。
【并行约束】S18R 在改 `server/figures.js` 与 `src/line3_spatial/`:**你别碰这两个**。

【背景（主 Agent 已裁决）】
- **R2（死路）**：工作台 OnboardingPortal 无法录入 v3 intake 四块（排版/阈值/协变量/
  配对/验证集映射/focus genes/WGCNA 参数:以 v3_intake.test.js 的实际形状为准），
  也进不了 IN_HOUSE 模式（选"自有数据"落 PUBLIC_DB，domain.js:97-101 →
  project.js 拒非 GSM 样本）。手工建项只能用默认值；自有数据项目在工作台建不出来。
- **R11**：species/domain/dataType/sampleCount/contrasts 无服务端校验（脏值静默进 project.json）。
- **R12**：knockout ↔ target_ko_gene 不联动（DAG 含 virtual_knockout 但无靶基因被放行）。
- **R13**：LAYOUT_TEMPLATE_LABEL 键是收敛前旧 id，所有新项目 Studio 显示错误模板名。
- 服务端 intake 四块的**消费链已通**（v3_intake.test.js 30 例 + buildProjectMeta 落盘），
  缺的只是录入 UI 与校验。

【主 Agent 已定死的改动规格（不许自行更改）】

一、App.tsx OnboardingPortal（新增，视觉融入既有表单体系）：
1. **v3 intake 四块录入区**：字段与形状**逐字段照 v3_intake.test.js 的 payload 契约**
   （先读该文件列出四块的字段清单贴进取要，不许自己发明字段名）。默认值取
   服务端 normalize 后的默认（与 v3_intake.test.js 的默认断言一致）。
2. **plotLayoutConfig 选择器**：下拉两项 `template_4x3` / `template_16x9`
   （照 portal/index.html:517-520 的既有先例），默认 `template_4x3`，
   写进 submit body 的 `plotLayoutConfig.templateId`。
3. **IN_HOUSE 通道**：数据来源模式单选（PUBLIC_DB / IN_HOUSE_UPLOAD，语义照
   portal 的同名实现:可参考 portal/index.html:383-390 与 S19 的字段收集逻辑）。
   选 IN_HOUSE 时：显示"自有数据三件套"必填（id_type / value_scale / train_matrix，
   照 dualmode.test.js 的契约），且数据集配对区切换为自有数据形态
   （不需要 GSE 编号，用 LOC 编号:dualmode.test.js 有 LOC 编号断言，照它）。
4. **R13 顺带修**：`LAYOUT_TEMPLATE_LABEL`（App.tsx:203-207）键改为
   `template_4x3` / `template_16x9`（服务端 project.js:123-126 的现行 id），
   旧 id 兼容映射保留（project.js:133-137 有旧 id → 新 id 的映射，照它）。
5. submit body 把 intake 四块 + plotLayoutConfig + IN_HOUSE 字段全部带上
   （形状与 v3_intake.test.js / dualmode.test.js 的 payload 一致）。

二、server/project.js（+domain.js 如需）：
6. **R11 校验补齐**（逐条，失败 400 且 error 点名字段）：
   - `species`：非空且在枚举（Homo sapiens / Mus musculus / Rattus norvegicus:
     照 portal/index.html:下拉的三项；不认识就拒）；
   - `domain`：非空且在枚举（照 portal 下拉七项）；
   - `dataType`：非空且在 DATA_TYPE 枚举（domain.js 既有，别发明新枚举）；
   - `sampleCount`：正整数（≥1，拒绝负数/小数/字符串）；
   - `contrasts`：每条 case/ctrl 必须引用存在的组名；恰好一条 primary
     （groups ≥2 时）。
   - **兼容性红线**：这些校验只对**新建项目**生效；不得破坏
     `tests/project.test.js` / `v3_intake.test.js` / `dualmode.test.js`
     的既有用例（它们是契约；若某旧用例与新校验冲突，停下来上报，不许改旧断言）。
7. **R12 联动**：pipelineDag 含 `virtual_knockout` 而 `target_ko_gene` 为空 → 400
   （error 说明"含虚拟敲除步骤必须提供靶基因"）。
8. **line_id 落盘**：buildProjectMeta 产出的 project.json 增写 `line_id` 字段
   （取值来自建项请求的 lineId；aims.txt:96 示例有该字段）。
   若 lineId 缺失或不在三线枚举 → 400。

三、测试（BioanalysDesktop/tests/）：
9. `v3_intake.test.js` / `dualmode.test.js` **一条不改**（契约护栏）。
10. `project.test.js` 新增用例：R11 六条校验各一条负路径（400 + error 点名）+
    R12 一条 + line_id 落盘一条 + 兼容性（旧形态 payload 仍能建项）一条。
    预期新增 ≥10 条，全绿。

【任务项】
1. 先读 v3_intake.test.js 全文，把四块的字段清单（字段名/类型/默认值）整理成表
   贴进回报第 1 节:这是你的表单 schema，不许走样。
2. 读 dualmode.test.js 的 IN_HOUSE 建项用例，列出三件套与 LOC 编号规则。
3. 实现 App.tsx 表单（四块 + 模板选择 + IN_HOUSE 通道），字段收集进 submit body。
4. 实现 project.js 校验（R11 六条 + R12 + line_id），保持既有用例全绿。
5. 写测试（第 10 条规格）。
6. 自检：`cd BioanalysDesktop && npm test` **全绿**（237 旧 + 新增，一条不许红；
   如有红灯，先判断是你的改动破坏还是既有 flake:S20 报告提过 1 次环境性 flake，
   重跑一次确认；连续 2 次同位置红即是你破坏，修到绿再交付）。
7. 前端构建：`cd BioanalysDesktop && npm run build` 必须成功
   （TypeScript 编译过 = 类型安全的第一道关；贴输出尾行）。
8. E2E 真链验证（起真服务打真 HTTP，照 auth.test.js / index.test.js 的做法，
   临时端口 + 不碰真实远端）：
   - POST /api/projects/create 带全量 intake payload（含 IN_HOUSE + 16:9 模板）
     → 200，且落盘的 project.json 四块齐全、line_id 正确、plotLayoutConfig 正确；
   - R11 六条负路径各 POST 一次 → 400 且 error 点名；
   - R12 负路径 → 400；
   - **IN_HOUSE 全链**：IN_HOUSE payload → 200 → project.json 的
     data_source_mode='IN_HOUSE_UPLOAD' + LOC 编号正确（照 dualmode.test.js）。
   验证脚本落 `cn_debug/2026-10-20_verification_s24_intake_e2e.mjs`（幂等可复跑）。
9. 客户端构建产物 dist/ 会由 npm run build 更新:**这是允许的**（dist 在文件域内）；
   但不要手工改 dist 文件。
10. **每完成一步就更新一次 `con_hf/dispatch/S24_report.md`**（硬要求）。

【硬性禁止】
- 禁止改 `tests/v3_intake.test.js`、`tests/dualmode.test.js` 的任何断言。
- 禁止碰 `portal/`、`ops/`、`src/`、`server/figures.js`（S18R 在改）、
  `server/index.js` 路由、`docs/`、真实 `projects/` 数据。
- 禁止发明 v3 intake 之外的新字段名；字段语义有疑问以
  v3_intake.test.js + aims 规格为准，冲突时停下上报。
- 禁止为过测试放宽新校验；也不许为过新校验改旧断言（两头都不许动，
  冲突即上报）。
- 禁止把"表单应该能录入"写成已验证；E2E 必须真打 HTTP。
- App.tsx 是 2812 行的主文件：**改动最小化**，不做顺手重构/格式化；
  新增表单区块插入位置照既有 step 分区结构。

【验收标准】
A1 v3 intake 四块字段清单表（来自 v3_intake.test.js，逐字段）贴出，表单与之对齐。
A2 模板选择器 + R13 标签修复落地；IN_HOUSE 通道可达且三件套/LOC 编号正确。
A3 R11 六条 + R12 + line_id 服务端校验生效，负路径 400 点名。
A4 `npm test` 全绿（237 旧 + ≥10 新）；`npm run build` 成功。
A5 E2E 脚本全过（含 IN_HOUSE 全链），脚本落指定路径且幂等。
A6 旧契约测试（v3_intake/dualmode/project/portal_*）零改动且全绿。
A7 dist/ 由构建产出，无手工编辑。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入
`con_hf/dispatch/S24_report.md`。
