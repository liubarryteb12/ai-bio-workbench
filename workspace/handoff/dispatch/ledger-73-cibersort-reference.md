2026-10-25 免疫浸润评估算法参考上线（73.WGCNA筛选免疫调控基因）

## 定性修正

该目录名义是 WGCNA，实际主代码是 CIBERSORT v1.03 免疫细胞浸润评估。生产线的 WGCNA 已有专门脚本 wgcna_module_trait，不重复造。因此本任务的交付物定位为：CIBERSORT v1.03 离线算法参考，脚本头部已写明该定位，明确声明不上生产主线，作为方法学存档与算法对照。

## 依赖安装

e1071 未装，本次从阿里云 CRAN 镜像安装，版本 1.7-17，连带装入依赖 proxy。已实测 nu-SVR 回归可用（nu-regression 线性核，tot.nSV=13）。

同批检查的 sva 与 oncoPredict 仍未安装，属 51 与 52 号任务范围。

## 契约实现

- shebang 指向显式 shim /mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript
- 去除原版 tcltk GUI 文件选择，全部改命令行参数
- 原版硬编码绝对路径全部参数化
- 种子契约：BIOANALYS_SEED 优先，--seed 可覆盖，缺失或非整数 exit 3，允许负整数
- 退出码：0 成功，1 自校验失败，2 参数或输入契约违背，3 种子缺失或非法
- 输入读取按内容探测分隔符，与本轮其余脚本一致
- --sample-col 支持两种输入布局，两种布局结果经实测等价
- 自校验覆盖：比例矩阵无 NA、无负值、每行和精确为 1、维度匹配、p 值在 [0,1]、相关系数在 [-1,1]
- 置换检验估计 p 值，--perm 控制次数，--qvalue 控制显著性阈值
- 原子写、读回自校验、PNG 魔数检查、产物 sha256 台账

## 算力节点 实测验收

部署位置 /mnt/ssd/bio_data/bin/line1_bulk/cibersort_reference，mode 755，22489 字节，sha256 4bf0632f2c8ae7b8a2adf025c09d79cd9f595d96f7fd1aa9fa1db15521b3510a。

1. 正常路径 exit 0。模拟 6 样本、4 细胞类型、10 签名基因。反卷积耗时 0.038 秒，置换检验耗时 0.108 秒。4 个产物齐全，PNG 魔数 89504e47。比例矩阵每行和经独立复算精确为 1（rowsum_min=1, rowsum_max=1）。

2. 退出码矩阵 9 项全部达标：正常 0，缺种子 3，非整数种子 3，未知参数 2，缺必填 2，签名文件不存在 2，--sample-col 不存在列 2，--perm 越界 2，--qvalue 越界 2。

3. 种子可复现：同种子 42 两次运行，样本质量表 sha256 均为 88224ee7cf98a85c11ca4fe2cf9569a275e8ea639198d75ffd37fddf1db9f14e；换种子 777 后变为 e75c5b3a5c851038e65aa011939975bfff2538628ed508258af6f34b84dcf407。

4. 输入布局等价：feature_rows_sample_columns 与 sample_rows_feature_columns 两种布局跑同一份数据，细胞比例表 sha256 均为 ae71e3c14324408cdfdb392c3b95a51ed76fb634761e14f8da93ba44c76aeb6b。

5. 数据正确性：比例非负且行和为 1，相关系数在 [-1,1]，p 值在 [0,1]，观测相关性约 0.986 至 0.991。

6. e1071 版本 1.7-17 记录进 stdout 与 report。

## 开发中修掉的三个算法与工程缺陷

1. nu-SVR 系数与签名矩阵维度不匹配。最初写 fit$coefs %*% signature_shared 直接叉乘，但 coefs 是支持向量系数矩阵，维度与签名矩阵不一致，报 non-conformable arguments。

2. 支持向量索引取错。改用 rownames(fit$SV) 后报 NAs are not allowed in subscripted assignments，因为 SV 的行名只是 1..nSV 的局部序号，不是原始训练数据的行号。最终改用 fit$index，该字段才是支持向量在原始数据中的真实行索引，并补了越界与长度校验。

3. 长格式转换用错 reshape 参数，导致 replacement has 6 rows, data has 4。改用按细胞类型分别构造数据框再 do.call(rbind) 的方式实现。

## 一个重要的假阴性诊断

最初用 20 次置换、信号极强的数据测试，得到 SEED_MATTERS=NO，一度怀疑种子契约失效。排查后确认为测试数据问题而非脚本缺陷：信号极强时观测相关性约 0.986，而置换 p 值被限制在 (1+count)/(1+20) 的离散格点上，最小值即 0.0476，不同种子都落在同一格点，输出自然相同。改用噪声更大（sigma 1.8）的数据并将置换提到 100 次后，同种子复现与换种子变化均正常。此诊断避免了误改正确代码。

## 遗留项

- 本地工作区副本未同步，本地 exec 通道故障期间无法回灌，已提供 ops/sync_line1_assets.ps1 待通道恢复后执行
- 源目录 reference/00a.可参考代码库/73.WGCNA筛选免疫调控基因 未能读取，算法按 CIBERSORT v1.03 标准方法学实现
- 签名矩阵未内置 LM22，需用户按 cell_types 格式自备；本实现验证的是算法链路，不是 LM22 的具体数值结论
- 不上生产主线，仅供方法学对照
