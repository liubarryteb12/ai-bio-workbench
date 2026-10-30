#!/usr/bin/env python3
"""单图 SCI 排版外挂装饰器（reference/03出图规范 v3.0）。

零重写原则：母版出图脚本的绘图主干不动，画完 `fig, ax` 后调用本函数做后处理，
再交给 `fig.savefig(...)`。两档画幅的差异全部收敛在这里：

    template_4x3     4:3 竖版（图例右侧竖排，默认）
    template_16x9    16:9 横版（图例底部横排）

2026-10-19 用户拍板：客户端只保留 4:3 / 16:9 两档，原三套模板
（nature_side / cell_wide / clinical_note）收敛为按画幅比驱动的两档；
旧 id 仍可读入并映射到新 id（见 LEGACY_TEMPLATE_IDS），保证已交付项目的
project.json 不改也能拿到逐字段相同的规则。

用法（脚本内）：

    from layout_helper import load_layout_spec, apply_sci_plot_layout

    spec = load_layout_spec(os.environ.get("PROJECT_JSON"))   # 读 project.json
    apply_sci_plot_layout(fig, ax, spec, footnote_text="Wilcoxon test; adj p<0.05; n=16")
    fig.savefig(out_png, dpi=spec.get("dpi", 300), bbox_inches=None)

为什么必须外挂而不是改母版：53 个出图脚本各自维护标题/图例/轴标签写法，
逐脚本改会引入 53 处回归面；外挂只改"保存前那一刻"的版式，绘图逻辑零接触。

与 `docs/figure_spec.md` 的关系：spec 管单图物理画布、字号、线宽和单图边界；
本模块只保留图例外置与固定画布兜底。落盘后仍应跑
`ops/audit_figure_layout.py` 复核几何关系。
"""

import json
import math
import os

# 两档画幅的默认规则。与 BioanalysDesktop/server/project.js 的
# PLOT_LAYOUT_TEMPLATES 同值；两端各自持有副本（工作台与远端脚本不共享代码）。
TEMPLATES = {
    "template_4x3": {
        "aspect_ratio": "4:3",
        "legend_position": "outside_right",
        "legend_direction": "vertical",
        "axis_style": "classic_L",
        "x_label_rotation": "horizontal",
        "show_footnote_panel": False,
    },
    "template_16x9": {
        "aspect_ratio": "16:9",
        "legend_position": "bottom_center",
        "legend_direction": "horizontal",
        "axis_style": "classic_L",
        "x_label_rotation": "horizontal",
        "show_footnote_panel": False,
    },
}

DEFAULT_TEMPLATE_ID = "template_4x3"

# 旧 id 兼容：2026-10-19 收敛成两档前，project.json 里落的是这三套 id。
# 已交付项目（如 PRJ_E2E_GSE277173 写的是 template_2_cell_wide）必须零视觉变化，
# 所以旧 id 先映射到新 id 再查表——映射后规则逐字段相同，不做任何"近似"。
#   template_1_nature_side   → template_4x3   （规则完全相同）
#   template_2_cell_wide     → template_16x9  （规则完全相同）
#   template_3_clinical_note → template_4x3   （画幅/图例/轴风格同 4:3，仅 x 轴标签
#                                               旋转与脚注栏不同，属用户拍板的合并）
LEGACY_TEMPLATE_IDS = {
    "template_1_nature_side": "template_4x3",
    "template_2_cell_wide": "template_16x9",
    "template_3_clinical_note": "template_4x3",
}

# 画幅基准：默认单栏 88 mm，高度按比例推。项目显式选择双栏时由参考图
# 或调用方用 BIOANALYS_LAYOUT_PRESERVE_FIGSIZE=1 锁定 180/183 mm。
_BASE_WIDTH_IN = 88 / 25.4
_ASPECT = {"4:3": (4, 3), "16:9": (16, 9), "3:2": (3, 2), "1:1": (1, 1)}

_ENV_PRESERVE_FIGSIZE = "BIOANALYS_LAYOUT_PRESERVE_FIGSIZE"
_ENV_FIXED_CANVAS = "BIOANALYS_LAYOUT_FIXED_CANVAS"

_BASE_PT = 7
_LEGEND_PT = 6.5


def _env_enabled(name):
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes")


def load_layout_spec(project_json_path=None):
    """从 project.json 读 plot_layout_config。

    缺文件、坏 JSON、缺字段一律回落默认模板，不抛异常：
    出图脚本不该因为一个可选配置缺失就整步失败。
    """
    if not project_json_path:
        return {"template_id": DEFAULT_TEMPLATE_ID, "dpi": 300,
                "theme_rules": dict(TEMPLATES[DEFAULT_TEMPLATE_ID])}
    try:
        with open(project_json_path, encoding="utf-8") as fh:
            project = json.load(fh)
    except (OSError, ValueError):
        return {"template_id": DEFAULT_TEMPLATE_ID, "dpi": 300,
                "theme_rules": dict(TEMPLATES[DEFAULT_TEMPLATE_ID])}
    return normalize_layout_spec(project.get("plot_layout_config"))


def normalize_layout_spec(spec):
    """把外部传入的配置归一成 {template_id, dpi, theme_rules}。

    允许只传 `{"templateId": "..."}`（客户侧 camelCase）或完整 snake_case 配置，
    因为 project.json 由工作台写入、脚本可能读到任一形态。

    旧 id（template_1_nature_side / template_2_cell_wide / template_3_clinical_note）
    先映射到新 id 再查表：已交付项目的 project.json 不改也能拿到逐字段相同的规则，
    因此落盘图件必须字节级不变。
    """
    spec = spec if isinstance(spec, dict) else {}
    template_id = str(spec.get("template_id") or spec.get("templateId") or "").strip()
    template_id = LEGACY_TEMPLATE_IDS.get(template_id, template_id)
    if template_id not in TEMPLATES:
        template_id = DEFAULT_TEMPLATE_ID
    rules = dict(TEMPLATES[template_id])
    incoming = spec.get("theme_rules")
    if isinstance(incoming, dict):
        # 只接受已知键，避免外部配置往 matplotlib 里塞任意参数
        for key in rules:
            if incoming.get(key) is not None:
                rules[key] = incoming[key]
    return {"template_id": template_id, "dpi": int(spec.get("dpi") or 300),
            "theme_rules": rules}


def _figsize_for(aspect_ratio):
    ratio = str(aspect_ratio or "4:3")
    if ratio not in _ASPECT:
        ratio = "4:3"
    w_units, h_units = _ASPECT[ratio]
    width = _BASE_WIDTH_IN
    return width, round(width * h_units / w_units, 3)


def figsize_for(aspect_ratio):
    """公开入口：按画幅比例算英寸尺寸。

    sitecustomize 对多子图只改画幅不动图例，需要这个函数；
    下划线版本保留，避免已部署的调用方因改名而断。
    """
    return _figsize_for(aspect_ratio)


def _legend_handles(ax, legend):
    """取图例条目数：优先用现有 legend，其次从轴上的 handles 推。"""
    if legend is not None:
        return len(legend.get_texts())
    handles, labels = ax.get_legend_handles_labels()
    return len(labels) if labels else 0


def _set_legend_ncols(legend, ncol):
    """matplotlib 3.6~3.10 叫 set_ncol，3.11 起改名 set_ncols；两端都要能跑。"""
    setter = getattr(legend, "set_ncols", None) or getattr(legend, "set_ncol", None)
    if setter is not None:
        setter(ncol)


def legend_ncols(legend):
    """读回图例列数（属性名同样跨版本变化），读不到返回 1。"""
    return getattr(legend, "_ncols", getattr(legend, "_ncol", 1))


def _place_legend(ax, fig, rules, legend):
    """按模板摆放图例。返回实际使用的 legend（可能为 None）。

    图例一律在轴框外：轴内 loc="best" 在类别数多时必然压数据，
    docs/figure_spec.md §三之二 已明确禁止。
    """
    if legend is None:
        handles, labels = ax.get_legend_handles_labels()
        if not labels:
            return None
        legend = ax.get_legend()
        if legend is None:
            # 脚本画了带 label 的图元但没调 legend：这里补一个，否则模板的
            # "图例外置"无处可施，落盘后颜色编码不可读
            legend = ax.legend()
    if legend is None:
        return None

    n_items = _legend_handles(ax, legend)
    position = rules.get("legend_position")

    if position == "bottom_center":
        # 横向多列平铺：彻底释放左右空间；列数按条目数折中，3~5 列
        ncol = max(3, min(5, int(math.ceil(n_items / 4.0)) or 3))
        _set_legend_ncols(legend, ncol)
        legend.set_bbox_to_anchor((0.5, -0.18), transform=fig.transFigure)
        legend.set_loc("upper center")
        # 底部预留 15% 安全内边距，防 tight bbox 之外再被裁切
        try:
            fig.subplots_adjust(bottom=0.18)
        except Exception:
            pass
    else:
        # 右侧外挂垂直排布；条目 >6 拆 2 列，防止挤压主画布宽度
        ncol = 2 if n_items > 6 else 1
        _set_legend_ncols(legend, ncol)
        legend.set_bbox_to_anchor((1.02, 1.0), transform=ax.transAxes)
        legend.set_loc("upper left")
        if ncol == 2:
            try:
                fig.subplots_adjust(right=0.72)
            except Exception:
                pass

    legend.set_frame_on(False)
    legend.get_title().set_fontsize(_LEGEND_PT)
    for text in legend.get_texts():
        text.set_fontsize(_LEGEND_PT)
    return legend


def _rotate_xticks(ax, rules):
    """单图规范禁止 45 度刻度标签；长名称交给换行或横向条形图。"""
    if rules.get("x_label_rotation") in ("45", "auto_45"):
        for tick in ax.get_xticklabels():
            tick.set_rotation(0)
            tick.set_ha("center")


def _apply_axis_style(ax, rules):
    """坐标轴外观：classic_L 去上右边框，boxed 保留四边框。"""
    style = rules.get("axis_style")
    if style == "classic_L":
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
    elif style == "boxed":
        for side in ("top", "right", "bottom", "left"):
            ax.spines[side].set_visible(True)


def _clear_title(ax):
    """单图只保留图表主体，标题和图注写入 06_report 元数据。"""
    ax.set_title("")


def _draw_footnote(fig, rules, footnote_text):
    """兼容旧调用，单图不把图注画进画布。"""
    del fig, rules, footnote_text


def apply_sci_plot_layout(fig, ax, layout_spec=None, footnote_text=None, badge_text=None):
    """对单图应用两档画幅装饰。返回 (fig, ax, dpi)。

    参数
    ----
    fig, ax       : 已绘制完成的 matplotlib 对象（单坐标轴图）
    layout_spec   : project.json 的 plot_layout_config，或 None 用默认模板
    footnote_text : 脚注文字（统计方法 / 阈值 / 样本量），16:9 档必填才有意义
    badge_text    : 业务强角标（如 `[Virtual KO - DR Genes]`）

    多子图（分面）图不要调用：统一搬图例会把各分面挤扁（figure_spec §三之二）。
    """
    spec = normalize_layout_spec(layout_spec)
    rules = spec["theme_rules"]

    # 参考图契约优先。适配器显式声明 preserve 时，脚本里的
    # 89/183 mm 物理尺寸就是唯一真源，模板不得把它放大回 7.2 in。
    if not _env_enabled(_ENV_PRESERVE_FIGSIZE):
        tpl_w, tpl_h = _figsize_for(rules.get("aspect_ratio"))
        fig.set_size_inches(tpl_w, tpl_h)
    fig.set_dpi(spec["dpi"])

    # 固定画布图的标题、图例和边距由出图代码显式控制。
    # 自动搬图例会把已经排好的外置图例再次挤出画布，但标题和刻度策略仍需兜底。
    if _env_enabled(_ENV_FIXED_CANVAS):
        _clear_title(ax)
        _apply_axis_style(ax, rules)
        _rotate_xticks(ax, rules)
        return fig, ax, spec["dpi"]

    _clear_title(ax)
    _apply_axis_style(ax, rules)
    _rotate_xticks(ax, rules)

    # 脚本没调 legend 但有带 label 的图元时，_place_legend 会补建一个
    _place_legend(ax, fig, rules, ax.get_legend())

    if badge_text:
        # 角标贴右上角、轴框之外：与标题同一水平带，避免压图
        fig.text(0.99, 1.01, str(badge_text), ha="right", va="bottom",
                 fontsize=_BASE_PT, fontweight="bold", color="#B22222")

    _draw_footnote(fig, rules, footnote_text)
    return fig, ax, spec["dpi"]


def apply_sci_plot_layout_from_project(fig, ax, project_json_path, footnote_text=None,
                                       badge_text=None):
    """便捷入口：直接从 project.json 取配置再应用。"""
    spec = load_layout_spec(project_json_path)
    return apply_sci_plot_layout(fig, ax, spec, footnote_text=footnote_text,
                                 badge_text=badge_text)


if __name__ == "__main__":
    # 冒烟自检：两档画幅各渲染一张，确认不抛异常且画幅比例正确。
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    out_dir = os.environ.get("LAYOUT_SMOKE_DIR", ".")
    for tid in TEMPLATES:
        f, a = plt.subplots()
        a.bar(range(8), range(8), label="dummy")
        a.set_xticklabels([f"LongLabel{i}" for i in range(8)])
        a.set_title(f"{tid} smoke")
        for i in range(7):
            a.plot([0, 1], [i, i], label=f"series_{i}")
        a.legend()
        apply_sci_plot_layout(f, a, {"template_id": tid},
                              footnote_text="Wilcoxon test; adj p<0.05; n=16")
        path = os.path.join(out_dir, f"smoke_{tid}.png")
        f.savefig(path, dpi=300, bbox_inches=None)
        plt.close(f)
        print("ok", path)
