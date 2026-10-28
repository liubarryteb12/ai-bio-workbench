# Encoding audit report

Scanned at: 2026-10-25T11:52:24+08:00
Root: D:\00.AIagent\codespace\AI辅助生信分析流程工作台
Excluded top-level dirs: .git, node_modules, __pycache__, .venv, venv, outputs, artifacts, .codex, .agents, .tmp, .Temp, cache, snapshots, encoding_backup, encoding_backup_20261024
Skipped binary by extension: 273
Skipped files over 20971520 bytes: 2
Files scanned: 1375
Files needing action: 0

## Per top-level directory

| directory | files | needing action |
| --- | --- | --- |
| _archive | 3 | 0 |
| .claude | 1 | 0 |
| .gitattributes | 1 | 0 |
| .gitignore | 1 | 0 |
| .probe_gmt.sh | 1 | 0 |
| .probe_l2s.sh | 1 | 0 |
| .probe_l2s2.sh | 1 | 0 |
| .run_backup.sh | 1 | 0 |
| .run_new.sh | 1 | 0 |
| .run_v2.sh | 1 | 0 |
| .tmp_probe.sh | 1 | 0 |
| 项目交付报告.html | 1 | 0 |
| AGENTS.md | 1 | 0 |
| aims | 4 | 0 |
| bin | 1 | 0 |
| BioanalysDesktop | 105 | 0 |
| cn_debug | 316 | 0 |
| con_hf | 120 | 0 |
| deliverables | 4 | 0 |
| docs | 19 | 0 |
| locale_negative_check.log | 1 | 0 |
| ops | 46 | 0 |
| portal | 6 | 0 |
| project_data | 95 | 0 |
| reference | 544 | 0 |
| shared | 2 | 0 |
| src | 89 | 0 |
| start_all.bat | 1 | 0 |
| start_portal.bat | 1 | 0 |
| start_workbench.bat | 1 | 0 |
| test_use_data | 5 | 0 |

## Action totals


## Priority counts

- P0: 0
- P2: 0
- P3: 0

## Detail

Full list in encoding-audit-detail.tsv. Priority P0 covers src, ops and
BioanalysDesktop, which affect the dual-plane runtime directly. P2 covers
reference material. P3 covers docs and root files. Rows with action
encoding_needs_manual_review are non-UTF8 but do not look like GBK, so
converting them blind would risk data loss; review those first.

## Notes

Encoding detection uses strict UTF-8 decoding. Files that fail are then
scored for GBK likeness by counting high-byte pairs, which is a heuristic,
not a proof. Treat the manual-review rows as unverified.