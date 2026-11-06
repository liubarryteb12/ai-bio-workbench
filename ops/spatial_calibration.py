"""像素-微米标定与交叉复核（第 69 轮三审收敛项）。

为什么需要这个模块（实测事实）：
同一张 Visium 切片上两条换算路径相差 20% ——

| 路径 | 分子 | 分母 | 结果 |
|---|---|---|---|
| 光斑包络 | spot_diameter_fullres = 87.22 px | 55.0 um | 0.6306 um/px |
| 光斑包络 | 同上 | 65.0 um | 0.7453 um/px |
| 晶格中心距 | 内部点第一壳层中位 132.0 px | 100.0 um | 0.7576 um/px |

根因：Space Ranger 的 spot_diameter_fullres 定义是「theoretical 65 um spot」
在 fullres 图上的像素跨度，含光学弥散包络；55 um 只是捕获孔径。
把 55 当分子会让一切以微米为单位的阈值系统性偏小 17%。
用 65 之后与晶格口径只差 1.6%。

晶格口径本身也有边界效应：组织边缘 spot 的第一壳层邻居常落在组织外，
kNN 会跳到第二壳层（约 1.73 倍距离），把中位数拉高。
因此只取「第一壳层一致」的内部点来测 pitch。

用法：
    from ops.spatial_calibration import um_per_px
    cal = um_per_px(scalefactors, xy_pixels)
    双口径比值超出 [0.90, 1.10] 会抛 CalibrationError。

历史实测（供复核，勿删）：
  C1-D7: spot_diameter_fullres = 87.22 px
         按 55.0 换算 -> 0.6306 um/px（错，系统性偏小 17%）
         按 65.0 换算 -> 0.7453 um/px
         晶格（内部点第一壳层）132.0 px -> 0.7576 um/px
         比值 1.0166，落在允许带内。
"""

import numpy as np
from scipy.spatial import cKDTree

# 光斑包络口径（Space Ranger 定义，用于换算）
SPOT_ENVELOPE_UM = 65.0
# 捕获孔径口径（仅用于报告与文档，不得用作换算分子）
SPOT_CAPTURE_UM = 55.0
# 六角晶格中心距标称值
LATTICE_PITCH_UM = 100.0
# 双口径比值允许带：超出即 fail-closed
RATIO_LOW = 0.90
RATIO_HIGH = 1.10
# 第一壳层一致性容差：第 2 近邻距离相对第 1 近邻的倍数上限
SHELL_TOL = 1.30


class CalibrationError(Exception):
    """标定不可信：宁可停下，也不要拿错换算继续算微米阈值。"""


def _first_shell_pitch(xy, k=7):
    """只取第一壳层一致的内部点，返回其最近邻距离中位数（像素）。

    边缘点的第一壳层缺邻居，kNN 会跳到第二壳层（约 1.73 倍），
    直接用全体中位数会系统性偏高，所以先按壳层一致性筛掉。
    """
    n = xy.shape[0]
    if n < k + 1:
        raise CalibrationError("spot 数 %d 少于 %d，无法测晶格 pitch" % (n, k + 1))
    tree = cKDTree(xy)
    d, _ = tree.query(xy, k=k + 1)
    d1 = d[:, 1]
    d2 = d[:, 2]
    # 第 2 近邻仍在第一壳层内 => 该点周围邻居齐全，是内部点
    interior = d2 <= d1 * SHELL_TOL
    if interior.sum() < max(50, int(0.2 * n)):
        raise CalibrationError(
            "内部点仅 %d（共 %d），组织过于破碎，晶格 pitch 不可信"
            % (int(interior.sum()), n))
    return float(np.median(d1[interior])), int(interior.sum()), n


def um_per_px(scalefactors, xy_pixels):
    """返回双口径 um/px 与比值。

    scalefactors: uns['spatial'][sample]['scalefactors']（需含 spot_diameter_fullres）
    xy_pixels:    该样本的 spot 像素坐标 (N, 2)，必须与 scalefactors 同一缩放级别
    """
    try:
        d_px = float(scalefactors["spot_diameter_fullres"])
    except (KeyError, TypeError, ValueError) as exc:
        raise CalibrationError("scalefactors 缺 spot_diameter_fullres: %s" % exc)
    if not np.isfinite(d_px) or d_px <= 0:
        raise CalibrationError("spot_diameter_fullres 非法: %r" % d_px)

    um_by_spot = SPOT_ENVELOPE_UM / d_px
    pitch_px, n_interior, n_total = _first_shell_pitch(np.asarray(xy_pixels, dtype=float))
    um_by_lattice = LATTICE_PITCH_UM / pitch_px

    ratio = um_by_lattice / um_by_spot
    if not np.isfinite(ratio) or ratio < RATIO_LOW or ratio > RATIO_HIGH:
        raise CalibrationError(
            "像素-微米双口径不一致：spot 包络 %.4f um/px（%.2f px @ %.0f um），"
            "晶格 %.4f um/px（内部点 %.1f px @ %.0f um，%d/%d 点为内部点），"
            "比值 %.3f 超出 [%.2f, %.2f]。"
            "先确认坐标与 scalefactors 是否同一缩放级别（fullres vs hires），"
            "再确认切片是否破碎或存在形变。"
            % (um_by_spot, d_px, SPOT_ENVELOPE_UM,
               um_by_lattice, pitch_px, LATTICE_PITCH_UM, n_interior, n_total,
               ratio, RATIO_LOW, RATIO_HIGH))

    # 主口径取晶格（2026-11-07 实测改判）。
    # 理由：spot_diameter_fullres 是 Space Ranger 对光斑直径的逐图估计，
    # 本数据集 5 个样本在 87.06~90.19 px 间波动（3.6%）；而相邻 spot 中心距
    # 在所有样本上恒为 132.0 数据单位，是平台常量（Visium 100 µm）。
    # 用 65/d_px 会让 500 µm 的条实际画出 507.9~525.5 µm（偏长 1.5~5.1%）。
    # 双口径仍都返回，比值校验照旧：它守的是「坐标与 scalefactors 同一缩放级别」，
    # 与「用哪个当主口径」是两件事。
    return {
        "um_per_px": um_by_lattice,
        "um_per_px_by_spot": um_by_spot,
        "um_per_px_by_lattice": um_by_lattice,
        "ratio": ratio,
        "spot_diameter_px": d_px,
        "lattice_pitch_px": pitch_px,
        "interior_spots": n_interior,
        "total_spots": n_total,
    }


def px_of_um(um, cal):
    """把微米长度换算成像素长度（用主口径 spot 包络）。"""
    return float(um) / cal["um_per_px"]


def um_of_px(px, cal):
    """把像素长度换算成微米。"""
    return float(px) * cal["um_per_px"]
