# BLKR-01 真机冒烟证据（2026-11-15）

## 1. 算力面修复

- 发现 `/opt/R/4.5.3-site-library` 下 43,228 个包文件全是指向空目录 `/.l2s` 的断链，`library(limma)` 直接失败。
- 用冷备卷 `_coldbackup/v1_opt_R.tar.gz` 恢复：SHA256 校验 `a17925f2...` 通过，解包 2 分 25 秒。
- 恢复后 `limma 3.68.5` 可加载；Python venv 的 numpy / pandas / scipy / scanpy 均可导入。

## 2. 算力面同源

- `run_throttled_task.sh`：仓库与真机均为 `c561f4c76849350bb875a4d7310de8fa54026b71c2673cbf66a912c13a03f468`。
- `core/mem_guard.py`：仓库与真机均为 `255df110b9b7768bc8bb84cf913af0a20520c8f916a25acefaa190265090affa`。
- 同步前真机包装器是 11 月 6 日的旧版（17,359 字节），无 6.5GB 档位。

## 3. 生产母版真跑

- 数据：`tests/fixtures/golden/line1_bulk`，120 基因 x 12 样本，6 Ctrl vs 6 Case。
- 计数矩阵列名改为 `GSM900001` 到 `GSM900012`，分组表 12 行。
- `prep_matrix`：counts_rnaseq 模式，120 基因 / 12 样本，分组核对一致。
- `deg_limma`：24 个显著基因（12 上调 / 12 下调），最小 adj.P 1.995e-12。
- 两档内存都跑通：6.5GB 生产档与 3.5GB 验证档，`WROTE` 字节数与磁盘实际一致（14,382）。

## 4. D1 到 D2

- 门户真进程 18800；上传 `counts.csv`（7,085 B）与 `grouping.txt`（180 B）。
- 提交生成 `PKG_2026-11-15_152638_BLKR01_PKG`，manifest 计数 2 个数据文件。
- D2 接收器轮询后拉取、校验、解包到桌面收件箱；`/api/portal/inbox` 识别 `attachments.data_files=2`，`suggestedLine=line1_bulk`。
- D2 回写：门户侧 `PKG_.../sync_results/sync_result.json` 为 `status=done`，manifest 带包 SHA256 与解包落点。

## 5. 工单闭环

- 第一次 `WO_20261115_152638` 失败：`prep_matrix` exit 2。根因是执行计划的正则只认 `.txt/.tsv` counts，不认 `.csv`，导致 `series_matrix` 角色解析不到，母版只收到 grouping。
- 修复：`execution_plan.service.js` 的 counts/matrix 正则加入 `csv`，新增 `execution_plan_inputs.test.js` 2 条。
- 第二次 `WO_BLKR01_02` 完成，用时 78 秒：
  - 4 个任务全部 exit 0：prep_matrix / qc_matrix / pca_matrix / deg_limma。
  - `task_receipts` 4 条，均为 `status=passed`。
  - 交付物 5 项：Project_Summary.md、Analysis_Report.md（9,728 B）、Analysis_Report.html（350,522 B）、Client_Delivery.tar.gz（493,910 B）、work_order.receipt.json。
  - 验收 19 项全绿，`DELIVERY_ACCEPTANCE_OK 四道关全绿`。
  - 工单 receipt sentinel：`PRODUCTIZATION_RECEIPT_OK`。
- 交付包 Ed25519：`CHECKSUMS.sig` 对 `CHECKSUMS.sha256` 验签结果为 true。
- 本次工单交付 tar 由远端 `build_client_report.py` 生成，包内只有 `CHECKSUMS.sig`，没有 `receipt_v1.json`；Pi 打包路径的 `delivery_packager.js` 会写带 `ed25519_signature` 的 `receipt_v1.json`，该文件同样纳入 `CHECKSUMS.sha256`。

## 6. 双检查点

- 检查点一：`ps_blkr01_e2e` 提交方案后状态为 `AWAITING_PLAN_APPROVAL`，宽限截止 1794728445918。
- 服务端每 15 秒扫描；第 180 秒状态自动变为 `PLAN_APPROVED`，`plan_approved_by=autonomy_policy`，无需人工点击。
- 检查点二：`dispatch` 后提交 1 个靶点，状态 `AWAITING_TARGET_APPROVAL`；人工 `approve-targets` 后转 `TARGET_APPROVED`；`report-signed` 后转 `REPORT_SIGNED`，`delivery_grade=STANDARD_VERIFIED`。

## 7. 与 Gemini 设计的差异

1. `work_order` 的 `receipt/v1` 里 `sentinel` 仍是字符串，没有 `sentinel.archive_ed25519_sig` 与 `sentinel.receipt_ed25519_sig` 两个字段；实际签名落在交付包 `CHECKSUMS.sig` 与交付包内 `receipt_v1.json.ed25519_signature`。
2. 本次真机计算链路走管理员确认工单路径，Pi 双检查点用同一项目单独跑通状态机，两者尚未合并成一条单会话全链路。
