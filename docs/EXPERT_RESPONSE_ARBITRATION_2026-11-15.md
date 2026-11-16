# 第三方专家方案裁定稿：AI 主力化三层自主模型（2026-11-15）

> 对象：《首席系统架构师 × 临床转化生信总编》对 `docs/EXPERT_BRIEF_2026-11-15.md` 的评审回复（六项裁定 + 回执 6/6）。
> 立场：以当前工作树与 `SPEC.md`、`SCOPE.md`、`workflows.json`、`receipt/v1` 真源为准。
> 性质：技术裁定与实施顺序，不新增第二真源；本文裁定已收成可执行目标，见 `docs/GOAL_2026-11-15.md` 后续修订（待用户终审红线后补入）。
> 事实基线：28 道门禁全绿；2127 用例 0 失败；mutation_gate 常驻 22 条变异（m1 至 m22）。

---

## 零、一句话结论

专家方案的主干全部采纳：三维自主矩阵、3 次预算 + 降级阶梯、倒计时闸门策略化、
三栏审批弹窗、PKG manifest 加 `format_hint` 与 `autonomy_grants`、6+3 工具边界与
门禁版本化扩充。这套设计与仓库既有防线（第 6 道项目脚本边界、第 26 道护栏、
11 层判定链、租约体系）是同构的，属于「把已预留的缝合法用满」，不是推倒重造。

但四处事实偏差必须先纠正，两处红线冲突必须先经用户终审，然后才能开工。

---

## 一、事实核对：专家稿 vs 工作树真源

| 专家说法 | 真源事实 | 处理 |
|---|---|---|
| PKG 需要「独立的 `package_manifest.v1.json` 清单文件」承载 data_files | portal 已在提交时产出 `package_manifest.json`，`data_files[]` 已带 role 与 sha256；from-package 链路已消费 | 采纳为**增强既有文件**：加 `format_hint` 与 `autonomy_grants` 可选字段，不改文件名，不搞 v1/v2 双文件 |
| 变异反证「从 19+6 升级为 19+9」 | mutation_gate 常驻已是 22 条（m1 到 m22，含 Pi 域 2 条）；另有 q3q2 独立 6 条 | 改为「mutation_gate 22 条 + 新增 M-Pi-07/08/09 → 25 条」，q3q2 6 条不动 |
| 资源守卫文件名 `bio_memory_guard.py` | 实名 `core/mem_guard.py`（本工作树） | 按真源文件名写 |
| 验证态内存收紧「RLIMIT_AS 收紧」 | mem_guard 现走容器内存上限约束（cgroup/limit 语义），非单进程 RLIMIT_AS | 语义采纳（验证态 3.5GB 紧缩），实现落在 mem_guard 的模式参数，不虚构接口 |
| 工具清单文件在 `desktop/runtime/picli/tools_manifest.json` | 属实（声明面），运行时真源 `pi_tools_bridge.js` | 按既有双向比对机制扩 |
| 第 6 道门禁要求 scripts_manifest 逐条登记 | 属实（缺登记、缺清单、同名克隆都红） | 与 propose_adaptation 天然契合，登记字段扩充见下 |

---

## 二、裁定 1：三维自主矩阵（采纳，含防呆锚点）

采纳「数据模态 × 契约不变量影响域 × 算力成本」三维切分，L3/L2/L1 三级，
落 `schemas/autonomy_policy_v1.json`（随包走 data 目录可覆盖）。

要点裁定：

1. **不变量锚点采纳**：适配脚本只许改「脏数据 → 母版标准输入契约」的映射，
   严禁改数值分布形态。`run_validation` 强制对比样本数守恒、基因覆盖率下限、
   数值分位数摘要；覆盖率阈值按专家 80% 起步，实测后可调。
2. **阈值归配置**：3.5GB 验证红线、180 秒验证超时、2 次节点级重试、
   3 次 step 预算、20 分钟熔断线，全部进 `autonomy_policy_v1.json`，代码只读配置。
3. 与 REJ-006 的关系：L3 验证态 3.5GB 小于生产 8.0GB 上限，无冲突；
   专家把「引入重型包」划入 L1 正确，与 REJ-006 台账一致。

---

## 三、裁定 2：失败语义（采纳主干，两处收紧）

采纳 3 次受控预算（Attempt 1 契约对齐 / 2 参数调优 / 3 强制降级阶梯 /
预算耗尽熔断挂起 `HUMAN_INTERVENTION_REQUIRED`，下游 blocked）。

收紧点：

1. **降级阶梯必须登记白名单**：专家列的四条降级路径（ComBat→removeBatchEffect、
   pearson→bicor→Spearman、scTenifoldKnk 下采样 1500 细胞固定 seed、
   NNLS 细分亚群合并）全部进 `autonomy_policy_v1.json` 的 `fallback_ladder` 显式登记，
   AI 只能按登记路径降级，不得临场发明新路径。
2. **叙事联动强制化**：降级后报告 Methods 必须由事实核查器校验含对应披露句，
   缺披露即报告构建失败（复用 `fact_check_narrative.mjs` 既有拦截机制）。
3. 诊断卡片（3 次 Diff + 日志）推桌面端通知，作为 D0 桌面壳的扩展项。

---

## 四、裁定 3：通知层宽限期（采纳，参数修正一处）

采纳「倒计时自动放行 + 熔断豁免」改造两道检查点，默认参数：

| 参数 | 专家值 | 裁定 |
|---|---|---|
| checkpoint_1 交互宽限 | 180s | 采纳 |
| checkpoint_2 交互宽限 | 300s | **修正为 600s**：靶点锁定直接决定交付结论，给足人工复核时间 |
| 无人值守黄金豁免 | 15s | 采纳（留日志与 Toast 时间） |
| 零等待直通 | 黄金回归集 + 复跑已验证工单 + adaptation_count=0 且全 PASS | 采纳 |

**强制吊销自动放行（Revoke Auto-Pass）三条全部采纳**：组内有效重复 N<3、
剔除样本超 15% 或探针丢失超 20%、统计降级（裸 P 值替代 FDR / 外验 AUC<0.65）。
触发任一即无限期等待人工点击，并写台账。

---

## 五、裁定 4：审批弹窗（采纳 MVP 五要素 + 两点工程化）

采纳三栏卡片弹窗五要素（诊断摘要、预检徽章、只读 Diff、前后数据对比、决策栏）
与两个后端端点（`GET /api/work-orders/:id/proposals`、
`POST /api/work-orders/:id/proposals/:propId/decide`，带租约头）。

工程化修正：

1. 批准写入 scripts_manifest 由后端原子写（专家已提），需补「写入后立即跑
   第 6 道门禁的项目级校验逻辑」做双保险，防止登记与磁盘漂移。
2. 弹窗进 D0 桌面壳视图矩阵（新 D0.5），不阻塞 D0 收口主线，可并行施工。

---

## 六、裁定 5：PKG manifest 演进（采纳，去掉双文件制）

采纳 additive 可选字段策略（`format_hint`、`autonomy_grants`、requirement_sha256），
落在**既有** `package_manifest.json` 上；旧包（无新字段）按 legacy 模式放行，
新字段出现即启用严格校验。回执 6/6 中「构造测试包」按此口径执行。

不采纳：独立的 `package_manifest.v1.json` 第二文件（与「一个含义一个真源」冲突，
且 from-package 消费链已绑定现有文件名）。

---

## 七、裁定 6：6+3 工具与第 26 道门禁演进（采纳主干，三处工程化收紧）

### 7.1 三个新工具的物理边界

全部采纳，按真源文件名落地：

1. propose_adaptation：路径白名单（仅 `workspace/projects/<id>/scripts/adapt_*.R|py`）、
   母版同名与高相似度拦截（REJ-002）、AST 黑名单（system/subprocess/socket/
   unlink/rm 等逃逸调用，白名单只留纯数据转换包）、写盘即同步登记
   scripts_manifest（含输入输出契约、SHA-256、上游母版关联、purpose、reason）。
2. run_validation：复用 `run_throttled_task.sh` 通道加 `--validation-mode`；
   `core/mem_guard.py` 加验证态模式（3.5GB / 180s）；跨线签名强制先过
   `isolated_bridge_gate`；验证产物写 `.val_tmp/`，验收通过才原子提升。
3. dispatch_step：程序化调既有任务 FSM，必带当前租约头；前置条件锁
   （适配脚本必须 VERIFIED_OK 且哈希未变，否则 409 `ERR_ADAPTATION_UNVERIFIED`）。

### 7.2 第 26 道门禁版本化（V2 护栏契约）

1. `tools_manifest.json` 拆 `tier1_readonly_and_orchestration`（原 6）与
   `tier2_sandboxed_adaptation`（新 3），声明面与运行时双向比对机制不变；
   严禁第 10 个未授权工具。
2. tier2 handler 静态必须显式调用 `validateAdaptationPath()`、
   `scanAstBlacklist()`、`verifyScriptsManifest()` 三个守卫函数，缺失即红。
3. **变异扩充修正口径**：mutation_gate 22 → 25 条（M-Pi-07 母版克隆、
   M-Pi-08 未验证直发、M-Pi-09 豁免伪造），q3q2 独立 6 条不变；
   metrics_sync 与门禁基线同步更新。
4. receipt/v1 溯源扩展：`actor_trace` 里新增三类标准事件
   （propose_adaptation 附脚本 SHA-256、run_validation 附耗时与内存峰值、
   auto_pass_after_grace），schema 不变，零破坏兼容（2026-11-15 T1.7 已铺好 trace 机制）。

---

## 八、红线冲突：用户终审结果（2026-11-15 已拍板）

| # | 专家主张 | 与既有裁定的冲突 | 待用户裁定 |
|---|---|---|---|
| 1 | 检查点一「180 秒倒计时自动入队」、检查点二「300 秒自动签发报告并签名」 | GOAL 两面形态与 Pi 契约现行为：检查点是硬闸门 | **终审：选 C（一放一收）**。Checkpoint #1 立项入队：180s 宽限倒计时自动放行（命中强制吊销三条除外）；Checkpoint #2 靶点锁定与报告签发：保留人工点击硬闸门，不设自动放行。报告签发是对客户背书的不可逆动作。唯一豁免：内部跑批工单显式带 `golden_regression: true` 且全绿时，允许自动化测试中豁免 #2 人工点击 |
| 2 | 验证集 AUC<0.65 只触发「吊销自动放行，转人工」，未禁止最终签发 | 现契约：外验 AUC 与统计口径是交付可信性判据 | **终审：同意，实施签名分级**。凡统计降级（裸 P 值替代 FDR、外验 AUC<0.65、第 3 次 Fallback 后仍弱显著）严禁进入常规 Ed25519 标准签名通道，默认拦截 409 `ERR_DEGRADED_STATS_REQUIRE_OVERRIDE`；人工特批「探索版签发」后：报告抬头与 Methods/Discussion 强制注入探索性分析声明，`receipt.v1.json` 打标 `delivery_grade: "EXPLORATORY_DEGRADED"`（常规 `"STANDARD_VERIFIED"`），密码学回执诚实反映证据等级 |

---

## 九、实施顺序（终审后生效）

| 波次 | 内容 | 依赖 |
|---|---|---|
| A1 | `autonomy_policy_v1.json` schema + 策略加载器 + 默认阈值 | 无 |
| A2 | PKG manifest 加 `format_hint` / `autonomy_grants`（additive）+ from-package 透传 | A1 |
| A3 | propose_adaptation + scripts_manifest 联动 + AST 守卫 | A1 |
| A4 | run_validation（mem_guard 验证态模式 + .val_tmp 原子提升） | A3 |
| A5 | dispatch_step + 前置条件锁 | A4 |
| A6 | 第 26 道门禁 V2（tier 拆分 + 3 守卫函数静态检查）+ mutation_gate 3 条新变异 | A3 至 A5 |
| A7 | 检查点策略化 + 桌面审批弹窗 + proposals 两端点 | A1 + 用户红线终审 |
| A8 | metrics/门禁基线同步 + 全量回归 + 回执 6/6 三项实证 | 全部 |

每波先红后绿，单独成提交，门禁不放宽。

### 9.1 实施状态（2026-11-15 收口）

| 波次 | 状态 | 证据 |
|---|---|---|
| A1 策略契约 | 完成 | `shared/autonomy_policy_v1.mjs` + 12 条契约测试 |
| A2 manifest 增强 | 完成 | `shared/package_manifest_v1.mjs` + portal/from-package 接线 + 9 条测试 |
| A3 propose_adaptation | 完成 | 四守卫全接 + 7 条工具测试 |
| A4 run_validation | 完成 | mem_guard 验证态模式 + `.val_tmp` 原子写 + 5 条测试 |
| A5 dispatch_step | 完成 | 租约 + 前置锁 + 5 条测试 |
| A6 门禁 V2 | 完成 | tier1/tier2 + 三守卫静态检查 + 25 条变异 escaped=0 |
| A7 检查点与签名分级 | 完成 | C 方案 + proposals 两端点 + 三栏弹窗 + `delivery_grade` |
| A8 基线同步 | 完成 | 2168 用例 0 失败；28 门禁全绿；回执 6/6 三项实证 |

---

## 十、回执 6/6 采纳口径

专家「回执 6/6」三项实证全部采纳为 A8 的验收判据，按本文口径修正后执行：

1. 脏数据自愈闭环实测（打乱表型列名 + 双斜杠探针 ID 的测试包）。
2. 吊销自动放行实测（剔除 >15% 或 AUC<0.65 时倒计时取消、转人工）。
3. 第 26 道门禁升级后 25 条变异全绿输出（escaped=0）。

（裁定稿完。第八节两项已终审，按第九节波次开工，检查点二宽限 600s 参数作废：签发保留人工，无宽限期）
