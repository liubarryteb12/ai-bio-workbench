# skills/ SOP 规约资产

把 SOP 从 `docs/*.md` 逐步转成机器可读规约。每个技能一个目录，内含 `skill.yaml`
与 `prompt.md`。`stable/` 是已验收资产，`in-progress/` 是孵化中资产。

## 目录约定

| 路径 | 含义 |
|---|---|
| `skills/stable/<category>/<name>/skill.yaml` | 机器可读规约 |
| `skills/stable/<category>/<name>/prompt.md` | 执行指令与输出格式 |
| `skills/in-progress/` | 未验收草稿 |

## 字段约定

`skill.yaml` 字段固定为 `name`、`version`、`status`、`invocation_mode`、`category`、
`title`、`description`、`required_references`、`allowed_tools`、`verify_commands`、
`exit_criteria`、`negative_constraints`。

`required_references` 与 `allowed_tools` 写仓库相对路径，门禁逐条验证目标存在。
`verify_commands` 的第一条是主验收入口。`exit_criteria` 与对应门禁的检查项一一对应。

## 验收

```powershell
node tools/dev/skills_contract_gate.mjs
```

通过哨兵 `SKILLS_CONTRACT_GATE_OK`。门禁校验 YAML 结构、必填字段、引用路径、
prompt 配套与工单 skill 的 exit_criteria 和门禁检查项双射。
