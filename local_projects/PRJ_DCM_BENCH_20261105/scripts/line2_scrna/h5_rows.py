import numpy as np
import scipy.sparse as sps
import h5py


def read_var_column(h5_path, col):
    """读 var 的一列（字符串列在 h5ad 里可能是 dataset，也可能是 categorical 组）。"""
    with h5py.File(h5_path, 'r') as f:
        node = f['var'][col]
        if isinstance(node, h5py.Dataset):
            raw = node[...]
            return np.array([v.decode() if isinstance(v, bytes) else str(v) for v in raw])
        cats = node['categories'][...]
        codes = node['codes'][...]
        cats = np.array([c.decode() if isinstance(c, bytes) else str(c) for c in cats])
        return cats[codes]


def read_csr_rows(h5_path, key, rows):
    """按行切片 CSR 稀疏矩阵，绕开 anndata backed 的内存陷阱。

    实测（2026-11-05）：anndata 的 backed 对象在读取时仍会把 layers 里的稀疏矩阵整层
    `to_memory()`（本数据 layers['counts'] nnz=2.1 亿 → indices 单数组 802 MiB），
    叠加 data/indptr 约 2.4GB，直接触发 Android 低内存杀手（thrashing 后连 adj=0 前台进程都被杀）。
    这里只按行区间读 indptr/data/indices，内存与选中行数成正比。
    """
    with h5py.File(h5_path, 'r') as f:
        g = f[key]
        enc = str(g.attrs.get('encoding-type', ''))
        if 'csr' not in enc.lower():
            raise RuntimeError('read_csr_rows 只支持 CSR，实际 %s（key=%s）' % (enc, key))
        shape = tuple(int(x) for x in g.attrs['shape'])
        indptr = np.asarray(g['indptr'][...], dtype=np.int64)
        rows = np.asarray(rows, dtype=np.int64)
        spans = []
        start = prev = int(rows[0])
        for r in rows[1:]:
            r = int(r)
            if r == prev + 1:
                prev = r
                continue
            spans.append((start, prev))
            start = prev = r
        spans.append((start, prev))
        out_d, out_i = [], []
        for lo_r, hi_r in spans:
            lo, hi = int(indptr[lo_r]), int(indptr[hi_r + 1])
            if hi > lo:
                out_d.append(np.asarray(g['data'][lo:hi]))
                out_i.append(np.asarray(g['indices'][lo:hi]))
        # indptr 必须跨区间累计：每个区间的偏移是相对本区间起点的，直接拼会得到负数
        out_ptr = [0]
        running = 0
        for r in rows:
            running += int(indptr[r + 1] - indptr[r])
            out_ptr.append(running)
    data = np.concatenate(out_d) if out_d else np.zeros(0, dtype=np.float32)
    indices = np.concatenate(out_i) if out_i else np.zeros(0, dtype=np.int32)
    return sps.csr_matrix((data, indices, np.asarray(out_ptr, dtype=np.int64)),
                          shape=(rows.size, shape[1]))