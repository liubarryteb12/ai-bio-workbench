# AI 辅助生信分析工作台（BioanalysDesktop）全域统一工程执行计划（Execution Plan v3.0）

> **文档角色**：分阶段工程实施蓝图、依赖拓扑与验收方案（Execution Plan）
> **版本与时间戳**：`v3.0` | 生成时间戳：`2026-10-26 07:49:17 -04:00`（文件标识：`20261026_0749`）
> **对齐基线**：与规范总纲 `20261026_0749_aims_v3.0_spec.md` 及任务清单 `20261026_0749_engineering_todolist.md` 1:1 严格对齐
> **工程方法论**：彻底废除原 `2026-10-25` 方案中“13 个阶段来回跳跃（先做门户 Sync 再验 R 4.5.3、先上选择器再补底层哈希）”的反模式，严格执行 **「第一阶段：基础落地（Foundation Landing） → 第二阶段：相关配套（Supporting Facilities） → 第三阶段：功能实现（Feature Implementation）」** 的三阶递进工程流。
> **执行状态**：Gate 1、Gate 2 与 Final Gate 已于 2026-10-27 全部通过，证据见 `con_hf/runs/2026-10-27_final_gate/REPORT.md`。

---

## 一、 为什么必须重构原有流程顺序？（原方案跳跃性诊断与纠偏）

### 1.1 原三份文档的流程跳跃病灶诊断
1. **病灶一：未验底层环境，先建上层业务（原 2026-10-25 分期阶段 4/5 vs 阶段 6）**
   * **原顺序问题**：原方案把“门户 Sync 六接口与守护进程骨架（阶段 4、5）”排在“R 4.5.3 图型兼容性验证（阶段 6）”之前。若 K40 容器 R 4.5.3 基础包或桥接精度存在底层阻塞，上层通道即便写完也无法派发任何真实图型任务。
   * **v3.0 纠偏**：将 **R 4.5.3 三层递进验证 + 离线公共参考库落盘** 提至 **第一阶段：基础落地（`WP-1.4`）**，作为后续一切模板注册与流水线闭环的物理前提。
2. **病灶二：功能上线后才回头补防漂移与副本规范（原 2026-10-25 分期阶段 9/10 vs 阶段 12/13）**
   * **原顺序问题**：原方案在阶段 9 上线门户出图选择器、阶段 10 接通全链路派发，却把“预览图版本一致性 `preview_sha256` 断言（阶段 12）”和“适配副本落 `figures/adapt/`（阶段 13）”放到最后补票。这会导致阶段 9~10 开发的代码直接污染母版或使用过期预览图，随后在阶段 12~13 推倒返工。
   * **v3.0 纠偏**：将 **`figure_templates.json` 注册表、`preview_sha256` 断言、`figure_graph.js` 跨线校验** 全部前置收敛至 **第二阶段：相关配套（`WP-2.3`）**；待规则与守卫全部就位后，再在 **第三阶段：功能实现（`WP-3.2` / `WP-3.3`）** 一次性高质量实现门户选择器与 `figures/adapt/` 派生副本打包。
3. **病灶三：两套台账与两套目录并存打架（`aims.txt` vs `2026-10-25` 方案）**
   * **原顺序问题**：`aims261021todo.txt` 按旧目录规划 M1~M4，而 `2026-10-25` 方案新建 `local_projects/` 与 JSONL 台账，两边平行施工极易造成脚本落点冲突。
   * **v3.0 纠偏**：在 **第一阶段（`WP-1.2`）** 先完成 `local_projects/` 与 `con_hf/sync/` 目录契约和脚手架，在 **第二阶段（`WP-2.1`）** 完成存量项目与 JSONL 台账零损迁移，使第三阶段所有生信闭环与 Sync 交付天然运行在全新的自包含目录之上。

---

### 1.2 重构后的三阶段 12 工作包（WP）单向依赖拓扑图

```text
====================================================================================================
【第一阶段：基础落地 (Phase 1: Foundation Landing)】 —— 打牢契约、目录、算力防崩与容器环境底座
====================================================================================================
  [WP-1.1] 全局 SSOT 契约收口               [WP-1.2] 双平面物理目录落地
  (20条黑名单动态注入 / 14类格式 / 合法根) ──► (远端 /mnt/ssd + 本地 local_projects/ 脚手架)
                    │                                         │
                    ▼                                         ▼
  [WP-1.3] K40 算力防崩与长任务铁律         [WP-1.4] 容器 R 4.5.3 验证与离线公共库落盘
  (3线程 / EAS / 温控 / P-26,P-27,P-29) ──► (17图型三层验证 / 离线 STRING / Line1 验证集)
                                                      │
  ==================== 【阶段门禁 Gate 1：底层底座 100% 绿灯，准入第二阶段】 ====================
                                                      ▼
====================================================================================================
【第二阶段：相关配套 (Phase 2: Supporting Facilities)】 —— 搭建台账、守卫、注册表、Sync 通道与 CI
====================================================================================================
  [WP-2.1] JSONL 台账与索引器配套           [WP-2.2] 桥接守卫与上传硬配额配套
  (ledger_indexer / 存量迁移 / P-XX保留)   (去注释扫描 / --stage桥接 / 20GiB reservedBytes)
                    │                                         │
                    ▼                                         ▼
  [WP-2.3] 出图治理与图模板注册表配套       [WP-2.4] 单向 Sync 通道配套、远端对账与 CI
  (figure_templates.json / figure_graph)   (门户6接口 / sync_daemon骨架 / 双落点SHA256 / CI)
                                                      │
  ==================== 【阶段门禁 Gate 2：配套设施 100% 绿灯，准入第三阶段】 ====================
                                                      ▼
====================================================================================================
【第三阶段：功能实现 (Phase 3: Feature Implementation)】 —— 业务流水线闭环、视图组装与商业交付
====================================================================================================
  [WP-3.1] 三线 55 步生信闭环与内存削峰     [WP-3.2] 8080 门户与图级选择器功能实现
  (Line2 GSVA+GC削峰 / Line1 离线PPI+验证) ─► (选择器UI / 预览与真实图分区 / 12条 Playwright E2E)
                    │                                         │
                    ▼                                         ▼
  [WP-3.3] 8787 四大视图与 Sync 全链路贯通  [WP-3.4] 真实数据交付演练、防伪签名与高可用
  (figures/adapt打包 / HTML报告 / 拔桩全通) ─► (CHECKSUMS.sig 签名 / 多节点 Failover / 商业签收)
====================================================================================================
```

---

## 二、 分阶段详细实施蓝图与排期（Execution Roadmap）

### 第一阶段：基础落地（Phase 1: Foundation Landing）—— 预计周期：Day 1 ~ Day 5

#### 1. 阶段目标
在不改动上层业务流程的前提下，把单一事实源契约、本地/远端双平面目录、K40 容器长任务守护铁律、R 4.5.3 兼容性底数以及离线公共参考库彻底夯实。

#### 2. 详细执行步骤与批次编排
* **Batch 1.A（Day 1 ~ Day 2，本地编排面并行切片）**：
  * **切片 S1（执行 `WP-1.1`）**：改造 `portal/serve.mjs` 实现 `tumor_blacklist.js`（20 条正本）与 `data_formats.mjs`（14 类格式、`5GiB`）的 `__INJECT_SHARED_CONTRACTS__` 动态注入；复核 `server/ledger.js` 四类路径合法根单测。
  * **切片 S2（执行 `WP-1.2`）**：更新 `docs/directories.md` 增补 `local_projects/` 与 `con_hf/sync/` 条款；编写 `ops/init_project_scaffold.py` 脚手架并跑通 `tests/project_scaffold.test.js`。
* **Batch 1.B（Day 3 ~ Day 5，K40 算力面串行执行——严守 P-29 禁并发 SSH 铁律）**：
  * **步骤 1（执行 `WP-1.3`）**：核验 `/etc/profile.d/bio_limits.sh` 与 `ops/run_throttled_task.sh`；固化 `setsid nohup`（P-26）、40 分钟/分钟级分档等待（P-27）及 $\ge 60$ 秒轮询 + 容器内禁 `find`/`ps`/`grep -r` 守卫（P-29）。
  * **步骤 2（执行 `WP-1.4` 之公共库部署）**：将离线 STRING v12.0 互作表（`9606`/`10090` min700）与 Line 1 独立验证基准集推送至 `/mnt/ssd/bio_data/public_references/{stringdb,benchmarks/line1}/` 并锁死只读权限。
  * **步骤 3（执行 `WP-1.4` 之 R 4.5.3 三层验证）**：在 K40 容器内对 `reference/05.可参考出图代码/` 下 17 个已采集图型逐一执行 L1（环境包与魔数）、L2（桥接与 17 位精度）、L3（端到端出图）验证，生成 `_meta/r453_verification_report.json` 并刷新 `_meta/bizard_index.csv`。

#### 3. 第一阶段准出验收门禁（Gate 1 Checklist）
1. `npm test` 既有单测 + 新增 `project_scaffold.test.js` 100% 绿灯。
2. 远端 `/mnt/ssd/bio_data/public_references/` 下离线 STRING 库与 Line 1 基准集 SHA256 对账通过。
3. 17 个图型在 R 4.5.3 下的 `deps_status`（`ready` 或 `blocked_r453`）100% 实测落盘，零主观猜测。

---

### 第二阶段：相关配套（Phase 2: Supporting Facilities）—— 预计周期：Day 6 ~ Day 12

#### 1. 阶段目标
基于第一阶段的目录与环境底数，完成存量项目与 JSONL 台账迁移、升级桥接与配额守卫、构建图级模板注册表与校验器、打通单向 Sync 传输骨架与远端双落点同步工具，并接入 CI 门禁。

#### 2. 详细执行步骤与批次编排
* **Batch 2.A（Day 6 ~ Day 8，台账迁移与底层守卫升级）**：
  * **切片 S3（执行 `WP-2.1`）**：编写 `ops/ledger_indexer.py`（实现 Append-Only JSONL 按 `id` 聚合、`errors` 与 `fixes` 按 `refs` 串联、生成 `INDEX.json`/`README.md`/`local_projects/INDEX.md`）；将 `pitfalls_ledger.md` 无损转为 `con_hf/ledger/pitfalls.jsonl`（保留 `P-01`~`P-29`）；将 `PRJ_20261019_IS_lactylation`、`default` 及 `outputs/figures/` 108 张真实结果图零损迁入 `local_projects/`。
  * **切片 S4（执行 `WP-2.2`）**：在 `server/task.js` 合入 `stripShellAndCodeComments`；在 `ops/verify_bridge_checkpoint.py` 与 `src/bridge_guard.sh` 合入 `--stage {pre-dimred,post-dimred}` 与本机优先执行逻辑；在 `server/upload.js` 合入 20GiB `reservedBytes` 写盘前硬闸门（超限回 `413`）。
* **Batch 2.B（Day 9 ~ Day 12，图模板注册表、Sync 通道配套与远端同步）**：
  * **切片 S5（执行 `WP-2.3`）**：根据 Gate 1 的 R 4.5.3 验证报告生成 `src/figure_templates.json`（含 `source_sha256`、`preview_sha256`、`deps_status`）；编写 `BioanalysDesktop/server/figure_graph.js`（校验 `linked_mods`、语言匹配及 `adapt_vars` 严禁跨线取值）；编写 `tests/figure_templates_parity.test.js` 锁死母版与预览图同批更新纪律。
  * **切片 S6（执行 `WP-2.4`）**：在 `portal/serve.mjs` 实现 6 个 `/api/sync/*` 接口與 60 秒限流；编写 `ops/sync_daemon.ps1` 骨架（强制 `NO_PROXY=127.0.0.1,localhost`，seam 桩模式）并接入 `ops/serve_guard.ps1`；编写并执行 `ops/sync_and_verify_remote.ps1 -FailOnDrift` 完成远端 `src/` 与 `bin/<line>/` 双落点原子同步；配置 GitHub Actions / Runner CI 三连检。

#### 3. 第二阶段准出验收门禁（Gate 2 Checklist）
1. 存量项目迁移前后文件数与字节数 100% 一致，`local_projects/INDEX.md` 与双层 JSONL 台账可正常检索聚合。
2. `ops/sync_and_verify_remote.ps1 -FailOnDrift` 执行通过，本地与远端 `src/`、`bin/` 双落点 SHA256 100% 一致。
3. `portal_sync.test.js`、`figure_templates_parity.test.js`、`upload_quota.test.js`、`bridge_guard_invariant.test.js` 在 CI 流水线中全绿通过。

---

### 第三阶段：功能实现（Phase 3: Feature Implementation）—— 预计周期：Day 13 ~ Day 24

#### 1. 阶段目标
在底座与配套全部就位的前提下，完成三条生信分析线 55 个脚本 100% 真机闭环、上线 8080 门户图级选择器与 12 条 E2E 测试、实现 `figures/adapt/` 派生副本打包与单文件 HTML 交付报告、拔除 Sync 守护进程 seam 桩打通全链路，并完成真实非肿瘤客户数据商业交付与多节点高可用演练。

#### 2. 详细执行步骤与批次编排
* **Batch 3.A（Day 13 ~ Day 16，三线生信闭环与内存削峰——执行 `WP-3.1`）**：
  * 修改 Line 2 `06_gsva_pathways.R`（切输入源为 `00_sc_harmony.h5ad` + Pseudo-bulk 聚合）与 `10_virtual_ko.R`（3 种子循环内显式 `rm(res); gc()`）；修改 Line 1 `04_enrich_ppi.R`（读离线 STRING）与 `09_external_val.R`（冻结系数验证外部集）。
  * 通过 `ops/sync_and_verify_remote.ps1` 同步至 K40，真机跑通 Line 1、Line 2、Line 3 全步骤 `exit 0`，产物回搬至 `local_projects/<项目>/{data,figures}/<line>/`。
* **Batch 3.B（Day 17 ~ Day 20，门户选择器、工作台交付与 Sync 全链路贯通——执行 `WP-3.2` & `WP-3.3`）**：
  * **门户侧（`WP-3.2`）**：在 `portal/index.html` 上线图级模板选择器（`deps_status` 置灰、`preview_sha256` 校验、`adapt_vars` 表单）及「内置示例预览 vs 项目真实结果图」分区展示；编写并跑通 12 条 Playwright E2E 自动化测试。
  * **工作台与 Sync 侧（`WP-3.3`）**：实现 `figures/adapt/` 派生副本生成与 `01_Adapted_Code/` 打包对账；实现单文件出版级 HTML 项目交付报告渲染；拔除 `ops/sync_daemon.ps1` seam 桩，打通从门户提交到客户看到真实图件与 HTML 报告的端到端自动化闭环。
* **Batch 3.C（Day 21 ~ Day 24，防伪签名、多节点高可用与真实数据商业签收——执行 `WP-3.4`）**：
  * 升级交付包 `CHECKSUMS.sig` Ed25519 私钥签名与验签工具；在 `server/task.js` 实现主备 SSH 算力节点池 10 秒自动故障转移（Failover）；使用 1 套真实非肿瘤客户数据集完成端到端商业交付演练与全套台账归档。

#### 3. 第三阶段终验判据（Final Acceptance Criteria —— 20 条全量核对表）

| 验收域 | 序号 | 终验判据（100% 实测达标） |
| :--- | :---: | :--- |
| **一、自包含结构与台账** | 1 | 任一项目的数据、图件、调试、交付与台账全部收口在 `local_projects/<项目>/` 单一目录下，无需跨 4 处查找。 |
| | 2 | 项目级 `ledger/*.jsonl` 与全局 `con_hf/ledger/*.jsonl` 严格按“换项目是否成立”分流，零正文重复；历史 `P-XX`/`D-XX` 编号 100% 保留。 |
| | 3 | JSONL 追加语义下，`ops/ledger_indexer.py` 能按 `id` 聚合最新状态，并按 `refs` 将 `errors` 与 `fixes` 串成完整视图，同时索引独立的 `outputs/system_logs/`。 |
| **二、单向 Sync 与网络** | 4 | 一条 GSE 或客户自有数据从 8080 门户提交后，全自动流转并在门户展示真实图件与单文件 HTML 报告。 |
| | 5 | 8787 编排面对 8080 门户全出站通信（显式 `NO_PROXY=127.0.0.1,localhost`），门户从不主动连接 8787。 |
| | 6 | `netstat` 证实 8787 仅监听 `127.0.0.1`，本地 PC 无任何 R/Python 生信计算进程，算力 100% 落在 K40（或备用节点池）。 |
| | 7 | 上行客户包与下行结果包双向 SHA256 及 `CHECKSUMS.sig` Ed25519 数字签名校验 100% 通过。 |
| | 8 | 同一 `ticket_id` 60 秒内二次点击同步触发限流，返回 `{ok:false, retry_after:N}` 与“稍后重试”。 |
| | 9 | 交付四道闸拦截时，门户准确显示 `blocked`（「待人工确认，详见对接人」），绝不停留在假 `running`。 |
| **三、图模板库与出图** | 10 | 17 个已采集图型完成 K40 R 4.5.3 三层验证，通过者入册 `src/figure_templates.json`，失败者标 `blocked_r453` 且客户端置灰并显示原因。 |
| | 11 | 门户将「内置示例预览图（`_verified.png`）」与「项目真实产出图（`local_projects/<项目>/figures/<line>/`）」物理分区展示并醒目标注。 |
| | 12 | 图型模板可跨线共享，但填入 `adapt_vars` 的数值严格来自本项目本线，跨项目/跨线取值在 `server/figure_graph.js` 100% 被拒。 |
| | 13 | 模板适配仅修改 `local_projects/<项目>/figures/adapt/` 派生副本（头部记母版路径与 sha256，随 `01_Adapted_Code/` 交付），`reference/05.` 母版 SHA256 零变化。 |
| | 14 | 修改母版未同批重跑预览图更新 `preview_sha256` 时，防漂移单测立即报红；磁盘文件与指纹不符时门户提示「预览图与模板不同步」。 |
| **四、三线生信与高可用** | 15 | Line 1（含离线 STRING PPI 与冻结系数外部验证）、Line 2（含 `00_sc_harmony.h5ad` 输入切换、GSVA Pseudo-bulk 与虚拟敲除 GC 削峰）、Line 3（含 NNLS 自签名反卷积与虚拟敲除）共 55 个脚本在 K40 真机 100% `exit 0`。 |
| | 16 | 所有 DEG 与 DR Genes 在表格、图件角标（`[Virtual KO Perturbation - DR Genes]`）与三段式解读中 100% 物理区分。 |
| | 17 | `ops/sync_and_verify_remote.ps1 -FailOnDrift` 确保本地仓库与远端 `src/`、`bin/` 双落点零漂移，五维自检第 4 维绿灯。 |
| | 18 | 20GiB `reservedBytes` 上传写盘前硬闸门生效，并发超额分片 100% 返回 `413`/`507`。 |
| | 19 | CI 流水线（500+ 单测 + `tsc` + `build`）与 8080 门户 12 条 Playwright E2E 测试 100% 绿灯。 |
| | 20 | 模拟 K40 高温（$\ge 95^\circ	ext{C}$）或断联时，`server/task.js` 在 10 秒内自动将新任务故障转移至备用计算节点。 |

---

## 三、 生产级风险预案与自动降级矩阵（Risk & Fallback Matrix）

| 风险类别 | 所属阶段 | 监控探针与触发阈值 | 自动化保护动作（System Action） | 人工介入与台账回写要求 |
| :--- | :---: | :--- | :--- | :--- |
| **1. 容器并发 SSH 触发 proot abort (P-29)** | 第一~三阶段 | 短时间并发 SSH 连接或容器内执行 `find`/`ps`/`grep -r` | `sync_daemon.ps1` 强制 `SYNC_BATCH=1` 串行派发，轮询间隔锁死 $\ge 60	ext{s}$，静态审计拦截全盘扫描命令 | 若发生 abort，等待 60s 后由 `00_link_check.ps1` 重建链路，严禁高频重试；记入 `con_hf/ledger/errors.jsonl` |
| **2. SoC 高温热节流 / 熔断** | 第一~三阶段 | `/sys/class/thermal` $\ge 85^\circ	ext{C}$ (`warn`) / $\ge 95^\circ	ext{C}$ (`fail`) | 8787 自检灯变红；`run_throttled_task.sh` 步间触发 `sleep 30` 冷却循环至 $< 78^\circ	ext{C}$；配置备用节点时触发 `task.js` 自动路由切换 | 检查外置风冷与旁路供电；记入 `con_hf/ledger/actions.jsonl` |
| **3. 7.5GB 内存配额逼近 / OOM** | 第三阶段 (`WP-3.1`) | cgroup v2 `memory.current` $\ge 90\%$ 或进程因 `RLIMIT_AS` 退出 | 停止当前步，机器台账记 `status: failed, checkpoint_status: halted`；保留前序已 `exit 0` 的 `.rds`/`.h5ad` 检查点 | 核查是否启用 Pseudo-bulk 与循环 `rm()+gc()`，必要时下调 `nc_nCells=500`；记入项目 `ledger/errors.jsonl` 与 `fixes.jsonl` 后断点续跑 |
| **4. F2FS 存储水位低于 20% 红线** | 第二~三阶段 | `df -P /mnt/ssd/bio_data` 剩余空间 $< 20\%$ 或 `.uploads` 达 20GiB | `check_storage_and_isolation.sh`、`upload.js` 硬闸门与交付第 1 道闸同时阻断新任务/新上传；触发 `gcStaleUploads` | 将已签收项目远端 `.h5ad`/`.rds` 回搬至 `local_projects/<项目>/data/` 后清理远端，在 `con_hf/ledger/actions.jsonl` 记录释放容量 |
| **5. 远端双落点或预览图版本漂移** | 第二~三阶段 | 五维自检第 4 维检测到 `src/` 或 `bin/` SHA256 不一致，或 `preview_sha256` 不符 | 自检汇总 `all_pass = false`；门户对指纹不符的图型屏蔽旧图并提示「预览图与模板不同步」 | 严禁在远端手改脚本；立即在本地运行 `ops/sync_and_verify_remote.ps1 -FailOnDrift` 或重跑 `_verified.png` 对齐并记账 |
