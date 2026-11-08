# B3 黑名单口径收敛（27 条 → 8 条）执行报告（2026-10-21）

> 依据：共享任务 task-5 + 2026-10-21 用户裁定；规格正本 `aims/aims.txt` §三.1 模块 A「黑名单确认清单」；8 条原文出处 `con_hf/dispatch/S21_scout_workbench_gaps.md:170`（疑点 h）。
> 执行者：blacklist-arch。改动范围：`aims/aims.txt`、`BioanalysDesktop/server/tumor_blacklist.js`、新增 `BioanalysDesktop/tests/tumor_blacklist.test.js`，三者均在派发单 write scopes 内。

## 一、改了什么

### 1. `BioanalysDesktop/server/tumor_blacklist.js`（27 条 → 8 条，导出锁口径，修 null 崩溃）

| 位置 | 改动 |
|---|---|
| :21-30 | `BLACKLIST_PATTERNS` 由 27 条收敛为 8 条，顺序与 aims 清单逐条一致：`/cancer/i`、`/tumor/i`、`/carcinoma/i`、`/glioma/i`、`/immune\s*infiltration/i`、`/肿瘤/`、`/癌/`、`/免疫浸润/` |
| :21 | 新增 `export`（原为模块内 `const`）：仅让测试能断言"恰好 8 条 + 逐条正则"，业务调用方不受影响 |
| :16-20 | 数组上方注释写明"与 aims 清单逐条同序"、"导出仅供测试锁口径，业务代码走 checkTumorBlacklist / validateProjectFields" |
| :8-13 | 文件头补规格正本出处、2026-10-21 收敛裁定、被删 19 条清单摘要、项目铁律原句「只按规格中经确认的黑名单和校验规则实现拦截，不要自行扩充规则」、"增删必须两侧同步" |
| :64-71 | `validateProjectFields` 修健壮性缺陷：`fields` 为 undefined/null/非对象时原实现 `fields[key]` 抛 TypeError（`Object.keys(fields \|\| {})` 只兜住了 key 列表，没兜住取值）。新增 `const source = fields && typeof fields === 'object' ? fields : {}`，`allKeys` 与 `val` 改用 `source` |
| :33-35、:42-51 | `BLACKLIST_HINT` 与 `checkTumorBlacklist` 逻辑未动（收敛只改数据，不改匹配算法） |

被删除的 19 条（无规格条文依据的自行扩充）：`tumour`、`sarcoma`、`lymphoma`、`leukemia`、`leukaemia`、`melanoma`、`adenocarcinoma`、`squamous cell carcinoma`、`tumor microenvironment`、`tumour microenvironment`、`immune checkpoint`、`PD-L1`、`CTLA-4`、`oncogene`、`tumor suppressor`、`癌症`、`免疫检查点`、`肿瘤微环境`、`癌细胞`。

### 2. `aims/aims.txt` :72-77（原为 2026-10-20 旧裁定的 27 条正本写法）

- 清单改为 8 条正本：英文 5 条 `cancer`/`tumor`/`carcinoma`/`glioma`/`immune infiltration`（正则 `immune\s*infiltration`），中文 3 条 `肿瘤`/`癌`/`免疫浸润`；保留"全部 i 大小写不敏感、按子串匹配"的匹配语义说明。
- 新增「出处与沿革」：8 条为 aims 早期列举原文（2026-10-21 按 S21 疑点 h 逐字复核）；如实记录 2026-10-20 曾反向裁定 27 条为规格正本，以及 2026-10-21 用户改判收敛的理由（那 19 条无规格条文依据，违反铁律），并重申"增删必须同时改清单与 tumor_blacklist.js"。
- 「已知边界」按收敛后的实际行为重写：列出不再单独拦截的词，同时点明 adenocarcinoma / squamous cell carcinoma 仍因含 carcinoma 命中、tumor microenvironment 仍因含 tumor 命中、肿瘤微环境/癌细胞/癌症 仍因含 肿瘤/癌 命中；"免疫"作为领域合规与"免疫浸润"作为机制词拦截不冲突。

### 3. 新增 `BioanalysDesktop/tests/tumor_blacklist.test.js`（205 行，15 个 test，LF）

| 行 | 测试名 | 锁定的契约 |
|---|---|---|
| :36 | 黑名单恰好 8 条，且与 aims 清单逐条同序一致 | 条数 + 逐条 `String(regex)` 同序比对，防止下一次悄悄扩充 |
| :45 | 英文模式大小写不敏感 | CANCER / Tumor / Glioma 等大写写法命中 |
| :51 | 逐模式正例：8 条模式各自命中规格词 | 8 条模式各自至少一个正例，逐条可归因 |
| :70 | immune infiltration 允许词间空白 | `immune infiltration` / 多空格 / 制表符 |
| :76 | 收敛后不再命中的历史扩充词（口径回退的回归锚） | 13 个词逐一断言 `hit === false`：tumour、tumour microenvironment、sarcoma、lymphoma、leukemia、leukaemia、melanoma、immune checkpoint、PD-L1、PD1、CTLA-4、oncogene、免疫检查点 |
| :97 | 父词覆盖：这些词虽移出清单，仍因含父词而命中（如实记录边界） | adenocarcinoma、squamous cell carcinoma、tumor microenvironment、肿瘤微环境、癌细胞、癌症、致癌物、免疫浸润微环境 |
| :115 | 正常非肿瘤文本必须放行（误伤负例） | 脑卒中、阿尔茨海默、肺纤维化、脂肪肝、帕金森、"免疫"、"免疫微环境"、PD1 抑制剂、CTLA4、TP53 EGFR MYC、GSE16561 |
| :134 | 子串匹配的固有边界："非肿瘤"仍会被拦（如实记录，不视为 bug） | 与 aims 边界说明对齐，避免以后被当成新 bug 反复"修" |
| :140 | matches 去重且保留原文大小写 | `['CANCER','肿瘤']` 顺序与原文一致 |
| :146 | 空值与非字符串输入安全放行 | undefined/null/''/数字/对象均不抛错 |
| :154 | BLACKLIST_HINT 保持非肿瘤定位提示 | 提示语含"非肿瘤"与"肿瘤/免疫浸润"，防文案漂移 |
| :159 | validateProjectFields：固定语义字段逐字段命中 | name/description/disease/tissue/notes 五个字段各自命中并返回正确 `field` |
| :175 | validateProjectFields：非固定 key 也全量扫描（踩坑台账 #153 回归） | `group_*` / `focus_gene_*` 命中即拒，锁死"字段白名单硬编码"坑不复发 |
| :185 | validateProjectFields：无命中与空输入安全 | `{}` / undefined / null 均返回 hit=false 且不抛错（覆盖本次修的崩溃点） |
| :202 | validateProjectFields：非字符串字段值不抛错 | 数字、数组、对象值不导致 TypeError |

## 二、为什么

1. **口径以规格正本为准，不以实现为准。** 项目铁律原文：只按规格中经确认的黑名单和校验规则实现拦截，不要自行扩充规则。S21 侦察（`con_hf/dispatch/S21_scout_workbench_gaps.md:170` 疑点 h）已查明 27 条里 19 条是 `tumor_blacklist.js` 自行扩充，规格原文只有 8 条。2026-10-20 的旧裁定（`con_hf/操作台账.md:3271-3278`）反向把 27 条写成规格正本，理由是"收敛会放行 sarcoma / lymphoma / PD-L1 等明确肿瘤词"；2026-10-21 用户改判：宁可放过，也不许实现方自行扩大拦截面。**这是用户裁定，不是执行者的口味选择**，本切片只负责落地并把沿革写进 aims，避免下一个人再翻回去。
2. **为什么导出 BLACKLIST_PATTERNS。** 原文件该数组不导出，任何测试都无法断言"恰好 8 条"，只能间接测行为；一旦有人加回第 9 条，行为测试仍可能全绿。导出后 `:36` 的测试直接锁条数与逐条正则，让"越权扩充"在 CI 里立刻失败。
3. **为什么顺手修 validateProjectFields 的 null 崩溃。** 写 `:185`"空输入安全"用例时发现 `validateProjectFields(undefined)` 直接 TypeError。原实现的 `Object.keys(fields || {})` 只兜住了 key 列表，循环体里的 `fields[key]` 没兜。这是同文件内的健壮性缺陷，修它对所有正常调用方行为零变化（正常调用方永远传对象），但让"上游漏传"从 500 崩溃降级为放行。
4. **为什么不改前端。** `BioanalysDesktop/src/App.tsx` 没有本地正则副本：它在 :662-690 防抖 350ms 调 `POST /api/blacklist/check`（服务端 `server/index.js:818-829` 走 `checkTumorBlacklist` + `BLACKLIST_HINT`），只实时校验 name/description/disease 三字段，其余字段靠建项时 `server/project.js:406-431` 的 `validateProjectFields` 兜底。收敛服务端即自动生效，前端无需改。
5. **为什么不改 portal 与文档。** 那几处在 write scopes 外，按派发单要求只写建议，见第五节。

## 三、验证尾行原文

单文件（`cd BioanalysDesktop && node --test tests/tumor_blacklist.test.js`，exit 0）：

```
ℹ tests 15
ℹ suites 0
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 101.454
```

全量（`cd BioanalysDesktop && npm test`，exit 0）：

```
ℹ tests 397
ℹ suites 0
ℹ pass 397
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3655.3425
```

基线 382/382 → 397/397（+15，全部来自本切片新增文件）；无既有测试因收敛失败（仓库内无任何测试断言"27 条"或读取 aims 文本；`tests/project.test.js:130-131`、`tests/v3_intake.test.js:304-313` 用的 cancer/肿瘤 仍在 8 条内）。

## 四、已知边界

1. **子串匹配的固有误伤（规格语义，非 bug）**：`非肿瘤` 命中 `肿瘤`、`致癌物`/`癌变` 命中 `癌`；单字 `免疫` 不拦（只有 `免疫浸润`）、`免疫微环境` 不拦（不含"浸润"）。已在 aims 边界节与 `:134` 测试中如实记录，避免以后被当新 bug 反复"修"。
2. **收敛后放行的词（故意的）**：tumour 及英式拼写、sarcoma、lymphoma、leukemia/leukaemia、melanoma、immune checkpoint、PD-L1/PD1、CTLA-4、oncogene、tumor suppressor、免疫检查点。实际拦截面仍比"8 条"宽，因为父词覆盖（adenocarcinoma / squamous cell carcinoma 含 carcinoma，tumor microenvironment 含 tumor，肿瘤微环境 / 癌细胞 / 癌症 含 肿瘤/癌）。
3. **portal 前端目前比服务端严**：`portal/index.html:620` 仍是 27 条副本，注释还写着"与工作台 tumor_blacklist.js 同源"（已不同源）。后果是用户可能在 portal 被前端拦下，而服务端本会放行；不影响服务端建项兜底，但两边口径不一致，需 Lead 按第五节同步。
4. **导出 BLACKLIST_PATTERNS 的误用风险**：它只是测试探针。若后续有人直接 import 它做业务判断，就绕过了 `checkTumorBlacklist` 的字符串归一化（`String(text || '')` 与去重），不建议。
5. **未连真机、未改 git**：所有测试走纯函数，无 ssh/spawn 垫片需求；未 commit / checkout / stash，工作树改动仅上述三个文件（`git diff --stat` 里 `docs/geo_mining_sop_v2.md`、`ops/README.md`、`_archive/` 重命名、`shared/upload_session.mjs` 等属其他切片的并发改动）。
6. **全量测试会真实 ssh 到 k40-ubuntu**（`tests/consistency.test.js`，127.0.0.1:10022），本机可达故 397 全过；该连接不是本切片新增的。

## 五、建议改动（write scopes 外，请 Lead 落地）

| 文件:行 | 现状 | 建议改成 | 不改的后果 |
|---|---|---|---|
| `portal/index.html:619-628` | `var BL_PATTERNS` 仍是 27 条副本，注释"与工作台 tumor_blacklist.js 同源"；`checkBlacklist` 在 :629，调用点 :852（实时）与 :1654（提交前，含 notes） | 同步收敛为与 server 同序的 8 条，注释改为"规格正本 aims/aims.txt §三.1，与 BioanalysDesktop/server/tumor_blacklist.js 逐条同序" | portal 比服务端严，两边口径漂移；下次有人按 portal 反推服务端口径会再次走错 |
| `docs/delivery_supervisor_prompt.md:61` | "严禁绕过 27 条肿瘤/免疫浸润中英文正则黑名单（`server/tumor_blacklist.js`）" | "严禁绕过 8 条肿瘤/免疫浸润中英文正则黑名单（`server/tumor_blacklist.js`，规格正本 aims §三.1）" | 监督方按过期条数核对，会把合规实现判成漏拦 |
| `项目交付报告.html:131` | "模块A：项目信息 + 非肿瘤正则黑名单(30词)" | "非肿瘤正则黑名单（8 条，见 aims §三.1）" | 交付材料数字过期，且与 :196 的 30 自相矛盾 |
| `项目交付报告.html:196` | "30个中英文正则黑名单(cancer/tumor/免疫浸润...)" | "8 条中英文正则黑名单（cancer/tumor/carcinoma/glioma/immune infiltration/肿瘤/癌/免疫浸润）" | 同上 |
| `con_hf/handoff.md:1331` | 表格"黑名单 \| 27 \| 27 条正则 \| ✓" | 若 handoff 作交接正本，改为 8 并注明 2026-10-21 裁定 | 接手方按 27 条复核 |
| `con_hf/handoff.md:1169` | "内置 `BL_PATTERNS` 黑名单正则……"（事实描述，未提条数） | 可保留；建议加"待与 server 8 条同步" | 低风险 |

架构层建议（不在本切片）：黑名单目前有 3 处副本（server JS、portal HTML 内联、aims 清单），靠人工"两侧同步"必然再次漂移。根治方向是单一真源 + 构建期注入（例如 portal 由 server 导出生成，或测试断言 portal 副本与 server 逐条同序）。本次测试只能锁住 server 侧，portal 侧无测试覆盖。

## 六、附：工作树状态自查

- 本切片改动：`M BioanalysDesktop/server/tumor_blacklist.js`、`M aims/aims.txt`、`?? BioanalysDesktop/tests/tumor_blacklist.test.js`。
- 换行：两个代码/测试文件均为 LF（`CR=0`）；`aims/aims.txt` 保持仓库既有 CRLF 工作树形态（`core.autocrlf=true`，index 为 LF，edit 未引入混合行尾）。
- 未执行 `npm install` / `pnpm add` / 未改 `package.json` / 未跑 build。
