# 全量审查 · 生信算力与出图正确性轴（lead 取证，2026-11-05）

> 审查身份：【低资源嵌入式 Linux 生信算力与 SCI 出图正确性轴】。
> 配合身份：4 Argon =【系统架构、质量门禁与发表规范合规的首席外部评审】；
> platform-auditor =【系统与平台工程审计师】（服务端 / 门禁 / 测试有效性 / React UI 轴）。
> 基线 HEAD `0f26f9f`（本轴前置文档提交），前序 `941e92e`。工作区除 `con_hf/ledger/actions.jsonl`
> 运行期追加（342 行遥测，append-only）与未跟踪的 `项目情况汇总2026-11-04.md` 外干净。
> 实测：`node ops/run_all_gates.mjs --skip-tests --json` → ok=true，16 道非慢门禁全绿，11 秒。
> 全量 `npm test` 以托管后台作业运行，结果在收尾节补录。

## 一、取证口径

只读扫描 `src/line*/scripts/*`（54 步母版）、`ops/*figure*` 与 `ops/*gate*.mjs`、
`docs/figure_spec.md` v2.2、`ops/run_all_gates.mjs` 17 道门禁清单、
`docs/UI_OPTIMIZATION_BACKLOG.md`、`docs/full_review_round1_plan.md` / `round2_plan.md`、
`.tmp/receipt44.md` / `round43.md` / `commit_msg35.txt` / `commit_msg36.txt`。
每项结论带 file:line 或实跑数字，区分「已确认缺陷」与「待验证假设」。

## 二、已确认缺陷（真 bug / 契约违背，优先修）

### B1 `figure_source_provenance.mjs` 漏审 1 份出图脚本（P1，门禁假绿）
- 证据：`ops/figure_source_provenance.mjs:24-31` 的 `FIGURE_SCRIPTS` 只登记 6 份；
  `glob src/line*/scripts/*figures*` 实得 7 份，缺 `line3_spatial/spatial_figures`。
  `grep PROVENANCE: src` 实得 6 处声明，`spatial_figures:1-12` 头部无声明。
- 后果：这道门禁（总门禁第 11 道）输出 `FIGURE_PROVENANCE_OK`，但漏掉一份真实出图脚本。
  门禁自称「全部出图脚本均有诚实溯源声明」，与实际不符，属自我宣称失真的假绿。
- 红测判据：新增契约断言「`FIGURE_SCRIPTS` 集合 === `glob('src/line*/scripts/*figures*')` 集合」，
  当前应红；修后转绿。变异：从数组删掉 `line3_spatial/spatial_figures` 必须红。
- 修法：数组补该脚本，`spatial_figures` 头部补 `# PROVENANCE: INDEPENDENT`（其头部已声明
  「逐样本空间图因像素坐标不可比」独立实现），同步检查 `ml_hub_analysis` / `ml_model` /
  `ppi_string` / `key_genes` / `external_validation` 等含 `plt.savefig` 的母版是否也应纳管。

### B2 15 处母版头部仍写 `150dpi`，与 rcParams / 规范 300 DPI 冲突（P2，文档漂移）
- 证据：`grep '150dpi' src/line*/scripts/*` 命中 **15** 处，如
  `src/line1_bulk/scripts/bulk_figures:12`、`src/line3_spatial/scripts/spatial_figures:9`、
  `src/line2_scrna/scripts/scrna_figures:14`；而同文件 `bulk_figures:73` 的
  `plt.rcParams.update` 明确 `"figure.dpi": 300, "savefig.dpi": 300`。
- 后果：注释是 AI 与接手人读的第一口径，写 150 而代码跑 300，会造成「按注释改回 150」的回归。
  `docs/figure_spec.md` 第 1 节与 `ops/figure_spec_gate.mjs` 都锁定 300。
- 红测判据：静态断言「`src/line*/scripts/*` 头部口径注释不得出现 `150dpi` 字面量」，当前应红。
- 修法：15 处字面量改为 `300dpi`（纯注释等价替换，不动任何渲染参数）。

### B3 用户 `plt.close("all")` 铁律与实现 `plt.close(fig)` 的契约差（P2）
- 证据：`grep close\("all"\) src` 命中 **0**；`grep close\(fig\) src` 命中 40+ 处
  （如 `bulk_figures:133`、`spatial_figures:102`、`scrna_figures:135`）。
  `docs/figure_spec.md` 第 3 节写「每脚本出图后 `plt.close("all")`」，实现却是逐图 `plt.close(fig)`。
- 判断：逐图释放本身更精确，但用户新提示词把 `plt.close("all")` 列为「铁律」，且规范文字也是字面要求。
  这是**口径分叉**不是内存泄漏（`save()` helper 内已逐图释放），按「一个含义一个真源」必须消解。
- 修法（已写入提示词第 4 节 1 条裁定）：单图 `plt.close(fig)` 后立即 `plt.close("all")` 兜底，
  脚本末尾再调一次；R 侧 `dev.off()` 已成对（`wgcna_modules` 4 处、`cox_analysis`、
  `ml_diagnostics`），补 `graphics.off()` 收尾即可。先加静态门禁钉住再改实现。

### B4 `*_report.txt` 缺输入哈希（P2，用户第 4 节交付要求）
- 证据：`bulk_figures:769-782` 的 `figures_manifest.txt` 记录
  `step / seed / out / count / elapsed` 与产物清单，**没有输入文件 sha256**；
  `docs/coding-standards.md` 步骤脚本结构只要求「口径、阈值、诊断量、计时、产物清单」。
- 后果：用户新提示词第 5 节明确要求「输入哈希」，当前产物无法证明图由哪份数据渲染。
- 修法：在 figures manifest 追加 `input_sha256=` 行（对 `--input` 传入的文件逐个算），
  不改动现有字段，保持旧解析器兼容。

### B5 单图 30s/60s 渲染上限无机器判据（P3，规范空转）
- 证据：`docs/figure_spec.md` 第 4 节写「单图渲染超 60s 视为异常」，
  `grep timeout ops/*gate*.mjs` 只命中门禁自身超时（`static_gate.mjs:63` 20000ms 等），
  无「单图渲染耗时」判据；`run_all_gates.mjs:99` 的 300000ms 是整道门禁上限，不是单图。
- 判断：规范条款无执行体，属「写了等于没写」。但真机计时需要 K40，先做**静态面**：
  出图脚本不得出现全矩阵 `imshow` / 无上限 `for` 网络迭代，配合 `figure_score` 的 A3 尺寸下限。
- 修法：新增静态断言（或并入 `static_gate.mjs`），标为待验证假设，不擅自声称已覆盖运行时。

## 三、待验证假设（不擅自升级为缺陷）

- H1 `ops/figure_spec_gate.mjs:27` 的 `MIN_EDGE_PX=800` 只告警不判红，而
  `cn_debug/figure_score.py` A3 要求最短边 >=1200px。两者是不同层（产线 DPI 门禁 vs 交付打分），
  需确认是否要统一口径，避免「门禁绿但打分 UNVERIFIED」。
- H2 `ops/audit_figure_layout.py` 只 patch Python `Figure.savefig`，R `png()` 设备图
  （`pca_matrix` / `deg_limma` / `wgcna_modules` / `cox_analysis` / `ml_diagnostics`）
  跑审计得 `figs=0`。规范第 7 节已诚实登记为 UNVERIFIED 走人工清单，属已知边界，
  R 侧审计器是否补建需 Argon 裁定。
- H3 `ops/figure_source_provenance.mjs` 的 `REFERENCE_PATH_MARKERS` 只认
  `05.可参考出图代码` 等 4 个串；若未来参考库改名，DERIVED 判定会静默失效。
- H4 便携包 `dist/portable` 内 5 个关键资产由 `dist_parity_gate.mjs` 比对，
  但 `docs/AI_FIGURE_PROMPT.md` 这类新文档不在比对清单（设计如此，非缺陷）。

## 四、已确认「现状其实合规」的点（防止过度优化）

| 项 | 证据 | 结论 |
|---|---|---|
| Agg / 300 DPI / 8pt / 英文 / 禁 jet | 各 `*_figures` rcParams（`bulk_figures:72-77` 等）+ `figure_spec_gate.mjs` 读 pHYs | 已覆盖，勿重复造 |
| 图例外置 / 图注分行 / 阈值靠边 / adjustText | `figure_spec.md` 第 3 节之二之三、17 脚本内嵌 canonical helper、`audit_figure_layout.py` A~E | 已覆盖 |
| 黄金数据集拒绝全灰 | `L2_core_code.R` / `L2p_more_code.py` 注入 4000 基因，实测 245~247 显著点；round44 尺度守卫 | 已覆盖 |
| 30 ready 封板 / 预览 sha 恒等 | `figure_ready_allowlist.json` + ready_matrix + preview_provenance | 已覆盖 |
| seed 缺失 exit 3 | 各母版头部 `BIOANALYS_SEED:-UNSET` + `docs/coding-standards.md` 退出码表 | 已覆盖 |
| 三线隔离 | `docs/isolation.md` + `02_check_isolation.ps1` + 运行时路径断言 | 已覆盖 |
| 多核降权 | `ops/run_throttled_task.sh` 的 `taskset/nice/ionice` | 已覆盖 |

## 五、与 UI / 流程轴的接口

`docs/UI_OPTIMIZATION_BACKLOG.md`（第 64 轮取证）列 P1~P5 五项：
P1 app.css 变量化、P2 其余 4 视图三态契约、P3 OnboardingView 1691 行拆分、
P4 响应式、P5 配色美化。本轴不碰前端，交 platform-auditor 与 Argon 裁定优先级。
本审查发现的 B1~B5 全在「出图正确性 / 规范一致性」域，与 UI 轴无写作用域重叠。

## 六、建议梯队（与既有严格串行纪律一致）

| 梯队 | 票 | 出口判据 |
|---|---|---|
| 0 止血 | B1 溯源门禁漏审（假绿） | 红测先红后绿，集合恒等断言 + 1 条变异反证 |
| 1 规范一致 | B2 15 处 150dpi 注释、B3 句柄释放口径、B4 输入哈希 | 各带静态红测，全量门禁与 npm test 零退化 |
| 2 长尾 | B5 渲染耗时静态判据、H1/H2 待裁定项 | 需 Argon 裁定是否立项，不擅自开垦 |
| 3 外部轴 | UI P1/P2 等 | 待 platform-auditor 清单与 Argon 裁定 |

铁律：梯队间串行；每票先红测后实现；收尾做变异反证并核对还原 sha；
梯形 0/1 期间 `ops/figure_ready_allowlist.json` 锁死，readyCount 恒 30。
