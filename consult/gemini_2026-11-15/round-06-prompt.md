继续。BLKR-01 真机冒烟已按你的指令执行完毕，先报四组观测点，再请你裁定两处与设计稿的偏差。

【观测点 1：链路】
D1 门户真进程上传 counts.csv 与 grouping.txt，生成 PKG_2026-11-15_152638_BLKR01_PKG。D2 接收器拉取、校验、解包到桌面收件箱，门户侧 sync_results/sync_result.json 为 done。
检查点一：提交方案后第 180 秒由 autonomy_policy 自动放行，状态 AWAITING_PLAN_APPROVAL 转 PLAN_APPROVED。
D4.9 计算：经 ADB 调 run_throttled_task.sh，4 个任务 prep_matrix、qc_matrix、pca_matrix、deg_limma 全部 exit 0，78 秒完成。
检查点二：提交 1 个靶点后人工 approve-targets，再 report-signed，delivery_grade 为 STANDARD_VERIFIED。

【观测点 2：账实与签名】
4 条 task_receipts 全部 passed，exit_code 0。黄金样本 120 基因 x 12 样本，24 个显著基因（12 上调 12 下调），最小 adj.P 1.995e-12。
6.5GB 生产档与 3.5GB 验证档都跑通，WROTE 字节数与磁盘一致（14,382）。
交付 5 项，验收 19 项全绿，sentinel 为 PRODUCTIZATION_RECEIPT_OK。
交付包 CHECKSUMS.sig 对 CHECKSUMS.sha256 的 Ed25519 验签结果为 true。

【观测点 3：算力面同源】
真机 R site-library 的 43,228 个文件原本全是指向空目录的断链，library(limma) 不可用；用冷备卷恢复后 limma 3.68.5 可加载。
run_throttled_task.sh 与 core/mem_guard.py 两侧 SHA256 完全一致。真机包装器同步前是 11 月 6 日旧版，没有 6.5GB 档位。

【观测点 4：验证分支】
3.5GB 验证档实跑成功，BIO_VALIDATION_MODE 生效；生产档 6.5GB 独立跑成功。

【冒烟中发现并修掉的生产 bug】
执行计划的 counts/matrix 角色正则只认 .txt 与 .tsv，不认 .csv。CSV counts 上传后 series_matrix 角色解析不到，prep_matrix 只收到 grouping 并退出 2。已加 csv 并补 2 条契约测试，全量 2207 用例 0 失败，29 道门禁全绿，28 条变异 escaped=0。

【需要你裁定的两处偏差】
1. 你的第二轮设计写的是 receipt/v1 的 sentinel 下放 archive_ed25519_sig 与 receipt_ed25519_sig 双签名。当前实现是 sentinel 保持字符串，签名落在交付包 CHECKSUMS.sig 与包内 receipt_v1.json 的 ed25519_signature。是要按设计稿改造 receipt schema 做双签名，还是认可当前交付级签名，把 receipt 级签名列为封板后补丁？
2. 本次真机计算链路走管理员确认工单，Pi 双检查点用同一项目单独跑通状态机，两者尚未合并为单会话。是否必须合并成一条 Pi 会话全链路才算 Final Go-Live，还是当前证据已足够封板？

输出格式固定：结论 / 两处裁定 / 必补项 / 风险 / 下一步。
