# 全量审查 Round1 计划稿：227 条缺陷收敛为五个梯队、34 张票

本文件是 `goal-b672d087-b0f9-4e01-8c76-bfc780c340d5` 第一轮的产出：只取证 + 计划，不动工。
缺陷明细在 `.tmp/review/` 五份（portal_ui.md 55 条 / server.md 68 条 / figures.md 44 条 / tests_gates.md 54 条 / frontend.md 50 条），本文件只做收敛与排序。

## 一、怎么读这份文件

| 你 | 取 |
|---|---|
| 想知道先修什么 | 第二节梯队表 + 第四节梯队 0 全票 |
| 想知道某条缺陷在哪 | 直接用票号到 `.tmp/review/` 里 grep |
| 想知道为什么这个顺序 | 第三节排序依据 |
| 想验收 | 每张票的「红测判据」，全绿才算完 |

## 二、五梯队总表（4 Argon 裁定：严格串行，梯队 0 红测先行）

| 梯队 | 主题 | 票数 | 入口条件 | 出口判据 |
|---|---|---|---|---|
| 0 | 止血（P0） | 6 | 无 | 6 张票各自的红测全绿 + 变异反证全红 |
| 1 | 出图真源 | 7 | 梯队 0 完成 | 30 ready 逐条重渲染、preview sha 逐字节等于产物 sha、总门禁绿 |
| 2 | 门禁自证 | 7 | 梯队 1 完成 | mutation_gate 5 条变异全部变红、gate:all 从 7 道变 8 道且绿 |
| 3 | UI 与流程简化 | 8 | 梯队 2 完成 | 三套信息架构收敛为两套、双端校验规则同一份常量、fetch 不再裸调 |
| 4 | 页面美化 | 3 | 梯队 3 完成 | 空态/密度/对齐达标，不引入新交互 |

铁律（Argon 原话「绝不能混杂并行」）：
1. 梯队内可以并行，梯队间严格串行。
2. 每张票先写红测，红测不变红不许改实现。
3. 每张票收尾必须做一次变异反证：把该票修的东西破坏回去，对应红测必须变红。
4. 梯队 0 与 1 期间锁死 `ops/figure_ready_allowlist.json`，readyCount 恒 30。

## 三、排序依据

1. 已复现的进程级 DoS 与整页白屏在任何 UI 改动之上都是负资产：门户能被一条畸形请求打死（我亲手复现），mock 模式下桌面端整页 React #321 白屏。
2. 出图是用户连续两轮点名的痛点，但「配色不对」的真因是图没重跑 + 母版三份分叉。先归一母版再重渲染，否则重渲染只是把旧配色的图再出一遍。
3. 门禁排在业务之后，因为四条门禁自身能在功能失效下打 OK，不先让它们可信，后面所有梯队的「绿」都不能当证据。
4. UI 重构排在第 3 梯队，因为信息架构收敛会大改 OnboardingView.tsx，先修完安全与数据链再动结构，避免返工。

## 四、梯队 0：止血（6 张票，全部 P0）

### T0-1 门户进程级 DoS
- 位置：`portal/serve.mjs:1444` `const url = new URL(req.url, ...)` 无 try；`portal/serve.mjs:1809` listen 无 error 监听；全文件无 uncaughtException。
- 复现：向 8080 发 `GET http://[bad HTTP/1.1` → socket ECONNRESET → `/health` FETCHFAIL → 8080 不再 LISTENING。
- 修：URL 解析 try/catch 回 400；listen 挂 error；加 process.on('uncaughtException') 与 unhandledRejection 兜底。
- 红测：起测试实例 → 发畸形请求 → `/health` 仍 200 且进程 pid 不变。
- 变异：去掉 try/catch → 红测必须红。

### T0-2 survey 三端点未鉴权
- 位置：`portal/serve.mjs:1674-1707` `/api/survey/select` 不在 `PROTECTED_API`（`portal/serve.mjs:1507-1509` 只有 /api/submit、/api/datafiles、/api/references），ticket 只过正则就 writeFileSync 覆盖。
- 修：三个 survey 端点纳入 PROTECTED_API，并校验 `Sec-Fetch-Site` / `Origin`。
- 红测：无口令 POST /api/survey/select → 401 或 403，文件 mtime 不变。
- 变异：从 PROTECTED_API 移除 → 红测必须红。

### T0-3 PORTAL_TOKEN 未配置即全放行
- 位置：`portal/serve.mjs:399-408` `if (!expected) return { ok: true };`，注释自认「未启用：任何请求都放行」。
- 修：未配 token 时写端点（POST/PUT/DELETE）一律 403 并打启动告警；只读端点继续放行，保证现有 auth_required=false 的门户体验不退。
- 红测：未配 token 的实例 POST /api/submit → 403；配了 token 且带对的口令 → 200。
- 变异：把 `if (!expected)` 改回 return ok:true → 红测必须红。

### T0-4 diagnostics 远端命令拼接
- 位置：`BioanalysDesktop/server/routes/diagnostics.routes.js:190-191`（`dir` 直接取 searchParams 拼进 `if [ -d '<requested>' ]`，无条件可注入）、`:233-235`（`sub` 经 `files.js:16-32` normalize 只折叠 . 与 ..，不处理引号，属有条件可注入）。
- 修：`dir` 走白名单正则 `/^[A-Za-z0-9._/-]+$/`；`sub` 同规则；两条都改为 base64 传参远端解码，彻底不拼引号。
- 红测：`dir=x'; id; echo '` → 400 且远端无执行痕迹。
- 变异：去掉正则 → 红测必须红。

### T0-5 桌面端 effect 交错 + 白屏
- 位置：`BioanalysDesktop/src/App.tsx:66-101`（第一个 effect 的清理函数里插进了第二个 useEffect，导致首页 mount 时 /api/selfcheck 请求 0 次，卸载时抛 Invalid hook call）；`src/views/SelfCheckAdminView.tsx:17-19`（不判 res.ok，:74 直接 result.checks.map 无兜底 → 401/500 白屏）；src 全站无 ErrorBoundary。
- 修：拆成两个独立 effect；新增 `src/lib/fetchJson.ts` 统一判 res.ok；加 ErrorBoundary 包住每个 tab。
- 红测（Playwright）：① 首页 mount 后 /api/selfcheck 恰好 1 次；② `BIO_COMPUTE_ADAPTER=mock` 下页面不白屏且横幅可见；③ selfcheck 返 500 时显示错误卡片而非崩。
- 变异：还原交错 effect → ①②必须红。

### T0-6 runningTasks 幽灵任务导致永久 409
- 位置：`BioanalysDesktop/server/routes/tasks.routes.js:146` `if (runningTasks.size > 0) return 409`；set 在 :322，审计失败路径（:278-328）仍登记。
- 修：runningTasks 由全局单例改为按 projectId+lineId 分桶；审计失败时在 onExit 前 delete；启动时清空残留。
- 红测：模拟审计失败一次 → 再次提交同项目应 200；不同项目必须互不阻塞。
- 变异：恢复全局 size 判断 → 红测必须红。

## 五、梯队 1：出图真源（7 张票）

Argon 裁定 Q2/Q3 已定：以 `reference/05.可参考出图代码/_meta/R453_compat/` 为唯一真源，18 条不降级而改走重渲染门禁。

### T1-1 母版三份归一
- 现状：`_meta/R453_compat/L2_core_code.R`(a8ae5c81) vs `L2_组学常用图/L2_core_code.R`(d60ecbf2) vs `L2_组学常用图/L2_volcano_code.R`(8829922c) 三份火山；`_meta/R453_compat/L3_sankey_code.R`(9f80d4b6) vs `L3_高级组合图/L3_sankey_code.R`(6c94fe74) 两份桑基。
- 修：主目录三份移入 `reference/05.可参考出图代码/_legacy/`，从 `_meta/script_plot_matrix.json` 删除对应 runner，registry `source` 全指 compat。
- 红测：`src/figure_templates.json` 里出现两次以上的同名母版 basename 断言为 0；矩阵 runner 路径全部存在且不与 _legacy 交叉。

### T1-2 30 ready 逐条真机重渲染 + preview 回写
- 修：k40-ubuntu 用归一后母版重渲染 30 个 ready 的 preview PNG，回写 `preview_sha256` 与 `preview` 路径。
- 红测：每条 `sha256(实际文件) === preview_sha256` 且 30/30 通过；重渲染前后 readyCount 恒 30（铁律）。
- 变异：故意改一个字节 → 该条必须红。

### T1-3 preview 与渲染产物恒等门禁
- 修：并入第 5 道 figure_registry 门禁，断言 `preview_sha256 === 渲染产物 sha`，且渲染产物必须来自 compat 母版。
- 红测：构造 preview 与产物 sha 不等 → 门禁退出码非 0。

### T1-4 line2 火山接真源
- 位置：`src/line2_scrna/scripts/scrna_figures:81-83` UP=#D62728/DOWN=#1F77B4/NS=#BBBBBB；`:721-731` 硬编码 padj<0.05 与 |l2|>1；同文件 :269-270 已有 CASE_COLOR=#EE0000/CTRL_COLOR=#3B4992 未被复用。
- 修：三色改 #EE0000/#3B4992/#BEBEBE，阈值改读 `read_cutoffs()`。
- 红测：7 张 `l2_08_deg_volcano_*` 重渲染后像素采样命中三色；换 loose/strict 档产物点数不同。

### T1-5 桑基产线缺口定案
- 现状：三线 scripts 里 grep sankey/alluvium/chord 命中全为 0；现网预览是 Titanic 演示图（Class→Sex→Age）。
- 修：二选一，本轮建议先出缺口票不硬做：若 line1 的 WGCNA 模块与基因成员表已就位，则补产线入口；否则把 fig_l3_sankey 标 `block_reason=无产线数据入口`（会打破 readyCount=30，需用户单独授权）。
- 红测：无论走哪条，注册表状态与产线能力必须一致，不允许「registry 说 ready 而产线无入口」。

### T1-6 火山排版接规范
- 位置：`src/line1_bulk/scripts/bulk_figures:517` figsize=(8,6.5)；:541-544 caption 缺判据与基因数；:517-546 无基因名标注。
- 修：按 `reference/03出图规范/sci.md:61` 改 single 88x80mm，标 Top5-15 基因名，caption 四要素（判据/三色语义/上下调数/基因总数）。
- 红测：PNG 物理尺寸 88x80mm ±1mm；caption 行内可见 `|log2FC|>X & adj p<Y` 与 `n=N`。

### T1-7 便携包适配器同步
- 位置：`dist/portable/BioanalysWorkbench/BioanalysDesktop/server/figure_adapters.js`（grep EE0000=0、D55E00=13，仍是旧配色）。
- 修：把 dist/portable 的同步纳入构建步骤而非手工拷贝。
- 红测：构建后 dist 与 server 的 figure_adapters.js sha 相等。

## 六、梯队 2：门禁自证（7 张票）

### T2-1 clean_workspace 神圣名单
- 位置：`ops/clean_workspace.mjs:40-49` SACRED_PATTERNS 漏 `BioanalysDesktop/`（而 `BioanalysDesktop/.tmp` 正是清理目标，实测 3532 项残留）；`:119-135` scanLogs 全仓递归，git 已跟踪的 29 个 .log 也在删除集（实测 dry-run targets=440）。
- 修：名单加 BioanalysDesktop/ 与其下 .tmp；删除集排除 `git ls-files` 命中的文件。
- 红测：`--dry-run` 输出里不得含任何 git 已跟踪路径；`BioanalysDesktop/.tmp/x` 必须被拒。
- 变异：从名单移除 BioanalysDesktop/ → 红测红。

### T2-2 delivery_acceptance coverage_ok
- 位置：`ops/delivery_acceptance_core.mjs:358` 与 `:385` 两处硬编码 true，而 `:273` 与 `:311` 已算出 coverageOk 却弃用。
- 修：两处接到已算出的值。
- 红测：构造覆盖不全的交付记录 → `coverage_ok` 为 false 且退出码非 0。

### T2-3 metrics_sync 子串匹配与 cases=0
- 位置：`ops/metrics_sync.mjs:193` `!actual.includes(n)` 子串匹配；`:118-120` 只在 cases===null 判未实测，cases=0 视为成功。
- 修：改精确相等；cases===0 与 cases===null 一并判未实测。
- 红测：把 README 基线改成差 10 倍的数字 → 门禁红；`node --test 一个不存在的文件` → 门禁红。

### T2-4 ledger_gen --check 空转
- 位置：`ops/ledger_gen.mjs:227-251` main 只有 --write 分支，否则把整份台账打到 stdout 并 return 0（我实跑证实）。
- 修：加 --check 分支，比对磁盘内容，不等则 exit 1 并打印差异摘要。
- 红测：改一处模板数 → `--check` 退出码非 0。
- 变异：删掉 --check 分支 → 红测红。

### T2-5 static_gate 静默跳过与扫描面
- 位置：`ops/static_gate.mjs:275-277` 缺工具只打 [INFO] 且 `return failed === 0 ? 0 : 1`；`:34` SCAN_DIRS 不含 `BioanalysDesktop/tests`、`BioanalysDesktop/src`、`portal`、`docs`。
- 修：缺工具计入 failed（可用 --allow-missing 显式降级）；SCAN_DIRS 扩充。
- 红测：模拟宿主无 Rscript → 门禁红；在 portal/ 放一个语法错文件 → 门禁红。

### T2-6 mutation_gate.mjs（第 8 道门禁，Argon Q4 裁定）
- 修：新建 `ops/mutation_gate.mjs`，对五条关键防线各注入一次破坏，逐条要求对应门禁变红；任一条不变红则整道门禁失败。变异清单：① clean_workspace 名单去 BioanalysDesktop ② metrics_sync 基线改子串 ③ ledger_gen --check 恒 0 ④ static_gate 缺工具仍 0 ⑤ preview sha 改一位。
- 红测：门禁自身全绿；然后手工把任一条变异改成「不破坏」，mutation_gate 必须变红（元变异反证）。
- 代价：gate:all 预估 +40 秒。

### T2-7 CI 去 || true 与补 e2e
- 位置：`.github/workflows/ci.yml:35` 留档步骤整条 `|| true` 且与 :32 重复跑全部门禁；全文无 playwright 步骤，`tests/e2e/portal.spec.ts` 19 个 test 从不执行。
- 修：去掉 || true；加 e2e job。
- 红测：故意让一条测试失败 → CI 红。

## 七、梯队 3：UI 与流程简化（8 张票）

| 票 | 内容 | 红测判据 |
|---|---|---|
| T3-1 | 桌面端 6 tab 收敛为 3 tab（建项与输入 / 结果与图件 / 运维与 Agent，五维自检并入运维） | 页面 tab 数=3；原有 6 项功能入口在新结构里全部可达（逐个点击断言） |
| T3-2 | 双端校验同一份常量：对比对生成策略（桌面端仍保留 ≥3 组自动两两全生成 + 默认全勾）、粘贴解析分隔符（门户支持中文逗号，桌面只认逗号与制表符）、逐行数据集字段（桌面端留空即继承项目级） | 同一份 payload 在两端校验结论必须一致（参数化测试，≥6 组夹具） |
| T3-3 | 25 处 fetch 裸调统一走 fetchJson | grep `fetch(` 后不带 res.ok 的处数为 0；每处失败路径有可见错误态 |
| T3-4 | 内部术语外泄清理（线1/2/3、算力削峰、aims §一.3、Master-SHA256、GET /api/selfcheck、A2A v1.0 :9910、/api/projects/steps、HTTP 400） | 用户可见文案里这些字符串出现次数为 0 |
| T3-5 | 空态与错误态（五维自检整屏只有一张卡无骨架、Studio 首屏三块全空、Pi Agent 监控全省略号、日志流「暂无日志」） | 每个 tab 的空态有骨架 + 一句可执行引导；断网时有重试按钮 |
| T3-6 | 门户提交反馈（3 秒无反馈、失败只说「网络异常」、一次只报一个错、不跳出错步骤） | 提交中显示进度；413/401/422 文案透传；校验失败跳到首个出错步骤并聚焦 |
| T3-7 | 请求体上限与 413（8 处无上限：projects.routes.js:45、tasks.routes.js:49、upload.routes.js:25/111/166、figures.routes.js:165/371、report.routes.js:27；两处超限只 req.destroy） | 超限请求收到 413 且进程不回 ECONNRESET |
| T3-8 | `/api/projects/meta?project=default` 404（local_projects/default/project.json 存在而 Studio 拿不到 meta） | Studio 首屏不再有该 404，meta 正常渲染 |

## 八、梯队 4：页面美化（3 张票）

| 票 | 内容 | 判据 |
|---|---|---|
| T4-1 | 门户 5 步视觉密度与间距统一 | 五步每屏首屏信息量一致，无滚动条抖动 |
| T4-2 | 桌面端结果页三栏布局与字号层级 | 1080p 与 1440p 下三栏不塌陷 |
| T4-3 | 无障碍补课（focus-visible、aria-invalid、抽屉 focus trap、aria-live） | axe 扫描 0 critical |

## 九、刻意不做

- 不新增图模板，不动 `ops/figure_ready_allowlist.json` 的 30 个 ID 集合（30 集合恒等是第二十九轮封板铁律）。
- 不重构 `OnboardingView.tsx` 的 1925 行巨石本身（T3-1 只做 tab 层收敛，巨石拆分单独立票等梯队 4 后评估）。
- 不改 `docs/figure_deep_optimization_plan.md` 的既有裁定，本文件与它是并列关系（那份管图件工程化，本文件管全项目缺陷优先级）。
- 不在梯队 0 期间清理 8 个 `.tmp_probe_*.mjs` 探针（后面几轮还要用）。

## 十、执行入口

梯队 0 第一张票 T0-1（门户 DoS），红测先写：`tests/portal_dos_resilience.test.js`。
