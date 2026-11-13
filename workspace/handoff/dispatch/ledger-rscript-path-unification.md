# Rscript 路径统一加固台账

日期：2026-10-25

范围：算力节点 Ubuntu 容器的 Rscript 入口、工作台跨语言检测、版本清单。

结论：生产可执行文件已不再依赖 PATH 解析裸 `Rscript`。登录 shell 的裸 `Rscript` 也稳定命中 shim 并返回 R 4.5.3。非交互 SSH 的裸 `Rscript` 仍为 `NOT_FOUND`，生产脚本已不依赖该路径。

## 1. 红环与根因

修复前已实跑的命令：

```powershell
$env:NO_PROXY='localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8'
ssh -p 10022 -o ConnectTimeout=20 k40-ubuntu 'bash -lc "command -v Rscript; Rscript --version"'
```

关键输出：

```text
LOGIN_WHICH=/data/data/com.termux/files/usr/bin/Rscript
Rscript (R) version 4.6.1 (2026-06-24)
RED_LOOP_EXIT=1
```

根因确认：

1. `/etc/profile.d/termux-profile.sh` 把 基础用户空间 bin 追加到 PATH 末尾。
2. 系统 R 4.3.3 已物理删除，裸 `Rscript` 因 基础用户空间 路径回落到 R 4.6.1。
3. 非交互 SSH 不加载 `profile.d`，裸 `Rscript` 为 `NOT_FOUND`。
4. 母版脚本内存在裸 `Rscript` 与 `#!/usr/bin/env Rscript`，会继承上述不稳定解析。

## 2. 生产入口脚本

统一约定：

```bash
RSCRIPT_BIN="${BIOANALYS_RSCRIPT:-/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript}"
```

所有实际调用改为 `"$RSCRIPT_BIN"`。R 脚本 shebang 改为绝对 shim 路径。

| 绝对路径 | 修改前 | 修改后 |
|---|---|---|
| `/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py` | `subprocess.run(["Rscript", "--vanilla", ...])` | `RSCRIPT_BIN = os.environ.get("BIOANALYS_RSCRIPT", shim)`，子进程调用 `RSCRIPT_BIN` |
| `/mnt/ssd/bio_data/ops/run_throttled_task.sh` | `R|Rscript) EXEC_CMD="Rscript"` | `R|Rscript) EXEC_CMD="$RSCRIPT_BIN"` |
| `/mnt/ssd/bio_data/bin/line1_bulk/prognostic_diagnostic_roc` | `#!/usr/bin/env Rscript` | `#!/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript` |
| `/mnt/ssd/bio_data/bin/line1_bulk/survival_analysis` | `#!/usr/bin/env Rscript` | `#!/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript` |
| `/mnt/ssd/bio_data/bin/line1_bulk/probe_env` | `Rscript --version` | `"$RSCRIPT_BIN" --version` |
| `/mnt/ssd/bio_data/bin/line1_bulk/prep_matrix` | `Rscript --vanilla - <<'RSCRIPT'` | `"$RSCRIPT_BIN" --vanilla - <<'RSCRIPT'` |
| `/mnt/ssd/bio_data/bin/line1_bulk/deg_limma` | `Rscript --vanilla - <<'RSCRIPT'` | `"$RSCRIPT_BIN" --vanilla - <<'RSCRIPT'` |
| `/mnt/ssd/bio_data/bin/line1_bulk/pca_matrix` | `Rscript --vanilla - <<'RSCRIPT'` | `"$RSCRIPT_BIN" --vanilla - <<'RSCRIPT'` |
| `/mnt/ssd/bio_data/bin/line1_bulk/qc_matrix` | `Rscript --vanilla - <<'RSCRIPT'` | `"$RSCRIPT_BIN" --vanilla - <<'RSCRIPT'` |
| `/mnt/ssd/bio_data/bin/line1_bulk/wgcna_modules` | `Rscript - <<'RSCRIPT'` | `"$RSCRIPT_BIN" - <<'RSCRIPT'` |
| `/mnt/ssd/bio_data/bin/line1_bulk/enrichment_bulk` | `Rscript - <<'RSCRIPT'` | `"$RSCRIPT_BIN" - <<'RSCRIPT'` |
| `/mnt/ssd/bio_data/bin/line1_bulk/ml_hub_analysis` | `Rscript - <<'RSCRIPT'` | `"$RSCRIPT_BIN" - <<'RSCRIPT'` |
| `/mnt/ssd/bio_data/bin/line1_bulk/cox_analysis` | `Rscript - <<'RSCRIPT'` | `"$RSCRIPT_BIN" - <<'RSCRIPT'` |
| `/mnt/ssd/bio_data/bin/line1_bulk/ml_diagnostics` | `BIOANALYS_SEED="$seed" Rscript - <<'RSCRIPT'` | `BIOANALYS_SEED="$seed" "$RSCRIPT_BIN" - <<'RSCRIPT'` |
| `/mnt/ssd/bio_data/bin/line2_scrna/gsva_pathways` | `Rscript - <<'RSCRIPT'` | `"$RSCRIPT_BIN" - <<'RSCRIPT'` |

本地源文件：

```text
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\ops\verify_bridge_checkpoint.py
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\ops\run_throttled_task.sh
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line1_bulk\scripts\prognostic_diagnostic_roc
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line1_bulk\scripts\survival_analysis
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line1_bulk\scripts\probe_env
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line1_bulk\scripts\prep_matrix
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line1_bulk\scripts\deg_limma
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line1_bulk\scripts\pca_matrix
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line1_bulk\scripts\qc_matrix
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line1_bulk\scripts\wgcna_modules
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line1_bulk\scripts\enrichment_bulk
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line1_bulk\scripts\ml_hub_analysis
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line1_bulk\scripts\cox_analysis
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line1_bulk\scripts\ml_diagnostics
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line2_scrna\scripts\gsva_pathways
```

本地备份根目录：

```text
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\cn_debug\backups_20261025_rscript_path_unification
```

每个脚本的备份名称为 `<原文件名>.bak_20261025_rscript_shim`。备份已移出 `src/**/scripts/`，避免被母版全集测试当成生产脚本。

远端备份保留在目标文件旁，名称为 `<原文件名>.bak_20261025_rscript_shim`。共 15 个脚本备份：

```text
/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py.bak_20261025_rscript_shim
/mnt/ssd/bio_data/ops/run_throttled_task.sh.bak_20261025_rscript_shim
/mnt/ssd/bio_data/bin/line1_bulk/prognostic_diagnostic_roc.bak_20261025_rscript_shim
/mnt/ssd/bio_data/bin/line1_bulk/survival_analysis.bak_20261025_rscript_shim
/mnt/ssd/bio_data/bin/line1_bulk/probe_env.bak_20261025_rscript_shim
/mnt/ssd/bio_data/bin/line1_bulk/prep_matrix.bak_20261025_rscript_shim
/mnt/ssd/bio_data/bin/line1_bulk/deg_limma.bak_20261025_rscript_shim
/mnt/ssd/bio_data/bin/line1_bulk/pca_matrix.bak_20261025_rscript_shim
/mnt/ssd/bio_data/bin/line1_bulk/qc_matrix.bak_20261025_rscript_shim
/mnt/ssd/bio_data/bin/line1_bulk/wgcna_modules.bak_20261025_rscript_shim
/mnt/ssd/bio_data/bin/line1_bulk/enrichment_bulk.bak_20261025_rscript_shim
/mnt/ssd/bio_data/bin/line1_bulk/ml_hub_analysis.bak_20261025_rscript_shim
/mnt/ssd/bio_data/bin/line1_bulk/cox_analysis.bak_20261025_rscript_shim
/mnt/ssd/bio_data/bin/line1_bulk/ml_diagnostics.bak_20261025_rscript_shim
/mnt/ssd/bio_data/bin/line2_scrna/gsva_pathways.bak_20261025_rscript_shim
```

## 3. 跨语言检测联动修复

显式变量调用会改变任务引擎的调用识别，已同步修复：

| 文件 | 修改前 | 修改后 |
|---|---|---|
| `BioanalysDesktop/server/task.js` | `/(^|[\s;&|"])Rscript(?=...)/` | 同时识别 `$RSCRIPT_BIN`、`${RSCRIPT_BIN}` 与 `Rscript` |
| `BioanalysDesktop/tests/bridge_guard_invariant.test.js` | 只识别 `Rscript` | 使用同一调用集合 |
| `BioanalysDesktop/tests/task_comment_strip.test.js` | 只识别 `Rscript`，母版基线 58 | 使用同一调用集合，母版基线更新为 67 |

支撑文件的本地备份位于集中备份目录：

```text
task.js.bak_20261025_bridge_detection
bridge_guard_invariant.test.js.bak_20261025_bridge_detection
task_comment_strip.test.js.bak_20261025_bridge_detection
```

## 4. Profile 兜底

远端新增：

```text
/etc/profile.d/zz-bioanalys-shim-path.sh
```

内容：

```bash
# Keep the verified R 4.5.3 shim ahead of the 基础用户空间 R 4.6.1 fallback.
BIOANALYS_R_SHIM_DIR=/mnt/ssd/bio_data/ops/layout_autoload/bin
PATH="${BIOANALYS_R_SHIM_DIR}:${PATH}"
export PATH
unset BIOANALYS_R_SHIM_DIR
```

权限：`644 root:root`

SHA256：

```text
384a6d85f34412fb986e6512f2aca73e9b5e02877f411820453e01546fdbe05e
```

本地同源文件：

```text
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\ops\layout_autoload\zz-bioanalys-shim-path.sh
```

语法检查：`bash -n` 与 `dash -n` 均通过。

回滚动作：删除 `/etc/profile.d/zz-bioanalys-shim-path.sh`。未修改 `termux-profile.sh`。

## 5. 版本清单

修改文件：

```text
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\docs\software_versions.json
/mnt/ssd/bio_data/software_versions.json
/mnt/ssd/bio_data/ops/software_versions.json
```

本地备份：

```text
D:\00.AIagent\codespace\AI辅助生信分析流程工作台\cn_debug\backups_20261025_rscript_path_unification\software_versions.json.bak_20261025_version_drift
```

远端备份：

```text
/mnt/ssd/bio_data/software_versions.json.bak_20261025_version_drift
/mnt/ssd/bio_data/ops/software_versions.json.bak_20261025_version_drift
```

改后三份清单 SHA256 一致：

```text
cd84711f0cdc975a25888da9445538e21b44296506754fc88ea23d8666969dc1
```

解释器：

```text
R: 4.5.3, Rscript (R) version 4.5.3 (2026-03-11)
python3: 3.12.3
```

R 包实测更新：

| 包 | 旧记录 | 实际与新记录 |
|---|---:|---:|
| WGCNA | 1.74 | 1.74 |
| limma | 3.58.1 | 3.68.5 |
| ggplot2 | 4.0.3 | 4.0.3 |
| clusterProfiler | 4.10.1 | 4.20.3 |
| data.table | 1.14.10 | 1.18.6.1 |
| glmnet | 4.1.8 | 5.1 |
| survival | 3.5.8 | 3.8.12 |
| org.Hs.eg.db | 3.18.0 | 3.23.1 |
| matrixStats | 1.2.0 | 1.5.0 |
| GSVA | 1.50.5 | 1.50.5 |
| GSEABase | 1.64.0 | 1.72.0 |
| Seurat | 5.6.0, installed=true | 不可用, installed=false |
| pheatmap | 1.0.12 | 1.0.13 |
| ComplexHeatmap | 2.18.0 | 2.26.1 |
| pROC | 1.18.5 | 1.19.1 |

Python 侧核对结果：

```text
Python 3.12.3 与清单一致。
scanpy、anndata、pandas、numpy、scipy、scikit-learn、matplotlib、seaborn、
networkx、statsmodels、harmonypy、liana、pyscenic、arboreto、gseapy、
scTenifold、shap、h5py、Pillow、adjustText 均与清单一致。
scTenifold 的实际发行名是 scTenifoldpy 0.5.1，版本本身一致。
```

最终全量版本比对：

```text
VERSION_MISMATCH_COUNT=0
```

## 6. 验收证据

### 6.1 登录 shell

```text
LOGIN_PATH=/mnt/ssd/bio_data/ops/layout_autoload/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/data/data/com.termux/files/usr/bin
LOGIN_WHICH=/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript
Rscript (R) version 4.5.3 (2026-03-11)
LOGIN_ASSERT_EXIT=0
```

`--vanilla` 模板挂载：

```text
R_LIBS_USER=/opt/R/4.5.3-site-library
R version 4.5.3 (2026-03-11)
```

### 6.2 非交互 SSH

```text
NONINTERACTIVE_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
NONINTERACTIVE_WHICH=NOT_FOUND
```

生产脚本已全部显式调用 shim，不再依赖该非交互 PATH。

### 6.3 静态检查

12 个 bash 脚本 `bash -n` 全部通过。

Python AST 通过。

`prognostic_diagnostic_roc` 与 `survival_analysis` 的 R parse 通过。

11 个 bash 母版的 `RSCRIPT_BIN` 配置逐项解析为：

```text
/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript
Rscript (R) version 4.5.3 (2026-03-11)
```

### 6.4 安全实跑

`verify_bridge_checkpoint.py` 通过一次性包装器触发 shim：

```text
VERIFY_BRIDGE_EXIT=1
VERIFY_BRIDGE_SUBPROCESS_VERSION=Rscript (R) version 4.5.3 (2026-03-11)
```

退出 1 是因为输入是故意提供的无效 RDS，符合预期。

`run_throttled_task.sh` 通过最小 R 探针实跑：

```text
RUN_THROTTLED_EXIT=0
R version 4.5.3 (2026-03-11)
R_LIBS_USER=/opt/R/4.5.3-site-library
```

`prognostic_diagnostic_roc --help`：

```text
step_executed=prognostic_diagnostic_roc
prognostic_diagnostic_roc 输入契约失败: 未知参数: --help
PROGNOSTIC_EXIT=2
```

`survival_analysis --help`：

```text
step_executed=survival_analysis
survival_analysis input contract failure: unknown argument: --help
SURVIVAL_EXIT=2
```

其余母版按用户禁令未整跑，只做语法、配置解析和调用点静态验证。

### 6.5 自动化测试

相关 Node 测试：

```text
tests 66
pass 66
fail 0
```

覆盖 shim 入口、布局注入、桥接提交拦截、bridge_guard、注释剥离、双语母版集合与母版全集基线。

### 6.6 温度与 shim

实跑期间最高有效温度：

```text
34.30 C
```

低于 60 C 停止线。

shim 未被修改：

```text
576803aede2569c5efe4e7bff0887cafb3608864f17a944c0a6e994ac6d3568b
```

## 7. 最终扫描

远端精确扫描可执行文件的命令：

```bash
find /mnt/ssd/bio_data/bin /mnt/ssd/bio_data/ops /mnt/ssd/bio_data/src \
  -type f -perm /111 ! -name '*.bak_*' -print0 2>/dev/null |
  xargs -0 grep -nE '(^|[[:space:];&|])Rscript([[:space:]]|$)|/usr/bin/Rscript|/usr/bin/env[[:space:]]+Rscript'
```

最终结果只剩两处注释：

```text
/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py:108:    # RDS 需 R 侧检查，这里用 Rscript 子进程
/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript:2:# Rscript 垫片（零重写外挂的一部分）
```

广域 `grep -rn` 仍有 74 条 `Rscript` 字样，来源为显式 shim 路径、变量名、注释、测试正则和文档示例，没有生产命令位裸调用。

广域文件列表中的临时脚本：

```text
/mnt/ssd/bio_data/tmp/2026-10-25_prognostic_diagnostic_roc_acceptance.sh
```

该文件使用显式 `/opt/R/4.5.3/bin/Rscript`，不是裸调用，也不在生产 `bin/ops/src` 扫描范围内。

本地扫描结论相同。剩余裸字符串只在测试、README 与报告示例中：

```text
BioanalysDesktop/tests/* 的检测正则与负向用例
src/line1_bulk/scripts/README.md 的 shebang 示例
ops/render_report_html.py 的展示代码字符串
```

按“不要改 README”的交付纪律，README 未改。

## 8. 遗留项

非交互 SSH 的裸 `Rscript` 仍为 `NOT_FOUND`。生产脚本已通过显式 `RSCRIPT_BIN` 消除依赖，因此当前不阻塞。

如需让非交互 SSH 也自动命中 shim，可选方案是给 `k40-ubuntu` 服务账号配置 `BASH_ENV=/etc/profile.d/zz-bioanalys-shim-path.sh`。可选落点：

1. 引擎侧远端命令显式注入 `BASH_ENV`，影响面最小。
2. SSH 服务端 `Match User` 下设置 `SetEnv BASH_ENV=...`，需要改 sshd 配置并重载。
3. `~/.ssh/environment` 配合 `PermitUserEnvironment yes`，影响面较大且涉及安全策略。

本次未改 SSH 服务端配置，留给主代理决策。
