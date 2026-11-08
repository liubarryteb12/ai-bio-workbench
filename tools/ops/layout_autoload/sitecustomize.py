"""出图模板自动挂载（Python 侧）。

为什么需要它：53 个母版出图脚本按"母版绝对只读"的规矩不能改，但客户在需求单上
选的 `plot_layout_config`（Nature 侧边 / Cell 宽幅 / 临床注记）必须真的生效。
于是把模板应用做成解释器启动时的外挂：只要任务环境里给了 `BIOANALYS_PROJECT_JSON`，
任何 `fig.savefig(...)` 落盘前都会自动套一次模板。

与脚本内嵌 `_install_layout_guard()` 的关系：
  guard 负责"最低合规线"（图例搬出轴框、文本收边、防压字），
  本模块负责"成品风格"（画幅比例、图例方位、脚注栏、角标）。
  两者都包 `Figure.savefig`，调用链为 guard → 本模块 → 原始 savefig，
  即模板最后生效——客户选的模板优先级高于母版的通用收口。

设计约束（都踩过坑）：
  * **失败不能中断出图**：模板是增强项，出图失败才是事故。任何异常只写 stderr 警告。
  * **幂等**：同一进程多次 import / 多次 savefig 只包一层。
  * **零开销**：没设 `BIOANALYS_PROJECT_JSON` 时立即 return，不 import matplotlib。
  * **可关闭**：`BIOANALYS_LAYOUT_DISABLE=1` 时完全不介入（排障用）。

部署：`/mnt/ssd/bio_data/tools/ops/layout_autoload/sitecustomize.py`，
任务脚本把该目录加进 `PYTHONPATH` 即可自动加载（site 模块启动时 import sitecustomize）。
"""

import os
import sys

_ENV_PROJECT = "BIOANALYS_PROJECT_JSON"
_ENV_DISABLE = "BIOANALYS_LAYOUT_DISABLE"
_MARK = "_bioanalys_layout_patched"


def _warn(message):
    # 出图是长任务，日志会被 tail 看；用一行前缀便于 grep
    sys.stderr.write("[layout_autoload] %s\n" % message)


def _install_memory_guard():
    """在任何科学计算包导入前设置进程级 7.5GB 虚拟内存软熔断。"""
    here = os.path.dirname(os.path.abspath(__file__))
    ops_root = os.path.dirname(here)
    if ops_root not in sys.path:
        sys.path.insert(0, ops_root)
    try:
        from bio_memory_guard import enable_memory_guard
        enable_memory_guard(7.5)
    except Exception as cause:  # noqa: BLE001 - 守卫失败不能阻断解释器启动
        _warn("7.5GB 内存守卫挂载失败: %s" % cause)


_install_memory_guard()


def _install_numpy_compat():
    """Keep legacy scientific packages working with current NumPy."""
    try:
        import numpy as np
        if not hasattr(np, "object"):
            np.object = object
    except Exception as cause:  # noqa: BLE001 - compatibility shim must not block startup
        _warn("NumPy legacy alias shim failed: %s" % cause)


_install_numpy_compat()


def _load_spec():
    """读 project.json 的 plot_layout_config。读不到返回 None（等于不介入）。"""
    path = os.environ.get(_ENV_PROJECT, "").strip()
    if not path or not os.path.isfile(path):
        return None
    try:
        import json
        with open(path, encoding="utf-8") as fh:
            project = json.load(fh)
    except (OSError, ValueError) as cause:
        _warn("读取 project.json 失败，跳过模板应用: %s" % cause)
        return None
    spec = project.get("plot_layout_config")
    if not isinstance(spec, dict):
        _warn("project.json 无 plot_layout_config，使用默认模板")
        spec = {}
    return spec


def _patch(spec):
    """给 Figure.savefig 包一层：落盘前应用模板。"""
    import matplotlib
    matplotlib.use("Agg", force=False)  # 手机/容器无显示面；已有后端时不动
    from matplotlib.figure import Figure

    if getattr(Figure.savefig, _MARK, False):
        return False

    # layout_helper 可能在同目录（部署时拷贝）或父目录 ops/（symlink 或直接引用）
    here = os.path.dirname(os.path.abspath(__file__))
    for candidate in (here, os.path.dirname(here)):
        if os.path.isfile(os.path.join(candidate, "layout_helper.py")):
            if candidate not in sys.path:
                sys.path.insert(0, candidate)
            break
    try:
        from layout_helper import apply_sci_plot_layout, normalize_layout_spec, figsize_for
    except ImportError as cause:
        _warn("找不到 layout_helper，跳过模板应用: %s" % cause)
        return False

    normalized = normalize_layout_spec(spec)
    original = Figure.savefig

    def savefig(self_fig, *args, **kwargs):
        try:
            axes = [a for a in self_fig.get_axes()]
            # 只处理单坐标轴图：分面图的图例属于各分面，统一搬移会互相挤扁
            # （docs/figure_spec.md §三之二 的豁免条款）
            if len(axes) == 1:
                apply_sci_plot_layout(self_fig, axes[0], normalized)
            else:
                # 多子图也要按模板定画幅，否则客户选的 16:9 不生效；
                # 图例不搬（分面图各有图例，统一搬移会互相挤扁）。
                # 同样只能放大不能缩小：压扁多子图会直接压掉分面标签。
                tpl_w, tpl_h = figsize_for(normalized["theme_rules"].get("aspect_ratio"))
                cur_w, cur_h = (float(v) for v in self_fig.get_size_inches())
                self_fig.set_size_inches(max(cur_w, tpl_w), max(cur_h, tpl_h))
                self_fig.set_dpi(normalized["dpi"])
        except Exception as cause:  # noqa: BLE001 - 模板失败绝不能中断出图
            _warn("应用模板失败（继续按原样落盘）: %s" % cause)

        # dpi 必须显式传：matplotlib 的 savefig.dpi="figure" 解析的是
        # rcParams["figure.dpi"]（默认 100），不是实例的 fig.set_dpi()。
        # 不显式注入的话，模板设了 300 也会落成 100 DPI。
        # 调用方显式给了 dpi（位置第 2 参或关键字）就尊重它。
        if len(args) < 2 and "dpi" not in kwargs:
            kwargs["dpi"] = normalized["dpi"]
        return original(self_fig, *args, **kwargs)

    setattr(savefig, _MARK, True)
    setattr(savefig, "_bioanalys_original", original)
    Figure.savefig = savefig
    return True


def _install():
    if os.environ.get(_ENV_DISABLE, "").strip() in ("1", "true", "yes"):
        return
    spec = _load_spec()
    if spec is None:
        return
    try:
        if _patch(spec):
            _warn("已挂载出图模板: %s" % (spec.get("template_id") or "template_4x3"))
    except Exception as cause:  # noqa: BLE001
        _warn("挂载失败: %s" % cause)
    # 主题层（字体族/线宽）：与模板同一处、同一套纪律；默认关，BIOANALYS_PY_THEME=1 才生效。
    # 只补覆盖对照表里两个真缺口，见 con_hf/dispatch/S4_python_theme_gap.md
    if os.environ.get("BIOANALYS_PY_THEME", "").strip() == "1":
        try:
            # fig_theme.py 在 ops/ 下（与 layout_autoload/ 同级），插上级目录
            sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            from fig_theme import apply_fig_theme
            applied = apply_fig_theme()
            _warn("已挂载 Python 主题（%d 项 rcParams）" % applied)
        except Exception as cause:  # noqa: BLE001
            _warn("主题挂载失败: %s" % cause)


_install()
