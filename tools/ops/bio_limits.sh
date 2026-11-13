#!/bin/bash
# bio_limits.sh：容器全局线程封顶与无头渲染配置
# 部署到 /etc/profile.d/bio_limits.sh（容器内 source 即生效），仓库存一份在 ops/
# 自备算力节点 通用 ARM64 处理器 八核：大核 4,5,6 留给计算，小核 0-3 保系统/SSH，超大核 7 空置防发热降频
# 线程封顶 3 = 只用 3 个大核，防止全核跑满触发 thermal throttling

export OMP_NUM_THREADS=3
export OPENBLAS_NUM_THREADS=3
export MKL_NUM_THREADS=3
export VECLIB_MAXIMUM_THREADS=3
export NUMEXPR_NUM_THREADS=3
export R_DATATABLE_NUM_PROCS_PERCENT=50
export MPLBACKEND=Agg
