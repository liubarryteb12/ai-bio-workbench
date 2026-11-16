# Pi CLI 驱动型工作台：受控边界与契约

> 本文是 Pi CLI 在本仓库内的唯一接入契约。实现真源是三个文件：
> [pi_tools_bridge.js](file:///d:/00.AIagent/codespace/bioworkbench/BioanalysDesktop/server/services/pi_tools_bridge.js)
> （六大工具白名单）、[pi_supervisor.js](file:///d:/00.AIagent/codespace/bioworkbench/BioanalysDesktop/server/services/pi_supervisor.js)
> （会话与双检查点）、[fact_check_narrative.mjs](file:///d:/00.AIagent/codespace/bioworkbench/tools/reporting/fact_check_narrative.mjs)
> （正文防幻觉）。声明面是 `desktop/runtime/picli/tools_manifest.json`，
> 与运行时由 `tools/dev/pi_guardrail_gate.mjs` 双向比对，不一致即红。

## 零、本地安装与配置（2026-11-15）

Pi CLI 不是仓库自带二进制，必须单独安装。本机落点与配置如下：

| 项 | 值 |
|---|---|
| npm 包 | `@earendil-works/pi-coding-agent@1.5.2` |
| 安装目录 | `desktop/runtime/picli/node_modules/@earendil-works/pi-coding-agent` |
| CLI 入口 | `desktop/runtime/picli/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js` |
| Agent 目录 | `desktop/runtime/picli/agent` |
| 模型配置 | `desktop/runtime/picli/agent/models.json`（SenseNova OpenAI 兼容端点） |
| 默认模型 | `sensenova/glm-5.3` |
| 终端入口 | `desktop/runtime/picli/pi.cmd` |

`.env.local` 需要三项（该文件已 gitignore）：

```text
BIO_PI_CLI_BIN=<仓库绝对路径>\desktop\runtime\picli\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js
PI_CODING_AGENT_DIR=<仓库绝对路径>\desktop\runtime\picli\agent
BIO_PI_API_KEY=<本机密钥>
```

验证命令：

```powershell
node .tmp/pi_env_probe.mjs
```

返回 `ok=true` 且 `finalText` 非空即表示 `runPiRpc` 真链路可用。

## 一、边界：模型能做什么、不能做什么

| 能力 | 状态 | 说明 |
|---|---|---|
| 读需求单摘要 | 允许 | `inspect_requirement`，只回摘要字段，不回长自由文本 |
| 编译 DAG 拓扑 | 允许 | `compile_work_order`，校验工单契约，只回摘要 |
| 轮询执行进度 | 允许 | `dispatch_and_poll_dag`，只读 |
| 读指标卡 | 允许 | `read_step_metrics`，严格 < 32 KB |
| 受控调参 | 允许（记录） | `remediate_step_param`，只在注册表允许区间内，写台账 |
| 报告核验 | 允许 | `build_and_verify_report`，给出可否签发判定 |
| 执行 shell / powershell | **禁止** | 无任何通用执行能力；`pi_guardrail_gate` 静态扫描模块源码 |
| 自由读文件 | **禁止** | 只有 `read_step_metrics` 与 `inspect_requirement` 两个受控读入口 |
| 自由写文件 | **禁止** | 参数调整只写台账，不改母版，不改产物 |
| 访问网络 | **禁止** | 配置面 `network: false` |
| 直接签报告 | **禁止** | 必须经检查点二人工批准 |

## 二、两道人工检查点

```text
立项
  └─ Pi 提交方案与 DAG 预审（submitPlan）
       └─ [检查点一] 人工点"批准入队"（approvePlan，必须留 actor）
            └─ POST /api/work-orders/:id/run
                 └─ DAG 执行、通道回搬、成功率与水位
                      └─ Pi 提交 1–3 个待锁定靶点（submitTargetLock）
                           └─ [检查点二] 人工确认靶点（approveTargetLock）
                                └─ 报告渲染 → 事实核查 → Ed25519 签名
```

两条判据都是硬闸门：

1. 未批准检查点一就下发 DAG → `INVALID_STATE_TRANSITION`；
2. 未批准检查点二就签发报告 → `INVALID_STATE_TRANSITION`；
3. 批准时缺 `actor` → `CHECKPOINT_ACTOR_REQUIRED`；
4. 靶点数不在 1–3 → `TARGET_LOCK_COUNT_INVALID`。

## 三、九工具的输入契约

| 工具 | 必填参数 | 可选参数 | 只读 |
|---|---|---|---|
| `inspect_requirement` | `package_id` | — | 是 |
| `compile_work_order` | `project_id`、`line_id`、`selected_mods` | `params_override` | 是 |
| `dispatch_and_poll_dag` | `work_order_id` | `lease_id` | 是 |
| `read_step_metrics` | `project_id`、`mod_id` | — | 是 |
| `remediate_step_param` | `work_order_id`、`mod_id`、`param_key`、`new_value`、`reason` | — | 否 |
| `build_and_verify_report` | `project_id`、`narrative_payload_json` | — | 否 |
| `propose_adaptation` | `project_id`、`mod_id`、`filename`、`content`、`purpose`、`reason` | — | 否 |
| `run_validation` | `project_id`、`mod_id`、`entry_point` | — | 否 |
| `dispatch_step` | `work_order_id`、`project_id`、`mod_id`、`entry_point`、`lease_id` | — | 否 |

**未声明参数一律拒绝**（`PI_PARAMS_INVALID`），不做静默丢弃。

## 四、指标卡契约（step_metrics/v1）

指标卡是 Pi 唯一的结构化输入面。设计约束是"千字节级"：单卡序列化后严格小于
32768 字节，超过即 `PI_METRICS_INVALID`。

必要字段：`schema_version`、`mod_id`、`line_id`、`project_id`、`status`、
`generated_at`、`input_fingerprint.inputs_digest`、`metrics`。

可选：`seed`、`qc_flags`、`figures`。

`mod_id` 必须已在 `tools/bio/workflows.json` 登记，幽灵 Mod 一律拒绝。

`qc_flags.code` 是受控枚举（8 个），不接受自造码：

```
DEG_COUNT_LOW / DEG_COUNT_HIGH / WGCNA_SCALE_FREE_LOW /
VALIDATION_OVERFIT_SUSPECT / SPOT_COUNT_LOW / CELL_COUNT_LOW /
DECONV_RESIDUAL_HIGH / SCALEBAR_UNVERIFIED
```

### 生成方式

```powershell
node tools/reporting/extract_step_metrics.mjs --project=PRJ_DCM_BENCH_20261105 --line=line1_bulk
```

指标卡落 `workspace/projects/<id>/metrics/<mod_id>.metrics.json`。

## 五、报告防幻觉：槽位绑定

正文里所有统计数值必须写成 `{{metric:<mod_id>.<path>}}`。路径支持点号与数组下标，
例如 `{{metric:l1_de_limma.top_genes[0].gene_symbol}}`。

拒绝条件（任一即 `ERR_NARRATIVE_HALLUCINATION_DETECTED`）：

1. 正文有裸写统计数值（`p = 0.03`、`AUC = 0.87`、`log2FC = 1.2`、`n = 24` 等 10 类规则）；
2. 槽位在指标卡里找不到真值；
3. 同名槽位出现不同真值（冲突）；
4. 引用了不在 27 Ready 白名单内的图件。

### 生成报告

```powershell
node tools/reporting/pi_clinical_report_builder.mjs --project=PRJ_DCM_BENCH_20261105 --out=report.md "<cards>/*.metrics.json"
```

### 单独验真

```powershell
node tools/reporting/fact_check_narrative.mjs report.md <cards>/*.metrics.json
```

## 六、可调参数白名单

只允许注册表声明的阈值键，每个键带硬边界。表外键一律 `PI_PARAM_NOT_TUNABLE`：

| 参数键 | 区间 | 单位 |
|---|---|---|
| `l1_de_limma.log2fc_cutoff` | 0 – 3 | log2FC |
| `l1_de_limma.padj_cutoff` | 0.001 – 0.1 | FDR |
| `l1_de_limma.pvalue_cutoff` | 0.001 – 0.1 | P.Value |
| `l1_de_wgcna.power` | 1 – 20 | 软阈值 β |
| `l1_de_wgcna.min_module_size` | 10 – 200 | 基因数 |
| `l2_qc_cells.min_genes` | 100 – 2000 | 每细胞基因数 |
| `l2_qc_cells.max_mito_pct` | 5 – 50 | % |
| `l3_qc_spots.min_counts` | 200 – 5000 | UMI/spot |
| `l3_branches_celltype.min_abundance` | 0.01 – 0.2 | 丰度比例 |

## 七、门禁与变异反证

```powershell
node tools/dev/pi_guardrail_gate.mjs     # 声明面一致性 + 行为判据
node tools/dev/mutation_gate.mjs         # 30 条防线反证（含 Pi 十一条）
node tools/dev/run_all_gates.mjs         # 29 道串联门禁
```

Pi 相关变异：`m20_pi_bare_metric`（裸写数值判据）、`m21_pi_param_bounds`（可调参数边界）、
`m22_pi_ghost_mod`（幽灵 Mod 判据），以及 `m23` 到 `m30` 的克隆拦截、未验证直发、
宽限伪造、租约抢占、跨代验证重放、静默空输出、阶段越权与擦除路径守卫。

## 八、持久化

| 库 | 位置 | 内容 |
|---|---|---|
| `pi_sessions.sqlite` | `data/.ops_state/` | 会话、检查点、工具调用记录 |
| `pi_jobs.sqlite` | `data/.ops_state/` | 无状态 RPC 作业簿（既有 `pi_runner.js`） |

两库分开：会话是"监督关系"的生命周期，作业是"单轮调用"的簿记。混表会让两套状态互相污染。

重启后 `resumableSessions()` 返回未终结会话与各自卡在哪一步。

## 九、便携包与签发擦除演练

Pi CLI 是运行时资产，不进 Electron 生产依赖。版本锁在
`desktop/runtime/picli/package.json`，由 `stage-runtime.mjs` 整目录复制进
`resources/runtime/picli`，后端默认经 `tools/bin/pi-wrapper.js` 解析包内 CLI
并注入 `PI_CODING_AGENT_DIR`，不依赖全局 `pi`。`BIO_PI_CLI_BIN` 仍可显式覆盖。

签发擦除真机演练：

```powershell
node tools/dev/pi_sign_wipe_drill.mjs
```

判据：`delivery_verified=true`、`wipe.ok=true`、设备侧只剩 `WIPE_TOMBSTONE.json`。
脚本使用一次性临时密钥对，跑完即删，不碰生产密钥；设备离线直接失败，不降级成 mock。
