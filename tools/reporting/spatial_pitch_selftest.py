"""合成数据验证：晶格 pitch 算法与标定入口的防线。

分层防线：
  1. _first_shell_pitch：只取第一壳层一致的内部点，避免边缘把 pitch 抬高；
  2. um_per_px：双口径比值必须落在 [0.90, 1.10]，拦「坐标缩放级别错配」与「随机散点」；
  3. 出图侧平台护栏：反推光斑直径必须落在 50~70 µm，拦「非 Visium 平台套用 100 µm」。
本脚本验证 1 与 2；3 由 figure_scalebar_contract 静态断言 + 真机跑图覆盖。
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
from spatial_calibration import _first_shell_pitch, um_per_px, CalibrationError


def hex_lattice(pitch, rows=40, cols=40):
    pts = []
    dy = pitch * np.sqrt(3) / 2.0
    for r in range(rows):
        offset = (pitch / 2.0) if (r % 2) else 0.0
        for c in range(cols):
            pts.append([c * pitch + offset, r * dy])
    return np.asarray(pts, dtype=float)


ok = True
print("--- 1. 合成六角晶格：pitch 必须被准确还原 ---")
for pitch in (132.0, 100.0, 87.5):
    got, n_int, n_tot = _first_shell_pitch(hex_lattice(pitch))
    err = abs(got - pitch) / pitch
    if err > 0.01:
        ok = False
    print("  %-4s pitch=%.1f -> got=%.2f err=%.3f%% interior=%d/%d"
          % ("OK" if err <= 0.01 else "FAIL", pitch, got, err * 100, n_int, n_tot))

print("--- 2. 完整标定入口：正常晶格必须给出接近 1 的比值 ---")
pitch = 132.0
sf = {"spot_diameter_fullres": 87.165}
cal = um_per_px(sf, hex_lattice(pitch))
print("  um_by_lattice=%.4f um_by_spot=%.4f ratio=%.3f"
      % (cal["um_per_px_by_lattice"], cal["um_per_px_by_spot"], cal["ratio"]))
if not (0.90 <= cal["ratio"] <= 1.10):
    ok = False
    print("  FAIL 比值越界")

print("--- 3. 破碎散点：完整入口必须 fail-closed ---")
rng = np.random.default_rng(0)
try:
    um_per_px(sf, rng.random((400, 2)) * 1e6)
    print("  FAIL 随机散点未抛错")
    ok = False
except CalibrationError as exc:
    print("  OK   随机散点正确抛 CalibrationError: %s" % str(exc)[:70])

print("--- 4. 缩放级别错配：直径除以 2 必须 fail-closed ---")
try:
    um_per_px({"spot_diameter_fullres": 87.165 / 2.0}, hex_lattice(pitch))
    print("  FAIL 缩放错配未抛错")
    ok = False
except CalibrationError:
    print("  OK   缩放错配正确抛 CalibrationError")

print("PITCH_ALGO_OK" if ok else "PITCH_ALGO_FAIL")
