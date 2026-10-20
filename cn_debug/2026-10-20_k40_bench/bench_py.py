#!/usr/bin/env python3
"""bench_py.py — Python 侧效率基准 v2（numpy matmul，固定 seed）

v2 变更：负载 2000x2000x5 -> 3000x3000x3（单配置 ~8-12s，摊薄系统噪声）。
线程数由调用方经环境变量 OMP/OPENBLAS/MKL/NUMEXPR 注入。
"""
import argparse
import time

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--cpus", default="none")
ap.add_argument("--threads", type=int, default=3)
ap.add_argument("--tag", default="x")
ap.add_argument("--round", type=int, default=1)
a = ap.parse_args()

seed = 20261013  # aims 契约 seed
N = 3000
rng = np.random.default_rng(seed)
A = rng.standard_normal((N, N))
B = rng.standard_normal((N, N))
_ = A @ B  # 预热（BLAS 线程池启动），不计时
t0 = time.perf_counter()
n_rep = 3
for _ in range(n_rep):
    C = A @ B
w = time.perf_counter() - t0
gflops = n_rep * 2 * N**3 / (w * 1e9)
print(f"PY_DONE cpus={a.cpus} threads={a.threads} tag={a.tag} "
      f"round={a.round} wall={w:.3f} per_rep={w / n_rep:.3f} gflops={gflops:.2f} checksum={float(C.sum()):.4f}")
