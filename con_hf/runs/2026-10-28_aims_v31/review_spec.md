# Spec 轴只读评审：T-FT-05 真实输入语义适配与 G2

## 结论
发现 3 项：1 项 Spec 缺失，1 项疑似错误，1 项 scope creep。

## 发现
1. **P1 疑似错误：real-input overlay 会额外运行母版。** Spec 要求派生副本“读取固定步骤产出的真实 .tsv/.h5ad”（aims/01_aims_20261027_1204.md:115）。实现把 masterSource 保留在 overlay 前（BioanalysDesktop/server/figure_adapters.js:401），母版会先写合成图/合成 PDF，再执行真实数据覆盖。行为能产出真实图，但不是纯真实驱动执行，且 h5ad 模板可能额外计算 UMAP。同理 fig_l2p_dotplot 的 registry canonical_output 为 `figures/dotplot__L2p_dotplot_verified.png`（src/figure_templates.json:3088），母版 `sc.pl.dotplot` 实际只产 `figures/_L2p_dotplot_verified.png`，远端 copy 可能为空。
2. **P1 缺失：Python 任务未注入 BIOANALYS_SEED。** Spec 要求随机种子契约；R 已校验（BioanalysDesktop/server/figure_adapters.js:108）。但 task.js 的 Python runner 只执行 `python3`（BioanalysDesktop/server/task.js:776），测试任务载荷也没有 env_vars 映射（BioanalysDesktop/server/index.js:1352），Python overlay 可能以未设种子状态运行。
3. **P2 scope creep：多节点故障转移/温度熔断进入本次 diff。** Spec 来源只覆盖 T-FT-05/G2；`routeTask` 等属于无关能力扩展（BioanalysDesktop/server/task.js:254），应拆出独立评审与验证证据。

## Resolution
1. 已修复：overlay 先于 masterSource 执行并以 `quit(status = 0)` 或 `raise SystemExit(0)` 终止（figure_adapters.js:397-408）；测试断言 master 不可达（figure_adapters.test.js:148-161）。dotplot overlay 直接写 `figures/dotplot__L2p_dotplot_verified.png`，K40 evidence exit 0、产物 PASS（real_input_adapters/fig_l2p_dotplot_ledger.json:32、artifact_validation.tsv:5）。
2. 已修复：`buildTaskScript` 统一 `export BIOANALYS_SEED="$SEED"`（task.js:714），Python adapted 有继承测试（task.test.js:240-255）。
3. 维持待拆。
