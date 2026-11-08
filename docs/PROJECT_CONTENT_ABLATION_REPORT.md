# 项目内容消融实验报告

日期 2026-11-08｜目标项目 `PRJ_DCM_BENCH_20261105`｜隔离根 `.tmp/project_content_ablation/<run_id>/`

> 本实验只在 `.tmp/project_content_ablation/` 的临时副本上删除内容。真实 `local_projects` 未改动，母版未改动，生信分析代码未重跑。

## 1. 方法与边界

- 每个消融场景独立建一份最小骨架副本，副本位于 `.tmp/project_content_ablation/<run_id>/scenarios/<scenario>/local_projects/PRJ_DCM_BENCH_20261105/`。
- 骨架包含 `project.json`、三条线的 PNG 名称、`FIGURE_SOURCE_MANIFEST.tsv`、`README_FIGURE_SOURCES.md`、`BENCHMARK_REPORT.md`、`INTEGRATED_REPORT.md`、`FINAL_SEAL_REPORT.md`，以及 `scripts/resume_benchmark.sh`（存在时复制）。已退役组图会显式补出占位文件，确保组图消融场景有物可删。
- PNG 默认写成声明 300 DPI 的 tiny 占位图；设置 `ABLATION_COPY_REAL_PNGS=1` 可改为复制少量真实 PNG，复制上限由 `ABLATION_MAX_REAL_PNGS` 控制。
- 项目发现判据复刻 `listLocalProjectsWithMeta` 的目录扫描与 `project.json` 读取逻辑，不启动服务。
- 来源清单判据复刻 `/api/figures/source_manifest` 的固定路径读取行为，两份文件都缺失时返回 `ok=false`。
- 出图门禁用 `node ops/figure_spec_gate.mjs --dir <临时项目相对路径>` 实际执行。
- 报告构建独立性用静态读取 `ops/build_client_report.py` 判定，不产生交付包。

## 2. 消融场景总览

| 场景 | 删除内容 | a 项目发现 | b 图件清单 | c 来源清单 | d 出图门禁 | e 报告构建 | 结论 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `old_reports` | BENCHMARK_REPORT.md<br>INTEGRATED_REPORT.md | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 |
| `legacy_figures` | line3_spatial/l3_mouse_05_knockout_dr.png<br>line3_spatial/l3_mouse_10_dr_gsea_top.png<br>line3_spatial/l3_mouse_11_dr_overlap.png<br>line3_spatial/l3_mouse_12_ora_top.png<br>line3_spatial/l3_mouse_13_gsea_top.png | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 |
| `composite_figures` | line1_bulk/l1_32_deg_overview.png<br>line3_spatial/l3_mouse_16_domain_panel.png | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 |
| `source_config` | line3_spatial/FIGURE_SOURCE_MANIFEST.tsv<br>line3_spatial/README_FIGURE_SOURCES.md | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 |
| `old_ssh_runner` | scripts/resume_benchmark.sh | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 |

## 3. 逐场景明细

### 3.1 `old_reports`：删除旧报告

- 删除内容：`BENCHMARK_REPORT.md`、`INTEGRATED_REPORT.md`
- 验证 0（目标内容已删除）：通过。BENCHMARK_REPORT.md, INTEGRATED_REPORT.md
- 验证 a（项目仍可被发现）：通过。project.json 可读，project_id=PRJ_DCM_BENCH_20261105
- 验证 b（剩余图件不含已删除文件且至少单图）：通过。剩余 95 张，已删除 2 项
- 验证 c（来源清单接口可读且不抛异常）：通过。ok=true
- 验证 d（出图门禁不因少图误判）：通过。exit=0，FIGURE_SPEC_OK，扫描 95 张 PNG
- 验证 e（报告构建不依赖旧报告名）：通过。引用 project.json / ledgers / 实际产物，未引用 BENCHMARK_REPORT.md 或 INTEGRATED_REPORT.md
- 场景结论：通过

### 3.2 `legacy_figures`：删除 legacy 图件

- 删除内容：`line3_spatial/l3_mouse_05_knockout_dr.png`、`line3_spatial/l3_mouse_10_dr_gsea_top.png`、`line3_spatial/l3_mouse_11_dr_overlap.png`、`line3_spatial/l3_mouse_12_ora_top.png`、`line3_spatial/l3_mouse_13_gsea_top.png`
- 验证 0（目标内容已删除）：通过。line3_spatial/l3_mouse_05_knockout_dr.png, line3_spatial/l3_mouse_10_dr_gsea_top.png, line3_spatial/l3_mouse_11_dr_overlap.png, line3_spatial/l3_mouse_12_ora_top.png, line3_spatial/l3_mouse_13_gsea_top.png
- 验证 a（项目仍可被发现）：通过。project.json 可读，project_id=PRJ_DCM_BENCH_20261105
- 验证 b（剩余图件不含已删除文件且至少单图）：通过。剩余 90 张，已删除 5 项
- 验证 c（来源清单接口可读且不抛异常）：通过。ok=true
- 验证 d（出图门禁不因少图误判）：通过。exit=0，FIGURE_SPEC_OK，扫描 90 张 PNG
- 验证 e（报告构建不依赖旧报告名）：通过。引用 project.json / ledgers / 实际产物，未引用 BENCHMARK_REPORT.md 或 INTEGRATED_REPORT.md
- 场景结论：通过

### 3.3 `composite_figures`：删除组图

- 删除内容：`line1_bulk/l1_32_deg_overview.png`、`line3_spatial/l3_mouse_16_domain_panel.png`
- 验证 0（目标内容已删除）：通过。line1_bulk/l1_32_deg_overview.png, line3_spatial/l3_mouse_16_domain_panel.png
- 验证 a（项目仍可被发现）：通过。project.json 可读，project_id=PRJ_DCM_BENCH_20261105
- 验证 b（剩余图件不含已删除文件且至少单图）：通过。剩余 93 张，已删除 2 项
- 验证 c（来源清单接口可读且不抛异常）：通过。ok=true
- 验证 d（出图门禁不因少图误判）：通过。exit=0，FIGURE_SPEC_OK，扫描 93 张 PNG
- 验证 e（报告构建不依赖旧报告名）：通过。引用 project.json / ledgers / 实际产物，未引用 BENCHMARK_REPORT.md 或 INTEGRATED_REPORT.md
- 场景结论：通过

### 3.4 `source_config`：删除旧来源配置

- 删除内容：`line3_spatial/FIGURE_SOURCE_MANIFEST.tsv`、`line3_spatial/README_FIGURE_SOURCES.md`
- 验证 0（目标内容已删除）：通过。line3_spatial/FIGURE_SOURCE_MANIFEST.tsv, line3_spatial/README_FIGURE_SOURCES.md
- 验证 a（项目仍可被发现）：通过。project.json 可读，project_id=PRJ_DCM_BENCH_20261105
- 验证 b（剩余图件不含已删除文件且至少单图）：通过。剩余 95 张，已删除 2 项
- 验证 c（来源配置缺失时 ok=false 且不抛异常）：通过。ok=false，本地图件来源清单不存在（FIGURE_SOURCE_MANIFEST.tsv / README_FIGURE_SOURCES.md）
- 验证 d（出图门禁不因少图误判）：通过。exit=0，FIGURE_SPEC_OK，扫描 95 张 PNG
- 验证 e（报告构建不依赖旧报告名）：通过。引用 project.json / ledgers / 实际产物，未引用 BENCHMARK_REPORT.md 或 INTEGRATED_REPORT.md
- 场景结论：通过

### 3.5 `old_ssh_runner`：删除旧 SSH runner

- 删除内容：`scripts/resume_benchmark.sh`
- 验证 0（目标内容已删除）：通过。scripts/resume_benchmark.sh
- 验证 a（项目仍可被发现）：通过。project.json 可读，project_id=PRJ_DCM_BENCH_20261105
- 验证 b（剩余图件不含已删除文件且至少单图）：通过。剩余 95 张，已删除 1 项
- 验证 c（来源清单接口可读且不抛异常）：通过。ok=true
- 验证 d（出图门禁不因少图误判）：通过。exit=0，FIGURE_SPEC_OK，扫描 95 张 PNG
- 验证 e（报告构建不依赖旧报告名）：通过。引用 project.json / ledgers / 实际产物，未引用 BENCHMARK_REPORT.md 或 INTEGRATED_REPORT.md
- 场景结论：通过

## 4. 报告构建独立性（全局 e）

- 静态读取 `ops/build_client_report.py`。
- 读取 project.json：是
- 读取台账 ledgers：是
- 读取 results/ 产物：是
- 读取 processed/ 产物：是
- 读取 figures/ 产物：是
- 未引用 `BENCHMARK_REPORT.md` 与 `INTEGRATED_REPORT.md`：是

## 5. 结论

五个消融场景全部通过。删除旧报告、legacy 图件、组图、旧来源配置与旧 SSH runner 后，项目仍可被发现，剩余图件清单自洽，来源清单接口在配置缺失时返回 `ok=false` 而不抛异常，出图门禁不因少图误判，报告构建不依赖两份旧报告名。

这说明本次消融针对的是项目内容，不是生信分析功能。分析产物、图件与门禁判据保持独立。

PROJECT_CONTENT_ABLATION_OK
