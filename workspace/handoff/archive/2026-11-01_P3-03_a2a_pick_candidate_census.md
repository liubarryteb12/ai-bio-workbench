# P3-03 A2A 分支提交级择优普查

> 2026-11-01。只读静态取证。本文只依据 `git log`、`git show`、`git diff`、`git grep` 和 `git ls-tree`。
> 未修改代码，未 checkout 分支，未 merge，未 cherry-pick，未提交。

## 一、基线校正与结论

| 项目 | 本次实测 |
|---|---|
| 当前 master | `2c8f411`，已含 P3-01 的 upload、diagnostics、report、figures 四片路由拆分 |
| `codex/a2a-v1` | `b5b46f9` |
| merge base | `d2d3cdeb4896df49ff1204258ba04da59bc2adb6` |
| 提交数 | `master..codex/a2a-v1` 为 51，`codex/a2a-v1..master` 为 20 |
| 当前对称差异 | 926 files changed, 63,896 insertions, 12,332 deletions |
| P3 正本旧口径 | 827 files changed, 62,184 insertions, 6,581 deletions |

旧口径来自较早 master 基线。当前 P3-01 继续拆分后，对称差异增加到 926 个文件。本清单使用当前实测，同时保留旧口径，避免主代理把差异变化误判成后续分支漂移。

本文中的 `picked` 表示“建议选作局部移植来源”，不表示可以直接执行整提交 cherry-pick。任何触碰 `BioanalysDesktop/server/index.js`、`BioanalysDesktop/src/App.tsx`、`BioanalysDesktop/tests/**` 的提交，均按下列硬门处理：

> 等 P3-01/P3-02 合入后再评估。

## 二、不可整支 merge 的证据

1. `BioanalysDesktop/server/index.js`：当前 master 为 1,671 行，a2a 分支为 2,604 行。`git diff --numstat master..codex/a2a-v1` 对该文件给出 `+1120 / -51`。两边都改了这个文件，且 master 已把 upload、diagnostics、report、figures 四组端点搬入 `server/routes/*.js`，a2a 分支没有这些新模块。直接合并后，旧单文件路由与新路由模块会形成双实现，必须人工重新决定派发顺序。
2. `BioanalysDesktop/src/App.tsx`：当前 master 为 3,800 行，a2a 分支为 3,972 行。`git diff --numstat` 给出 `+477 / -28`。a2a 的 Pi 观测功能仍按旧单组件方式接入，P3-02 尚未完成视图拆分，直接合并会把新状态和 UI 重新压回 `App.tsx`。
3. 拆分文件面：当前 master 已有 `server/routes/{upload,diagnostics,report,figures}.routes.js`，a2a 分支对应路径为 0 文件。`src/views/` 在 master 与 a2a 均尚未落地，P3-02 完成后该冲突面会扩大。
4. 测试面：对 `BioanalysDesktop/tests/**` 的对称差异为 38 个文件，`+4501 / -1466`。其中包含源码守卫、认证、proc、Pi Agent、runtime slots、task recovery 等测试。整支 merge 会同时改变当前拆分基线和测试守卫，无法产生可审计的单批原子提交。
5. 提交面：`2c4c0ba`、`55b9585`、`ce2d680`、`8e862ae`、`72a8394`、`3439950` 同时改 `server/index.js` 与 `App.tsx`。`42c429e`、`f0b63b4`、`f07f2d9`、`b5b46f9` 改 `tests/**`。这些提交进入 P3-03 前必须等 P3-01/P3-02 合入后再评估。

结论：a2a 分支不是“只多了三批能力”的窄分支。它同时携带 A2A 运行时、文档重组、微内核、mods、出图资产和发布清理。P3-03 只能按文件与行为做局部移植。

## 三、51 条提交普查

取证命令按顺序为：

```powershell
git log --reverse --format='%H' master..codex/a2a-v1
git show --stat=120 --format='%h %s' <hash>
git show --numstat --format='' <hash>
```

下表按时间从旧到新排列，文件数与增删行数均来自上述提交级命令。`主要路径` 只列该提交的主要文件面，超宽提交另列需要拆出的关键路径。

| # | 提交 | 标题 | 文件 / 行数 | 主归属 | 建议 | 一句话理由 | 主要路径 |
|---:|---|---|---:|---|---|---|---|
| 1 | `b348216` | docs(aims): add A2A charter and preserve bio baseline | 8 / +1300 / -0 | 三批外 | rejected | A2A 宪章与旧基线迁移文档不属于三批能力，master 已有更新后的 aims 导航，合入会形成文档双源。 | `aims/A2A/**`, `aims/bio/**` |
| 2 | `769d860` | docs(a2a): lock charter and security decisions | 4 / +108 / -0 | 三批外 | rejected | 安全决策、样例环境与纲领文本没有运行时能力，且决策内容需要与 master 现版对表。 | `00.最高技术纲领-20261028.txt`, `.env.a2a.example`, `con_hf/SPEC_DECISIONS.md`, `.gitignore` |
| 3 | `b42aae4` | feat(a2a): add core path, ledger, bus, module and security audit base | 7 / +483 / -0 | 第二批 | 需人工裁定 | 这是引擎层前置底座，master 没有 `src/core`；是否引入整套架构超出单一容灾适配器。 | `src/core/**`, `src/engines/security-audit-engine/**`, `tests/test_a2a_core.py`, `tests/a2a_core_compile.cjs` |
| 4 | `c433cf7` | feat(a2a): add pi and codex ops plus module manifests | 9 / +354 / -0 | 三批外 | rejected | 内容是 A2A daemon、Codex 启动器和模块清单，不提供本地容器容灾。 | `ops/pi_a2a_daemon.sh`, `ops/pi_termux_bootstrap.sh`, `ops/codex_a2a_launcher.sh`, `src/mods/mod-core-engines/**` |
| 5 | `c5a80a8` | fix(a2a): drop bundled typescript copy and fix posix path guard | 3 / +16 / -11 | 第二批 | 需人工裁定 | 修的是 `b42aae4` 引擎底座的编译与 POSIX 路径问题，脱离底座没有独立业务价值。 | `src/core/PathGuard.ts`, `tests/a2a_core_compile.cjs`, `.gitignore` |
| 6 | `90b2460` | feat(a2a): add structured artifact validator | 2 / +253 / -0 | 三批外 | rejected | A2A 结构化产物校验不属于 runner、本地容灾或 PiAgentChat 观测。 | `src/engines/artifact-sync-engine/artifact_validator.py`, `tests/test_a2a_artifact.py` |
| 7 | `8589b05` | feat(a2a): add task poller and pi bootstrap helpers | 3 / +489 / -0 | 第一批 | 需人工裁定 | 任务轮询是断链恢复前置，但 master 没有 A2A poller 调用面，直接移植会成为孤儿模块。 | `src/engines/a2a-rpc-engine/a2a_client_poller.py`, `ops/pi_seed_settings.sh`, `ops/pi_provider_env.sh` |
| 8 | `0465169` | fix(a2a): make core compile run on Node 18 and load modules as esm | 2 / +26 / -12 | 第二批 | 需人工裁定 | 只是引擎层 Node 18/ESM 编译门，必须随 `b42aae4` 与 `0e3e161` 一起裁定。 | `tests/a2a_core_compile.cjs`, `tests/test_a2a_core.py` |
| 9 | `6728d59` | test(a2a): probe the pi daemon security guards on the phone | 1 / +57 / -0 | 三批外 | rejected | 真机安全探针依赖 A2A 运行时和手机，不属于三批能力。 | `tests/a2a_guard_probe.sh` |
| 10 | `3ecb8d3` | chore(a2a): record the k40 gate results in the action ledger | 2 / +82 / -0 | 三批外 | rejected | 门禁记录和台账写入器不提供可合入能力。 | `ops/append_a2a_ledger.py`, `con_hf/ledger/actions.jsonl` |
| 11 | `105128f` | feat(a2a): verify codex serve and bridge the proxy to the phone | 4 / +157 / -0 | 三批外 | rejected | Codex 代理桥接属于 A2A 网络拓扑，不是通用容灾适配器。 | `ops/codex_a2a_probe.sh`, `ops/k40_proxy_bridge.ps1`, `ops/append_a2a_ledger.py`, `con_hf/ledger/actions.jsonl` |
| 12 | `6c9fb56` | feat(a2a): make the k40 adb forwards reproducible | 1 / +31 / -0 | 三批外 | rejected | adb 端口映射只是真机连接便利，仍依赖物理手机，不能解决缺陷 #8 的单点依赖。 | `ops/k40_adb_forward.ps1` |
| 13 | `e8bb236` | feat(a2a): auto-start pi server and add secure probe | 3 / +229 / -34 | 三批外 | rejected | 自启 Pi server 和安全探针属于 A2A 运行时，不属于指定三批。 | `ops/pi_a2a_daemon.sh`, `ops/pi_seed_settings.sh`, `tests/a2a_pi_server_probe.sh` |
| 14 | `3782bb3` | feat(a2a): put each adapter on its correct plane | 2 / +86 / -0 | 三批外 | rejected | 标题虽含 adapter，但落盘是 Codex 与 Pi 的操作脚本，不是计算执行接缝的本地容器 adapter。 | `ops/start_pc_codex_a2a.ps1`, `ops/pi_set_provider_key.ps1` |
| 15 | `d638721` | chore(a2a): ignore the local codex-a2a runtime database | 1 / +1 / -0 | 三批外 | rejected | 仅忽略本地运行时数据库，无功能价值。 | `.gitignore` |
| 16 | `ccde81f` | feat(a2a): lock pi to the two approved reasoning models | 2 / +73 / -12 | 三批外 | rejected | Pi 模型白名单与 A2A 策略绑定，不属于三批。 | `ops/pi_a2a_daemon.sh`, `ops/pi_set_provider_key.ps1` |
| 17 | `254b41f` | fix(a2a): refuse bare pi start and probe the model lock | 2 / +69 / -0 | 三批外 | rejected | 裸启动拒绝和模型锁探针仍属 A2A 运行时策略。 | `tests/a2a_guard_probe.sh`, `ops/pi_a2a_daemon.sh` |
| 18 | `0c35b08` | docs(a2a): record the stage 1 gate report | 1 / +79 / -0 | 三批外 | rejected | 静态门禁报告，不是能力提交。 | `docs/a2a_stage1_gate_report.md` |
| 19 | `cdf695e` | fix(a2a): close the p0 and p1 gaps from the review | 3 / +60 / -14 | 三批外 | rejected | 修的是 A2A daemon、种子设置与产物校验器，未进入三批目标面。 | `ops/pi_a2a_daemon.sh`, `ops/pi_seed_settings.sh`, `src/engines/artifact-sync-engine/artifact_validator.py` |
| 20 | `d94457b` | fix(a2a): close remaining review findings | 4 / +18 / -4 | 三批外 | rejected | 维护 A2A 台账、启动器、PathGuard 与安全审计，均依附未准入运行时。 | `ops/append_a2a_ledger.py`, `ops/pi_termux_bootstrap.sh`, `src/core/PathGuard.ts`, `src/engines/security-audit-engine/security_audit.py` |
| 21 | `2b69e70` | feat(a2a): run the first real cross-plane task end to end | 3 / +126 / -8 | 三批外 | rejected | 首个真实跨平面任务依赖完整 A2A 运行时与手机链路，不是可独立挑拣的能力包。 | `ops/pi_seed_models.sh`, `ops/pi_inject_provider.ps1`, `ops/pi_a2a_daemon.sh` |
| 22 | `128ff14` | chore(a2a): record the first end to end task in the ledger | 2 / +20 / -2 | 三批外 | rejected | 仅是端到端任务台账与写入器调整。 | `ops/append_a2a_ledger.py`, `con_hf/ledger/actions.jsonl` |
| 23 | `9d58e82` | test(a2a): extract and validate structured artifacts from pi replies | 1 / +294 / -0 | 三批外 | rejected | Pi 回复产物协议与三批无关。 | `tests/test_a2a_e2e_artifact.py` |
| 24 | `bc5499a` | chore(a2a): record async and live artifact gate results | 2 / +31 / -1 | 三批外 | rejected | 仅记录异步与实时产物门禁结果。 | `ops/append_a2a_ledger.py`, `con_hf/ledger/actions.jsonl` |
| 25 | `f4dc3ab` | test(a2a): parse multi-file artifacts in all reply layouts | 1 / +216 / -14 | 三批外 | rejected | 扩展 Pi 多文件产物解析测试，仍属 A2A 产物协议。 | `tests/test_a2a_e2e_artifact.py` |
| 26 | `e607ccb` | chore(a2a): record the screen-off keepalive gate | 2 / +21 / -1 | 三批外 | rejected | 息屏保活结果记录，不提供 runner 或容灾实现。 | `ops/append_a2a_ledger.py`, `con_hf/ledger/actions.jsonl` |
| 27 | `2c4c0ba` | feat(mod-pi-observability): real-time Pi agent monitoring in the workbench | 4 / +551 / -1 | 第三批 | picked | 提供 Pi 状态、调用、日志与模型切换的基础实现，后续提交与测试可局部抽取；触碰拆分面。等 P3-01/P3-02 合入后再评估。 | `BioanalysDesktop/server/index.js`, `BioanalysDesktop/server/pi_agent.js`, `BioanalysDesktop/src/App.tsx`, `BioanalysDesktop/src/app.css` |
| 28 | `55b9585` | feat(mod-pi-observability): dispatch modal, ledger trail and per-model usage | 4 / +202 / -0 | 第三批 | picked | 在 `2c4c0ba` 上增加派发、台账和按模型统计，必须作为有序链的一部分移植；触碰拆分面。等 P3-01/P3-02 合入后再评估。 | `BioanalysDesktop/server/index.js`, `BioanalysDesktop/server/pi_agent.js`, `BioanalysDesktop/src/App.tsx`, `BioanalysDesktop/src/app.css` |
| 29 | `ce2d680` | feat(a2a): land v1.1.0 D-11 idempotent runner and D-12 telemetry sidecar | 10 / +620 / -6 | 第一批 | picked | 含 `ops/pi_idempotent_runner.sh` 与首个 runner 测试，可局部提取为幂等 runner 起点；server、App、telemetry 部分不与第一批混取。等 P3-01/P3-02 合入后再评估。 | `ops/pi_idempotent_runner.sh`, `tests/test_pi_idempotent_runner.sh`, `ops/pi_telemetry_sidecar.py`, `BioanalysDesktop/server/index.js`, `BioanalysDesktop/src/App.tsx` |
| 30 | `98a235b` | test(a2a): land the v1.1.0 eight-dimension regression suite | 2 / +307 / -0 | 第一批 | 需人工裁定 | 补充断链恢复和幂等派发语义，但代码落在 master 不存在的 `src/engines/a2a-rpc-engine/`，要先把契约移植到现有远端执行接缝。 | `src/engines/a2a-rpc-engine/a2a_client_poller.py`, `tests/test_e2e_a2a_pipeline.py` |
| 31 | `ed74e7c` | chore(a2a): record the eight-dimension regression gate | 2 / +16 / -1 | 三批外 | rejected | 八维门禁记录，不含可独立合入实现。 | `ops/append_a2a_ledger.py`, `con_hf/ledger/actions.jsonl` |
| 32 | `d555e73` | fix(workbench): make start bats auto-restart own stale instance | 4 / +70 / -9 | 三批外 | rejected | 启动脚本清理陈旧实例属于本地运维修复，不在 P3-03 三批范围。 | `ops/restart_18787.ps1`, `ops/port_preflight.ps1`, `start_workbench.bat`, `start_portal.bat` |
| 33 | `8e862ae` | perf(mod-pi-observability): make the panel near real-time | 3 / +67 / -18 | 第三批 | picked | 把观测读取优先切到 9911 sidecar，并保留 SSH 降级，是观测插槽的性能组成；触碰拆分面。等 P3-01/P3-02 合入后再评估。 | `BioanalysDesktop/server/index.js`, `BioanalysDesktop/server/pi_agent.js`, `BioanalysDesktop/src/App.tsx` |
| 34 | `72a8394` | feat(mod-pi-observability): structured task timeline per the aims html spec | 4 / +96 / -3 | 第三批 | picked | 增加五级任务时间线与前端筛选，属于观测插槽核心行为；触碰拆分面。等 P3-01/P3-02 合入后再评估。 | `BioanalysDesktop/server/index.js`, `BioanalysDesktop/server/pi_agent.js`, `BioanalysDesktop/src/App.tsx`, `BioanalysDesktop/src/app.css` |
| 35 | `e3551d2` | feat(figures): apply 03出图规范 v1.0 to all K40 figure masters | 5 / +340 / -0 | 三批外 | rejected | K40 出图母版批量修饰与 P3-03 三批无关。 | `ops/beautify_r_masters.py`, `ops/audit_figure_spec_v110.py`, `ops/fix_remaining_themes.py`, `ops/fix_de_palette.py` |
| 36 | `0e3e161` | feat(core-engines): land microkernel 7-piece core and 8 shared engines with path/thread guards | 28 / +3714 / -63 | 第二批 | 需人工裁定 | 唯一包含 `MockComputeAdapter` 与计算接口的提交，但一次引入 28 文件微内核和 8 个引擎，是架构准入决策，不是小挑拣。 | `src/core/**`, `src/engines/compute-engine/**`, `src/engines/bridge-engine/**`, `tests/test_compute_engine.py`, `tests/compute_engine_compile.cjs` |
| 37 | `3439950` | feat(mods): add 10 pluggable mods, K40 figure sources v1.0, and A2A runtime routes | 86 / +7945 / -1164 | 第二批（主），含第三批 | 需人工裁定 | 混合 10 个 mod、K40 图源、A2A runtime route 与 `PiAgentChat`；必须按文件拆，不能整提交挑拣。等 P3-01/P3-02 合入后再评估。 | `BioanalysDesktop/src/PiAgentChat.tsx`, `BioanalysDesktop/server/pi_agent_routes.js`, `BioanalysDesktop/src/pi_chat_state.js`, `src/mods/**`, `src/figure_sources/**` |
| 38 | `42c429e` | test(tests-ledger): add 100 workbench test files, A2A contract tests, and execution ledgers | 123 / +15713 / -875 | 第一批（主），含第三批 | 需人工裁定 | 同时含 runner 终版、telemetry 测试、PiAgent 测试与大量无关测试和台账，只能按目标测试文件抽取。等 P3-01/P3-02 合入后再评估。 | `ops/pi_idempotent_runner.sh`, `tests/test_pi_idempotent_runner.sh`, `tests/test_pi_telemetry_sidecar.py`, `BioanalysDesktop/tests/pi_agent*.test.js`, `BioanalysDesktop/tests/pi_chat_state.test.js` |
| 39 | `568de8d` | docs(release): unify aims SSOT navigation, add root README, and finalize v3.2 release plan | 130 / +19819 / -34521 | 三批外 | rejected | 发布文档和参考资产大清理，包含 34,521 行删除，既非三批能力，也会覆盖 master 新文档真源。 | `aims/**`, `reference/**`, `README.md`, `con_hf/**`, `local_projects/**` |
| 40 | `530ae32` | feat(mods): add SCI single-plot style config (paper_style.py, theme_paper.R) | 3 / +320 / -0 | 三批外 | rejected | 新出图风格配置不属于 P3-03。 | `src/config/paper_style.py`, `src/config/theme_paper.R`, `src/config/color_map.csv` |
| 41 | `6255060` | test(tests-ledger): add pipeline figure standardizer and release plan mapping | 3 / +583 / -4 | 三批外 | rejected | 管线出图标准化器与发布计划映射不在三批范围。 | `ops/standardize_pipeline_figures.py`, `ops/apply_release_commits.mjs`, `ops/release-plan.mjs` |
| 42 | `96bd2d3` | docs(release): standardize 48 Line 1 bulk figures and deploy 00_config | 83 / +624 / -0 | 三批外 | rejected | 83 个文件主要是 Line 1 图资产和配置部署，与 P3-03 无关。 | `local_projects/**/figures/line1_bulk/**`, `src/config/**` |
| 43 | `45b16e4` | feat(mods): add spatial square presets and flexible height to paper_style | 1 / +9 / -1 | 三批外 | rejected | 只调整出图预设与高度，属于出图线。 | `src/config/paper_style.py` |
| 44 | `c7dc8ea` | test(tests-ledger): add Line 2 and Line 3 figure standardizers and relaxed audit tolerances | 4 / +1076 / -1 | 三批外 | rejected | Line 2/3 图标准化与审计放宽属于出图线。 | `ops/standardize_line2_figures.py`, `ops/standardize_line3_figures.py`, `ops/audit_figure_spec_v110.py`, `ops/release-plan.mjs` |
| 45 | `70d1fc0` | docs(release): standardize 43 Line 2 and 72 Line 3 pipeline figures to 100% SCI compliance | 238 / +920 / -0 | 三批外 | rejected | 238 个图资产文件，属于出图发布批次。 | `local_projects/**/figures/line2_scrna/**`, `local_projects/**/figures/line3_spatial/**` |
| 46 | `f0b63b4` | test(tests-ledger): fix desktop mock resets and windows subprocess utf-8 decoding | 6 / +15 / -1 | 三批外 | rejected | 修的是 mock 复位、UTF-8 解码和发布计划归类，不提供本地计算 adapter。等 P3-01/P3-02 合入后再评估。 | `BioanalysDesktop/tests/figure_project_plan.test.js`, `BioanalysDesktop/tests/upload_quota.test.js`, `BioanalysDesktop/tests/upload_session.test.js`, `ops/tests/test_local_project_workspace.py` |
| 47 | `98fa46f` | docs(release): add automated adb port forward preflight to start_workbench.bat | 1 / +9 / -0 | 三批外 | rejected | 自动 adb forward 仍是物理手机路径，不能提供无设备容灾，且只改启动 bat。 | `start_workbench.bat` |
| 48 | `f07f2d9` | test(tests-ledger): align portal e2e pi chat assertions with dedupe and polling timeouts | 2 / +10 / -2 | 第三批 | picked | 修正 Pi Chat 去重与轮询超时断言，属于第三批 e2e 验证的一部分。等 P3-01/P3-02 合入后再评估。 | `BioanalysDesktop/tests/e2e/portal.spec.ts`, `con_hf/ledger/actions.jsonl` |
| 49 | `253c959` | docs(release): restore figure catalog index and manifest for single-figure browser | 4 / +29630 / -0 | 三批外 | rejected | 恢复图目录生成资产，单个 `catalog.json` 即 28,832 行，和 P3-03 无关。 | `reference/05.可参考出图代码/library/catalog.json`, `manifest.csv`, `README.md`, `licenses.json` |
| 50 | `8991b51` | test(tests-ledger): support clean worktree in release plan assertions | 1 / +1 / -1 | 三批外 | rejected | 只改发布计划测试对干净工作树的判断，属于发布线。 | `tests/test_release_plan.py` |
| 51 | `b5b46f9` | Refine topic survey workflow and project guidance | 131 / +5982 / -931 | 第三批（主），含第一批与外部混合 | 需人工裁定 | 标题像文档整理，实际还含 Pi heartbeat route、runner/sidecar 副本与大量课题调研和架构文件；只能局部提取 heartbeat 与副本差异。等 P3-01/P3-02 合入后再评估。 | `BioanalysDesktop/server/pi_agent_routes.js`, `BioanalysDesktop/tests/pi_agent_routes.test.js`, `01_mobile_compute/runtime/**`, `docs/proposals/**`, `03_server_orchestrator/**` |

## 四、批次分布与关键依赖

按主归属计数，跨批提交只计入主批次：

| 主批次 | 总数 | picked | rejected | 需人工裁定 |
|---|---:|---:|---:|---:|
| 第一批：幂等 runner 与远端长任务锁 | 4 | 1 | 0 | 3 |
| 第二批：本地容器容灾适配器 | 5 | 0 | 0 | 5 |
| 第三批：PiAgentChat 观测插槽 | 6 | 5 | 0 | 1 |
| 三批外 | 36 | 0 | 36 | 0 |
| 合计 | 51 | 6 | 36 | 9 |

### 第一批

- `ce2d680` 是最初 runner 来源，`42c429e` 把 `ops/pi_idempotent_runner.sh` 从 164 行扩展到终版 631 行，并扩展 `tests/test_pi_idempotent_runner.sh`。如果直接只取 `ce2d680`，会拿到较旧版本；主代理应从 `42c429e` 的相同文件抽取终版，同时只取该提交的目标文件。
- `42c429e` 同时含 `tests/test_pi_telemetry_sidecar.py` 与 PiAgent 测试。它是测试载体，不是可直接挑拣的单一功能提交。
- `98a235b` 的断链恢复契约位于 `src/engines/a2a-rpc-engine/a2a_client_poller.py`，master 没有该文件。要复用其语义，必须移植到现有远端执行或 `ops/run_throttled_task.sh` 调用面。
- `8589b05` 是 A2A 任务轮询前置。`git grep -n pi_idempotent_runner codex/a2a-v1` 虽能命中 poller 和分支内 preflight，但这些调用面都不在 master，不能把命中数当作 master 生产接线证据。
- `ops/pi_idempotent_runner.sh` 最终 631 行，`01_mobile_compute/runtime/pi_idempotent_runner.sh` 只有 154 行，两个副本不同。`b5b46f9` 又加入一份移动端副本，必须选一个真源，避免第三份复制继续漂移。

### 第二批

- `0e3e161` 是唯一提供 `MockComputeAdapter`、`ComputeAdapter`、`ComputeEngineImpl` 和 `BridgeComputeAdapter` 的提交。它的验证面是 `tests/compute_engine_compile.cjs` 与 `tests/test_compute_engine.py`。
- `b42aae4`、`c5a80a8`、`0465169` 是引擎底座的路径、编译和 ESM 依赖。三者不宜脱离 `0e3e161` 单独挑选。
- master 已有 `BioanalysDesktop/tests/node_failover.test.js`，它测试的是远端节点离线或过热时的备用节点选择，不等于本地无设备 mock。第二批必须先用户裁定“引整层引擎”还是“只在现有 `server/proc.js` 接缝加 mock adapter”。
- 第二批当前没有 `picked`。原因是证据显示能力存在，但承载面是一次 28 文件架构准入，静态普查不能替代用户裁定。

### 第三批

- `2c4c0ba`、`55b9585`、`8e862ae`、`72a8394` 构成有序观测链，必须按顺序移植。
- `3439950` 才新增独立的 `src/PiAgentChat.tsx`、`server/pi_agent_routes.js` 和 `src/pi_chat_state.js`，但它同时携带 86 文件的 mods、图源和 runtime route，不能整提交 cherry-pick。
- `42c429e` 才集中加入 `BioanalysDesktop/tests/pi_agent.test.js`、`pi_agent_routes.test.js`、`pi_chat_state.test.js` 与 `tests/e2e/pi_chat.spec.ts`。这些测试应作为第三批的伴随测试，但仍需从 123 文件提交中局部抽取。
- `f07f2d9` 只把 `portal.spec.ts` 的 Pi Chat 超时改为 20 秒，并修正取消任务消息的 task id。它适合在第三批测试移植后单独带上。

## 五、冲突与依赖标注

| 提交 | 冲突面 | 处理 |
|---|---|---|
| `2c4c0ba` | `server/index.js`, `src/App.tsx` | 等 P3-01/P3-02 合入后再评估，届时接入新 route 与 view |
| `55b9585` | `server/index.js`, `src/App.tsx` | 与 `2c4c0ba` 同链，等 P3-01/P3-02 |
| `ce2d680` | `server/index.js`, `src/App.tsx` | runner 与测试可先抽，UI 和 sidecar 接线等 P3-01/P3-02 |
| `8e862ae` | `server/index.js`, `src/App.tsx` | 与观测链同链，等 P3-01/P3-02 |
| `72a8394` | `server/index.js`, `src/App.tsx` | 时间线 UI 与 route 需落在拆分后的模块，等 P3-01/P3-02 |
| `3439950` | `server/index.js`, `src/App.tsx` | 只抽 `PiAgentChat`、routes、状态模块与 mod manifest，等 P3-01/P3-02 |
| `42c429e` | `BioanalysDesktop/tests/**` | 只抽 runner、sidecar、Pi Agent 测试，等 P3-01/P3-02 |
| `f0b63b4` | `BioanalysDesktop/tests/**` | 本提交建议 rejected，若复审改变结论也必须等 P3-01/P3-02 |
| `f07f2d9` | `BioanalysDesktop/tests/**` | 等 P3-01/P3-02，然后与第三批 e2e 同批验证 |
| `b5b46f9` | `BioanalysDesktop/tests/**` | 只抽 heartbeat 与目标 runner 差异，等 P3-01/P3-02 |

## 六、每批验证命令建议

以下命令应在移动端 Linux 算力面执行。命令中的仓库路径用占位符 `<REPO>` 代替，实际执行时必须替换为算力面工作区绝对路径。当前 K40 离线，真机项只能标待设备恢复，不能把静态检查冒充真机绿灯。

### 第一批

```bash
bash -lc 'set -euo pipefail; cd <REPO>; bash tests/test_pi_idempotent_runner.sh "$HOME/bin/pi_idempotent_runner.sh"; python3 -m pytest -q tests/test_a2a_poller_state.py tests/test_pi_telemetry_sidecar.py; node --test BioanalysDesktop/tests/wrapper_running_marker.test.js BioanalysDesktop/tests/wrapper_wiring.test.js BioanalysDesktop/tests/wrapper_exec_modes.test.js'
```

文件名证据：

- `tests/test_pi_idempotent_runner.sh` 覆盖 fresh run、done checkpoint 复用、篡改后重跑、并发锁、SIGTERM 子进程回收、SIGKILL 后 attached lock、损坏 PNG、UTF-8 摘要和只读母版。
- `tests/test_a2a_poller_state.py` 覆盖重启后恢复任务、瞬时断网重试和 `dispatch_idempotent_step`。
- `BioanalysDesktop/tests/wrapper_running_marker.test.js`、`wrapper_wiring.test.js`、`wrapper_exec_modes.test.js` 是 master 现役包装器接缝，移植锁语义后必须同步扩展。

### 第二批

```bash
bash -lc 'set -euo pipefail; cd <REPO>; node tests/compute_engine_compile.cjs; python3 -m pytest -q tests/test_compute_engine.py -k "not real_k40_bridge"; python3 -m pytest -q tests/test_a2a_core.py; node --test BioanalysDesktop/tests/node_failover.test.js BioanalysDesktop/tests/proc.test.js'
```

文件名证据：

- `tests/compute_engine_compile.cjs` 明确列出 `types.ts`、`PathGuard.ts`、compute interface、implementation、adapters，以及 bridge interface、implementation、adapters。
- `tests/test_compute_engine.py` 直接覆盖 `MockComputeAdapter` 成功与失败归一化、超时、argv 错误、thread 上限、清理路径和真实 K40 adapter。命令排除 `real_k40_bridge`，用于 K40 离线时验证本地 mock 能力。
- `BioanalysDesktop/tests/node_failover.test.js` 证明 master 现有接缝已经覆盖远端备用节点选择与动作台账。新本地 adapter 不能绕过该真源。
- `BioanalysDesktop/tests/proc.test.js` 钉住本地子进程白名单与 ssh/scp/adb 边界，是接 mock adapter 前必须通过的隔离门。

### 第三批

```bash
bash -lc 'set -euo pipefail; cd <REPO>/BioanalysDesktop; node --test tests/pi_agent.test.js tests/pi_agent_routes.test.js tests/pi_chat_state.test.js; npx tsc --noEmit; npm run build; npx playwright test tests/e2e/pi_chat.spec.ts tests/e2e/portal.spec.ts'
```

文件名证据：

- `BioanalysDesktop/tests/pi_agent.test.js` 覆盖模型白名单、base64 SSH envelope、模型切换、settings/pin 原子更新和远程实际状态。
- `BioanalysDesktop/tests/pi_agent_routes.test.js` 覆盖 route 接管、ping、模型切换、dispatch、GetTask、CancelTask、telemetry、日志和 heartbeat。
- `BioanalysDesktop/tests/pi_chat_state.test.js` 覆盖历史恢复、去重、轮询退避、取消竞态和终态门。
- `BioanalysDesktop/tests/e2e/pi_chat.spec.ts` 覆盖移动与桌面视口、真实回复去重、刷新恢复、取消失败和 composer 不重叠。
- `BioanalysDesktop/tests/e2e/portal.spec.ts` 含 Pi Chat 的派发、轮询、清历史与取消恢复断言，`f07f2d9` 修的就是这里。

## 七、最高风险提交

| 提交 | 风险 | 静态证据 |
|---|---|---|
| `3439950` | 最高 | 86 文件，`+7945 / -1164`，混合 mods、图源、Pi 观测和 runtime route，并同时改 `server/index.js` 与 `App.tsx`。直接挑拣会把无关资产和旧单文件接线一起带进来。 |
| `42c429e` | 很高 | 123 文件，`+15713 / -875`，同时含 runner 终版、sidecar 测试、PiAgent 测试、100 个测试文件和台账。它既是第一批关键来源，也是第三批测试来源，必须逐文件抽取。 |
| `568de8d` | 很高 | 130 文件，`+19819 / -34521`，大范围删除 reference 和 local project 资产。即使不涉及三批运行代码，误合也会造成工作区内容大面积回退。 |

次高风险为 `b5b46f9`。标题只写课题调研流程，实际 131 文件，且含 Pi heartbeat route、runner/sidecar 副本和大量架构文档。主代理审阅时必须按文件 diff，不可按标题判断。
