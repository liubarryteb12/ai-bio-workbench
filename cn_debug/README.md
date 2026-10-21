# cn_debug/ — 调试与验证工作区（非运行时代码）

> 本目录**不参与任何运行时链路**：没有任何生产脚本 import / source 这里的文件。
> 性质：一次性探针、验证脚本、审计 CSV、调试数据、临时日志。
> 建档索引：2026-10-21（B2 落地的替代措施——不搬家，建索引）。

## 使用规则

1. **新增探针必须登记**到本文件对应分区，写清"验证什么 / 结论 / 是否可删"。
2. 命名沿用 `YYYY-MM-DD_<类别>_<主题>.<ext>`，类别取 `debug` / `verification` / `e2e` / `probe`。
3. `*.log` 已被 `.gitignore` 忽略（第 52 行），可随时删除，不进版本库。
4. 判决证据（审计 CSV、负对照样本、验证脚本）**不许删**——`con_hf/dispatch/` 的报告按文件名逐条引用。

## 一、判决证据（保留，勿删）

| 文件 | 用途 | 引用处 |
|---|---|---|
| `figure_audit_all.csv` / `figure_audit_line1.csv` / `figure_score.csv` | 137 张图的布局审计与评分底表 | `con_hf/dispatch/` 出图相关报告、`docs/figure_spec.md` |
| `figure_score.py` / `figure_code_audit.py` / `figure_audit_scan.py` | 上述底表的生成器 | 同上 |
| `figure_negctrl/`、`figure_audit_sweep/`、`is_fig_audit/` | 负对照样本与逐轮审计产物 | 出图规范验收记录 |
| `GSE30528_*`、`GPL571.*`、`build_gpl571.py` | 线 1 外部验证集原始数据与注释探针（约 18MB） | `con_hf/` 数据集调研、外部验证集冻结评估 |
| `s10_before_*.md5` | 改动前产物指纹（可复算回归） | S10 报告 |

## 二、验证脚本（按切片归档，跑过的都留）

| 前缀 | 覆盖 | 代表文件 |
|---|---|---|
| `2026-10-18_verification_*` | 门户/归档包/数据文件部署/布局模板/双模式提交 | `2026-10-18_verification_archive_package.mjs`、`..._layout_autoload.py` |
| `2026-10-19_*` | 布局映射、WGCNA v1/v10、客户端提交 E2E、S11 报告版本采集 | `2026-10-19_verification_wgcna_v1_v10.mjs` |
| `2026-10-20_verification_*` | 出图 G1/G2 校准、S19 门户上传、S20 上传上限、S24 接单 E2E、S26 台账 E2E、S27 报告 E2E、S28 桥接 | `2026-10-20_verification_s28_bridge.mjs` |
| `2026-10-21_verification_*` | S30 白名单三端一致性 | `2026-10-21_verification_s30_whitelist.mjs` |
| `_s28_*`、`_s31_probe_state_db.py` | S28 桥接取证、S31 台账归因探针（只读） | `_s28_forensic.sh` |

## 三、一次性调试探针（可删，保留仅为查史）

| 前缀 | 说明 |
|---|---|
| `2026-10-13_*` / `2026-10-14_debug_*` | 早期 SCENIC / 单细胞 / 出图能力探测（`s3_*`、`s4_*`、`s5*` 系列原型脚本同属此类） |
| `2026-10-19_verify_step_catalog.py`、`2026-10-20_debug_s16_*`、`2026-10-20_s17_measure.py` | 步骤目录、配色普查、几何测量的一次性探针 |
| `check_heredoc_syntax.py`、`check_py_syntax.py`、`pyflakes_check.py`、`undef_check.py` | 语法/未定义变量静态检查小工具（可随时重写） |
| `*_prototype.R`、`s3_*_prototype.py` | 三线母版脚本的原型稿，已被 `src/<line>/scripts/` 取代 |

## 四、目录

| 目录 | 内容 |
|---|---|
| `2026-10-20_*`、`2026-10-19_before_s*` 等 | 各切片的改动前快照 |
| `samples/`、`figures/`、`theme_demo/` | 出图样例与主题演示 |
| `ops_legacy_2026-10-20/` | ops 侧历史脚本备份 |
| `s24_e2e_tmp/` | S24 接单 E2E 临时工作区（可删） |

## 五、已清理记录

- 2026-10-21（B1）：删除 `*.log` 21 个共 486KB（`subagent_*`、`figure_audit_sweep_subagent_*`、`serve_guard.log`、`workbench_*.log`、`portal_server.log` 等）与 `__pycache__` 7 个共 532KB。
- 更早：`scenic_db/`（689MB，SCENIC 参考库，0 引用）已不存在。
