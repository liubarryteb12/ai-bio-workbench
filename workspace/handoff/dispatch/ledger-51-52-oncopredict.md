2026-10-25 药物敏感性预测上线（51.药物敏感性分析oncoPredict、52.oncoPredict包基因表达与药物敏感性）

## 依赖安装

sva 不在 CRAN，属 Bioconductor 包。Bioconductor 的阿里云与清华镜像的 src/contrib/PACKAGES 路径均不可达，官方 bioconductor.org 可达但 R 原生 download 下载 tar.gz 频繁超时（edgeR 4.8.2 与 sva 3.58.0 都触发 60 秒超时）。

解决办法是分段下载加本地安装：先用 available.packages 从官方 Bioconductor 拿版本号，再用 curl 单独下载 tar.gz（curl 秒下，R 下载超时），最后 install.packages(本地文件, repos=NULL, type="source") 离线安装。

实际只缺 3 个直接依赖，其余 23 个已在 K40 装好。最终安装结果：

locfit 1.5.9.12（CRAN，阿里云）
genefilter 1.92.0（Bioconductor）
edgeR 4.8.2（Bioconductor）
sva 3.58.0（Bioconductor）

安装用 setsid nohup 后台执行，避免长编译导致 SSH 连接被切断。安装期间温度约 25 摄氏度。

## oncoPredict 本体无法安装，改为方法学自实现

oncoPredict 不在 Bioconductor 官方仓库，主要发布在 GitHub。本环境 GitHub 主站可达（HTTP 200）但仓库定位失败：paulgeeleher/oncoPredict、cornelius-lab/oncoPredict、GSEA-MS-KCC/oncoPredict、mskcc/oncoPredict 等候选地址全部返回 404，GitHub 搜索页返回空（需登录或 JS 渲染），API 搜索无结果。因此无法获取官方源码。

同时 GDSC2_Expr.rds 训练矩阵在 K40 上不存在（该文件在本地 reference/09.待整理 旁的 encoding_backup 目录），本地读取通道当时故障，也无法取得。

处置：按已发表的 oncoPredict 方法学自行实现，交付 oncopredict_ridge 脚本。方法学核心为：以训练队列基因表达为自变量、药物 IC50 为因变量，对每种药物用 cv.glmnet 拟合 ridge 回归（alpha=0，交叉验证选 lambda.min），再预测目标队列 IC50。与官方包的差异是未实现 shrinkage correction 与多模型选项，固定 ridge，参数更少更稳。脚本头部已写明该定位。

## 契约实现

- shebang 指向显式 shim /mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript
- 种子契约：BIOANALYS_SEED 优先，--seed 可覆盖，缺失或非整数 exit 3，允许负整数
- 退出码：0 成功，1 自校验失败，2 参数或输入契约违背，3 种子缺失或非法
- 输入读取按内容探测分隔符，与本轮其余脚本一致，三个输入文件各自探测
- --sample-col 支持两种输入布局，训练与目标矩阵可分别用不同布局
- --drug-col 指定药物响应表的药物列，--min-samples 控制最小训练样本数
- 自校验覆盖：预测数量匹配、预测值有限、表观相关性有限、产物读回、PNG 魔数
- 报告固定写 external_validation=not_performed，不宣称外部验证结论
- 原子写、产物 sha256 台账

## K40 实测验收

部署位置 /mnt/ssd/bio_data/bin/line1_bulk/oncopredict_ridge，mode 755，18588 字节，sha256 9bd7f7d9cf74200c9e30ea4f3721b027c3d5e1a1a14dd7a6724175039ab465ef。

1. 正常路径 exit 0。模拟 24 训练样本、12 目标样本、30 基因，IC50 由 G1 与 G2 线性组合加噪声构造。lambda_min=8.3152993，apparent_correlation=0.92721395，模型抓到构造关系。4 个产物齐全，PNG 魔数 89504e47。stderr 仅一条 cv.glmnet 的 fold 警告（24 样本分 10 fold 导致每 fold 不足 3 例），属预期提示不影响结果。

2. 退出码矩阵 9 项全部达标：正常 0，缺种子 3，非整数种子 3，未知参数 2，缺必填 2，训练表达矩阵不存在 2，--sample-col 不存在列 2，--drug-col 不存在列 2，--min-samples 过小 2。

3. 种子可复现：同种子 20261025 两次运行，预测表 sha256 均为 7457176ff32ea881ea064a07d01eada29dd4b7c3262adae9a33016bab5178268。

4. CSV 与 TSV 等价：三个输入文件全部换成制表符分隔后，预测表 sha256 仍为 7457176ff32ea881ea064a07d01eada29dd4b7c3262adae9a33016bab5178268，与逗号分隔路径完全一致。

5. 数据正确性：预测值全部有限，预测数量与目标样本数一致，表观相关性 0.927。

6. glmnet 版本 5.1 记录进 stdout、summary 与 report。

## 遗留项

- 本地工作区副本未同步，已提供 ops/sync_line1_assets.ps1 待本地 exec 通道恢复后执行
- 官方 oncoPredict 包未安装，本实现为方法学复现，未经与官方包输出逐项比对；若后续能取得官方源码与 GDSC2_Expr.rds，建议补一次数值一致性验证
- 无外部验证数据，报告固定 not_performed
- 52 号任务（oncoPredict 包基因表达与药物敏感性）依赖 51 的输出格式，本次一并覆盖，但同样受制于官方包缺失
- sva 已装但本脚本未使用，它是 73 号任务的间接依赖，装它为补全 oncoPredict 依赖链
