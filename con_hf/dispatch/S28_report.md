# S28 桥接四项断言接线 · 执行报告

- 派发单：con_hf/dispatch/S28_bridge_checkpoint_wiring.md
- 子 Agent：sw-engineer profile（glm-5.3-flash / wkcn）
- 开工时间：2026-10-20
- git 基线：9354cbe（工作区仅有 2 个未跟踪派发单文件，无未提交修改）

## 1. 引擎读码结论（ops/verify_bridge_checkpoint.py，135 行全文已读）

CLI 契约：
- `python3 verify_bridge_checkpoint.py --input <.h5ad|.rds> [--from Python|R] [--to R|Python]`
- `--input` 必填；按扩展名分派检查器：`.h5ad` → check_h5ad（anndata 0.13.4），
  `.rds` → check_rds（内部 spawn Rscript，timeout 120s）。
- 其他扩展名 → `fail("不支持的文件格式（需 .h5ad 或 .rds）")`，exit 1。

退出码语义：`0` = 四项全过（stdout 逐条 `[BRIDGE OK]` + 末尾 `[BRIDGE PASS]`）；
非 `0` = 有断言失败，失败原因写到 stderr，格式 `[BRIDGE FAIL] <原因>`，无 stdout PASS 行。

四项断言（h5ad 路径；RDS 路径同构，reducedDimKeys 为 PCA/UMAP/spatial）：
1. 基因名：var_names 超过 50% 为纯数字索引 → fail（"疑似 Ensembl ID 未映射"，点名基因名断言）
2. 矩阵方向：维度为 0 或 nnz=0 → fail（矩阵方向/稀疏性断言）
3. Barcode：obs_names 超过 80% 为纯数字 → fail（barcode/样本名断言）
4. Embedding：obsm 无 X_pca / X_umap / spatial 任一 → fail（降维/坐标保留断言）

引擎所需输入：**一个真实存在的 .h5ad 或 .rds 文件路径**（远端文件系统内）。
这是引擎硬约束，无文件则必然 exit 1。→ 见 §"接线设计决策"。

## 2. 双语判定证据（真实母版，命令位调用计数）

计数口径：按行匹配「命令位 Rscript / python3? 调用」（行首或 `空格 ; & | "` 之后，
后随空白/引号/行尾），注释里的普通提及不计为调用（如 `gsva_pathways:40` 的
"# 1) python 侧…" 不算 python3 调用行:该行前缀是 `#`，`python` 前有空格会被计入，
属已知宽松方向，只影响计数不影响双语布尔判定；见测试 T1 diagnostic 实测数字）。

| 母版 | Rscript 调用行 | python 调用行 | 判定 |
|---|---|---|---|
| src/line2_scrna/scripts/gsva_pathways | :98 `Rscript - <<'RSCRIPT'` | :41、:147 `python3 - <<'PYSCRIPT'` | 双语 → true |
| src/line1_bulk/scripts/ml_diagnostics | :524 `BIOANALYS_SEED="$seed" Rscript - <<'RSCRIPT'` | :61 `python3 - <<'PYSCRIPT'` | 双语 → true |
| src/line1_bulk/scripts/deg_limma | :62 `Rscript --vanilla - <<'RSCRIPT'` | 无 | 纯 R → false |
| src/line2_scrna/scripts/scrna_figures | 无 | :1 处 python 调用 | 纯 Python → false |
| 不存在 step（no_such_step_s28） | : | : | 母版缺失 → false + warn |

实测背景复核：grep 实测双语母版共 4 个分析脚本（ml_diagnostics / ml_hub_analysis /
probe_env / gsva_pathways；README.md 非脚本不计），与派发单"三线都有跨语言步骤"一致。

## 3. 引擎真机预检（只读调用，未改引擎）

```
ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/verify_bridge_checkpoint.py \
  --input projects/default/line2_scrna/processed/scrna_annotated.h5ad --from Python --to R'
→ [BRIDGE OK] gene names: 2000, numeric < 50% (0)
→ [BRIDGE OK] matrix shape: obs=4587 x var=2000, nnz=9174000
→ [BRIDGE OK] obs names: 4587, numeric < 80% (0), sample: ['GSM8049208', ...]
→ [BRIDGE OK] embeddings: X_pca, X_umap
→ [BRIDGE PASS] all 4 assertions passed
→ EXIT=0
```

default 项目共 41 个 .h5ad/.rds（find 实测），真链正路径输入选
`projects/default/line2_scrna/processed/scrna_annotated.h5ad`（gsva_pathways 的真实上游产物）。

## 4. 实现进度

- [x] 步骤 2：needsBridgeCheck + buildBridgeCheckCommand + 提交层接线
  - task.js 新增：`inspectBridgeNeed`（判定依据）/ `needsBridgeCheck`（布尔门，规格签名）/
    `buildBridgeCheckCommand(lineId, stepName, {inputs, projectId})` / `runBridgeCheckSync`（run.js 同款
    default-import 可拦截范式）/ `BridgeCheckError` / 常量 `BRIDGE_ENGINE_REMOTE`、`BRIDGE_SSH_TIMEOUT_MS`
  - index.js 接线位置：`auditCommand` 跨线审计之后、`runTask` 下发之前
  - 退出码判决：0 → `[bridge] ... 四项断言通过` 放行；1..254（非 255）→ 400 带引擎原文；
    255/-1（ssh 连接失败/超时）→ 503「桥接校验无法执行（K40 不可达）」
  - 已知限制（上报主 Agent，见 §8）：双语步骤但 inputs 无 .h5ad/.rds 时无法构造引擎命令
    （引擎只认这两种格式），实现为 warn 留痕 + 放行，不编造参数、不阻断提交
- [x] 步骤 1：引擎读码结论（本文件 §1）
- [x] 步骤 2：needsBridgeCheck + buildBridgeCheckCommand + 提交层接线（细节见上）
- [x] 步骤 3：测试 tests/bridge_checkpoint.test.js（15 条，全绿；含 3 条元字符负路径）
  - 单文件 `node --test tests/bridge_checkpoint.test.js` → tests 15 / pass 15 / fail 0
- [x] 步骤 4：`npm test` → tests 296 / pass 296 / fail 0（基线 281 + 新增 15，既有测试零红）；
  `npm run build` → ✓ built in 680ms
- [x] 步骤 5：K40 真链正/负路径验证（脚本 cn_debug/2026-10-20_verification_s28_bridge.mjs，幂等，8/8 PASS）
  - 正路径（真 K40、真引擎、真 HTTP）：default/line2 `gsva_pathways`（唯一双语步骤，
    判定证据见 §2）+ 输入 `processed/scrna_annotated.h5ad`：
    提交 200 返回 taskId=default-line2_scrna-1792509126608；服务端日志出现
    `[bridge] line2_scrna/gsva_pathways 四项断言通过`；任务出现在 /api/tasks（正常下发）；
    随即 stop 避免重算。全流程日志见脚本输出（会话回报中有原文）。
  - 负路径（不改引擎文件，在验证脚本里造坏输入）：远端 /tmp 用 anndata 造 var_names
    全数字的 h5ad → 同一双语步骤提交 → 400，error 含引擎原文
    `[BRIDGE FAIL] var_names 超过半数为数字索引（10/10），疑似 Ensembl ID 未映射`
    （点名基因名断言）。临时文件已删（/tmp/s28_*.h5ad 已清理）。
  - 数据面不变性：验证前后 processed+figures 共 97 个文件的 md5 聚合值一致
    （c4f0443efbab64f6868537ccfc31c9d0），且 find -newermt "15:00" 为 0:
    整个验证窗口 default 项目 processed/figures 零写入。
  - K40 不可达分支（503）无法在真链安全复现（需真断链），由测试垫片覆盖
    （exit 255 → 503「桥接校验无法执行（K40 不可达）」），标注：未在真链复现 503。

## 5. 验证记录（真链输出原文摘要）

```
PASS | 链路 | ssh k40-ubuntu 可达
PASS | 正路径·提交返回 | status=200 body={"taskId":"default-line2_scrna-1792509126608",...}
PASS | 正路径·[bridge] 四项断言通过日志 | [bridge] ... 为跨语言步骤，执行四项断言: python3
  /mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py --input '.../scrna_annotated.h5ad'
  --from Python --to R || [bridge] line2_scrna/gsva_pathways 四项断言通过
PASS | 正路径·任务正常下发（在跑任务表可见） | {"taskId":"default-line2_scrna-1792509126608",...}
PASS | 正路径·收尾 stop（避免重算） | status=200
PASS | 负路径·提交 400 | status=400
PASS | 负路径·error 点名断言项（引擎原文） | ...[BRIDGE FAIL] var_names 超过半数为数字索引（10/10），疑似 Ensembl ID 未映射
PASS | 数据面快照一致 | before=[97 | c4f0443e...] after=[97 | c4f0443e...]
==== S28 真链验证汇总: 8/8 PASS ====
```

## 6. 台账副作用（如实记录）

- 两次真链正路径提交均随即 stop，各落 1 条 failed 台账（接线前 stop 行为一致）：
  17222ebe（15:09:40Z）、25d51e17（15:12:16Z），error_log「stderr 为空，退出码非零」。
- **待归因发现**：system_logs 还有 3 条同形态 gsva_pathways failed 台账
  （58546485@15:09:31Z、86b31149@15:10:33Z、c2cc6e68@15:11:44Z），input/seed 与我的提交
  完全一致，但时间点无法对应我记录的 2 次提交动作。已核实：当前无 gsva/python/Rscript
  残留进程、15:12 后无新台账、数据面零写入（见 §5）。疑似另有 8787 形态后端
  （run.js 台账格式：UUID task_id + project_id + random_seed 齐全，非 ops 格式）或
  自动续跑看门狗在窗口内派发。**归因未定，交主 Agent 排查**，不在本切片范围内处理。

## 7. 文件变更清单

| 文件 | 变更 |
|---|---|
| BioanalysDesktop/server/task.js | 新增桥接判定/命令构造/同步执行（inspectBridgeNeed、needsBridgeCheck、buildBridgeCheckCommand、runBridgeCheckSync、BridgeCheckError、BRIDGE_ENGINE_REMOTE、BRIDGE_SSH_TIMEOUT_MS），既有函数零改动 |
| BioanalysDesktop/server/index.js | 仅两处：import 增补；/api/tasks/submit 在 auditCommand 之后、runTask 之前插入桥接检查块 |
| BioanalysDesktop/tests/bridge_checkpoint.test.js | 新建（15 条测试） |
| cn_debug/2026-10-20_verification_s28_bridge.mjs | 新建（真链验证脚本，幂等） |
| con_hf/dispatch/S28_report.md | 本文件 |

git 状态：以上文件 + 两个派发单 md 为未跟踪/修改态，未提交（未获授权不做 git 动作）。

## 8. 假设与风险 / 待主 Agent 决策事项

1. **buildBridgeCheckCommand 签名扩展（已实施，请追认）**：规格定死 `(lineId, stepName)`，
   但引擎 CLI 硬要求 `--input <真实存在的 .h5ad/.rds>`。实现为
   `(lineId, stepName, { inputs, projectId })` 第三可选参：inputs 取自提交请求的
   task.inputs（提交层真实可得，非编造），相对路径按项目线 processed/ 解析。
   前两个参数与规格一致，两参调用形式兼容。
2. **双语步骤但 inputs 无 .h5ad/.rds**（实测全部 4 个双语母版中，gsva_pathways/ml_diagnostics/
   ml_hub_analysis 的跨语言桥接物是脚本内中间 tsv，引擎只认 h5ad/rds）：实现为
   warn 留痕 + 放行（不阻断=避免回归，不编造参数）。若要全覆盖需改 58 脚本或扩引擎
   （都在他线冻结域），建议主 Agent 另行决策。
3. **桥接校验语义边界**：提交层校验的是任务声明输入的 .h5ad/.rds 过四项断言；
   双语步骤脚本内部产生的中间桥接物（如 gsva 的 pseudobulk tsv）提交层不可见，
   本接线不覆盖（同第 2 条，需脚本级埋点才能覆盖）。
4. **§6 的 3 条待归因台账**：建议主 Agent 会话排查（可能是 default 会话域的
   看门狗/另一 8787 实例）。
5. K40 不可达 503 分支未在真链复现（测试垫片覆盖），标注未运行于真链。
6. npm test 现为 296 条（281 + 15），与派发单预期的"281 条基础上只增"一致。
