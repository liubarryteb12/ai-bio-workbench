"""出图主题层 · Python 侧（只补模板与 guard 都没覆盖的两项：字体族、线宽/点大小）。

为什么只有两项：见 con_hf/dispatch/S4_python_theme_gap.md 的覆盖对照表——
DPI/画幅/字号/图例外置/spines/tick 旋转/脚注栏/角标已由
tools/ops/layout_autoload/sitecustomize.py + tools/reporting/layout_helper.py 的 SCI 模板实现，
长标签折行/文本收边/落盘收口已由脚本内嵌 layout guard 实现。
这里只补 rcParams 基线（17 份内嵌副本）与模板层都没设的两项。

纪律与 layout_autoload 一致：
  * 只在明确设置 BIOANALYS_PROJECT_JSON 时介入；非出图步骤零影响
  * BIOANALYS_PY_THEME=1 才应用；未设 = 关闭（spike 期默认关，无回归）
  * 任何异常只 warning，不中断出图——出图失败才是事故
  * 幂等：重复合并只生效一次

部署：/mnt/ssd/bio_data/tools/ops/fig_theme.py，由 sitecustomize.py 调用。
"""

# ---- 主题片段：字体族 + 线宽/点大小（SCI 常见口径）----
FIG_THEME = {
    # 字体族：锁定首选序列，避免跨机器静默 fallback 成不同字形
    "font.family": "sans-serif",
    "font.sans-serif": ["DejaVu Sans", "Liberation Sans", "Arial", "Helvetica"],
    # 线宽/点大小：默认 1.5pt 线 + 6pt 点在密集散点里会糊；SCI 常用细线小点
    "lines.linewidth": 0.8,
    "lines.markersize": 4,
    "patch.linewidth": 0.8,
    "errorbar.capsize": 3,
}


def apply_fig_theme():
    """把主题片段合并进 matplotlib.rcParams。返回实际生效的键数。"""
    import matplotlib
    applied = 0
    for key, value in FIG_THEME.items():
        try:
            matplotlib.rcParams[key] = value
            applied += 1
        except Exception as exc:  # 键名/取值不被当前版本接受时只警告
            print(f"[fig_theme] rcParams[{key}] 应用失败: {exc}", file=__import__("sys").stderr)
    return applied
