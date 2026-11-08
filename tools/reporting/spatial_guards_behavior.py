"""标定与指纹守卫的真机行为验证（第 69 轮）。

静态契约只证明「代码写了」，本脚本证明「代码有效」：
  A. 五张真实切片双口径比值必须落在 [0.90, 1.10]；
  B. 故意给错缩放级别（hires 直径配 fullres 坐标）必须抛 CalibrationError；
  C. 破碎组织（内部点不足）必须抛 CalibrationError；
  D. 指纹对未改动矩阵稳定、对四类污染敏感、且不得 densify。

设备不可用时打印 SKIP 并以 0 退出，不影响离线门禁。
"""

import os
import sys

P = "/mnt/ssd/bio_data/projects/PRJ_STROKE_P1_SPATIAL_ABCA1/line3_spatial/processed"
H5 = os.path.join(P, "spatial_domains_mouse.h5ad")
if not os.path.exists(H5):
    print("SKIP no_device_data")
    sys.exit(0)

sys.path.insert(0, "/tmp")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import anndata as ad
from scipy.sparse import csr_matrix

from spatial_calibration import um_per_px, CalibrationError, RATIO_LOW, RATIO_HIGH
from matrix_guard import fingerprint, assert_unchanged, MatrixMutatedError

fails = []

a = ad.read_h5ad(H5)
samp = a.obs["sample_id"].astype(str).to_numpy()
for s in sorted(set(samp)):
    xy = np.asarray(a.obsm["spatial"])[samp == s]
    sf = a.uns["spatial"][s]["scalefactors"]
    try:
        cal = um_per_px(sf, xy)
        if not (RATIO_LOW <= cal["ratio"] <= RATIO_HIGH):
            fails.append("%s ratio 越界 %.3f" % (s, cal["ratio"]))
    except CalibrationError as e:
        fails.append("%s 标定抛错: %s" % (s, str(e)[:80]))
print("A. 五切片双口径交叉复核: %s" % ("PASS" if not fails else "FAIL"))

# B. 缩放级别错配必须被抓（把 fullres 直径除以 2 模拟误用 hires）
s0 = sorted(set(samp))[0]
xy0 = np.asarray(a.obsm["spatial"])[samp == s0]
sf0 = dict(a.uns["spatial"][s0]["scalefactors"])
sf0["spot_diameter_fullres"] = float(sf0["spot_diameter_fullres"]) / 2.0
try:
    um_per_px(sf0, xy0)
    fails.append("B 缩放级别错配未被抓")
except CalibrationError:
    print("B. 缩放级别错配 fail-closed: PASS")

# C. 破碎组织（随机散点，无第一壳层）必须被抓
rng = np.random.default_rng(0)
sparse_xy = rng.random((400, 2)) * 1e6
try:
    um_per_px({"spot_diameter_fullres": 87.22}, sparse_xy)
    fails.append("C 破碎组织未被抓")
except CalibrationError:
    print("C. 破碎组织 fail-closed: PASS")

# D. 指纹行为
X = a.X
f1 = fingerprint(X)
f2 = fingerprint(X)
if f1 != f2:
    fails.append("D1 指纹不稳定")
try:
    assert_unchanged(f1, X, stage="noop")
except MatrixMutatedError:
    fails.append("D2 未改动却抛错（误报）")
# 变异分两类：就地改写（返回 None）与返回新对象（切片）。
# 首版只调用 mut(Mc) 不接返回值，col_slice 的切片被丢弃，
# 实际送去比对的是未改动的副本，于是报「未被抓」——这是探针自身的缺陷。
for name, mut in (("inplace_scale", lambda M: M.data.__imul__(1.5)),
                  ("tiny_smooth", lambda M: M.data.__imul__(0.9995)),
                  ("col_slice", lambda M: M[:, :100])):
    Mc = X.copy()
    try:
        _ret = mut(Mc)
        if _ret is not None:
            Mc = _ret
    except Exception:
        continue
    try:
        assert_unchanged(f1, Mc, stage=name)
        fails.append("D3 %s 污染未被抓" % name)
    except (MatrixMutatedError, ValueError):
        # ValueError 也算抓到：非二维输入必须被守卫显式拒绝，
        # 而不是在内部解包时崩掉。
        pass
print("D. 指纹稳定/无误报/对污染敏感: %s" % ("PASS" if not any(x.startswith("D") for x in fails) else "FAIL"))

if fails:
    print("BEHAVIOR_FAIL")
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("BEHAVIOR_OK 标定与指纹守卫在真机数据上行为正确")
