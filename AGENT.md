# AI 入职入口（AGENT.md）

本文件是参考结构兼容入口。AI 执行纪律与导航的真源是根目录 `AGENTS.md`，
它由工具链自动加载并每轮进上下文。接手任何任务先读 `AGENTS.md`，再按
`INDEX.yaml` 导航。

## 接手任务的标准动作

1. 读 `AGENTS.md` 与 `INDEX.yaml`，确认当前主线、真源文件与可用门禁；
2. 读 `TODO.md` 的当前主线，确认需求与完成判据；
3. 动手前向用户对齐三问，答不清就先问：
   - 输入：读哪些文件或数据，路径是什么；
   - 产物：改哪些文件或产出什么，落点在哪；
   - 验收：哪条机器命令 Exit code 0 才算做完（优先复用 `tools/dev/run_all_gates.mjs` 与既有测试）。
4. 中间文件写在 `.tmp/` 或 `workspace/`，根目录与只读区保持整洁；
5. 交付前跑验收命令并贴出真实结果，再按 `AGENTS.md` 做一次自我 review。

台账登记同样带验收判据：`ledger/` 下新增 `changes` 与 `fixes` 条目按
`ledger/README.md` 的 `acceptance` 字段填写，`node tools/dev/ledger_acceptance_gate.mjs` 逐条核对。

