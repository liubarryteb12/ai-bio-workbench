# 系统范围与已否决设计（SCOPE.md）

本文件回答两个问题：这个项目做什么、不做什么；哪些方案已经被否决过，不许再提。

强制机制：每条否决都绑定一个真实存在的门禁脚本（`enforced_by`），由 `ops/router_gate.mjs`
校验路径存在性，填一个不存在的门禁会直接报红。生命周期字段（`status` / `reviewed_by` /
`superseded_by`）同样是机器可读的，`status=已撤销` 时必须写明 `superseded_by`。

## 一、范围内（In-Scope）

1. 三条隔离分析线的端到端流水线：`line1_bulk`（GEO 常规挖掘）、`line2_scrna`（单细胞）、
   `line3_spatial`（空间转录组），母版在 `src/<line>/scripts/`，步骤由 `src/workflows.json` 定义。
2. 受约束运行面上的真机执行与核验：受限内存设备上的部署、运行、产物回传与逐字节校验。
3. 图件合规：300 DPI、图例外置、图注置轴框外左下角、分类色板 Okabe-Ito、空间图内嵌比例尺。
4. 交付物与报告：脱敏后的综合报告、交付签名与四关验收。
5. 防退化基础设施：契约测试、变异反证、门禁脚本、台账。

## 二、范围外（Out-of-Scope）

1. 不做脱离明确退出判据的自主探索型 Agent。
2. 不做通用大模型问答窗口，本项目的产出必须是可追溯的分析结果。
3. 不承接与三条线无关的临时脚本需求，临时脚本放 `.tmp/` 且不进交付。
4. 不在生产链引入重型算法（详见 REJ-006）。

## 三、已否决设计（REJ）

| 编号 | 被否决的方案 | 否决理由 | 强制执行者 | 状态 | 复审依据 | 被替代者 |
|---|---|---|---|---|---|---|
| REJ-001 | 突破 30 条 Ready 白名单，随手新增未实证的模板 | 白名单只证明 ID 被封板，不证明源码与预览逐字节一致 | `enforced_by: ops/figure_ready_matrix.mjs` | 生效 | Argon 第 41 轮 | 无 |
| REJ-002 | 在项目目录放母版同名脚本副本做「临时改一版」 | 副本会分叉真源，事故无法复现 | `enforced_by: ops/project_script_gate.mjs` | 生效 | Argon 第 41 轮 | 无 |
| REJ-003 | 只改仓库母版，不同步算力面脚本 | 仓库与设备不同源时结果无法回溯到源码版本 | `enforced_by: ops/k40_script_parity.mjs` | 生效 | Argon 第 38 轮 | 无 |
| REJ-004 | 母版里硬编码 `python3` 解释器路径 | 不同宿主解释器位置不同，硬编码会静默用错环境 | `enforced_by: ops/python_interpreter_gate.mjs` | 生效 | 生信代码专项审核 | 无 |
| REJ-005 | 出图绕过 300 DPI 与非 PNG 口径 | 期刊排版要求物理尺寸与分辨率可复现 | `enforced_by: ops/figure_spec_gate.mjs` | 生效 | 生信代码专项审核第 4 项 | 无 |
| REJ-006 | 生产链引入 RCTD / cell2location / Stereoscope 等重型解卷积 | 受限内存设备会 OOM 137 或降频死锁；精度提升走 Top20 marker 提纯与 0.05 截断 | `enforced_by: ops/python_interpreter_gate.mjs` | 生效 | 第 66 轮 Argon 裁定 | 无 |
| REJ-007 | 便携包与源码各改各的，不做同源校验 | 陈旧快照交付出去等于发了一份未知版本的产物 | `enforced_by: ops/dist_parity_gate.mjs` | 生效 | Argon 第 35 轮 | 无 |
| REJ-008 | 条件跳过测试但不写原因 | skipped 随宿主漂移，不写原因无法区分环境缺失与悄悄关掉防线 | `enforced_by: ops/skip_reason_gate.mjs` | 生效 | Argon 第 21 轮 | 无 |
| REJ-009 | 只证明「修好能让门禁红」，不证明「改坏能让门禁红」 | 没有变异反证就无法区分真防线与恒绿的空断言 | `enforced_by: ops/mutation_gate.mjs` | 生效 | T2-6 第 8 道门禁 | 无 |
| REJ-010 | 两个测试或门禁进程共用同一份共享资源 | 并发互删导致的假红假绿反复出现 | `enforced_by: ops/test_isolation_gate.mjs` | 生效 | Argon 第 34 轮 | 无 |

## 四、维护约定

- 新增一条否决：先在表里加行，再补 `enforced_by` 指向的门禁；门禁不存在则 `ops/router_gate.mjs` 报红。
- 撤销一条否决：`状态` 改为 `已撤销`，并把 `被替代者` 填成新编号或替代方案；只删行不留痕是不允许的。
- 本文件的 REJ 编号不复用，删掉的编号留空。
## 五、变异反证的分层约定（Argon 第 67 轮 Q4a）

变异反证按**故障定界**分两层，两层在门禁上的硬判据完全相同，都是 `escaped === 0`：

| 层 | 覆盖对象 | 定界含义 |
|---|---|---|
| `infra` | 清理守卫、基线一致性、台账同源、跳过白名单 | 底座或沙箱漏了 |
| `behavior` | 静态语言扫描、出图证据漂移、路由匹配 | 业务阈值或规则偏了 |

分层的价值只在于「红的时候先看哪一层」，不构成给任何一层放水的理由。
`ops/mutation_gate.mjs` 每次运行都会打印 `分层 infra=a/a behavior=b/b｜escaped 两层均为 0`，
任一层出现存活即整体 FAIL。

路由与边界台账的变异（删关键词、改 enforced_by、加幽灵脚本）目前由契约测与 `router_gate` 覆盖，
下一步按 Argon 第 68 轮清单编入 `mutation_gate` 常驻运行。
