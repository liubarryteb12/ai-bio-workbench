# skills/stable/ops/

运维域已验收 SOP 规约。

| 技能 | 说明 | 源规范 | 验收入口 |
|---|---|---|---|
| `work_order` | 结构化工单自动执行与验收 | `docs/WORK_ORDER_ORCHESTRATOR.md` | `tools/dev/work_order_orchestrator_gate.mjs` |

新增技能先落 `skill.yaml` 与 `prompt.md`，再跑 `node tools/dev/skills_contract_gate.mjs`。
