#!/usr/bin/env python3
"""layout_helper 三模板验证（真渲染 + 复用 ops/audit_figure_layout.py 的几何判定）。

为什么用审计器当判据：模板的承诺是"图例在轴框外、脚注不压轴框、标签不重叠"，
这些是几何关系，肉眼看不稳；audit_fig 已经把这套判定固化成机器判据，
复用它比自己再写一套断言更可信。

跑法：
    python cn_debug/2026-10-18_verification_layout_helper.py
退出码：0 = 全过；1 = 有断言失败。
"""

import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "ops"))

from layout_helper import (  # noqa: E402
    TEMPLATES, load_layout_spec, normalize_layout_spec, apply_sci_plot_layout,
    legend_ncols,
)
import audit_figure_layout as afl  # noqa: E402

OUT_DIR = os.path.join(HERE, "figures")
os.makedirs(OUT_DIR, exist_ok=True)

failed = 0


def check(label, cond, detail=""):
    global failed
    if not cond:
        failed += 1
    print("%s | %s%s" % ("PASS" if cond else "FAIL", label, (" | " + detail) if detail else ""))


def build_fig(n_legend=8, long_labels=True):
    """造一张"最坏情况"图：8 个图例条目 + 长 X 轴标签（模板差异最明显）。"""
    fig, ax = plt.subplots()
    labels = ["Non_Lesional_Ctrl", "Lesional_Week2", "Lesional_Week4",
              "Lesional_Week8", "Treated_Week2", "Treated_Week4",
              "Treated_Week8", "Recurrence"][:n_legend]
    vals = list(range(len(labels)))
    for i, v in enumerate(vals):
        ax.bar(i, v, label=labels[i] if i < n_legend else None)
    if long_labels:
        ax.set_xticks(vals)
        ax.set_xticklabels(labels)
    ax.set_title("DEG counts by group")
    ax.set_ylabel("Gene count")
    return fig, ax


# ---------- 1. 配置归一化 ----------
check("默认模板为 template_1_nature_side",
      normalize_layout_spec(None)["template_id"] == "template_1_nature_side")
check("非法模板 id 回落默认",
      normalize_layout_spec({"templateId": "nope"})["template_id"] == "template_1_nature_side")
check("camelCase 模板 id 可识别",
      normalize_layout_spec({"templateId": "template_2_cell_wide"})["template_id"] == "template_2_cell_wide")
check("dpi 缺省 300", normalize_layout_spec({})["dpi"] == 300)
check("读不存在的 project.json 不抛错",
      load_layout_spec(os.path.join(HERE, "no_such_project.json"))["template_id"] == "template_1_nature_side")

# 未知 theme_rules 键不得透传（外部配置不能往 matplotlib 塞任意参数）
spec = normalize_layout_spec({"templateId": "template_1_nature_side",
                              "theme_rules": {"legend_position": "outside_right",
                                              "evil_key": "boom"}})
check("theme_rules 只接受已知键", "evil_key" not in spec["theme_rules"])

# ---------- 2. 三模板真渲染 + 几何审计 ----------
for tid, rules in TEMPLATES.items():
    fig, ax = build_fig()
    fig2, ax2, dpi = apply_sci_plot_layout(
        fig, ax, {"template_id": tid},
        footnote_text="Wilcoxon rank-sum; adj p<0.05; n=16",
        badge_text="[Virtual KO - DR Genes]" if tid == "template_3_clinical_note" else None)

    viol, info = afl.audit_fig(fig2, tid)
    check("%s 几何审计无违规" % tid, not viol, "; ".join(viol)[:160])

    w, h = fig2.get_size_inches()
    ratio = round(w / h, 3)
    expected = {"template_1_nature_side": round(4 / 3, 3),
                "template_2_cell_wide": round(16 / 9, 3),
                "template_3_clinical_note": round(4 / 3, 3)}[tid]
    check("%s 画幅比例 %.2f" % (tid, ratio), abs(ratio - expected) < 0.02)

    leg = ax2.get_legend()
    check("%s 图例存在且在轴框外" % tid, leg is not None)

    if tid == "template_1_nature_side":
        check("模板1：8 条目图例拆 2 列", legend_ncols(leg) == 2, "ncols=%s" % legend_ncols(leg))
        ticks = [t for t in ax2.get_xticklabels() if t.get_text()]
        check("模板1：长标签 + 多类别触发 45°",
              all(abs(t.get_rotation() - 45) < 0.1 for t in ticks))
        check("模板1：右上与右边框隐藏（classic_L）",
              not ax2.spines["top"].get_visible() and not ax2.spines["right"].get_visible())
        check("模板1：无脚注栏",
              not any("Wilcoxon" in t.get_text() for t in fig2.texts))
    elif tid == "template_2_cell_wide":
        check("模板2：图例横向多列（3~5）", 3 <= legend_ncols(leg) <= 5, "ncols=%s" % legend_ncols(leg))
        check("模板2：四边框保留（boxed）",
              ax2.spines["top"].get_visible() and ax2.spines["right"].get_visible())
        check("模板2：带脚注",
              any("Wilcoxon" in t.get_text() for t in fig2.texts))
    else:
        check("模板3：带浅灰脚注栏",
              any("Wilcoxon" in t.get_text() for t in fig2.texts))
        check("模板3：带业务强角标",
              any("Virtual KO" in t.get_text() for t in fig2.texts))

    check("%s 返回 dpi=300" % tid, dpi == 300)
    path = os.path.join(OUT_DIR, "verify_%s.png" % tid)
    fig2.savefig(path, dpi=dpi, bbox_inches="tight")
    plt.close(fig2)
    check("%s 落盘成功" % tid, os.path.getsize(path) > 10000, "%d bytes" % os.path.getsize(path))

# ---------- 3. 无图例 / 无标题的图不得崩 ----------
fig, ax = plt.subplots()
ax.plot([0, 1], [1, 0])
apply_sci_plot_layout(fig, ax, {"template_id": "template_1_nature_side"})
check("无图例无标题不抛错", True)
plt.close(fig)

print("\n%s" % ("全部符合预期" if failed == 0 else "%d 条不符合预期" % failed))
sys.exit(0 if failed == 0 else 1)
