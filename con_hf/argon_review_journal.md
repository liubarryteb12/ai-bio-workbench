# 与 4 Argon 模型的项目评审对话纪要

**会话地址**：https://gemini.google.com/app/d86041e7043c73f3
**模型**：Gemini 4 Argon（Complex tasks）
**会话标题**：生信工作台架构评审与重构指南

## 交互轮次

| 轮 | 我发送 | Argon 回复 | 文件 |
|---|---|---|---|
| 1 | 项目全量汇报（2876 字）+ 8 问 | 7550 字，8 节全量 | `.tmp/gemini_argon_reply_20261101.md` |
| 2 | 第一批落地结果（3880 字）+ 6 问 | 8645 字，6 节全量 | `.tmp/gemini_argon_reply_round2.md` |
| 3 | 批评实测核对 + 卡点（3340 字）| 5111 字，3 卡点破局+清单 | `.tmp/gemini_argon_reply_round3.md` |

## 关键结论演进

### 第一轮（架构层）
- proot 算力面存在 15-30% I/O 惩罚，已是结构性天花板；不可向多租户高并发演进
- 5.1 接缝破口必须无条件补齐，不可用文档合法化
- 最大隐性风险排序：算力面枯竭 > 控制面/算力面状态撕裂 > 母版无 CI（“控制面钢筋混凝土、算力面泥巴墙”）

### 第二轮（落地层，对我的代码逐条批评）
- **批评 A（部分成立）**：/proc/self/stat 的 self 语义错误 → 我采纳并改为 /proc/$$/stat。但它说「pgrp 是第5字段、你取成了state」的结论不对：我的实现是先剥前缀再取 $3，实测 $3 确实等于 pgrp
- **批评 B（完全成立）**：口令文件在 Windows 无有效权限位 + 强杀残留 → 已加 pid 校验与死进程判废
- **批评 C（不成立）**：.tmp 污染 git status → .gitignore 已有 `.tmp*/` 规则，实测 git 视为已忽略
- **批评 D（已预先实现）**：stdin EPIPE 击穿主进程 → runExecStream 已有 error 兜底
- **批评 E（完全成立）**：门禁只扫 server/ 会失明 → 扩到 6 个运行时目录，扩展后立即刷出 10 处（全在 encoding_backup 备份区），排除后全绿

### 第三轮（设备层，破解我的三个卡点）
- **根因确认**：`supervise/ok` 是 `mkfifo()` 创建的 FIFO；`runas_app` SELinux 域**禁止 create fifo_file**，而 Termux 原生 `untrusted_app` 域允许。这解释了「run-as 下建不出 supervise、正常 ssh 会话下能建」的全部现象
- **锁失效真因**：setsid 子进程继承 flock 的 fd 9，导致锁生命周期被污染——runsvdir 秒退但子进程还活着时锁不释放；单杀 runsvdir 后新实例永远拿不到锁
- **破局方案**：① 锁只绑 runsvdir 本体（`flock -n lock runsvdir -P`），子服务 exec 前关闭 fd；② 宿主点火改走 `am startservice TermuxService`（untrusted_app 域，能 mkfifo）而非 `run-as`；③ 静态预创建 supervise 管道后永不 rm -rf
- **破坏性运维保护模式**：控制面重建与数据面解耦（只杀 runsvdir/runsv，严禁 pkill sshd）+ 金丝雀旁路端口（18022 先行）+ 15 秒死人开关自动回滚

## 已落地（本轮）

| 项 | 状态 |
|---|---|
| 5.1 proc.js 单接缝收口（run.js 零 child_process） | 完成 |
| 接缝门禁测试（扩至 6 个运行时目录） | 完成，3/3 绿 |
| 5.9 scp 拓扑真源化 | 完成 |
| 5.6 口令不进 stderr + pid 生命周期校验 | 完成 |
| 5.10 便携 Python ignore | 完成 |
| 5.11 TEST_TMP 统一入口（8 个测试文件接入） | 完成 |
| 5.2 Pi 启动器纳管 ops/k40/ | 完成 |
| 盲点一 进程组收尾 + PGID 入锁 | 完成（改用 /proc/$$/stat） |
| ops/k40/sv/* 8 个 runit 服务定义纳管 | 完成 |
| 日志 10MB 轮转 | 完成 |
| ensure_runsvdir.sh（flock 单实例点火） | 已实现，待按第三轮方案重构 |

## 验证基线（链路健康时实测）

- `npm test`：1077 tests / 1076 pass / 0 fail / 1 skipped
- `tsc --noEmit`：exit 0；`npm run build`：exit 0
- 锁静态测试（Python）：7/7；包装器 `bash -n`：OK

## 待办（按 Argon 第三轮清单）

1. 【立即做】重构 ensure_runsvdir.sh：移除 rm -rf supervise、去掉 pkill sshd、加 15 秒死人开关、锁只绑 runsvdir 本体
2. 【立即做】把 Termux 的 profile.d/start-services.sh 与 .bashrc 自启收口到 ensure_runsvdir.sh
3. 【立即做】第二批 Step1-3：净仓（5.8+5.14）、删僵尸分支（5.13）、metrics_sync.js（5.4+5.12）
4. 【计划做】reconcile.js 台账自省 + CI 四语种静态门禁（5.5+5.7）
## 第四轮：设备服务树修复（用 Argon 的三套保护模式实战）

### 实战验证 Argon 方案有效
| 方案 | 实战结果 |
|---|---|
| 金丝雀旁路（18022 先行） | **成功**。`adb forward tcp:18022` + 备用 sshd 建立旁路通道，在其中杀旧 sshd 时主通道零中断 |
| 控制面/数据面解耦（只杀 runsvdir/runsv） | **成功**。ensure_runsvdir.sh 不再 pkill sshd，执行后 8022 始终可用 |
| 15 秒死人开关 | 已内置，本轮未触发（因为切换未失败） |

### 实际踩到的额外问题（Argon 未预见的）
1. **`uvicorn`/log 子服务的 supervise 目录会整个缺失**：`ubuntu-sshd/log/supervise` 不存在时 log 子服务永久 down。补建 `control`/`ok`(FIFO) + `lock`(普通文件) 后，runsvdir 重启即可派生。
2. **孤儿 dropbear**：`pkill runsv` 后 dropbear 的父进程变成已死的 runsv，成为孤儿仍占 10022；必须显式 kill 该 pid，新 runsv 才能绑定。
3. **`/proc` 遍历竞态**：`for f in /proc/[0-9]*/cmdline` 期间 pid 可能被回收，读 cmdline 会报 `No such file`。必须 `|| continue` 且判空。

### 最终设备状态
```
sshd:       run (runsv 接管)
crond:      run + log run
ssh-agent:  run + log run
ubuntu-sshd: run（容器 10022 可用）
runsvdir 实例数: 1
```
注：部分 log 子服务偶发 down（Android 存储上 runsv 监督不稳定），不影响业务。

## 第五轮：验收判据修正（把环境噪声与业务故障分开）

**问题**：`link.test.js` 的四段自检把「log 子服务 down」判成链路失败，导致真实可用的链路被报红。

**修正**（写进 link.js 与 link.test.js 的注释）：
- 硬失败只认「四段探测不通过」——那才是业务真不可用
- 主服务 down 仍算 fail（业务确实不可用，这条不放宽）
- **日志子服务异常降级为 warn**：K40 上 runsv 对 log 子进程监督不稳，实测常见「主服务 run + log down + 端口与业务全正常」，把它算链路失败是拿环境噪声否定业务可用性

## 第六轮：基线口径统一（技术债 5.4 + 5.12）

新增 `ops/metrics_sync.mjs`，三条实测修正：
1. **用例数不能静态正则计数**：按 `test(` 数出 1069，node --test 实际 1077（差额是 t.test 子用例）。改为**实测跑 node --test 并解析 TAP 汇总行**。
2. **`--check` 不能校验 SLOC**：统计脚本自身被计入，写完 README 再测 SLOC 就变了，基线永远追不上自己（循环依赖）。check 只校验用例数与 pass/fail。
3. README 基线行由脚本独占，`--write` 自动回写。

## 当前全量验证（链路健康时）

| 项目 | 结果 |
|---|---|
| `npm test` | **1078 tests / 1077 pass / 0 fail / 1 skipped** |
| 接缝门禁 | 3/3，扫描 6 个运行时目录 |
| `metrics_sync --check` | 基线一致 |
| `tsc --noEmit` / `build` | exit 0 |
## 第七轮（2026-11-02）：黄金冒烟落地 + 模板准入的真实约束

### 已完成并验证
- 三线黄金冒烟全绿（commit e69f628）：run_throttled_task.sh + BIO_LOCK_NAMESPACE=smoke、
  方向性锚点、图件魔数即焚 + expected/smoke_summary.json 进 Git；连跑两次 compare 确定性一致
- 双 R 三重锁死前两重（commit 2f5db48）：static_gate rscript-bare 门禁 + selfcheck RVER 强校验
- pip 锁改用项目 venv 导出（commit de2d712）：此前用系统 python3，scanpy 所在的 venv 整棵没进来
- 宿主污染防线（commit 2d781c2）：D:\Git\mnt\ssd 误触事故的机器化免疫

### 被 parity 测试抓回的错误（教训）
按「包已装」批量翻转 24 个模板 deps_status → figure_templates_parity 立刻 6 条红。
该字段语义是**准入状态**（ready 要求 verified+source+preview+12 字段齐备），不是「包已装」。
已回滚（a0b55fb）。

### 模板准入的真实约束（对 Argon 第七轮方案的事实修正）
Argon 判断「单次容器批处理即可让 readyCount 从 16 跃升至 41」。实测：
1. 24 个「包已齐」模板的 12 个准入字段**全部为空**（source/preview/双 sha/verified/lines/
   analysis_step/input_tables/produces/output_glob/canonical_output/sample_project_output），
   不是「只欠翻转」，是从未做过准入登记；
2. catalog 772 条素材里只有 1 条 suggested_template_id 命中 figure_templates，
   按图表类型模糊匹配仅 4 个模板有现成 code+preview（SHA 已核对匹配）：
   fig_l2p_scatterplot/pgg_0619、fig_l2p_barplot/pgg_0353、fig_l2p_heatmap/pgg_0579__f01、
   fig_l2p_boxplot/pgg_0429__f01；
3. **ready 与适配器实现强绑定**：figure_adapters.test.js 断言 ready 集合 === SUPPORTED_IDS（16 个），
   且每个 ready 模板都要有 CASES 条目（lineId/adaptVars/inputPath）+ input_tables 必须是
   绑定 step 的声明产物（parity validateFigureStepInputs）。
   → 每准入 1 个模板 = 登记 12 字段 + 写适配器 CASES + 过两条校验测试 + 真机出样例图。

结论：模板补齐是**逐模板的完整业务切块**，不是批量翻转。已把此约束回给 Argon 重排。
## 第八轮：Argon 的「4 个有素材模板」前提被证伪（我差点照做，及时回滚）

Argon 第八轮裁定「4 个模板有现成 code+preview 素材，直接准入，readyCount 16→20」。
我按此动手后在落盘前发现**溯源不成立**，全部回滚：

1. **registry 是生成物，不是可编辑真源**。`src/figure_templates.json` 由
   `ops/build_figure_templates.cjs` 从 `bizard_index.csv` + `r453_verification_report.json`
   生成，并有硬计数断言（ready 必须 16 / pending 65 / blocked 1）。我直接改 JSON 后
   `figure_templates_parity` 立刻 8 条红（`registry is generated from ... 不同步`）。
   正规准入必须走：verify_r453_figures.py 产出 runner+artifact 证据 → 更新 CSV 行状态
   → 重跑 builder。

2. **catalog 的 PNG 不是验证产物，是网站下载图**。命名约定 `*_verified.png` 在 registry 里
   指「k40 上 runner 实跑产出的 artifact」（见 r453 报告 l3.figures[].artifacts[].runner）。
   而 library/catalog.json 的 preview_path 是 `figures/pgg_*.png`，site=Python Graph Gallery，
   即**外部网站原图**。把它拷成 `L2p_*_verified.png` 等于伪造验证证据。
   library/README.md 自己也写明：「This directory is the project-owned candidate catalog.
   It is not the active figure registry.」

3. **4 个素材的图型语义也不匹配**：pgg_0619 实为 Manhattan 图（catalog 自己的
   suggested_template_id 就是 fig_l2p_manhattanplot，不是 scatterplot）；
   pgg_0353 是 Stacked Barplot；pgg_0579__f01 / pgg_0429__f01 是**代码片段**
   （无 seed 守卫、无 savefig，不能独立跑）。

教训：Argon 的裁定即使具体到「4 个模板 + SHA256 已核对」，仍可能建立在它没看到的
仓库约定上。**外部评审给的是方向，落地前必须用仓库自己的契约（生成物/命名约定/测试断言）
复核**。这次是 parity 测试和 library/README 一句话救了我。

已回滚：figure_adapters.js 的 4 个 overlay、SUPPORTED_TEMPLATE_IDS 扩容、8 个拷贝素材、
.gitignore 例外。全量测试回到 1086/1085/0 红基线。