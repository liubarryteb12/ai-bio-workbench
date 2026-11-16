# 推进主清单（TODO.md）

> 单线推进契约：本文件只登记「当前唯一主线」的可勾选步骤与验收命令。
> 背景与裁定见 INDEX.yaml governance 指向的 SPEC.md、SCOPE.md 与 docs/GOAL_2026-11-11.md，
> 这里不复述内容，只做任务寻路与完成打勾。

## 主线：便携版交付与全流程验收（2026-11-14 实测通过）

- [x] 母版 28 道门禁全绿（命令：`node tools/dev/run_all_gates.mjs`）
- [x] 便携包构建与净化 PATH 自检（命令：`node tools/dev/build_portable_package.mjs --verify`）
- [x] 便携包内全量测试零红（2062 用例，33 条白名单跳过；命令：包内 `test.cmd`）
- [x] 便携包客户方式总验收（解包目录直跑 `gate.cmd`，28 道全绿）
- [x] GUI 全流程实测：门户提交 → 工作台导入建项 → 工单创建（单权威租约）→ 确认入队 → 算力端调度 → 回执

## 支线：Pi CLI 受控接管与临床级报告（2026-11-15 落地）

- [x] 六大受控工具白名单与声明面双向一致（命令：`node tools/dev/pi_guardrail_gate.mjs`）
- [x] 指标卡契约 `step_metrics/v1`（32KB 上限 + 54 Mod 登记比对）
- [x] 双人工检查点状态机（未批准不得下发 DAG / 不得签发报告）
- [x] 报告槽位防幻觉（裸写数值、未命中槽位、非白名单图件三类拦截）
- [x] 黄金集全链复现（命令：`node tools/dev/pi_golden_case.mjs`）
- [x] 变异反证新增 3 条（m20 裸写数值 / m21 参数边界 / m22 幽灵 Mod）
- [ ] Pi CLI 二进制随包（需 `BIO_PI_CLI_BIN`，当前只随包受控配置）

## 已知边界（不算断点）

- GEO 模式的分析执行需要在算力端预置数据或可出网，当前实测到「算力端真实调度 + fail-closed 回执」为止。
- Dev Drive / 部分数据卷不解析目录联接，链接逃逸用例按 HOST_NO_SYMLINK_RESOLUTION 显式跳过（待用户裁定转正该白名单标签）。
