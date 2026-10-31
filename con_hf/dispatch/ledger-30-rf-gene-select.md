2026-10-25 随机森林基因筛选改造上线（30.随机森林筛选基因）

## 定位

新增生产脚本 rf_gene_select，用监督分类随机森林对基因做重要性排序并输出候选基因集。与母版 ml_model 的分工：本脚本只做单次重要性排序与阈值筛选，不做嵌套交叉验证，也不产出预测模型。

## 依赖安装

randomForest 未装，本次从阿里云 CRAN 镜像安装到 R 4.5.3 站点库。

安装过程注意：R 的 available.packages 与 install.packages 能正常访问 https://mirrors.aliyun.com/CRAN，但 curl 抓取该镜像的目录列表返回空，因此版本号通过 R 的 available.packages 查询得到，最终安装 4.7-1.2。

容器网络状况：proot 容器内 127.0.0.1:7890 无监听，adb reverse 映射的代理端口在容器内不可达，代理方案本次未使用；R 自身可直连 CRAN 镜像，故走 R 原生下载通道。

## 契约实现

- shebang 指向显式 shim /mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript
- 种子契约：BIOANALYS_SEED 优先，--seed 可覆盖，缺失或非整数 exit 3，允许负整数，边界取正负 .Machine$integer.max
- 退出码：0 成功且台账齐备，1 自校验失败，2 参数或输入契约违背，3 种子缺失或非法
- 输入读取按内容探测分隔符，与本轮 12 个脚本的修复方案一致，支持 --sep 显式指定
- --sample-col 支持两种输入布局：none 走 feature_rows_sample_columns，指定值走 sample_rows_feature_columns
- 重要性指标 MeanDecreaseAccuracy 与 MeanDecreaseGini 双列输出，按 MeanDecreaseAccuracy 降序
- 原子写、读回自校验、PNG 魔数检查、产物 sha256 台账
- 每类至少 3 个样本，结局至少 2 类，特征列去重

## K40 实测验收

部署位置 /mnt/ssd/bio_data/bin/line1_bulk/rf_gene_select，mode 755，18223 字节，sha256 03a3ceeae08a06b90af8d320c8a01d2bff5efc8274a18cc47becd6e1b677a71b。

1. 正常路径 exit 0。构造 40 样本 12 基因数据，其中 G1/G2/G3 在 case 组注入 +4 信号。结果 top_gene=G1，前三名依次为 G1(19.16)、G3(13.75)、G2(13.42)，第四名 G12 仅 2.12，模型准确抓到注入信号。4 个产物齐全，PNG 魔数 89504e47。

2. 退出码矩阵 10 项全部达标：正常 0，缺种子 3，非整数种子 3，未知参数 2，缺必填 2，输入不存在 2，--sample-col 不存在列 2，--sep 非法值 2，--ntree 越界 2，缺 --groups 2。

3. 种子可复现：同种子 20261025 两次运行，重要性表 sha256 均为 7ceb55479db110c6c9bbcb41c40964aa944a3d8e2ebb998fb67102e720794d8a；换种子 999 后变为 0a0518368702fe523ddce7a87de74f7d69043f55c1ff28e7dcfe31d16d078013。证明 seed 真正驱动随机森林随机性。

4. CSV 与 TSV 等价：同一份数据同一种子，CSV 与 TSV 两条路径的重要性表 sha256 完全一致，均为 7ceb55479db110c6c9bbcb41c40964aa944a3d8e2ebb998fb67102e720794d8a。

5. 带 sample_id 首列的标准表 exit 0，sample_col=sample_id 生效，input_dimensions=40x12，class_counts=case:20,ctrl:20。

6. randomForest 版本 4.7.1.2 记录进 stdout 与 report。实跑期间温度约 24.7 摄氏度，远低于 60 度阈值。

## 开发中修掉的三个自身缺陷

1. MeanDecreaseAccuracy 自校验误判。最初把负值当失败，但该指标是置换后准确率下降量，置换噪声基因完全可能为负，属正常行为。改为只校验有限性，MeanDecreaseGini 才要求非负。

2. file.rename 返回值泄漏到 stdout，污染台账。改用 invisible 包裹，并补原子写后的文件存在性断言。

3. R 命名向量越界索引导致 exit 1 而非 exit 2。argument_map[[flag]] 遇到未知参数名时抛 subscript out of bounds，c(...)[[value]] 遇到非法 --sep 时同样抛错，都走 R 的默认错误路径 exit 1。改为先用 %in% 判断成员关系再索引。

## 遗留项

- 本地工作区 src/line1_bulk/scripts/ 的副本未同步，本地 exec 通道故障期间无法回灌，已提供 ops/sync_line1_assets.ps1 待通道恢复后执行
- 未做嵌套交叉验证，重要性阈值筛选的泛化性能需按项目需求另做评估
- 源目录 reference/00a.可参考代码库/30.随机森林筛选基因 未能读取，本脚本按随机森林基因筛选的标准方法学实现，未继承原脚本的具体参数选择
