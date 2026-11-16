# ledger/ 统一知识台账

全局五类 JSONL（actions、changes、errors、fixes、pitfalls）的唯一落点。
追加式写入纪律与 `docs/ledger-schema.md` 契约不变。

| 路径 | 用途 |
|---|---|
| `*.jsonl` | 机器可读的追加式台账 |
| `ops_ledger.md` | 运维同步记录 |
| `pitfalls_ledger.md`、`踩坑台账.md` | 坑位与事故复盘 |
| `sync/` | 收件箱、发件箱与守护进程日志 |

历史台账条目保留写入时的路径原文，作为当时事实的证据，不随目录重构回写。

## 条目字段契约

五类 JSONL 的公共字段：`id`、`ts`、`type`、`kind`、`title`、`detail`、`evidence`。

`changes.jsonl` 与 `fixes.jsonl` 的新增条目（`ts` 不早于 2026-11-16）必须带 `acceptance`：
一条可执行的验收命令，或一个可机器核对的判据字符串。历史条目按写入时契约豁免，原文不回写。
核验命令：`node tools/dev/ledger_acceptance_gate.mjs`（已并入 `run_all_gates`）。

