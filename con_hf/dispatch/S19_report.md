# S19 回报：portal 补「数据文件上传」UI

> 本文件按 SUBAGENT_CONTRACT.md 输出契约按序填写，每完成一步即时更新。
> 项目根：D:\00.AIagent\codespace\AI辅助生信分析流程工作台
> 唯一改动文件：`portal/index.html`（服务端 / 测试 / ops / src 一行未碰）

## 1. 任务理解

目标：在用户提交台（portal）第 2 步「数据来源」新增 `IN_HOUSE_UPLOAD` 数据来源模式，
选中后渲染数据文件上传区，上传走裸二进制流 `POST /api/datafiles?sid&role&bind&name`，
提交时把 `uploadSid` / `dataFiles` / `data_source_mode='IN_HOUSE_UPLOAD'` 写进 `buildManifest()`，
使服务端 `validateDataFiles` + `buildPackagePlan` 能归档成 `PKG_*/raw_data/`。

验收标准：A1 模式可选、上传区正确渲染；A2 上传正路径真通（落盘 + PKG 包 + manifest）；
A3 ≥4 条负路径真 400 且 error 点名问题；A4 验证脚本落 `cn_debug/2026-10-20_verification_s19_portal_upload.mjs`
且 payload 由「UI 字段收集逻辑」构造；A5 `npm test` 237/237 + `node --check portal/serve.mjs`；
A6 PUBLIC_DB 路径零变化；A7 页面无 JS 报错（无浏览器环境则明确标注未验证）。

执行边界：只改 `portal/index.html`；不改 serve.mjs / archive.mjs / BioanalysDesktop / 测试 / ops / src；
不引外部依赖；不用 multipart/FormData；不改页面既有视觉体系。

## 2. 前端预检清单（逐条整理自服务端源码）

来源：`portal/lib/archive.mjs`（DATA_ROLES / DATA_EXT / MAX_DATA_BYTES /
MAX_DATA_FILES_PER_ROLE / validateDataFiles / buildPackagePlan / sanitizeFileName）
与 `portal/serve.mjs`（handleDataFileUpload / handleSubmit）。

上传接口 `POST /api/datafiles`（query：sid / role / bind / name，body = 文件裸二进制流）：

1. `sid` 必须匹配 `SID_RE = /^[A-Za-z0-9_-]{6,64}$/`，否则 400「上传会话 id 非法」。
2. `role` 必须 ∈ `DATA_ROLES`（train_matrix / val_matrix / sample_sheet / group_map /
   platform_annotation / other），否则 400「角色非法…」。
3. `name` 原文件名经 `sanitizeFileName` 后不得退化成 `file`，否则 400「文件名缺失或不可用」。
4. 扩展名（sanitize 后取最后一段，小写）必须 ∈
   `DATA_EXT = .tsv .csv .txt .gz .zip .xlsx .h5ad .rds .mtx`，否则 400「不支持的数据文件格式…」。
5. 体积 > `MAX_DATA_BYTES`（1 GiB）→ 400「单文件超过上限 1024MB」；空 body → 400「上传内容为空」。
6. 落点 `inbox/uploads/<sid>/<sanitizeFileName(name)>`，同名追加 `_2` / `_3`；
   返回 `{ok:true, name: savedName, path: 'uploads/<sid>/<savedName>', size}`。

提交接口 `POST /api/submit`（payload.uploadSid 或 dataFiles 非空即走包形态）：

7. `validateDataFiles` 通用层：角色合法、文件名非空、扩展名白名单、体积 ≤ 1 GiB、
   非 other 角色只允许 1 个、other 最多 `MAX_DATA_FILES_PER_ROLE = 3` 个。
8. `IN_HOUSE_UPLOAD` 层：`dataSource.uploaded_files[role]` 必须存在，且
   `basename(uploaded_files[role]) === basename(dataFiles[].name)`（允许用户填相对路径），
   否则「与填写的矩阵文件名 … 不一致」；val_matrix 未填则「需求未填写验证集矩阵（val_matrix）」。
9. `PUBLIC_DB` 层：train_matrix / val_matrix 必须绑定且 bind ∈ datasets；
   train_matrix 必须等于训练集 GSE、val_matrix 必须 ∈ 验证集 GSE；
   sample_sheet / group_map / platform_annotation 可不绑，但绑了就必须 ∈ datasets；
   bind 非空时文件名里出现的 `GSE\d+`/`GPL\d+` 必须与 bind 一致（大小写不敏感）。
10. `buildPackagePlan`：归档名 `<role>__<bind>__<原名>`（bind 为空则两段），
    落 `PKG_<时间戳>_<项目名>/raw_data/`，同名追加 `_2` / `_3`；
    `package_manifest.json` 的 `data_files[]` 含 role / bind / original_name / archive_name / size / from / to。
11. 提交前置（两种模式都查）：`dataSource.dataType` ∈ 四种枚举；
    `dataSource.datasets` 至少一组且每组有 GSE；references ≤ 5 且 path 形如 `refs/<sid>/<文件名>` 且文件存在；
    notes ≤ 4000 字。
12. 归档时数据文件从 `uploads/<sid>/` **移动**进包目录（rename），失败整体 500；
    上传会话目录搬空后才删除。

UI 侧据此实现的对应预检（同规则，先于服务端拒）：角色 ∈ 枚举、扩展名白名单、
≤1 GiB、bind 按角色策略（train_matrix→训练集 GSE 必绑、val_matrix→验证集 GSE 必绑、
sample_sheet/group_map→请绑训练集 GSE（可不绑）、other/platform_annotation→可不绑）、
bind ∈ 已填数据集列表、文件名 GSE/GPL 与 bind 一致、other ≤ 3、非 other 角色唯一（重复即替换提示）。

## 3. 实现摘要

`portal/index.html`（唯一改动文件，+约 380 行，零新增 CSS、零外部依赖）：

- 第 2 步新增「数据来源模式」卡片（复用 `.check` 卡片与既有 CSS 变量）：
  `PUBLIC_DB`（默认，既有行为）/ `IN_HOUSE_UPLOAD`（选中即显示上传区）。
- 上传区：规则说明 guide（bind 规则 / 同名替换 / 白名单 / 1 GiB 全部明示）、
  角色下拉（6 个角色带中文说明与必填标记，已传角色标注「已上传，再次上传将替换」，other 满 3 禁用）、
  bind 下拉（选项来自步骤 2 已填数据集 GSE 并按角色策略过滤，允许不绑的角色才有「不绑定编号」）、
  文件选择（accept 与白名单一致）、上传按钮、已传列表（角色 / bind / 文件名 / 大小 / 「已上传」标签 / 删除）。
- 上传：`fetch('/api/datafiles?sid&role&bind&name', {method:'POST', headers:{'Content-Type':'application/octet-stream'}, body: file})`；
  成功入列表、失败**原样展示服务端 error**；前端先做同规则预检。
- `buildManifest()`：仅 `IN_HOUSE_UPLOAD` 模式追加
  `dataSource.data_source_mode='IN_HOUSE_UPLOAD'`、`dataSource.uploaded_files`（角色→原始文件名）、
  `uploadSid` + `dataFiles[{role,bind,name,size,path}]`（有文件时才带后两者）。
  PUBLIC_DB 模式返回对象的键集合与改动前逐键一致。
- `validateStep(2)`：IN_HOUSE 模式要求至少 1 个文件且每个文件绑定仍对得上当前数据集。
- 摘要与打印报告：仅 IN_HOUSE 模式新增「数据来源模式 / 数据文件」行与「二·补、上传的数据文件」表；
  PUBLIC_DB 快照逐字不变。
- 上传会话 id 改为 `u` + 12 位十六进制（`newUploadSid()`，过服务端 SID_RE）。
  **参考文献与数据文件共用同一 sid**：服务端 `buildPackagePlan` 用 `payload.uploadSid` 推导
  `refs/<sid>/` 来源路径，两边不一致会让参考文献报「缺失或越界」:已用 4.1 真链验证同包归档。
- 包形态提交成功后置位拦截，避免同一 payload 二次提交换来一句难懂的服务端 400。

## 4. 文件变更清单

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `portal/index.html` | 修改 | 上述全部前端改动（HTML + 内联 JS） |
| `cn_debug/2026-10-20_verification_s19_portal_upload.mjs` | 新建 | 真链验证脚本，23 项断言，可复跑 |
| `con_hf/dispatch/S19_report.md` | 新建 | 本回报 |

未触碰：`portal/serve.mjs`、`portal/lib/archive.mjs`、`BioanalysDesktop/`（含全部测试）、
`ops/`、`src/`、`projects/`、`outputs/`、`project_data/`、真实 `portal/inbox/`
（验证全程用 `PORTAL_INBOX` 临时目录，脚本 0.0 断言 inbox 已隔离）。
仓库内 `outputs/`、`projects/`、`con_hf/figures_*`、`project_data/` 下的近期变动来自并行会话，非本会话所为。

## 5. 接口与交互实现说明

- 模式字段：`dataSource.data_source_mode` ∈ {`PUBLIC_DB`, `IN_HOUSE_UPLOAD`}；
  提交 payload 另带 `uploadSid` / `dataFiles`（有上传时才带）与 `dataSource.uploaded_files`。
- `dataFiles[].name` = 用户选中的**原始文件名**；`path` / `size` = 服务端返回值
  （服务端 sanitize / 同名 `_2` 后的真实落点）。归档名由服务端按原名生成，故包内名字对得上用户认知。
- `uploaded_files` 由 UI 从选中文件名自动派生，使服务端「上传名 == 填写名」校验按构造成立
  （服务端该分支硬校验，见 portal_archive.test.js 的 IN_HOUSE 用例）。
- bind 策略与服务端 `validateDataFiles` PUBLIC_DB 分支同规则；IN_HOUSE 模式下服务端不校验 bind，
  UI 仍按同一策略引导（bind 同时进归档名，便于人工核对）。

## 6. 测试与验证记录（全部为真实执行）

命令与结果（Windows + git-bash，项目根为工作目录）：

1. `node --check portal/serve.mjs` → **PASS**（确认未碰坏服务端）。
2. 内联脚本抽出后 `node --check` → **PASS**（页面 JS 无语法错误）。
3. `node cn_debug/2026-10-20_verification_s19_portal_upload.mjs` → **23/23 通过**。要点：
   - 第 0 层「UI 真码」：用正则从 `index.html` 抽出 `newUploadSid` / `DATA_*` / `ROLE_BIND_POLICY` /
     `dfPrecheck` / `dfSubmitProblem` / `buildManifest` 真实源码配桩执行；UI 常量与
     `import` 进来的 `portal/lib/archive.mjs` 真值 `deepEqual` 全等；
     **提交所用 payload 就是这份真 `buildManifest()` 的产物，不是手写 JSON**（A4）。
   - 0.6：PUBLIC_DB 模式顶层 10 键、`dataSource` 5 键与改动前完全一致，且
     `dataFiles`/`uploadSid`/`data_source_mode`/`uploaded_files` 均为 `undefined`（A6）。
   - 2.1/2.2：真上传落盘 `uploads/<sid>/`；真提交 200，`PKG_2026-10-20_HHMMSS_S19_验证项目/`
     生成，`raw_data/train_matrix__GSE277173__GSE277173_series_matrix.txt.gz` 字节一致，
     `package_manifest.json` 的 `data_files[0]` 七字段（role/bind/original_name/archive_name/size/from/to）全部正确，
     `requirement.json` 的 `data_source_mode` / `uploaded_files` / `uploadSid` 正确（A2）。
   - 负路径 8 条全部真 400 且 error 点名（A3）：① 角色非法 ② `.exe` 不在白名单（且不落盘）
     ③ sid 非法 ④ bind 不在数据集列表 ⑤ train_matrix 绑了验证集 GSE ⑥ 文件名 GSE 与 bind 不一致
     ⑦ IN_HOUSE 上传名与填写名不一致 ⑧ 同一角色两条文件。
   - 4.1：同一 sid 下数据文件 + 参考文献 → 一个包内 `raw_data/` 与 `references/` 齐全（共享 sid 决策验证）。
   - 4.2/4.3：PUBLIC_DB 无数据文件仍落扁平 JSON；仅参考文献时仍走扁平路径（老行为不变）。
   - 1.1：`GET /` 200 + 上传区全部构件（含白名单与 1 GiB 明示）在 HTML 中。
4. `cd BioanalysDesktop && npm test` → **tests 237 / pass 237 / fail 0**（A5、A6；
   改动前后各跑一次，基线同为 237/237）。
5. 结构自检（临时脚本，未入库）：30 类标签全部配平、5 个面板、5 个步骤、83 个 id 无重复。

未验证 / 无法验证（不做推断）：
- **真实浏览器交互未验证**：本环境无浏览器。新模式可选、上传区显示、下拉联动、文件选择、
  点击上传、删除等只做了服务级 200 + 内联脚本编译 + DOM 结构断言，未做真实点击级验证（A7 按此口径）。
- 1 GiB 上限只验规则分支（`dfPrecheck` 超限拒），未真传 1 GiB。

## 7. 假设与风险

1. **服务端「同角色删旧」是死代码**（serve.mjs:162）：`fs.readdirSync(dir).filter(n => n.startsWith(role + '__'))`
   与落盘命名 `sanitizeFileName(name)`（无角色前缀）永远匹配不上，所以重复上传的旧文件不会被删。
   实测证据：2.2 中同 sid 同名重传返回 `GSE277173_series_matrix.txt_2.gz`，首个文件仍在
   `uploads/<sid>/`。影响：`uploads/<sid>/` 会留孤儿文件，提交后会话目录也因此不会被清空。
   **包本身始终正确**（UI 只把最新 path 写进 payload）。本切片冻结服务端，未修:见 §9。
2. UI「删除」只把条目从 payload 移除；服务端无删除 API，物理文件留在 inbox。
3. IN_HOUSE 模式已传文件后切回 PUBLIC_DB：文件不进 payload（摘要与提示已明说），物理文件同上。
4. `uploaded_files` 为 UI 自动派生；若将来加「手动填写文件名」输入框，须与服务端
   「上传名 == 填写名」校验同步，否则会 400。
5. 包提交成功后需刷新页面才能改后重传（有明确提示，不静默）。
6. 项目无 lint / typecheck 配置，未运行此类检查；`npm test` 即项目既定验证入口。

## 8. 架构/接口变更建议（如发现冲突）

无阻塞性冲突。两点观察交主 Agent 裁决：
- serve.mjs:162 的 `role__` 前缀删旧过滤建议改为按角色记录或直接依赖客户端 payload（见 §7.1）。
- `portal/lib/archive.mjs` 的 IN_HOUSE 分支要求 `uploaded_files`，而派发单的 payload 契约只列了
  三个字段；UI 已按服务端事实补上 `uploaded_files`（自动派生），建议在主 Agent 的契约文档里补记该字段，
  避免后续切片误以为 payload 只有三项。

## 9. 待主 Agent 决策事项

1. 是否开一个服务端小切片修 `role__` 死代码 / 加上传删除 API（均超出本切片「服务端一行不改」边界）。
2. `uploaded_files` 是否要进主 Agent 侧的 payload 契约文档（§8 第 2 点）。
3. 真实浏览器验收（点选模式、下拉联动、上传、删除）是否安排人工或 CDP 复测。

## 10. 建议下一步

1. 人工或 CDP 打开 `http://127.0.0.1:8080/` 走一遍：选「自有数据上传」→ 训练集矩阵绑训练集 GSE 上传 →
   验证集矩阵绑验证集 GSE 上传 → 提交，核对收件箱 `PKG_*/raw_data/`。
2. 若要消掉 uploads 孤儿文件，按 §9.1 开服务端切片；改后本验证脚本 2.2 的〔观察〕结论需同步更新。
3. 本任务无正式结果目录（前端切片，产物即 `portal/index.html` 与验证脚本，已按项目约定归位）。
