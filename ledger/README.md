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
