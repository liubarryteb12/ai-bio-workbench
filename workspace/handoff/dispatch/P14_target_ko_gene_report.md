# P14 报告：target_ko_gene 必填项打通（aims:185 空转条款落地）

## 1. 任务理解

aims/aims.txt:185 要求「勾选虚拟敲除强制弹出 target_ko_gene 必填框」，但现状三处全缺：前端 TaskPanel 没有该输入框、POST /api/tasks/submit 不接收该字段、server/task.js 的 buildTaskScript 不注入任何靶基因，于是母版只能读自己写死的 KO_GENE。结果是：用户勾了虚拟敲除、选了别的基因，跑出来的 DR 表、显著性与图都正常，敲的却是母版默认基因，结论错且事后无从发现。

本切片把这条链路从「界面到母版环境变量」打通，范围严格限定在：

- BioanalysDesktop/server/index.js（提交层校验 + 透传）
- BioanalysDesktop/server/task.js（脚本注入 + 判据表）
- BioanalysDesktop/src/App.tsx（TaskPanel 输入框与前端拦截）
- BioanalysDesktop/tests/target_ko_gene.test.js（新建测试）

母版 src/line2_scrna/scripts/virtual_knockout 与 src/line3_spatial/scripts/spatial_knockout 由另外两个 teammate 改成读 BIO_KO_GENE，本切片未动 src/**。

## 2. 实现摘要

1. 判据收敛成一张表：server/task.js 导出 KNOCKOUT_STEPS = ['virtual_knockout', 'spatial_knockout']、requiresKoGene(stepName)、KO_GENE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/、isValidKoGene(value)。提交层与脚本构造层共用同一张表，避免两处判据分叉。写死表而不按 PIPELINE_STEP_META 的 note 关键词猜，是因为 note 是给人看的文案，改文案就会静默失效；步骤名本身就是远端命令名，是稳定契约。
2. 提交层拦截：/api/tasks/submit 接收可选字段 targetKoGene，先做类型与形态校验（400），再判「敲除步骤必须非空」（400），全部发生在 buildTaskScript / auditCommand / runTask 之前，因此不合法请求不会白跑一次 ssh。
3. 脚本注入：buildTaskScript 在 requiresKoGene(step) 时 push 一行 export BIO_KO_GENE='<gene>'（shellQuote 包裹），与 seed 的注入方式完全同构（seed 也是 export BIOANALYS_SEED）；export 行排在 run_throttled_task.sh 包装命令之前，bash 子进程继承环境，变量能穿过包装器到母版。非敲除步骤即使传了 targetKoGene 也不注入（语义：忽略），缺基因或非法则抛错，绝不静默退回 TNF。
4. 前端：TaskPanel 新增 koGene state 与条件渲染块，只在 step ∈ 敲除步骤时出现，标注「敲除靶基因 target_ko_gene（必填）」，说明写入 BIO_KO_GENE；空值或形态非法时下发按钮 disabled，submit 里另有一道前端拦截（双保险，服务端仍是权威）。

## 3. 文件变更清单

### 3.1 BioanalysDesktop/server/task.js（+53 / -2）

- :30-56 新增 KNOCKOUT_STEPS（:37）、KO_GENE_PATTERN（:46）、requiresKoGene（:49-51）、isValidKoGene（:54-56），均带「为什么这么定」的中文注释（为何写死表、为何卡首字符）。
- :257-264 buildTaskScript 的 JSDoc 与解构新增 targetKoGene。
- :282-298 新增注入分支：if (requiresKoGene(step)) { if (!isValidKoGene(targetKoGene)) throw new Error(...); lines.push(export BIO_KO_GENE=<shellQuote(gene)>); }，注释写明选环境变量而非命令行参数的三条理由（母版读 os.environ 一处口径、--input/--output/--seed 参数位已被占用、export 会被子进程继承故能穿过 run_throttled_task.sh）。

### 3.2 BioanalysDesktop/server/index.js（+32 / -1）

- :49 import 追加 requiresKoGene, isValidKoGene, KNOCKOUT_STEPS。
- :1508-1533 新增 P14 校验块，位置在 step 正则校验之后、inputs/outputs 数组校验之前（即远在 buildTaskScript/auditCommand/runTask 之前）：类型校验 400、形态校验 400、敲除步骤必填 400。
- :1565-1566 taskSpec 与 :1652 runTask 各透传 targetKoGene（空串转 undefined），注释说明审计用脚本与实际执行脚本必须带同一个靶基因。

### 3.3 BioanalysDesktop/src/App.tsx（+59 / -2）

- :2674-2677 模块级 KO_STEPS 常量与 KO_GENE_RE 正则（注释：前端只为即时反馈，服务端仍是权威）。
- :2690 TaskPanel 新增 const [koGene, setKoGene] = useState('')。
- :2724 派生 const needsKoGene = KO_STEPS.includes(step.trim())，刻意放在 appendLog/submit 之前声明（注释：否则 useCallback 依赖数组在渲染时求值会撞 TDZ）。
- :2762-2775 submit 内前端拦截：空值提示「虚拟敲除必须指定靶基因（target_ko_gene）」，形态非法提示「靶基因非法：只允许字母数字与 . _ -，长度 1..32，首字符不能是 . 或 -」。
- :2786 请求体加 targetKoGene: needsKoGene ? gene : undefined；:2802 依赖数组补 koGene 与 needsKoGene。
- :2825 koGeneInvalid 派生；:2833 下发按钮 disabled 追加 (needsKoGene && !KO_GENE_RE.test(koGene.trim()))。
- :2893-2907 条件渲染块 {needsKoGene && (...)}：label「敲除靶基因 target_ko_gene（必填）」+ input + subtle 说明（写入 BIO_KO_GENE、字符规则、空值禁用）+ 非法时红字提示。
- 既有 placeholder、seed 说明、步骤下拉等文案一字未改。

### 3.4 BioanalysDesktop/tests/target_ko_gene.test.js（新建，16 条）

见第 5 节。in-process 起服务 + 假 ssh 垫片写法沿用 tests/bridge_checkpoint.test.js 与 tests/task_submit_validation.test.js，未改它们的既有断言。

### 3.5 con_hf/dispatch/P14_target_ko_gene_report.md（本文件）

## 4. 接口与交互实现说明

### 4.1 POST /api/tasks/submit 最终契约

| 项 | 内容 |
| --- | --- |
| 字段名 | targetKoGene（camelCase，请求体顶层；落盘字段仍是 project.js 既有的 target_ko_gene snake_case，两者不混用） |
| 类型 | string，可选 |
| 形态规则 | /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/，即首字符字母或数字，其余字母数字与 . _ -，长度 1..32 |
| 必填条件 | step ∈ {virtual_knockout, spatial_knockout}（server/task.js 的 KNOCKOUT_STEPS） |
| 缺失/非法 | HTTP 400，error 以「虚拟敲除必须指定 target_ko_gene」开头，并点名步骤、线、请求体字段名与合法可选项 |
| 类型错误 | HTTP 400「targetKoGene 必须是字符串（基因符号）」 |
| 形态错误 | HTTP 400「targetKoGene 非法（只允许字母数字与 . _ -，长度 1..32，首字符不能是 . 或 -）」并回显违规原文 |
| 非敲除步骤传了 | 接受（不报错），但不注入任何环境变量，语义为「忽略」 |
| 前端 | TaskPanel 只在敲除步骤显示输入框；空值或非法时按钮 disabled；submit 内另有一道拦截（提示文案同上口径） |

### 4.2 注入的环境变量与母版契约（交给改母版的两个 teammate）

- 环境变量名：BIO_KO_GENE（大写，下划线，与既有 BIOANALYS_SEED 命名风格一致）。
- 生成形态：脚本中一行 export BIO_KO_GENE='<gene>'，由 shellQuote 单引号包裹，位于 cd 到 projects/<项目>/<线>/processed 之后、母版调用（或 run_throttled_task.sh 包装）之前。
- 可达性：ops/run_throttled_task.sh 只是 bash 子进程（内部再 nice/ionice 起解释器），export 出来的变量被子进程继承，不需要改包装器。
- 母版读取建议：KO_GENE = os.environ.get('BIO_KO_GENE', '').strip() or '<兜底>'；缺失时保留 TNF（line2 virtual_knockout 现状，src/line2_scrna/scripts/virtual_knockout:102）与 Spp1（line3 spatial_knockout 现状，src/line3_spatial/scripts/spatial_knockout:113）兜底，并向 stderr 打一行留痕（例如 [warn] BIO_KO_GENE 未设置，回退到 TNF）。
- 澄清一处事实偏差：派发单说两条母版「同理」都写死 TNF，实测 line3 的 spatial_knockout 默认是 Spp1（小鼠基因符号），不是 TNF。报告按实测写，母版改动请以各自文件为准。
- 契约边界：提交层保证「走界面的请求一定带合法基因」，兜底只服务于直连 算力节点 手工跑与历史脚本；兜底必须留痕，否则又回到「静默敲错基因」。

## 5. 测试与验证记录

### 5.1 新增测试文件（16 条，全部真实运行）

命令：cd BioanalysDesktop; node --test tests/target_ko_gene.test.js

尾行：tests 16 / suites 0 / pass 16 / fail 0 / cancelled 0 / skipped 0 / duration_ms 224.9，exit 0。

分组：

- A 纯函数 3 条：KNOCKOUT_STEPS 恰为两项且其余步骤（prep_matrix/deg_limma/summarize_dr/spatial_localization/空/undefined）均为 false；合法基因（TNF、Spp1、HLA-DRA、C1orf56、a1.2_x-y、1-Mar、32 个 A）全部通过；非法基因（空串、空格、TNF 带尾空格、TNF;rm -rf /、TNF|x、TNF$x、../etc/passwd、-x、.hidden、33 字符、TNF/../x、null/undefined/42/{}/[]）全部拒绝。
- B buildTaskScript 5 条：注入 export BIO_KO_GENE='TNF' 且 cd 与 PATH 垫片形态不变；与 BIOANALYS_SEED/SEED=20261013/--seed 共存；非敲除步骤即使传基因也不出现 BIO_KO_GENE；缺基因或非法（undefined/null/''/'TNF;rm -rf /'/'../x'）抛错；throttled 时 export 行索引小于 run_throttled_task.sh 索引，且含 self 'virtual_knockout' 形态。
- C 真 HTTP 5 条：virtual_knockout 缺基因 400（error 含「虚拟敲除必须指定 target_ko_gene」与步骤名）且 spawn 计数 0；spatial_knockout 缺基因 400 且 spawn 计数 0；非法字符 400（error 含违规原文）且 spawn 计数 0；非敲除步骤不传基因仍 200 下发且下发命令不含 BIO_KO_GENE；合法 TNF 的 virtual_knockout 200 下发且 ssh 命令里含 export BIO_KO_GENE='TNF'（端到端串通）。
- D App.tsx 静态断言 3 条：提交体 targetKoGene 三元表达式、KO_STEPS 常量、needsKoGene 派生；必填文案「敲除靶基因 target_ko_gene（必填）」与 {needsKoGene && ( 条件渲染、setKoGene 绑定、BIO_KO_GENE 说明；按钮 disabled 表达式与两条前端错误文案。

首次运行失败与修复（如实记录）：首跑 exit 1，报 SyntaxError: Invalid regular expression flags，原因是 PATH 垫片那条断言把含双引号与斜杠的字面量写成正则 /export PATH="/mnt\/.../，斜杠未转义导致正则提前闭合。改用 script.includes(...) 后 16/16 通过。

### 5.2 类型检查

命令：cd BioanalysDesktop; npx tsc --noEmit

结果：无输出，exit 0（App.tsx 零类型错）。

### 5.3 全量回归（有 1 条红，非本切片引入，见第 8 节）

命令：cd BioanalysDesktop; npm test

尾行：tests 690 / suites 0 / pass 689 / fail 1 / cancelled 0 / skipped 0 / duration_ms 30091.5，exit 1。

唯一失败：tests/aims_drift_guard.test.js:111「§一.2 三大铁律：8 条黑名单、阶段感知 --stage、seed 都在」，断言 AssertionError: §一.2 没写 8 条黑名单正本（tests/aims_drift_guard.test.js:113）。

条数核对：基线 674 + 本切片新增 16 = 690，与实测一致；即除该条外全部绿。

### 5.4 构建

按派发单要求未跑 npm run build（Lead 统一构建），标注为「未运行」。

## 6. 假设与风险

1. 判据表写死两个步骤名。若将来新增第三个敲除类步骤而忘记登记 KNOCKOUT_STEPS，该步骤会绕过必填（测试 A 组会因 deepEqual 失败而报警，属有意漂移守卫）。
2. 前端 KO_GENE_RE 与服务端 KO_GENE_PATTERN 是两份字面量（前后端不能共享模块），本次靠测试 D 组锁住形态；若只改一侧会漏，风险由测试部分兜住，仍属已知重复。
3. 非敲除步骤传了 targetKoGene 被忽略且不回显，调用方无法从响应看出被忽略。选这个语义是因为回显会诱导调用方以为参数生效。
4. 未做项目级预填：server/index.js:828 已把 projectMeta.targetKoGene（来自 project.js biological_priors.target_ko_gene）暴露给项目详情接口，TaskPanel 可据此预填输入框，本次未做（超出派发范围），属可选后续。
5. 未跑端到端真实敲除：母版尚未改成读 BIO_KO_GENE，现在跑真实任务只会走母版兜底，故本切片只验证到「ssh 下发命令里带 export BIO_KO_GENE」为止，母版侧生效需等另两个 teammate 改完再联调。标注：真实 算力节点 端到端「未运行」。
6. 大小写与物种：TNF 是 human 符号、Spp1 是 mouse 符号，本切片不校验基因与物种是否匹配（无权威离线基因库，且派发未要求），只在 placeholder 里提示 line2 默认 TNF、line3 mouse 默认 Spp1。

## 7. 架构/接口变更建议

1. 建议后续把「步骤是否需要额外参数」统一收进 server/project.js 的 PIPELINE_STEP_META（例如 requires: ['target_ko_gene']），由 task.js 的 KNOCKOUT_STEPS 从 meta 派生，消除「写死表 vs 文案 note」的双轨。本次不做是因为改 project.js 超出写范围。
2. 建议 TaskPanel 的靶基因输入框接项目详情接口的 targetKoGene 做预填（数据已在 index.js:828），减少重复录入。
3. 建议把 BIO_KO_GENE 与 BIOANALYS_SEED 一起写进 con_hf 的环境变量契约清单（本次未改台账）。

## 8. 待主 Agent 决策事项

全量测试有且仅有 1 条红，不在本切片写范围内，需要裁决：

- 失败点：tests/aims_drift_guard.test.js:113 断言 aims §一.2 含「8 条黑名单」，但当前 aims/aims.txt 已由另一路改动写成「20 条黑名单」（git status 显示 aims/aims.txt 与 BioanalysDesktop/server/tumor_blacklist.js 均处于已修改未提交状态，aims.txt 的 LastWriteTime 为 2026-10-21 19:29:11，晚于本切片开工时间）。
- 证据：git diff -- aims/aims.txt 显示 8 条改 20 条（英文 16 + 中文 4，含沿革段与 §一.2 铁律 1 状态列「已对齐（20 条正本）」）。
- 本切片未碰 aims/**、未碰 tumor_blacklist.js、未碰任何既有测试文件（git status 里这三个文件的改动不属于我）。
- 需要决策：改 aims_drift_guard.test.js 的断言（8 → 20）以跟上新规格，还是回退 aims.txt。两条都不在我写范围内，故停手上报，未自行处理。

## 9. 建议下一步

1. 裁决第 8 节的漂移：由黑名单切片同步更新 aims_drift_guard.test.js:113 的断言（8 条 → 20 条，并补 tumour/PD-L1/PD-1/CTLA-4 等新词的正则边界校验），让全量回到全绿。
2. 另两个 teammate 改完母版后，做一次真实联调：提交 virtual_knockout 带 targetKoGene=TNF，在 算力节点 上确认母版读到 BIO_KO_GENE 且 stderr 无兜底留痕；再提交一次不带（手工直连）确认兜底留痕存在。
3. Lead 统一跑 npm run build 与一次 E2E 回归（cn_debug/2026-10-19_e2e_run_pipeline.mjs 只走 line1_bulk 11 步，不涉及敲除，预期不受影响，但本切片未运行，标注「未运行」）。
