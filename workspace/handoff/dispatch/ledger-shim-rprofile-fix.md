# 算力节点 Rscript shim 与 Rprofile 修复台账

日期：2026-10-25

状态：任务 A、任务 B 通过，任务 C 已扫描并完成允许范围内的生产入口修复，剩余 PATH 与裸命令统一方案待主代理决策。

## 根因

### A. shim 未注入 profile

`/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript` 原先只导出 `R_LIBS_USER`，没有导出 `R_PROFILE_USER`。任务引擎会注入该变量，但直接调用 shim 时不会。

修复后 shim 固定：

```bash
REAL_RSCRIPT="/opt/R/4.5.3/bin/Rscript"
export R_LIBS_USER=/opt/R/4.5.3-site-library
export R_PROFILE_USER=/mnt/ssd/bio_data/ops/layout_autoload/Rprofile
```

### B. 模板应用存在两个独立失败点

第一个失败点是 helper 的自动倾斜判断：

```r
if (length(labels) > LAYOUT_MANY_LABELS &&
    max(nchar(labels), 0) > LAYOUT_LONG_LABEL_CHARS)
```

当 x 轴标签含 `NA` 时，`max(nchar(labels), 0)` 返回 `NA`，触发 `missing value where TRUE/FALSE needed`。接手时工作区与 算力节点 已有未提交的 `apply_layout_safely()` 补丁，本次保留该补丁并用最小用例复验。

第二个失败点是 `ggsave` 未传 `width/height` 时的零长度参数：

```r
cur_w <- suppressWarnings(as.numeric(override$width))
cur_h <- suppressWarnings(as.numeric(override$height))
if (is.na(cur_w)) ...
```

`as.numeric(NULL)` 返回 `numeric(0)`，`is.na(numeric(0))` 返回 `logical(0)`，因此 `if` 报 `argument is of length zero`。这是主代理复测命中的真实根因。

修复：

```r
as_optional_number <- function(value) {
  if (length(value) == 0L) return(NA_real_)
  suppressWarnings(as.numeric(value[1]))
}
cur_w <- as_optional_number(override$width)
cur_h <- as_optional_number(override$height)
```

降级行为保留：模板应用异常时仍 warning，并调用原始 `ggsave` 按原样落盘。

## 改动文件

本地工作区：

- `D:\00.AIagent\codespace\AI辅助生信分析流程工作台\ops\layout_autoload\bin\Rscript`
- `D:\00.AIagent\codespace\AI辅助生信分析流程工作台\ops\layout_autoload\Rprofile`
- `D:\00.AIagent\codespace\AI辅助生信分析流程工作台\ops\00_link_check.ps1`
- `D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\server\link.js`
- `D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\tests\r_runtime_entry.test.js`

算力节点：

- `/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript`
- `/mnt/ssd/bio_data/ops/layout_autoload/Rprofile`

关键 diff：

```diff
 REAL_RSCRIPT="/opt/R/4.5.3/bin/Rscript"
 export R_LIBS_USER=/opt/R/4.5.3-site-library
+export R_PROFILE_USER=/mnt/ssd/bio_data/ops/layout_autoload/Rprofile
```

```diff
-cur_w <- suppressWarnings(as.numeric(override$width))
-cur_h <- suppressWarnings(as.numeric(override$height))
+as_optional_number <- function(value) {
+  if (length(value) == 0L) return(NA_real_)
+  suppressWarnings(as.numeric(value[1]))
+}
+cur_w <- as_optional_number(override$width)
+cur_h <- as_optional_number(override$height)
```

```diff
-'/usr/bin/Rscript --version 2>&1 | head -1',
+'/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript --version 2>&1 | head -1',
```

## 备份与哈希

修改前备份：

| 文件 | sha256 |
|---|---|
| `/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript.bak_20261025_shim_rprofile_fix` | `9277eb6a2c5b6314f2d8d319077e6c8f28e47212b5146b93af43e51f6814161e` |
| `/mnt/ssd/bio_data/ops/layout_autoload/Rprofile.bak_20261025_shim_rprofile_fix` | `1a591b668552da48411fc2119599a91be5b2d1d2c41a30bf3757447cbec6c8db` |

修复后：

| 文件 | sha256 |
|---|---|
| `/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript` | `576803aede2569c5efe4e7bff0887cafb3608864f17a944c0a6e994ac6d3568b` |
| `/mnt/ssd/bio_data/ops/layout_autoload/Rprofile` | `a87edfa8b519c2e8e83fd8e7e7371e4a21e9267733fd3342f93fea0383c61d80` |

本地与 算力节点 两份修复文件哈希一致。shim 权限为 `755`。

## 验收证据

### 1. shim 注入 R_PROFILE_USER

```bash
BIOANALYS_PROJECT_JSON=/mnt/ssd/bio_data/projects/PRJ_E2E_GSE277173/project.json \
/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript \
  -e 'cat(R.version.string, "\n"); cat(Sys.getenv("R_PROFILE_USER"), "\n")'
```

关键输出：

```text
[layout_autoload] 已挂载出图模板：template_2_cell_wide
R version 4.5.3 (2026-03-11)
/mnt/ssd/bio_data/ops/layout_autoload/Rprofile
```

说明：`R_PROFILE_USER` 是环境变量，不是 R 对象。原始写法 `cat(R_PROFILE_USER)` 会报 `object 'R_PROFILE_USER' not found`，验收应使用 `Sys.getenv("R_PROFILE_USER")`。

### 2. shim 下 R 版本

```text
R version 4.5.3 (2026-03-11)
```

### 3. --vanilla 兼容性

```bash
BIOANALYS_PROJECT_JSON=/mnt/ssd/bio_data/projects/PRJ_E2E_GSE277173/project.json \
/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript --vanilla \
  -e 'cat(Sys.getenv("R_PROFILE_USER"), "|", R.version.string, "\n", sep="")'
```

关键输出：

```text
[layout_autoload] 已挂载出图模板：template_2_cell_wide
/mnt/ssd/bio_data/ops/layout_autoload/Rprofile|R version 4.5.3 (2026-03-11)
```

采用修法：shim 将 `--vanilla` 替换为 `--no-save --no-restore --no-site-file --no-environ`。实测该组合保留 shim 自己导出的 `R_PROFILE_USER`，同时不读站点文件与环境文件。

### 4. 主代理最小用例

project.json：

```json
{"plot_layout_config": {"template_id": "template_1_nature_side"}}
```

R 调用不传 `width/height`：

```r
ggsave(png, p, device="png", type="cairo")
```

修复后关键输出：

```text
[layout_autoload] 已挂载出图模板：template_1_nature_side
R_EXIT=0
MARKER=PRESENT
TEMPLATE_APPLY=OK
PNG_DIM=2160x1620
143b06722e870c3b781da83c16448f32b1adf15d31d0cc74fc47f5d94c2378e5  /tmp/layout_min_project_20261025.png
```

修复前同一用例：

```text
[layout_autoload] 已挂载出图模板：template_1_nature_side
Saving 7 x 7 in image
Warning message:
[layout_autoload] 应用模板失败，按原样落盘：argument is of length zero
TEMPLATE_APPLY=FAIL
PNG_DIM=2100x2100
```

### 5. NA 标签回归

直接调用 helper 可稳定复现原 warning：

```text
[1] "2" NA  "3" "4" "5" NA  NA
Error in if (length(labels) > LAYOUT_MANY_LABELS && max(nchar(labels),  :
  missing value where TRUE/FALSE needed
```

经 Rprofile 包装后，同一含 `NA` 标签的最小 ggplot 无“应用模板失败”，模板名正常输出。

### 6. 测试

定向测试：

```text
node --test tests/r_runtime_entry.test.js tests/link.test.js
tests 8
pass 8
fail 0
```

链路检查：

```text
环节4 容器 sshd  PASS  Rscript (R) version 4.5.3 (2026-03-11)
[link-check] 总体 = PASS
```

完整 `npm test`：

```text
tests 859
pass 852
fail 7
```

7 个失败均来自本轮开始前已存在的未跟踪母版与注册表数量不一致，包括 `prognostic_diagnostic_roc` 缺严格模式、8 个新增母版缺 seed/参数契约、8 个母版未登记 workflows.json、母版总数断言 62/54 与 66/58 不一致。它们不在本次 shim/Rprofile 修改面内。

## 4.3.3 残留清单

全库扫描命令：

```bash
grep -rn "4\.3\.3" /mnt/ssd/bio_data/ 2>/dev/null
```

结果：`147` 行匹配，`121` 个唯一文件，退出码 `0`。stderr 另有 `8` 个历史 PDF 的二进制命中。

### 已直接修复的生产残留

| 文件 | 行号 | 当前值 | 建议值 |
|---|---:|---|---|
| `BioanalysDesktop/server/link.js` | 88 | `/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript --version` | 已修复，无后续动作 |
| `ops/00_link_check.ps1` | 89 | `/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript --version` | 已修复，无后续动作 |
| `ops/layout_autoload/bin/Rscript` | 11 | `/opt/R/4.5.3/bin/Rscript` | 已固定，无后续动作 |

远端 `/mnt/ssd/bio_data/bin/` 与 `/mnt/ssd/bio_data/ops/` 扫描 `/usr/bin/Rscript`、`/usr/lib/R` 均为 0 条。

### 环境声明

| 文件 | 行号 | 当前值 | 建议值 |
|---|---:|---|---|
| `/mnt/ssd/bio_data/envs/line1_bulk/manifest.txt` | 8 | `version=4.5.3` | 保持 |
| `/mnt/ssd/bio_data/envs/line2_scrna/manifest.txt` | 8 | `version=3.12.3` | 保持，Python 线 |
| `/mnt/ssd/bio_data/envs/line3_spatial/manifest.txt` | 8 | `version=3.12.3` | 保持，Python 线 |

### PATH 与系统 R 状态

| 项目 | 当前状态 | 建议值 |
|---|---|---|
| 直接非交互 SSH 的 PATH | `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` | 生产任务继续由 `task.js` 注入 shim PATH |
| 直接非交互 SSH 的裸 `Rscript` | `NOT_FOUND` | 由任务引擎注入，或主代理决定全局 PATH 方案 |
| 登录 shell 的裸 `Rscript` | `/data/data/com.termux/files/usr/bin/Rscript`，R 4.6.1 | 禁止命中 基础用户空间 R，建议在 profile 中把 shim 目录前置 |
| `/etc/profile.d/termux-profile.sh` | 第 3 行把 基础用户空间 `bin` 追加到 PATH | 建议新增 `/etc/profile.d/10-rscript-shim.sh`，执行 `export PATH="/mnt/ssd/bio_data/ops/layout_autoload/bin:${PATH}"` |
| `/root/.bashrc`、`/root/.profile`、`/etc/profile` | 无 shim PATH 注入 | 如决定修登录态，统一放一个新的 profile 文件 |
| `/usr/bin/R` | 物理缺失 | 无需清理 |
| `/usr/bin/Rscript` | 物理缺失 | 无需清理 |
| `/usr/lib/R` | 物理缺失 | 已物理删除 |
| `/usr/lib/R/bin/Rscript` | 物理缺失 | 已物理删除 |
| `dpkg r-base-core` | 无已安装记录 | 系统 R 4.3.3 已物理移除，不只是 PATH 绕过 |

### 版本清单残留

| 文件 | 行号 | 当前值 | 建议值 |
|---|---:|---|---|
| `/mnt/ssd/bio_data/software_versions.json` | 20 | `"version": "4.3.3"` | 替换为 `/mnt/ssd/bio_data/ops/software_versions.json` 的 4.5.3 内容 |
| `/mnt/ssd/bio_data/software_versions.json` | 21 | `"version_raw": "Rscript (R) version 4.3.3 (2024-02-29)"` | 同步为 4.5.3 |

根目录副本是 `build_client_report.py` 的第三候选，当前首选 `/mnt/ssd/bio_data/ops/software_versions.json` 已是 4.5.3，因此生产优先路径正常，但根目录旧副本仍是漂移风险。

### 历史备份

| 文件 | 行号 | 当前值 | 建议值 |
|---|---:|---|---|
| `/mnt/ssd/bio_data/ops/_bak_20261021/build_client_report.py.bak` | 2018 | `"version": "4.3.3"` | 保留作历史回滚，不参与生产 |
| `/mnt/ssd/bio_data/ops/software_versions.json.bak_20261024_r453` | 20 | `"version": "4.3.3"` | 保留作升级前快照 |
| `/mnt/ssd/bio_data/ops/software_versions.json.bak_20261024_r453` | 21 | `"version_raw": "...4.3.3..."` | 保留作升级前快照 |
| `/mnt/ssd/bio_data/ops/build_client_report.py.bak_20261024_r453` | 2066 | `"version": "4.3.3"` | 保留作升级前快照 |
| `/mnt/ssd/bio_data/envs/line1_bulk/manifest.txt.bak_20261024_r453` | 8 | `version=4.3.3` | 保留作升级前快照 |

### 历史台账与交付物

| 类别 | 数量 | 当前值 | 建议值 |
|---|---:|---|---|
| `/mnt/ssd/bio_data/system_logs/*.json` | 107 行 | 历史任务 `environment.r.version=4.3.3`，行号 10 或 11 | 不改历史台账 |
| `/mnt/ssd/bio_data/system_logs/` 非 JSON 日志 | 3 行 | 构建日志与库清单中的 4.3.3 | 保留为迁移证据 |
| 交付报告 | 4 个文件，28 行 | `Analysis_Report.md/html` 记录历史 R 4.3.3 | 如需重新交付则重新生成，不改历史产物 |
| 历史 PDF 图件 | 8 个二进制命中 | PDF 内含历史 R 版本信息 | 重新出图时自然更新 |

### 数据误命中

| 文件 | 行号 | 当前值 | 建议值 |
|---|---:|---|---|
| `/mnt/ssd/bio_data/projects/default/line1_bulk/raw_data/GPL11532-32230.txt` | 16472 | 注释中含 `14-3-3 protein eta` | 忽略，不是 R 4.3.3 |
| `/mnt/ssd/bio_data/projects/PRJ_E2E_GSE277173/line1_bulk/raw_data/GPL11532-32230.txt` | 16472 | 注释中含 `14-3-3 protein eta` | 忽略，不是 R 4.3.3 |

### 仍需主代理决策的裸 Rscript

| 文件 | 行号 | 当前值 | 建议值 |
|---|---:|---|---|
| `/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py` | 144 | `subprocess.run(["Rscript", "--vanilla", ...])` | 默认 `RSCRIPT_BIN=/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript`，允许环境变量覆盖 |
| `/mnt/ssd/bio_data/ops/run_throttled_task.sh` | 75 | `EXEC_CMD="Rscript"` | 脚本路径模式改为绝对 shim，命令串模式继续使用引擎注入 PATH |
| `/mnt/ssd/bio_data/bin/line1_bulk/prognostic_diagnostic_roc` | 1 | `#!/usr/bin/env Rscript` | 改为 shim 绝对路径，或统一由引擎 PATH 保证 |

以下母版直接调用裸 `Rscript`，当前依赖 `task.js` 注入的 PATH，建议后续统一为 `RSCRIPT_BIN`：

```text
/mnt/ssd/bio_data/bin/line1_bulk/probe_env:29
/mnt/ssd/bio_data/bin/line1_bulk/prep_matrix:112
/mnt/ssd/bio_data/bin/line1_bulk/deg_limma:62
/mnt/ssd/bio_data/bin/line1_bulk/pca_matrix:57
/mnt/ssd/bio_data/bin/line1_bulk/qc_matrix:59
/mnt/ssd/bio_data/bin/line1_bulk/wgcna_modules:72
/mnt/ssd/bio_data/bin/line1_bulk/enrichment_bulk:67
/mnt/ssd/bio_data/bin/line1_bulk/ml_hub_analysis:118
/mnt/ssd/bio_data/bin/line1_bulk/cox_analysis:46
/mnt/ssd/bio_data/bin/line1_bulk/ml_diagnostics:536
/mnt/ssd/bio_data/bin/line2_scrna/gsva_pathways:194
```

## 温度

修复与扫描前实测有效热区最高 `31.002°C`，收尾复测最高 `32.072°C`，低于 60 度停机阈值。

## 清理

所有临时 JSON 与 PNG 已删除。全库扫描临时文件在结果读取和统计完成后删除。
