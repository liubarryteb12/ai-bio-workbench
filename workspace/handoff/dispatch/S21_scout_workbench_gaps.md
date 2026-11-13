# S21-scout · 工作台功能盘点报告（服务端 + 客户端真实缺口侦察）

> 切片性质：**纯只读侦察**。本报告未启动任何服务、未发出真实 HTTP 请求、未运行 `npm test`
> （派发单明令禁止，运行类验证归实现切片）。文中所有"有测试"均指**测试文件中存在对应用例**，
> 不代表已运行通过；所有行号对应 2026-10-20 读取时的文件状态。
>
> 工程事实：项目根 **不是 git 仓库**（`git status` 报 `fatal: not a git repository`），
> 无版本控制可回滚，改动前需另行备份。
>
> 文件域声明：`BioanalysDesktop/` 与 `portal/` 归本会话（sw-engineer）维护；
> `ops/`、`bin/`、`src/line*/scripts/` 归 default 会话主导，本报告对它们只读记录、不给改动建议。

---

## 规格功能清单与三态判决表

规格基准：`aims/aims.txt`（v2.4，417 行）+ `docs/figure_spec.md` + `docs/delivery_package_spec.md`。
判决分三态：**已实现**（API/UI/测试三者有其二且有代码证据）、**部分实现**（缺一半，注明缺什么）、**缺失**（仓库无任何对应实现）。

### 1. 架构与鉴权（aims §一.1，aims.txt:9-14）

| # | 规格功能（出处） | 判决 | 证据 / 缺口 |
|---|---|---|---|
| F1 | 四大前端视图导航（aims §三，aims.txt:65-159） | 已实现 | `BioanalysDesktop/src/App.tsx:284-289`（VIEWS 四键），`:418-421` 挂载 OnboardingPortal / CustomerInputConsole / PreFlightDashboard / ResultPreviewStudio |
| F2 | 本地零算力红线（aims.txt:9） | 已实现 | `server/proc.js:12`（白名单 ssh/scp/adb）、`:50-57`（assertAllowedProgram）；proc.test.js 6 例 |
| F3 | HTTP/S + Token 鉴权支持外网建项/上传/预览（aims.txt:10） | 部分实现 | 8787 有 Basic auth：`server/index.js:51-79`，auth.test.js 7 例；**portal（8080）无任何鉴权**——`portal/serve.mjs` 全文（536 行）无 auth 代码，且文件头注释自述"可单独内网穿透给客户"（:5-8）。aims 要求的 Token 鉴权在 portal 侧缺失 |
| F4 | 断链自动重连（00_link_check.ps1 心跳 + monkey 拉起 基础用户空间）（aims.txt:10） | 部分实现 | `server/link.js:161-190` 四段探测（设备/forward/基础用户空间/容器）+ runit 服务状态，link.test.js 4 例；但 **ps1 心跳状态与 tmux 守护会话 PID 无任何实现**（link.js 只探 runit `sv status`，不探 tmux） |
| F5 | 长任务 nohup/tmux 守护 + exit 0 检查点断点续跑（aims.txt:14） | 部分实现 | 任务执行 `server/run.js:30-107`（spawn ssh 流式 + 退出码台账）；**无 tmux/nohup 包装**（`ops/bio_watchdog.sh`、`ops/run_throttled_task.sh` 存在但服务端不调用，task.js:89-97 的 throttled 分支无调用方传 `throttled=true`）；任务级 resume 无 API/UI |

### 2. 视图 1 · 新建项目向导（aims §三.1，aims.txt:67-136）

| # | 规格功能（出处） | 判决 | 证据 / 缺口 |
|---|---|---|---|
| F6 | 模块 A：名称/描述/物种/非肿瘤领域/疾病名（aims.txt:71） | 已实现 | `App.tsx:1229-1291`（表单）、`:1269-1290`（物种三选一、领域下拉）；project.test.js:130-131、v3_intake.test.js:304 覆盖黑名单拦截 |
| F7 | 模块 A：前端正则黑名单实时红字拦截（aims.txt:71） | 已实现 | `App.tsx:521-553`（350ms 防抖调 `/api/blacklist/check`）、`server/index.js:683-697`、`server/tumor_blacklist.js:50-59`。**仅 name/description/disease 三个字段实时校验**；tissue/notes/分组名/focus_genes 只有建项时服务端兜底（project.js:333-359） |
| F8 | 模块 B：数据来源 GEO/ArrayExpress/自有 + train_gse/val_gse/gpl/样本数/组织（aims.txt:73） | 部分实现 | 配对表 UI `App.tsx:1325-1369`；`server/domain.js:174-222` 归一化（新格式透传/旧格式按位置推断）；datasets.test.js 12 例。**"自有数据"是死路**：选它不传 `data_source_mode`，服务端回落 PUBLIC_DB（domain.js:97-101），非 GSM 样本号被拒（project.js:378-384），且无 id_type/value_scale 录入 UI（App.tsx 全文无 `data_source_mode`/`IN_HOUSE`/`id_type` 字样） |
| F9 | 模块 B：协变量（batch_col/年龄/性别）（aims.txt:73） | 缺失（工作台侧） | App.tsx 无 covariate/batch 任何字段；`server/project.js:156-168` normalizeExperimentalDesign 只能从 intake 导入的 `experimentalDesign.cov` 取值，手工建项无法填 |
| F10 | 模块 B：三种分组模式 + 动态增组 + Reference/stage_order（aims.txt:74） | 已实现 | `App.tsx:1388-1404`（模式 chips）、`:630-690`（增删/角色/排序）、`:1424-1502`（分组卡片） |
| F11 | 模块 B：组内样本编号录入 + 跨组防重（aims.txt:75） | 已实现（客户端）/ 部分实现（服务端） | 客户端查重 `App.tsx:611-628`、`:1488-1490`；服务端 `project.js:368-376`。**服务端防重规则无任何测试**（project.test.js 无用例） |
| F12 | 模块 B：一键导入两列 Sample_ID,Group_Name（aims.txt:75） | 已实现 | `App.tsx:693-719`（applyBulkPaste）、UI `:1406-1422` |
| F13 | 模块 B：≥3 组显式对比对 + 主对比（aims.txt:76） | 已实现 | `App.tsx:721-751`（自动生成两两对比）、`:1504-1526`（勾选 + 主对比单选）；服务端不做 contrasts 引用校验（见风险 R11） |
| F14 | 模块 B：分片上传器 5MB 断点续传 + 格式校验（aims.txt:77） | 部分实现 | `server/upload.js`（init/chunk/status/complete，CHUNK_SIZE=**4MB**，:21）→ `server/index.js:1049-1171`；客户端 `App.tsx:2555-2668`。**不在向导模块 B 内**（在 Console 视图"数据导入"页）；**无断点续传**——`/api/upload/status` 存在但客户端从不调用，每次上传都新建 uploadId 从头传；分片大小与 aims 的 5MB 不一致 |
| F15 | 模块 C：第一级分析线单选物理锁（aims.txt:81） | 已实现 | `App.tsx:1534-1545`（LINES chips 单选）；服务端 audit.js:38-66 兜底拒跨线命令，audit.test.js 9 例 |
| F16 | 模块 C：第二级步骤勾选 + 4 项说明卡片（aims.txt:82） | 已实现 | `/api/projects/steps`（index.js:700-702）→ PIPELINE_STEP_META（project.js:258-310，含 desc/tool/io/note）；UI `App.tsx:1547-1592` |
| F17 | 模块 C：下游模块勾选**排序**（aims.txt:82） | 缺失（有意） | UI 按母版固定顺序渲染，无排序控件；App.tsx:1094-1095 注释说明"母版顺序即验证过的依赖顺序"。规格要求"支持勾选与排序"，实现只做勾选 |
| F18 | 模块 C：勾选虚拟敲除强制 target_ko_gene（aims.txt:82） | 部分实现 | 客户端强制（App.tsx:778、:1577-1583）；**服务端不强制**——project.js:100-116 normalizeBiologicalPriors 只归一化字符串，不检查 pipelineDag 是否含 knockout 步骤 |
| F19 | 模块 C：第三级算法/阈值参数设置（aims.txt:83） | 缺失（工作台侧） | 服务端有 ANALYSIS_CUTOFFS 三档 + WGCNA_CONFIG_DEFAULTS（project.js:27-97）且 v3_intake.test.js:22-46 覆盖，但**工作台无任何参数录入 UI**，只能经 portal 需求单导入透传（App.tsx:876） |
| F20 | 模块 D：ACL owner/collaborator（aims.txt:87） | 部分实现 | UI `App.tsx:1601-1615` → aclAndOutput（:834-838）；服务端不校验 role 枚举、collaborators 格式（project.js 无 ACL 校验代码） |
| F21 | 模块 D：算力削峰只读说明卡片（aims.txt:88） | 已实现 | `App.tsx:1617-1628`（nice/ionice、不绑核、3 线程、7.5GB 熔断、exit 0 检查点） |
| F22 | 模块 D：预期交付物勾选（Web 图集/tsv/矢量/检查点/台账）（aims.txt:89） | 部分实现 | UI `App.tsx:1630-1680` → expectedFormats（:827-832）。**标签写 "150 DPI PNG"**（:1638），与 aims §五.2 的 300 DPI（aims.txt:229）及服务端 `dpi: 300`（project.js:150）矛盾；映射值本身是 `png_300dpi`（:828） |
| F23 | 建项配置与 project_manifest.json 1:1 对齐（aims.txt:69、91-136） | 部分实现 | 四段式 + intake 四块均有落盘（project.js:409-457）；**缺 `line_id` 字段**——aims 示例（aims.txt:96）顶层有 `line_id`，服务端不存，改为按 pipelineDag/dataType 现推（index.js:663-664）；dataType/species/domain 不校验枚举（见疑点 c） |
| F24 | 客户需求收件箱导入（portal/inbox → 表单） | 已实现 | `App.tsx:923-1137`（导入映射）、`:1141-1227`（列表 UI）；`server/index.js:733-788`；index.test.js:128-183（列表/单文件/穿越/404） |

### 3. 视图 2 · 客户分析输入控制台（aims §三.2，aims.txt:140-142）

| # | 规格功能（出处） | 判决 | 证据 / 缺口 |
|---|---|---|---|
| F25 | 任务下发 + 实时日志 + 中止 | 已实现 | `App.tsx:2138-2343`（TaskPanel）；`server/index.js:1189-1354`（submit/stop/logs SSE）；index.test.js:65-125、task.test.js 12 例、run.test.js 11 例 |
| F26 | 快速核对 GSE/GPL 分组信息 | 缺失 | Console 四个子页（App.tsx:1707-1721：任务/导入/文件/台账）均不展示当前项目的 basicInfo/groups/datasets；项目元数据只在 Studio 顶部 strip 展示（App.tsx:1968-1988） |
| F27 | 微调单步参数 | 部分实现 | 只有自由文本 step + inputs/outputs + seed（App.tsx:2263-2296），无步骤下拉、无参数表单、无项目级阈值覆盖 |
| F28 | 触发断点续跑 | 缺失 | 无 resume API/UI（同 F5） |
| F29 | 查看当前流水线实时进度 | 部分实现 | 单任务 SSE 日志有（App.tsx:2164-2184）；无"流水线整体进度"视图（哪些步骤完成/失败/未跑） |
| F30 | 数据导入（分片上传） | 部分实现 | 同 F14 |
| F31 | 数据面文件浏览 | 已实现 | `App.tsx:2349-2449`；`server/index.js:890-924` + files.js；files.test.js 12 例 |
| F32 | 台账巡检 + 导出 | 部分实现 | `App.tsx:2674-2812`（LedgerPanel，含 txt 导出）；`server/index.js:860-888`。**无筛选**（aims.txt:154 要求按分析线/状态/耗时/内存峰值筛选）：byLine 分组有，状态筛选无，且 API 不回传耗时/内存（ledger.js:112 只回 lineId/stepName/status/problems/legal） |

### 4. 视图 3 · 服务端运维与审计控制台（aims §三.3，aims.txt:144-154）

| # | 规格功能（出处） | 判决 | 证据 / 缺口 |
|---|---|---|---|
| F33 | 自检灯 1：路径与 FUSE 红线（df -T 只读）（aims.txt:147） | 已实现 | `server/index.js:794-800`（fs_type 检查，含 fuse/sdcardfs 阻断） |
| F34 | 自检灯 2：F2FS 存储水位 <20% 告警（aims.txt:148） | 已实现 | `server/index.js:801-809`（freePct >= 20 判 pass） |
| F35 | 自检灯 3：SoC 算力、**温度**与 **7.5G 内存配额水位**（aims.txt:149） | 部分实现 | `server/index.js:810-816` 只 `cat /proc/meminfo | head -1`（MemTotal 一行）；**无温度、无 7.5GB 配额水位**。算力数在 link 段（index.js:838 展示 cpus/mem） |
| F36 | 自检灯 4：跨线隔离 **+ R/Python 桥接四项断言**（aims.txt:150） | 部分实现 | `server/index.js:817-823` 跑 `check_storage_and_isolation.sh line1_bulk`——**硬编码 line1**，line2/line3 的静态扫描没做；`ops/verify_bridge_checkpoint.py`（桥接四项断言）**不被服务端消费**，无任何代码引用 |
| F37 | 自检灯 5：ADB/SSH 守护链路 + tmux PID（aims.txt:151） | 部分实现 | `server/index.js:824-842`（checkLink 四段 + runit 服务）；**tmux 会话 PID 未展示**（link.js 不探 tmux） |
| F38 | `/api/link/check` 独立链路接口 | 部分实现 | `server/index.js:847-858` + link.test.js 4 例；**客户端无任何消费**（App.tsx 全文无 `/api/link/check` 引用，PreFlightDashboard 只调 `/api/selfcheck`，App.tsx:1738） |
| F39 | 台账可视化检索 + 多维筛选（aims.txt:154） | 部分实现 | 同 F32 |

### 5. 视图 4 · 结果预览与交付（aims §三.4）+ 出图与交付规范

| # | 规格功能（出处） | 判决 | 证据 / 缺口 |
|---|---|---|---|
| F40 | 左侧流水线步骤树（aims.txt:158） | 部分实现 | `App.tsx:1993-2017` 左树是**图件文件名列表**（按线分组），不是流水线步骤树 |
| F41 | 300 DPI PNG 图廊（Web CSS 缩放）（aims.txt:158、229） | 已实现 | `server/index.js:926-1047`（list/image，本地副本优先 + source 标注）；`App.tsx:2020-2082`（图廊 + 放大模态）；figures.test.js 12 例、pull.test.js 10 例 |
| F42 | Top 500 行交互式 .tsv 表格（aims.txt:158） | 缺失 | `App.tsx:2041-2045` 只有一句提示文字（"TSV 表格预览通过 /api/files/tree …展示"），无读取 .tsv 内容的 API 或 UI |
| F43 | AI 结构化三段式解读（结论→依据→限制）（aims.txt:158） | 部分实现 | `App.tsx:2084-2115` 解读卡片是按 DEG/DR 分类的**固定模板文案**（:1908-1938），非 AI 生成；DEG/DR 防混淆强标签已实现（:1891-1905、:2066） |
| F44 | 图件回搬本地（aims §三.4 + pull.js 头注释） | 已实现 | `server/pull.js:101-168` + `server/index.js:954-990`；任务成功自动回搬（index.js:1292-1303）；pull.test.js 10 例 |
| F45 | 后端出图预览页 `/preview/figures` | 已实现 | `server/index.js:992-1012` + renderFiguresPreview（:252-310），三线画廊 + 中文 caption（figures.js:69-177） |
| F46 | 图表排版 4:3/16:9 全链路（aims v3.0 模块 D；project.js:118-153） | 部分实现 | portal 有选择器（portal/index.html:517-520、:1842-1843）→ 服务端消费（index.js:639 → project.js:445 → project.json）→ 任务脚本注入 BIOANALYS_PROJECT_JSON（task.js:63-71，layout_inject.test.js 9 例）→ Studio 展示（App.tsx:1971）。**缺工作台向导侧选择 UI**（手工建项只能默认 template_4x3）；Studio 标签映射过期（见疑点 b） |
| F47 | 出图规范执行（300 DPI/bbox tight/大矩阵熔断/固定配色/KO 角标）（aims §五，aims.txt:226-231） | 已实现（属 src/+ops/ 域，非工作台软件） | `ops/fig_theme.py`、`ops/audit_figure_layout.py`、`ops/layout_autoload/`；工作台侧只消费产物。归 default 会话域，本切片只记录不改 |
| F48 | 客户交付报告（HTML 七章 + 打包）（aims §七.3，aims.txt:413；docs/delivery_package_spec.md） | 缺失（工作台侧） | 引擎 `ops/build_client_report.py` 存在（2206 行 CLI，内置 --self-test）；**8787 无任何调用/API/UI/测试**；spec 规定的打包入口 `ops/09_package_delivery.ps1` **在仓库中不存在**（ops/ 目录无 09 文件，delivery_package_spec.md:37 以此为调用契约）。详见疑点 a |
| F49 | 审计台账按线/状态/耗时/内存峰值筛选（aims.txt:154） | 部分实现 | 同 F32/F39 |

---

## 疑点 a–h 逐条结论

### a. 客户交付报告 —— 引擎在、工作台整域缺失

- `ops/build_client_report.py` 存在（2206 行，`--project/--no-tar/--dry-run/--self-test`，声称按 aims v3.0 §7.2 七章结构生成 `Analysis_Report.md/html` 并打 `<project_id>_Client_Delivery.tar.gz`）。
- **8787 服务端不调用它**：`server/*.js` 16 个模块全文检索 `build_client_report` 零命中；23 个端点（index.js:579-1333）无 report/deliver/download 类接口（检索 `report|deliver|download` 仅命中 project.js 的步骤 io 说明文字）。
- **无 API、无 UI、无测试**：BioanalysDesktop/tests/ 22 个文件无一引用；App.tsx 无报告相关 UI（唯一下载功能是台账巡检 txt 导出，App.tsx:2690-2709）。
- **客户端不能触发报告生成与下载**。报告只能人工 ssh 上服务器跑 CLI；历史产物（`con_hf/IS_client_Analysis_Report.md`、`deliverables/2026-10-20_IS_项目解读报告.md`）都是手工流转的结果。
- 附带事实：`docs/delivery_package_spec.md:37` 规定的打包入口 `ops/09_package_delivery.ps1` 在 ops/ 目录中不存在（该 spec §九还明确写"工作台前端：无交互入口，纯命令行工具"）。即交付域现状 = Python 引擎（default 会话域）+ 缺失的 PS 包装 + 工作台零集成。
- 结论：**aims §七.3 与用户本轮八大功能域中的"客户交付报告"在工作台侧完全缺失**；引擎可用但入口全无。

### b. 图表排版（4:3/16:9）—— 服务端消费链完整，工作台向导无选择 UI，Studio 标签过期

- **portal → 8787 → project.json 链路已通**：portal/index.html:517-520 画幅下拉（template_4x3 / template_16x9）→ :1842-1843 写入 `plotLayoutConfig.templateId` → 收件箱导入透传（App.tsx:1014、876）→ `index.js:639` 传入 buildProjectMeta → `project.js:445` normalizePlotLayoutConfig 归一化（含旧 id 兼容映射，:133-137）→ `buildCreateProjectCommand`（project.js:499-506）base64 写入项目 project.json → 任务执行时 `task.js:68` 注入 `BIOANALYS_PROJECT_JSON`，`ops/layout_autoload/`（sitecustomize.py + Rprofile + Rscript 垫片）在解释器启动时套模板；layout_inject.test.js 9 例固化该注入。
- **工作台客户端无排版选择 UI**：OnboardingPortal 全部表单 state（App.tsx:438-488）与 submit body（:840-877）都没有 plotLayoutConfig——手工建项只能用默认 template_4x3（project.js:127、146），客户在需求单上确认的 16:9 只在"从收件箱导入"路径能带进来。
- **Studio 展示标签过期**：`App.tsx:203-207` 的 `LAYOUT_TEMPLATE_LABEL` 键还是收敛前的三套旧 id（template_1_nature_side 等），而服务端现在只产 template_4x3/template_16x9（project.js:123-126）。结果：所有新项目 Studio 顶部都显示"未指定（按默认 Nature 侧边型）"（App.tsx:1971），与实际生效模板不符。
- 结论：**服务端消费 ✓、portal 选择 ✓、工作台向导录入 ✗、Studio 标签 ✗（过期映射）**。

### c. 建项契约校验 —— 覆盖了什么、漏了什么

`server/project.js` buildProjectMeta（:329-457）**有**校验的：
1. projectId 消毒（:330-331，domain.js:329-336）
2. 非肿瘤黑名单：name/description/disease/tissue/notes/分组名/focus_genes（:333-359）
3. 分组设计：样本跨组重复（:368-376）、样本编号格式按模式切换（:378-384）、≥2 组（:386-388）、有且仅 1 个 reference（:390-393）
4. IN_HOUSE 模式必填三件套 id_type/value_scale/train_matrix（domain.js:254-262，经 :397 归一化触发）
5. 验证集映射两侧样本重叠抛错（:193-195）、类型非法作废（:185-190）
6. dataFiles 路径穿越/绝对路径拒绝（:215-217）

**没有校验的（具体例子）**：
1. **dataType 不校验枚举**：公共模式下 `data_source` 是 `{...params.dataSource, datasets, datasets_inferred}` 原样透传（project.js:431-435），dataType 可以是任意字符串或缺失；domain.js:144-147 的 normalizeDatasetDataType 只用于行级兜底，项目级没人调。缺 dataType 时选线只能靠 pipelineDag 反推（index.js:663），推不出则数据文件部署失败（index.js:531-538）。
2. **species 不校验**：basicInfo.species 缺失直接默认 'Homo sapiens'（project.js:417），拼错（如 "Homo Sapiens"、"human"）静默接受。
3. **domain 不校验**：缺失落空串（project.js:416），aims.txt:71 要求的下拉选择没有服务端枚举约束。
4. **pipelineDag 不校验步骤归属**：任何 stepId 都照单全收，line1_bulk 项目里写 'virtual_knockout' 也合法；`line_id` 本身不落盘（aims.txt:96 示例有该字段）。
5. **sampleCount 不校验**：项目级样本数原样透传（可为负数/小数/字符串）。
6. **contrasts 不校验**：case/ctrl 可引用不存在的组名；不校验有且仅一个主对比。
7. **knockout 与 target_ko_gene 不联动**：DAG 含 virtual_knockout 但 target_ko_gene 为空，服务端放行（project.js:111-114 只 trim）。
8. **aclAndOutput.role / expectedFormats 不校验**枚举。
9. **IN_HOUSE 模式在工作台不可达**（见 F8）：data_source_mode 无录入 UI，选了"自有数据"也落 PUBLIC_DB，非 GSM 样本被拒——这是"校验存在但入口缺失"的组合断链。

### d. 上传 —— 两套并存、用途不同、互不知晓

- **8787 `/api/upload/*`**：init/chunk/status/complete 四端点（index.js:1049-1171），4MB 分片、本地 `.uploads/` 暂存、magic bytes 校验（upload.js:58-76）、scp 直落 `projects/<id>/<line>/raw_data/`。客户端 **UploadPanel 用的就是这套**（App.tsx:2570-2590）。
- **portal `/api/datafiles`（+`/api/references`）**：serve.mjs:142-262、:444-489，整文件裸流（非分片）、5GiB 上限、落 `inbox/uploads/<sid>/`，提交时归档进 `PKG_*` 包。客户用的是这套。
- **两套不是共用，文件也不会丢，但有关联缺口**：
  1. UploadPanel 传上去的文件**不写进 project.json 的 data_files**（submit body 无 dataFiles，App.tsx:840-877），建项契约与上传状态无关联；
  2. portal 上传的文件只在"从收件箱导入建项"时由 `deployDataFiles`（index.js:527-574）scp 部署到远端，且 group_map 角色被改名成母版契约名 grouping.txt（upload.js:220-224）；手工建项不会部署；
  3. 白名单两套不同：8787 允许 .h5/.loom/.soft/.tar/.rdata（upload.js:24-27），portal 允许 .xlsx 但不允许 .h5/.soft/.tar/.rdata/.loom（archive.mjs:23）——同一份数据走不同入口校验结论不同；
  4. 8787 侧**无断点续传**（status 端点存在但客户端不调用）。
- 结论：**两套独立系统，客户/管理员各一套；断点在"上传记录不进建项契约"和"无续传"**。

### e. 任务执行 —— inputs/outputs 服务端只有类型校验；客户端是自由文本不是选择器

- 服务端校验（index.js:1201-1267）：lineId 枚举、projectId 消毒、step 必填 + `^[A-Za-z0-9._-]+$` 字符集（:1216-1220）、**inputs/outputs 只校验"字符串数组"类型**（:1226-1235）、同项目同线同步骤去重（:1237-1243）、buildTaskScript + auditCommand 审跨线（:1258-1267）。
- **inputs/outputs 没有路径存在性/项目归属校验**：auditCommand 只扫脚本文本里的跨线字面量（audit.js:38-66）；指向**另一个项目**的同线路径（如 `/mnt/ssd/bio_data/projects/OTHER/line1_bulk/...`）提交时放行，要等任务跑完写台账时才被 ledger.js:105-108 判"跨项目"、run.js:91-94 拒绝落盘——任务已经真跑了。
- 客户端 TaskPanel：**step 是自由文本输入框**（App.tsx:2266-2268，placeholder 提示字符集），**inputs/outputs 是多行自由文本域**（:2284-2294）——既不能从 LINE_STEPS 选步骤，也不能选文件；placeholder 还是旧路径形态 `/mnt/ssd/bio_data/<line>/processed/...`（缺 `projects/<项目>` 段，:2286、:2293），会误导用户填错。
- 结论：**契约有类型级校验，无语义级校验；客户端全手工填写**。

### f. 自检/审计台账 —— 三个接口各自职责与客户端消费情况

- `/api/selfcheck`（index.js:791-845）：五灯 = fs_type / storage / memory / isolation / link。客户端 **PreFlightDashboard 完整消费**（App.tsx:1729-1798：all_pass 徽章 + 每灯状态点/value/detail）。缺维度见 F35-F37。
- `/api/link/check`（index.js:847-858）：四段探测 + 服务状态 + 算力。**客户端零消费**——App.tsx 检索 `/api/link/check` 零命中；PreFlightDashboard 只走 /api/selfcheck（其内部 link 灯复用 checkLink）。
- `/api/ledger/check`（index.js:860-888）：SSD 未挂载显式 blocked（:863-871），逐条 auditLedgerEntry + summarizeLedger。客户端 **LedgerPanel 完整消费**（App.tsx:2674-2812：总数/合法/违规、按线表、逐条明细、txt 导出）。**缺 aims.txt:154 要求的筛选**（状态/耗时/内存峰值），且 API 形状就不支持——ledger.js:112 只回 6 个字段，耗时（start/end_time）与 resource_usage 被丢弃。
- 结论：**selfcheck 消费完整但维度缺；link/check 有 API 无 UI；ledger 消费完整但无筛选**。

### g. 结果预览/图表 —— API 面齐全，客户端一半齐全、一半缺失或死代码

- `/api/figures/list`（index.js:926-952）：列图件 + caption + 来源标注（本地优先/远端回落）；`/api/figures/image`（:1014-1047）：取字节（本地副本优先）；`/api/figures/pull`（:954-990）：回搬；`/preview/figures`（:992-1012）：服务端渲染三线画廊（不依赖 React 构建，适合目视审核）。
- 客户端 **ResultPreviewStudio 齐全部分**：列表（:1829-1851）、回搬（:1854-1881）、图廊 + 放大模态（:2020-2082、:2118-2129）、DEG/DR 标签（:1891-1905）、解读卡片（:2084-2115）、项目 meta strip（:1968-1988）。
- **缺**：图件筛选（无关键字/步骤过滤）；TSV Top500 预览（占位，:2041-2045）；左树不是步骤树（:1993-2017）。
- **FiguresPanel 是死代码**：定义于 App.tsx:2455-2549（列表 + 放大），但 CustomerInputConsole（:1707-1721）只挂 TaskPanel/UploadPanel/FilesPanel/LedgerPanel，全文件检索 `FiguresPanel` 仅命中定义处一行——从未被渲染。
- 结论：**API 能力齐全；Studio 缺筛选与 TSV 预览；FiguresPanel 死代码需处置（接入或删除）**。

### h. 非肿瘤黑名单 —— 规则多于 aims 列举，属自行扩充，需用户确认

- aims.txt:71 列举的词：`cancer, tumor, carcinoma, glioma, immune infiltration, 肿瘤, 癌, 免疫浸润`（8 个英文/中文词 + "等词汇"）。
- `server/tumor_blacklist.js:10-38` 实际 29 条模式，除 aims 列举的外**自行增加了**：tumour、sarcoma、lymphoma、leukemia、leukaemia、melanoma、adenocarcinoma、squamous cell carcinoma、tumor/tumour microenvironment、immune checkpoint、PD-L1/PD1、CTLA-4、oncogene、tumor suppressor、癌细胞、免疫检查点、肿瘤微环境。
- 按项目铁律（"只按规格中经确认的黑名单和校验规则实现拦截，不要自行扩充规则"），这份扩充**没有 aims 条文依据**，需要用户确认其规格来源；从代码注释（:4 "aims v2.3 铁律 1"）看是历史演进堆上去的。
- 附带口径不一致：App.tsx:300 的领域下拉含"免疫"选项，而黑名单拦"免疫浸润/免疫检查点"——"免疫"作为非肿瘤研究领域是否合规，与"非免疫浸润专精"的边界需要用户口径。
- 误伤风险评估：单字 `/癌/`（:33）会命中任何含"癌"的文本（"癌变""致癌物"等仍属肿瘤语义，风险低）；`/PD-?L?1/i`（:27）理论可命中含 "PD1" 子串的标识符（罕见）。总体误伤风险低，但**规则 provenance 不合规**。
- 结论：**实现强于 aims 列举，属自行扩充；建议由用户确认后把确认清单写回规格，否则按 aims 收敛**。

---

## 测试覆盖盘点

### 22 个测试文件 → 模块映射（用例数按 `test(` 出现计数，**均未运行**）

| 测试文件 | 覆盖模块 | 用例数 | 覆盖性质 |
|---|---|---|---|
| audit.test.js | server/audit.js（+ssh.js buildRemoteCommand） | 9 | 跨线拒绝/变体/共享区放行 |
| auth.test.js | server/index.js 鉴权（子进程真 HTTP） | 7 | 401/放行/静态页保护 |
| consistency.test.js | server/ledger.js ↔ ops/03_check_logs_remote.sh 同口径 | 1 | 双实现判定一致 |
| datasets.test.js | server/domain.js normalizeDatasets | 12 | 新旧格式/行级三元组 |
| datatype.test.js | server/domain.js 数据类型→线 | 4 | 枚举/回落 |
| dualmode.test.js | domain.js 双模态 + project.js IN_HOUSE | 16 | 模式归一化/LOC 编号/建项落盘 |
| figures.test.js | server/figures.js | 12 | 路径断言/解析/caption |
| files.test.js | server/files.js | 12 | 越界拒绝/树构建 |
| index.test.js | server/index.js 入口冒烟 | 8 | health/submit 拒绝路径/收件箱 |
| layout_inject.test.js | server/task.js 出图模板注入 | 9 | 环境变量注入三线全覆盖 |
| ledger.test.js | server/ledger.js | 11 | 跨线/缺种子/跨项目/汇总 |
| link.test.js | server/link.js | 4 | 四段探测/服务状态 |
| manifest.test.js | server/manifest.js | 5 | key=value 解析/缺文件返回 null |
| portal_archive.test.js | portal/lib/archive.mjs | 21 | 命名/校验/打包计划 |
| portal_submit.test.js | portal/serve.mjs（真进程 E2E） | 7 | 上传/归档/负路径 |
| proc.test.js | server/proc.js | 6 | 白名单/零算力红线 |
| project.test.js | server/project.js | 13 | meta 构建/命令构造/黑名单 |
| pull.test.js | server/pull.js | 10 | 计划/落盘/字节校验 |
| run.test.js | server/run.js | 11 | 审计前置/台账闭环/文件名安全化 |
| task.test.js | server/task.js | 12 | 脚本构造/台账字段/转义 |
| upload.test.js | server/upload.js | 13 | 消毒/magic/分片全流程 |
| v3_intake.test.js | server/project.js intake 四块 | 30 | 阈值/模板/先验/映射 |

合计约 233 个 `test()` 用例。测试基建：`package.json` 的 `npm test` = `node --test tests/*.test.js`（node:test 原生 runner）。

### 没有任何测试的模块/面

**服务端模块级**：
- `server/tumor_blacklist.js`：**无直接单测**（无测试文件 import 它；仅经 buildProjectMeta 间接覆盖两条抛错路径，project.test.js:130-131、157；checkTumorBlacklist 的逐模式行为零覆盖）。
- `server/index.js`：仅 3 类端点有覆盖（health、tasks/submit 的拒绝路径、portal/inbox 两端点 + auth 中间件）。**以下端点零测试**：`/api/projects/create`、`/api/projects/list`、`/api/projects/steps`、`/api/projects/meta`、`/api/blacklist/check`、`/api/selfcheck`、`/api/link/check`、`/api/ledger/check`、`/api/files/tree`、`/api/figures/list`、`/api/figures/pull`、`/api/figures/image`、`/preview/figures`、`/api/upload/init|chunk|status|complete`、`/api/tasks/stop`、`/api/tasks/logs`、`serveStatic`。
- `server/ssh.js`：buildRemoteCommand 经 audit.test.js 覆盖；**buildFetchCommand 零覆盖**。

**客户端整体**：
- `src/App.tsx`（2812 行）：**零测试**。仓库无 React 测试运行时（package.json devDependencies 无 vitest/jest/@testing-library；无测试配置文件）。四大视图、OnboardingPortal 的全部交互逻辑（黑名单防抖、分组查重、导入映射）均无自动化覆盖。
- `src/main.tsx`、`src/app.css`：无测试（正常）。

**工作台外（记录事实）**：
- `ops/build_client_report.py`：自带 `--self-test`（其 docstring:30），但**未接入 BioanalysDesktop 测试套件**，`npm test` 不会跑到它。

---

## 风险清单（P0/P1/P2）

### P0（阻断 / 数据损坏 / 安全）

| # | 位置 | 问题 | 影响 |
|---|---|---|---|
| R1 | portal/serve.mjs:491-534（全文无 auth） | 用户提交台（8080）设计为"可单独内网穿透给客户"（:5-8），但**无任何鉴权**；任何人可达 `/api/submit`（写需求 JSON）、`/api/datafiles`（单文件至 5GiB，serve.mjs:191-195）、`/api/references` | 公网暴露时可被匿名写入/打满磁盘/投毒需求文件；aims.txt:10 要求的 Token 鉴权缺失 |

### P1（重要 / 功能不可用）

| # | 位置 | 问题 | 影响 |
|---|---|---|---|
| R2 | App.tsx:438-488、840-877 | 工作台向导无法录入 v3 intake 四块（排版/阈值/协变量/配对/验证集映射/focus genes/WGCNA 参数），也无法进入 IN_HOUSE 模式（选"自有数据"落 PUBLIC_DB，domain.js:97-101 → project.js:378-384 拒非 GSM 样本） | 手工建项只能用默认阈值+默认模板；自有数据项目在工作台**建不出来**（死路）；客户需求单确认过的参数只能靠导入透传，手工建项即丢 |
| R3 | aims.txt:413 vs server/*.js（零引用）、ops/09_package_delivery.ps1 缺失 | 客户交付报告整域无工作台入口（无 API/UI/测试） | 用户本轮八大功能域之一完全缺失；交付靠人工 ssh 跑 CLI |
| R4 | App.tsx:2041-2045 | Studio TSV Top500 预览是占位文字，无读取 .tsv 的 API/UI | aims.txt:158 要求的三栏预览缺一栏 |
| R5 | upload.js:21（4MB）+ App.tsx:2578-2586 | 分片上传无断点续传（status 端点 :1108-1111 存在但客户端不调用，每次新 uploadId 从头传）；分片大小与 aims.txt:77 的 5MB 不一致 | 1.89GB 级原始包（handoff.md 实测）传到中途失败须全部重传 |
| R6 | index.js:810-816、817-823 | 自检缺温度、7.5GB 配额水位；isolation 灯硬编码 `line1_bulk`（:819），line2/line3 无隔离扫描；桥接四项断言（ops/verify_bridge_checkpoint.py）不被消费 | aims.txt:146-151 五维自检实际只有 ~2.5 维；"跨线隔离灯"给不出 line2/line3 的证据 |
| R7 | index.js:154-164（runRemote→spawnSync 同步）+ :860-888 | /api/ledger/check 串行同步读 N 个台账（每文件一次 40s 同步阻塞）；整个服务用同步子进程 | 台账数量增长后，一次巡检会把上传/SSE/其他请求全部挂起（可用性） |
| R8 | App.tsx:2141（seed 默认 '42'） | TaskPanel 种子默认值 42，与 aims.txt:28 契约 seed=20261013 不符 | 用户不改种子即违反固定种子铁律，结果不可复现 |
| R9 | index.js:1226-1235 + audit.js:38-66 | inputs/outputs 无提交前路径存在性/项目归属校验；跨项目路径要等任务跑完写台账才被拒（ledger.js:105-108 → run.js:91-94） | 任务已实际执行、可能读错项目数据之后才发现 |
| R10 | App.tsx:2266-2268、2284-2294 | TaskPanel 步骤名/输入输出全自由文本，无 LINE_STEPS 下拉；placeholder 是缺 `projects/<项目>` 段的旧路径 | 用户须背命令名，易填错路径且无提交前校验 |
| R11 | project.js:417-418、:416、:431-435 | species/domain/dataType/sampleCount/contrasts/role 均不校验（详见疑点 c） | 脏值静默进 project.json，下游脚本按错分支跑 |
| R12 | project.js:100-116 vs pipelineDag | 服务端不强制 knockout ↔ target_ko_gene 联动 | 经 API 建项可造出"要敲除但没靶基因"的项目，跑到 virtual_knockout 步才失败 |
| R13 | App.tsx:203-207 vs project.js:123-126 | Studio 模板标签映射是收敛前旧 id | 所有新项目显示"未指定（按默认 Nature 侧边型）"，误导交付核对 |

### P2（建议）

| # | 位置 | 问题 | 影响 |
|---|---|---|---|
| R14 | App.tsx:2455-2549 | FiguresPanel 死代码（从未挂载） | ~95 行维护陷阱；二义性（用户以为 Console 有图件页） |
| R15 | index.js:847-858 | /api/link/check 无 UI 消费 | 接口闲置；链路详情只能在 selfcheck 的 link 灯里看摘要 |
| R16 | App.tsx:1638 | 交付物标签 "150 DPI" 与 aims §五.2 300 DPI（aims.txt:229）及 project.js:150 `dpi: 300` 矛盾 | 交付核对时口径不一致 |
| R17 | tumor_blacklist.js:10-38 | 29 条模式超出 aims.txt:71 列举范围（详见疑点 h） | 规则 provenance 不合项目铁律；需用户确认或收敛 |
| R18 | App.tsx:300 | 领域下拉含"免疫" | 与"非免疫浸润专精"边界口径需确认 |
| R19 | index.js:553-556、1150-1152 | scp 硬编码 `-P 10022 root@127.0.0.1`，与 runRemote 的 ssh 别名双轨 | ssh config 端口变更时上传/部署静默走错隧道 |
| R20 | index.js:84（runningTasks 内存 Map） | 服务重启丢失在跑任务跟踪（远端任务继续跑但 UI 看不到/停不掉） | 重启后任务成"孤儿" |
| R21 | 项目根非 git 仓库 | 无版本控制 | 任何改动无原生回滚手段，须手工备份 |

---

## 建议的切片拆分（按价值排序，每片给出目标文件与验收点）

> 实现方案由主 Agent 定框架后另派。文件域注意：BioanalysDesktop/ 与 portal/ 归本会话；
> ops/ 归 default 会话（只调用不改）。

| 优先 | 切片 | 主题 | 目标文件 | 验收点 |
|---|---|---|---|---|
| 1 | S22 | 建项向导补 v3 intake 录入 + IN_HOUSE 通道（解 R2/R11/R12） | App.tsx（OnboardingPortal 新增排版/阈值/协变量/配对/验证集映射/focus genes/WGCNA 区与 IN_HOUSE 表单）；server/project.js（补 species/domain/dataType/sampleCount/contrasts/knockout 联动校验，line_id 落盘） | ① 手工建项产出的 project.json 与 portal 导入等价（四块齐全）；② "自有数据"可建成 IN_HOUSE 项目（LOC 编号正确）；③ knockout 无靶基因被 400；④ project.test.js 新增负路径用例且 22 个旧文件全绿 |
| 2 | S23 | 客户交付报告工作台入口（解 R3） | server/ 新增 report 模块 + index.js 挂 3 端点（build/status/download，经 ssh 调 `ops/build_client_report.py --project`，只调用不改 ops/）；App.tsx Studio 或 Console 加"生成交付报告"按钮 + 进度 + 下载 | ① 对既有项目 E2E 生成报告并下载到本地；② 失败如实回显（不假成功）；③ 新增测试覆盖端点契约（不打真 ssh 的部分注入 run 接缝） |
| 3 | S24 | Studio TSV Top500 预览 + 图件筛选 + 真步骤树（解 R4、部分 F40） | server/ 新增 files/read 逻辑（限定 `<line>/results/*.tsv`，head 500 行 + 总行数）；App.tsx ResultPreviewStudio | ① Studio 能预览 deg_all.tsv 前 500 行且越界路径被拒；② 图件列表支持关键字筛选；③ 新测试覆盖路径断言 |
| 4 | S25 | 上传断点续传 + 分片对齐 aims（解 R5） | App.tsx UploadPanel（接 /api/upload/status 续传）；server/upload.js 或 aims 注释二选一对齐 5MB | ① 模拟中断后重进只传剩余分片；② upload.test.js 补续传用例；③ 若改 5MB 需同步 portal 文档口径 |
| 5 | S26 | 自检五维补齐（解 R6） | server/index.js /api/selfcheck（温度、7.5G 配额水位、line2/line3 隔离扫描、桥接四项断言展示、tmux PID）；server/link.js | ① selfcheck 五灯各带实测值；② isolation 灯覆盖三条线；③ 断链时该灯 unknown 不假装 pass |
| 6 | S27 | TaskPanel 改造（解 R8/R9/R10） | App.tsx TaskPanel（步骤下拉取 /api/projects/steps、种子默认 20261013、inputs/outputs 提交前校验）；server/index.js submit（路径存在性与项目归属预校验） | ① 跨项目 path 提交即 400（index.test.js 新增例）；② 种子默认值符合契约；③ 旧自由文本用法不破 |
| 7 | S28 | portal 鉴权 + 台账筛选 + UI 杂项（解 R1/R13/R14/R15/R16、F32/F39） | portal/serve.mjs + index.html（token）；server/ledger.js + index.js（回传耗时/内存，entries 带 start/end/resource）；App.tsx（LAYOUT_TEMPLATE_LABEL 键更新、150→300 DPI、FiguresPanel 处置、link 灯面板） | ① portal 无 token 请求 401；② LedgerPanel 支持按状态筛选并显示耗时；③ 模板标签显示正确 |
| 8 | S29 | 黑名单规则裁定（解 R17/R18） | 需用户先裁定：确认扩充清单 or 收敛到 aims 列举；定稿后 server/tumor_blacklist.js + 新增 tumor_blacklist.test.js | ① 每条模式有规格出处注释；② 直接单测覆盖逐模式行为（含误伤用例） |

**排序理由**：S22/S23 直接解"功能域级缺失"（建项死路 + 交付报告整域缺失），且 S22 是后续一切正确数据的地基；S24/S25 解规格明文要求但缺位的预览与续传；S26/S27 解运维可信度与执行契约；S28 收安全与体验；S29 需用户裁决，放最后。

---

## 附：端点与模块速查（本切片实测清点）

- 8787 端点 23 个（index.js:579-1333）：health、projects/list、projects/create、blacklist/check、projects/steps、projects/meta、portal/inbox、portal/inbox/item、selfcheck、link/check、ledger/check、files/tree、figures/list、figures/pull、preview/figures、figures/image、upload/init、upload/chunk、upload/status、upload/complete、tasks(GET)、tasks/submit、tasks/stop、tasks/logs(SSE) + 静态 dist 托管。
- portal 端点 4 个（serve.mjs:491-528）：/、/api/submit、/api/datafiles、/api/references、/health。
- 服务端模块 16 个：index/domain/proc/link/ledger/files/figures/pull/upload/project/tumor_blacklist/audit/task/run/manifest/ssh。
- 测试 22 个文件 / 约 233 用例；客户端 0 测试。
- 本报告未运行任何测试、服务或 HTTP 请求；运行类验证由后续实现切片承担。
