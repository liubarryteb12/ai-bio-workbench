"""表达矩阵指纹与进/出断言（第 69 轮第二审加固项 4）。

为什么要它：
空间平滑（BANKSY 式 Xs = (1-lambda)X + lambda*W@X）只能作为域聚类的输入特征。
一旦它污染了原始表达矩阵，下游 Moran's I 与 NNLS 解卷积就是在用平滑后的数据
证明空间相关性成立，属循环论证。

静态扫描「adata.X = ...」挡不住：至少有 6 条绕过路径 ——
  1. 切片视图赋值 X[mask] = ...
  2. in-place 缩放 X.data *= ...
  3. obsm 别名共享同一底层数组
  4. 函数内部改写后不返回
  5. 稀疏对象被复用（同一 csr_matrix 传进两个步骤）
  6. 下游脚本直接读上一次写坏的 h5ad
唯一挡得住的是进/出指纹比对：不关心谁改的、怎么改的，只关心值有没有变。

指纹必须纯读取：整体 densify 在 8GB 设备上会 OOM（实测 2.5GB 输入矩阵
densify 后约 2.2GB 副本，直接贴内存天花板）。

用法：
    from ops.matrix_guard import fingerprint, assert_unchanged
    fp = fingerprint(adata.X)
    ...  # 空间平滑与聚类
    assert_unchanged(fp, adata.X, stage="spatial_domains")
"""

import hashlib

import numpy as np
from scipy.sparse import issparse


class MatrixMutatedError(Exception):
    """原始表达矩阵在某个步骤前后发生了变化。"""


# 抽样规模：行索引固定，避免全矩阵遍历
_SAMPLE_ROWS = 512
_SAMPLE_COLS = 256


def fingerprint(X):
    """返回 (shape, nnz, digest) 三元指纹。

    形状与非零数是廉价强信号；digest 只覆盖固定行列交叉的抽样格点，
    因此与元素顺序无关，且稀疏矩阵不需要 densify。

    只接受二维矩阵。真机行为测抓到：csr 的列切片会退化成 COO 且 shape 长度
    可能为 1，直接解包会抛 ValueError 而不是 MatrixMutatedError，
    等于「守卫自己先崩」，调用方无法区分守卫故障与数据污染。
    """
    shape = tuple(getattr(X, "shape", ()) or ())
    if len(shape) != 2:
        raise ValueError("fingerprint 只接受二维矩阵，实际 shape=%r（类型 %s）"
                         % (shape, type(X).__name__))
    n, g = shape
    rows = np.linspace(0, n - 1, num=min(_SAMPLE_ROWS, n), dtype=int) if n else np.array([], dtype=int)
    cols = np.linspace(0, g - 1, num=min(_SAMPLE_COLS, g), dtype=int) if g else np.array([], dtype=int)

    h = hashlib.sha256()
    h.update(("%d,%d" % (n, g)).encode("utf-8"))

    if issparse(X):
        nnz = int(X.nnz)
        sub = X[np.ix_(rows, cols)] if rows.size and cols.size else None
        vals = np.asarray(sub.todense()).ravel() if sub is not None else np.array([], dtype=float)
    else:
        dense = np.asarray(X)
        nnz = int(np.count_nonzero(dense))
        vals = dense[np.ix_(rows, cols)].ravel() if rows.size and cols.size else np.array([], dtype=float)

    h.update(("%d" % nnz).encode("utf-8"))
    # 量化到 1e-6，避免不同 BLAS 归约顺序造成的末位抖动误报
    q = np.round(np.asarray(vals, dtype=float), 6)
    h.update(q.tobytes())
    return {"shape": (n, g), "nnz": nnz, "digest": h.hexdigest()[:16]}


def _fmt(fp):
    return "shape=%s nnz=%d digest=%s" % (fp["shape"], fp["nnz"], fp["digest"])


def assert_unchanged(before, X, stage=""):
    """比对进/出指纹，漂移即抛 MatrixMutatedError。

    before 可以是 fingerprint() 的结果，也可以是矩阵本身（就地取指纹）。
    """
    fp_before = before if isinstance(before, dict) else fingerprint(before)
    fp_after = fingerprint(X)
    # 形状必须一起比。真机行为测抓到：只比 digest 与 nnz 时，
    # X[:, :100] 这种列切片会因为抽样格点全部落在前 100 列内而给出相同
    # digest 与相同 nnz，把「矩阵被截列」误判成未改动。
    if (fp_before["shape"] != fp_after["shape"]
            or fp_before["digest"] != fp_after["digest"]
            or fp_before["nnz"] != fp_after["nnz"]):
        raise MatrixMutatedError(
            "原始表达矩阵在步骤 [%s] 前后不一致，疑似被平滑或就地改写。" % (stage or "<未命名>")
            + " before: " + _fmt(fp_before)
            + " | after: " + _fmt(fp_after)
            + " 下游 Moran I 与 NNLS 解卷积必须读取未平滑的原始矩阵，否则构成循环论证。"
        )
    return fp_after
