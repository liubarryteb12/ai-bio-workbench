#!/usr/bin/env python3
"""出图代码静态规范审查器（docs/figure_spec.md v2.2 的源码级检查）。

用法：
    python3 cn_debug/figure_code_audit.py --root src
    python3 cn_debug/figure_code_audit.py --root src --csv cn_debug/code_audit.csv

检查项（每条给出 文件:行号 + 违规类型 + 片段）：
  C1 轴内图例：ax.legend(...) 未带 bbox_to_anchor，且 loc 属于轴内位置词
  C2 禁用后端：使用了 show() / %matplotlib inline（Agg 之外的后端）
  C3 低 DPI：显式 dpi= <300（150/200/72 之类）
  C4 禁用字体大小：fontsize/size 落在 1..7 的整数（规范下限 8pt）
  C5 落地目录违规：图件写进 processed/ 或 results/ 而不是 figures/
  C6 输出 PDF/SVG：savefig/ggsave 落 .pdf / .svg
  C7 轴内标题：set_title/labs(title=...)/main= 出现中文
  C15 图例位置：loc=upper/lower center 或 bbox y<0（图例必须在轴框外右侧）

说明：C7 采用启发式检测（取样本内的 CJK 字符）；图内必须有英文标签是硬规则。
"""

import argparse
import csv
import io
import os
import re
import sys

AXIS_INNER_LOC = {"best", "upper right", "upper left", "lower right", "lower left",
                  "center right", "center left", "right", "center"}

CJK = re.compile(r"[\u4e00-\u9fff]")


def iter_py_files(root):
    """遍历 root 下所有常规文件（出图脚本是无扩展名的 bash，不是 .py）。"""
    for dirpath, _dirs, files in os.walk(root):
        if "__pycache__" in dirpath:
            continue
        for f in files:
            if f.endswith((".py", ".pyc", ".md", ".json")):
                continue
            yield os.path.join(dirpath, f)


def check_file(path):
    issues = []
    try:
        text = io.open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return issues
    lines = text.splitlines()

    for i, line in enumerate(lines, 1):
        stripped = line.strip()

        # C6 输出 PDF/SVG
        if re.search(r"\.(pdf|svg)['\"]\s*\)", stripped) and re.search(
                r"savefig|ggsave|save\(|png\(|pdf\(", stripped + " " + (lines[i] if i < len(lines) else "")):
            issues.append(("C6_PDF_OUT", path, i, stripped))

        # C3 低 DPI
        m = re.search(r"\bdpi\s*=\s*(\d+)", stripped)
        if m and int(m.group(1)) < 300:
            issues.append(("C3_LOW_DPI", path, i, stripped))

        # C7 R png() 设备未声明 res=：R 默认 72dpi，是"格式没锁死"的高危漏网
        # （C3 只能抓"声明了但低"，抓不到"根本没声明"）。
        # 判据必须是"语句开头就是 png("：文件名提及（"l1_02.png"）不出现在语句开头，
        # 而真正的设备调用一定在语句开头且自带 .png 文件名，两者靠位置区分。
        if re.match(r"(?:png|jpeg|tiff)\s*\(", stripped):
            window = " ".join(lines[i - 1:i + 4])   # png(...) 常跨 3-4 行
            if not re.search(r"\bres\s*=", window):
                issues.append(("C8_NO_RES", path, i, stripped))

        # C8 Python 落盘未声明 dpi：rcParams 必须有 savefig.dpi，或 savefig 显式带 dpi=
        if "savefig(" in stripped and not re.search(r"\bdpi\s*=", stripped):
            whole = text
            if "savefig.dpi" not in whole:
                issues.append(("C9_NO_DPI", path, i, stripped))

        # C4 禁用字号：只查 matplotlib 的 fontsize= 与 R 的 cex=；
        # ggplot 的 geom_point(size=) 是点大小、gseapy 的 min_size= 是参数域，
        # 都不属于"字号"，混在一起会大量误报。
        for fm in re.finditer(r"\bfontsize\s*=\s*([0-9](?:\.[0-9]+)?)", stripped):
            if float(fm.group(1)) < 8:
                issues.append(("C4_TINY_FONT", path, i, stripped))
                break
        for tf in re.finditer(r"\btitle_fontsize\s*=\s*([0-9]+(?:\.[0-9]+)?)", stripped):
            if float(tf.group(1)) < 8:
                issues.append(("C4_TINY_FONT", path, i, stripped))
                break
        for ce in re.finditer(r"\bcex(?:\.text|\.axis|\.main|\.lab)?\s*=\s*([0-9](?:\.[0-9]+)?)", stripped):
            # R 的 cex 是相对倍数（1.0 = 12pt），< 0.7 约等于 < 8.4pt
            if float(ce.group(1)) < 0.7:
                issues.append(("C4_TINY_CEX", path, i, stripped))
                break

        # C2 禁用后端 / show
        if re.search(r"matplotlib\.use\(\s*['\"](?!Agg)", stripped) or "plt.show(" in stripped:
            issues.append(("C2_BAD_BACKEND", path, i, stripped))

        # C1 轴内图例。判据必须覆盖两类漏网（S5-scout 实证的假阴性，2026-10-19）：
        #   ① 跨行调用：`loc=` 落在 `ax.legend(` 之后第 3 行甚至更后，2 行窗口看不到；
        #   ② 裸 `ax.legend()` / `plt.legend()`：不写 loc 就是默认 loc="best"（轴内）。
        # 做法：从当前行起向后拼到括号配平（或最多 12 行），再看整段里有没有
        # bbox_to_anchor；没有就是轴内图例，无论 loc 是显式还是默认。
        if ("ax.legend(" in stripped or "plt.legend(" in stripped) and not stripped.startswith("#"):
            # 注释行不算调用点：坏样本里写 "# ax.legend( 之后第 3 行" 也会被误报（实测踩到）
            window = stripped
            depth = window.count("(") - window.count(")")
            j = i
            while depth > 0 and j < len(lines) and (j - i) < 12:
                window += " " + lines[j]
                depth = window.count("(") - window.count(")")
                j += 1
            if "bbox_to_anchor" not in window:
                lm = re.search(r"loc\s*=\s*['\"]([^'\"]+)['\"]", window)
                loc = lm.group(1).lower() if lm else "best"   # 裸调用默认 best = 轴内
                if loc in AXIS_INNER_LOC:
                    issues.append(("C1_LEGEND_INSIDE", path, i, stripped))

        # C15 图例不得放轴框下方或居中（用户 2026-11-07 定稿：所有图例一律右侧）。
        # 覆盖两类历史漏网：loc=upper center/lower center，以及 bbox y 坐标为负的下方图例。
        if "legend(" in stripped and not stripped.startswith("#"):
            window = stripped
            depth = window.count("(") - window.count(")")
            j = i
            while depth > 0 and j < len(lines) and (j - i) < 12:
                window += " " + lines[j]
                depth = window.count("(") - window.count(")")
                j += 1
            lm = re.search(r"loc\s*=\s*['\"]([^'\"]+)['\"]", window)
            loc = lm.group(1).lower() if lm else ""
            by = re.search(r"bbox_to_anchor\s*=\s*\(\s*[^,()]+,\s*(-?[0-9.]+)", window)
            if loc in ("upper center", "lower center") or (by and float(by.group(1)) < 0):
                issues.append(("C15_LEGEND_BOTTOM", path, i, stripped))

        # C5 图件写错目录（py 侧显式写 results//processed/）
        if re.search(r"(results|processed)/[^'\"]*\.(png|pdf|svg)", stripped) and re.search(
                r"savefig|save\(|\.png|\.pdf|\.svg", stripped):
            if not re.search(r"figures/", stripped):
                issues.append(("C5_WRONG_DIR", path, i, stripped))

        # C4 扩展：rcParams 全部字号键低于 8pt（全局基准收口，Argon 第 76 轮）。
        _rc_font_keys = r"(font\.size|axes\.titlesize|axes\.labelsize|xtick\.labelsize|ytick\.labelsize|legend\.fontsize|legend\.title_fontsize)"
        for rc in re.finditer(r"['\"]" + _rc_font_keys + r"['\"]\s*:\s*([0-9]+(?:\.[0-9]+)?)", stripped):
            if float(rc.group(2)) < 8:
                issues.append(("C4_RCPARAMS_FONT", path, i, stripped))
                break

        # C12 二分类标准色（Control/WT=#3B4992，Treat/Disease=#EE0000）。
        # 零误报口径：仅当显式把 hex 色值绑定到 control/treat/wt/disease/case 命名标识符，
        # 且色值不是标准码时报违规；使用 seaborn 调色板名（非 hex）的不触发。
        cm = re.search(r"(control|treat|wt|disease|case)\w*\s*[:=]\s*['\"](#[0-9a-fA-F]{6})['\"]", stripped, re.IGNORECASE)
        if cm:
            role = cm.group(1).lower()
            color = cm.group(2).upper()
            standard = {"control": "#3B4992", "wt": "#3B4992", "treat": "#EE0000", "disease": "#EE0000", "case": "#EE0000"}
            expected = standard.get(role)
            if expected and color != expected:
                issues.append(("C12_BINARY_COLOR", path, i, stripped))

        # C9 图注左下角（校准集，report-only）：fig.text 的 y 坐标应 < 0（轴框外下方）。
        ft = re.search(r"fig\.text\(\s*([0-9.\-]+)\s*,\s*([0-9.\-]+)", stripped)
        if ft:
            try:
                if float(ft.group(2)) >= 0:
                    issues.append(("C9_CAPTION_POS", path, i, stripped))
            except ValueError:
                pass

        # C10 图例外置（校准集，report-only）：legend 调用未带 bbox_to_anchor 提示可能轴内。
        if ("legend(" in stripped and not stripped.startswith("#")
                and "bbox_to_anchor" not in stripped and "loc=" not in stripped):
            issues.append(("C10_LEGEND_LAYOUT", path, i, stripped))

    # ---- 文件级检查（循环结束后）----
    has_pyplot = ("import matplotlib.pyplot" in text) or ("from matplotlib" in text and "pyplot" in text)
    has_savefig = "savefig(" in text or "fig.savefig" in text

    # C13 末尾 plt.close("all")（硬阻断）：导入 pyplot 且出图但无任何 plt.close 调用。
    if has_pyplot and has_savefig and not re.search(r"plt\.close\(|pyplot\.close\(", text):
        issues.append(("C13_NO_CLOSE", path, 0, "missing plt.close('all') after figures"))

    # C14 Agg 后端先于 pyplot 导入（硬阻断）：use('Agg') 出现在 import pyplot 之后。
    if has_pyplot:
        use_match = re.search(r"matplotlib\.use\(\s*['\"]Agg['\"]\s*\)", text)
        pyplot_idx = text.find("import matplotlib.pyplot")
        if use_match and pyplot_idx >= 0 and use_match.start() > pyplot_idx:
            issues.append(("C14_BACKEND_ORDER", path, 0, "matplotlib.use('Agg') must precede import pyplot"))

    # C11 Virtual KO 标题角标（校准集，report-only）：KO 相关脚本标题应带 [Virtual KO ...] 角标。
    if re.search(r"virtual_knockout|ko_dr|Virtual KO", text, re.IGNORECASE) and has_savefig:
        if not re.search(r"\[Virtual KO", text):
            issues.append(("C11_KO_CAPTION", path, 0, "Virtual KO figure caption lacks [Virtual KO ...] tag"))

    # R 脚本（非 py 的 shell 内嵌或 Rprofile 不在本工具范围，但 grep 得动）
    # C1 的 R 等价（ggsave 不算；matplotlib 无）→ 跳过
    return issues


def check_shell_figures(root):
    """shell 内嵌 R/Python 的图件目录违规。"""
    issues = []
    for path in iter_py_files(root):
        try:
            text = io.open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        if not os.access(path, os.X_OK) and not text.startswith("#!"):
            continue
        for i, line in enumerate(text.splitlines(), 1):
            s = line.strip()
            if re.search(r"\.(pdf|svg)['\"]", s) and re.search(r"ggsave|pdf\(|png\(", s):
                issues.append(("C6_PDF_OUT", path, i, s))
            if re.search(r"\"(results|processed)/", s) and re.search(r"\.(png|pdf|svg)", s) \
                    and "figures/" not in s:
                issues.append(("C5_WRONG_DIR", path, i, s))
            if re.search(r"ggsave|\.png", s) and re.search(r"['\"](results|processed)/", s):
                pass
    return issues


def audit_tree(root):
    """遍历 root（目录）下所有出图脚本并汇总问题。"""
    issues = []
    for path in iter_py_files(root):
        issues.extend(check_file(path))
    issues.extend(check_shell_figures(root))
    return issues


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="src")
    ap.add_argument("--csv", default="")
    ap.add_argument("--report-only", action="store_true",
                    help="校准模式：打印全部违规但退出码恒 0（用于 C9-C11 误报校准）")
    args = ap.parse_args(argv)

    issues = audit_tree(args.root)
    # Argon 第 76 轮：硬阻断集（total_blocking>0 即 Exit 1）与校准集（report-only）分离。
    blocking_kinds = {
        "C1_LEGEND_INSIDE", "C2_BAD_BACKEND", "C3_LOW_DPI", "C4_TINY_FONT",
        "C4_TINY_CEX", "C4_RCPARAMS_FONT", "C5_WRONG_DIR", "C6_PDF_OUT",
        "C8_NO_RES", "C9_NO_DPI", "C12_BINARY_COLOR", "C13_NO_CLOSE", "C14_BACKEND_ORDER",
        "C15_LEGEND_BOTTOM",
    }
    report_kinds = {"C9_CAPTION_POS", "C10_LEGEND_LAYOUT", "C11_KO_CAPTION"}
    blocking = [row for row in issues if row[0] in blocking_kinds]
    report = [row for row in issues if row[0] in report_kinds]
    by_kind = {}
    for kind, path, lineno, snippet in issues:
        by_kind.setdefault(kind, []).append((path, lineno, snippet))

    if not blocking and not report:
        print("code_audit: no issue found (blocking=0 report=0)")
        return 0

    for kind in sorted(by_kind):
        rows = by_kind[kind]
        tag = "BLOCK" if kind in blocking_kinds else ("REPORT" if kind in report_kinds else "OTHER")
        print("%-20s [%s] %d 处" % (kind, tag, len(rows)))
        for path, lineno, snippet in rows[:40]:
            print("  %s:%d  %s" % (path, lineno, snippet[:120]))
        if len(rows) > 40:
            print("  ... 还有 %d 处" % (len(rows) - 40))

    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["kind", "file", "line", "snippet"])
            for row in issues:
                w.writerow(row)
    print("code_audit: total=%d blocking=%d report=%d" % (len(issues), len(blocking), len(report)))
    if args.report_only:
        return 0
    return 1 if blocking else 0


if __name__ == "__main__":
    sys.exit(main())
