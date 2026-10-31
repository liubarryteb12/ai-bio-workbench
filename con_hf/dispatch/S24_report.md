# S24 · 建项向导补 v3 intake 录入 + IN_HOUSE 通道 + 服务端校验补齐（解 R2/R11/R12/R13）: 实施报告

状态：**已完成**。npm test 247/247 全绿；npm run build + tsc --noEmit 通过；E2E 真链 25/25 通过（幂等复跑验证）。

## 任务理解

- 工作台 OnboardingPortal 无法录入 v3 intake 四块、进不了 IN_HOUSE 模式（R2 死路）；
- 服务端缺 species/domain/dataType/sampleCount/contrasts 校验（R11）、knockout↔target_ko_gene 不联动（R12）、line_id 不落盘；
- Studio 的 LAYOUT_TEMPLATE_LABEL 键是收敛前旧 id（R13）。
- 文件域：App.tsx / server/project.js / server/domain.js（如需）/ tests/*.test.js；禁碰 portal/、ops/、src/、server/figures.js（S18R 在改）、docs/、真实 projects/。

## 1. v3 intake 四块字段清单（照 v3_intake.test.js 逐字段整理，即表单 schema）

### 1.1 生物学先验 biologicalPriors（→ meta.biological_priors）

| 字段名（提交键） | 类型 | 服务端归一化默认 | 测试锚点 |
|---|---|---|---|
| focusGenes | string[] 或逗号/空格分隔字符串 | []（trim 去空，上限 5 个） | v3_intake.test.js:56-62 |
| targetKoGene | string | ''（trim） | :64-71 |
| koFallbackPolicy | 'strict_abort' \| 'auto_recommend' | 'strict_abort'（非法回落） | :64-71 |

### 1.2 统计阈值 analysisCutoffs（→ meta.analysis_cutoffs）

| 字段名 | 类型 | 默认 | 测试锚点 |
|---|---|---|---|
| profile | 'standard_sci' \| 'sensitive' \| 'strict' | 'standard_sci'（非法回落并标 profileFallback） | :22-44 |
| log2fc_threshold | number（可选显式覆盖） | 档位预设（standard=1.0 / sensitive=0.585 / strict=1.5） | :46-52 |
| padj_threshold | number（可选） | 档位预设（standard=0.05 / sensitive→0.05 / strict=0.01） | :37-39 |
| p_threshold | number（可选） | 档位预设（sensitive=0.05，其余 0.05） | normalizeAnalysisCutoffs 实现 |
| max_mt_percent | number（可选） | 15 | :34、:47-49 |

### 1.3 排版配置 plotLayoutConfig（→ meta.plot_layout_config）

| 字段名 | 类型 | 默认 | 测试锚点 |
|---|---|---|---|
| templateId | 'template_4x3' \| 'template_16x9'（旧 id template_1_nature_side/template_2_cell_wide/template_3_clinical_note 兼容映射） | 'template_4x3'（非法回落并标 templateFallback） | :75-118 |
| （dpi 恒 300，服务端写死，表单不提供） | : | 300 | :109-118 |

### 1.4 实验设计 experimentalDesign（→ meta.experimental_design）

| 字段名 | 类型 | 默认 | 测试锚点 |
|---|---|---|---|
| isPaired | boolean | false | :122-146 |
| pairMap | Record<string,string>（样本→供体/配对） | 未勾选配对时强制 {} | :122-138 |
| covariates.batchCol | string | '' | :128-138、:140-146 |
| covariates.adjustedVariables | string[] | [] | 同上 |

### 1.5 独立验证集映射 validationGroupMapping（→ meta.validation_group_mapping）

| 字段名 | 类型 | 默认 | 测试锚点 |
|---|---|---|---|
| valControlSamples | string[] | []（非数组回落空并标 invalid） | :150-181 |
| valTreatSamples | string[] | [] | 同上 |
| （两侧重叠 → 服务端直接拒建项） | : | : | :183-188、:292-302 |

## 2. dualmode.test.js 的 IN_HOUSE 契约要点

- 模式值：`data_source_mode: 'IN_HOUSE_UPLOAD'`（domain.js:97-101 缺失/非法回落 PUBLIC_DB）。
- 三件套必填（缺一服务端抛错）：`id_type` ∈ {Gene_Symbol, Ensembl_ID, Entrez_ID}、`value_scale` ∈ {Raw_Counts, TPM_FPKM, Log2_Normalized}、`uploaded_files.train_matrix` 非空（val_matrix 选填）。
- LOC 编号：服务端按项目 ID 派生 `LOC_<projectId>_TRAIN` / `LOC_<projectId>_VAL`（仅提供 val_matrix 才派生 _VAL）；表单不填编号，建项后 project.json.accession_and_platform.train_id 断言（dualmode.test.js:167-183）。
- 自有样本编号格式：`/^[A-Za-z0-9_.-]+$/`（如 Ctrl_1、Stroke_Mouse.02），公共库模式仍强制 GSM。

## 3. 实现记录（随步骤追加）

- [x] 基线：`npm test` 237/237 全绿（node v24.19.0）。
- [x] server 校验（R11 六条 + R12 + line_id 落盘）：
  - `server/domain.js`：新增 `SPECIES_ENUM`（三物种）与 `DOMAIN_ENUM`（portal 下拉七项同值）。
  - `server/project.js`：`buildProjectMeta(params, { strict })` 新增 strict 选项；strict 下执行
    `validateCreateContract`（species/domain/dataType/sampleCount/contrasts 引用与唯一 primary/R12 联动）；
    lineId 缺失或不在三线枚举抛错；返回对象新增 `line_id` 字段（合法落值、否则 null）。
    新导出 `buildProjectMetaStrict`（建项 API 入口专用）。既有直接调用（旧契约测试）不带 strict，行为不变。
  - `server/index.js`（最小改动，偏差见 §5）：create 路由内 `buildProjectMeta` → `buildProjectMetaStrict`，
    并透传 `lineId: requested.lineId`。400 语义复用既有 catch（`return json(res, 400, { error: cause.message })`）。
  - 探针验证（scratch/s24_strict_probe.mjs）：strict happy path 通过、8 条负路径全部按预期抛错点名（species/domain/dataType/sampleCount/contrasts case/primary 数/R12/line_id），旧形态无 strict 仍宽松建项。
- [x] App.tsx 表单（四块 + 模板选择 + IN_HOUSE 通道 + R13 标签修复）:详见 §3 后半与 §7。
- [x] project.test.js 新增 10 条用例。
- [x] `npm test` 247/247 全绿（237 旧 + 10 新）；`npx tsc --noEmit` 0 错误；`npm run build` 成功。
- [x] E2E 真链验证脚本 cn_debug/2026-10-20_verification_s24_intake_e2e.mjs：25/25 通过，复跑幂等。

### 3.1 App.tsx 实现明细（R2/R13）

- 模块 B 新增「数据来源模式」单选（PUBLIC_DB / IN_HOUSE_UPLOAD，语义照 portal 同名实现）；IN_HOUSE 下渲染
  自有数据三件套（id_type / value_scale / train_matrix 必填 + val_matrix 选填）与 LOC 派生提示；
  GSE/GPL 配对表仅在 PUBLIC_DB 模式渲染（自有数据无 GSE 概念）。submit 守卫：dataType 必选、
  sampleCount 正整数、三件套必填。
- 新增「模块 E · 分析契约（v3 intake）」卡片（插在模块 D 与提交之间，沿用既有 module-card / form 样式）：
  出图画幅两档下拉（默认 template_4x3，照 portal/index.html:517-520 先例）、统计阈值三档 chips +
  4 个可选数值覆盖、focusGenes、koFallbackPolicy、配对开关 + pairMap 文本域、batchCol / adjustedVariables、
  验证集映射两文本域、WGCNA 9 参数（全部选填留空走服务端默认）。
  targetKoGene 复用模块 C 的「目标敲除基因」框（单一录入位）。
- submit body：新增 lineId、双模态 dataSource、biologicalPriors / analysisCutoffs / plotLayoutConfig /
  experimentalDesign / validationGroupMapping / wgcnaConfig / dataFiles；`...(intakeExtras || {})` 整包透传移除
  （改为收件箱导入时映射进表单 state；dataFiles 无表单项，保留透传部署）。
- R13：`LAYOUT_TEMPLATE_LABEL` 键改为 template_4x3 / template_16x9，旧 id 保留兼容映射
  （照 project.js LEGACY_TEMPLATE_IDS）；Studio 顶部标签随之显示正确模板名。
- 收件箱导入：intake 块由「整包透传」改为映射进表单 state（旧 templateId 先映射新档）。

### 3.2 server 实现明细（R11/R12/line_id）

- `server/domain.js`：+`SPECIES_ENUM`（三物种）/ +`DOMAIN_ENUM`（portal 下拉七项同值）。
- `server/project.js`：`buildProjectMeta(params, { strict })` 新增 strict 选项；strict 下执行
  `validateCreateContract`（species / domain / dataType / sampleCount / contrasts 引用与唯一 primary / R12 联动）；
  lineId 缺失或不在三线枚举抛错；返回对象新增 `line_id`（合法落值、否则 null）；
  新导出 `buildProjectMetaStrict`（建项 API 入口专用）；sampleCount 类型必须 number（数字字符串也拒）。
- `server/index.js`（最小改动，偏差见 §5.1）：create 路由内 `buildProjectMeta` → `buildProjectMetaStrict`，
  透传 `lineId` 与 `wgcnaConfig`；400 语义复用既有 catch。
- 探针验证（scratch/s24_strict_probe.mjs）：strict happy path 通过、8 条负路径全部按预期抛错点名，
  旧形态无 strict 仍宽松建项。

## 4. 测试与验证记录

1. 旧契约护栏：`node --test tests/project.test.js tests/v3_intake.test.js tests/dualmode.test.js` → 56/56 pass
   （v3_intake 30 例 / dualmode 16 例 / project 旧 13 例；v3_intake 与 dualmode 一条断言未改）。
2. `npm test` 全集：`ℹ tests 247 / ℹ pass 247 / ℹ fail 0`（基线 237 + 新增 10）。
3. `npx tsc --noEmit`：exit 0（无输出）。
4. `npm run build`：`✓ 32 modules transformed ... ✓ built in 634ms`，产出 dist/assets/index-D0YO0xJl.js。
5. E2E（`node cn_debug/2026-10-20_verification_s24_intake_e2e.mjs`，临时端口 18790；ssh 垫片经 `--require`
   在 ESM 加载前补丁 child_process.spawnSync，把 /mnt/ssd/bio_data 重写到 cn_debug/s24_e2e_tmp/ssd，
   不碰真实远端、不改 server 源码）：
   - 公共库全量 intake 建项 200；落盘 project.json：line_id / template_16x9 / sensitive+log2fc 2.0 /
     focus_genes / 配对+协变量 / 验证集映射 / wgcna top_n_genes=6000 / PUBLIC_DB 全部断言通过；
   - R11 六条 + R12 + line_id 缺失共 8 条负路径：全部 400 且 error 点名字段；
   - IN_HOUSE 全链：200 → data_source_mode='IN_HOUSE_UPLOAD'、train_id='LOC_PRJ_S24_E2E_KO_TRAIN'、
     val_id=null、三件套落盘、自有样本编号（Ctrl_1）通过、line_id=line2_scrna + target_ko_gene='App'；
   - 汇总 25/25；连续复跑两次均 25/25（幂等）。
6. 未覆盖：前端交互无自动化测试（仓库无 React 测试运行时，与既有状态一致）；E2E 未覆盖 scp 数据文件部署路径
   （本验证 payload 不含 dataFiles；垫片对 scp 显式报失败，不留静默）。

## 5. 偏差与待主 Agent 裁决事项

1. **server/index.js 最小改动（超出字面文件域）**：文件域禁的是「index.js 路由挂载（除非新增端点）」，
   未加/删路由；但规格第 6-8 条（400 校验、line_id「取值来自建项请求」）必须在 create 路由内透传参数才能达成。
   实际 diff 共 3 处：import 增加 `buildProjectMetaStrict`；create 调用换 strict 入口并透传
   `lineId` 与 `wgcnaConfig`。若主 Agent 不认可，回退即回到「line_id 不落盘、表单 WGCNA 参数不生效」状态。
   其中 wgcnaConfig 透传是 E2E 首轮发现的既有缺口（此前请求即使传了也会被静默丢弃），按「不静默吞」原则补上。
2. **R11 的 strict 开关设计**：旧契约测试直接调 buildProjectMeta 且不带 species/domain/dataType/sampleCount/lineId
   （v3_intake 全部用例、project.test.js 'Neurovascular' 用例等 30+ 条），无条件校验会连环击穿旧断言
   （不许改旧断言）。故校验收敛在 `buildProjectMetaStrict`（建项 API 入口），`buildProjectMeta` 原行为不动，
   与「校验只对新建项目生效」语义一致。
3. **contrasts「恰好一条 primary（groups ≥2 时）」解读**：实现为「contrasts 非空时恰好一条 primary」。
   二组模式（工作台 <3 组不生成对比）contrasts=[] 仍放行，否则所有二组项目（含既有 UI 流程）建不出来。
   如需「二组也必须显式给 primary」需同步改 UI 生成逻辑，请主 Agent 裁决。
4. **R2 的「WGCNA 参数」**：v3_intake.test.js 无 WGCNA 形状（形状真源是 project.test.js 的
   WGCNA_CONFIG_DEFAULTS / normalizeWgcnaConfig）。按 R2 字面要求把 9 键做成选填区（空值走服务端默认），
   未发明新字段名。

## 6. 假设与风险

- 前端交互（模块 E 表单、IN_HOUSE 切换）未经浏览器人工点验（本环境无 GUI 自动化）；TS 编译 + E2E 覆盖了
  字段→body→服务端→落盘链路，UI 渲染正确性建议主 Agent 跑 `npm run dev` 目检一次。
- sampleCount 收紧为必填正整数：经 API 建项的旧脚本若传 0/缺省会开始 400（新项目新规，已交付项目不受影响）。
- 本任务未触碰：portal/、ops/、src/、server/figures.js（S18R 域）、docs/、真实 projects/ 数据、
  v3_intake.test.js / dualmode.test.js。dist/ 仅由 `npm run build` 产出，无手工编辑。

## 7. 文件变更清单

| 文件 | 变更 |
|---|---|
| BioanalysDesktop/server/domain.js | +SPECIES_ENUM / +DOMAIN_ENUM（校验枚举真源） |
| BioanalysDesktop/server/project.js | buildProjectMeta 加 strict 选项与 line_id 落盘；+validateCreateContract（模块私有）；+buildProjectMetaStrict 导出 |
| BioanalysDesktop/server/index.js | create 路由：strict 入口 + lineId / wgcnaConfig 透传（3 行，见 §5.1） |
| BioanalysDesktop/src/App.tsx | R13 标签修复；双模态单选 + IN_HOUSE 三件套 UI；模块 E intake 录入区；submit body / 守卫 / 重置；收件箱导入映射；IntakeExtras 类型补全 |
| BioanalysDesktop/tests/project.test.js | +10 条（R11 六条负路径、R12、line_id 落盘、兼容性、strict IN_HOUSE happy path） |
| BioanalysDesktop/dist/ | 由 vite build 重新产出（允许范围内） |
| cn_debug/2026-10-20_verification_s24_intake_e2e.mjs | E2E 验证脚本（幂等；运行时生成 ssh 垫片与 cn_debug/s24_e2e_tmp/ 临时目录） |
| con_hf/dispatch/S24_report.md | 本报告 |
