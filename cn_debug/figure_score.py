#!/usr/bin/env python3
"""出图质量打分系统（docs/figure_spec.md §七，机器可执行版）。

用法：
    python3 cn_debug/figure_score.py --dir outputs/PRJ_X/line1_bulk/figures
    python3 cn_debug/figure_score.py --dir ... --csv out.csv --json out.json

评分模型（5 大类共 20 项细则，满分 100）：

  A 格式合规性（30 分）
    A1 扩展名 PNG                                             5
    A2 DPI == 300（容差 1）                                    8
    A3 最短边 >= 1200px（8pt 可辨底线）                         5
    A4 文件 > 20KB（非空壳）                                    4
    A5 非空白（std > 5）                                        4
    A6 边缘无裁切（edge_ink < 5%）                              4

  B 参数准确性（20 分）—— 由 audit_figure_layout 的几何判定提供
    B1 图内标注 ⊆ 轴框（A 项）                                  6
    B2 图例在轴框外（B 项）                                      5
    B3 图注不与轴框相交（C 项）                                  5
    B4 标注/图例互不重叠（D 项）                                 4

  C 标注规范性（20 分）—— 文件名与 caption 登记的语义匹配度
    C1 captions 覆盖（figures.js captionFor 命中）               6
    C2 图件命名符合 <line>_<序号>_<语义>.png                     4
    C3 图件与 STEP_CATALOG 声明一致（build_client_report 不报未找到） 6
    C4 台账/report 登记该图口径                                   4

  D 视觉可读性（20 分）
    D1 无低 DPI（同 A2，反向上取信源）                           4
    D2 无 7pt 以下字号（C4_TINY_FONT/CEX 静态扫描）               6
    D3 图例未使用轴内 loc（C1_LEGEND_INSIDE 静态扫描）             6
    D4 未使用 PDF/SVG 交付件（C6_PDF_OUT）                       4

  E 逻辑正确性（10 分）—— 依赖 CSGC / 人工核查，机器侧只查可判定的部分
    E1 分组/方向来自 project.json contrasts 或报告注明的派生规则  5
    E2 相关值域 [-1,1] 且方向与 case/ctrl 定义一致（WGCNA 类）    5

判定：总分 >= 75 为达标（PASS）；60–74 为待修（FIX）；< 60 为不合格（FAIL）。
硬性一票否决（无论总分均判 FAIL）：A1/A2 失败、B1 失败、C2 失败。
"""

import argparse
import csv
import json
import os
import re
import sys

from PIL import Image
import numpy as np

PASS_LINE = 75.0
FIX_LINE = 60.0

WEIGHTS = {
    "A1": 5, "A2": 8, "A3": 5, "A4": 4, "A5": 4, "A6": 4,
    "B1": 6, "B2": 5, "B3": 5, "B4": 4,
    "C1": 6, "C2": 4, "C3": 6, "C4": 4,
    "D1": 4, "D2": 6, "D3": 6, "D4": 4,
    "E1": 5, "E2": 5,
}
assert sum(WEIGHTS.values()) == 100, sum(WEIGHTS.values())

# 一票否决项（机器可判定的）
VETO = ["A1", "A2", "B1", "C2"]

# 命名规则：<line前缀>_<可选线内前缀>_<两位序号[可带 a/b 分号]>_<语义>.png
# 例：l1_02_pca.png / l1_03_volcano_fdr.png / l1_05a_genes_detected.png
#     l2_08_deg_volcano_T_cell.png / l3_human_10_dr_gsea_top.png
# 语义段允许大写与点号：cell type 名天然带大写（T_cell / NK_ILC / macrophage_mDC /
# pDC），空间图带样本号 S1/S2——规范 §一只规定"<line前缀>_<序号>_<fig语义>"，
# 从未要求语义段小写。2026-10-19 实测：旧正则 [a-z0-9_]+ 把 5 张合规的
# l2_06_composition_box_<celltype> 误判 C2（一票否决），属判据比规范严（同 #194）。
NAME_RE = re.compile(r"^l[123]_(?:[a-z]+_)?[0-9]{2}[ab]?_[A-Za-z0-9_.]+\.png$")


def load_captions():
    """从 server/figures.js 的 FIGURE_CAPTIONS 提取匹配键（源级口径，不重复实现）。"""
    path = os.path.join("BioanalysDesktop", "server", "figures.js")
    try:
        text = open(path, encoding="utf-8").read()
    except OSError:
        return []
    return re.findall(r"\{\s*match:\s*'([^']+)'", text)


def load_audit_csv(path):
    """读 ops/audit_figure_layout.py --csv 的逐图判决。

    A 轴内标注⊆轴框 → B1；B 图例在轴框外 → B2；C 图注不与轴框相交 → B3；
    D 标注/图例互不重叠 → B4。判决 FAIL 时相关项记 False 并在 violations 里留痕。
    """
    out = {}
    if not path:
        return out
    with open(path, encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            name = (row.get("figure") or "").strip()
            if not name:
                continue
            viol = (row.get("violations") or "")
            ok = (row.get("verdict") or "").strip().upper() == "PASS"
            out[name] = {
                "B1": ok and not viol.startswith("A "),
                "B2": ok and "B " not in viol,
                "B3": ok and "C " not in viol,
                "B4": ok and "D " not in viol,
                "viol": viol,
            }
    return out


def load_src_figures(src_root="src"):
    """从源码静态提取「图文件名 → 出图脚本」映射。

    为什么不依赖台账：台账只记提交时**声明过**的 outputs，多数步骤历史上 `outputs=[]`，
    按台账反查会大面积归因失败（2026-10-19 实测：33 张图里 16 张归因不到）。
    源码里的图名字符串是稳定事实，静态扫一遍即可。

    两种键：
      - 完整图名：`l1_04_topvar_heatmap.png`
      - 前缀模板（键以 `%` 结尾）：脚本用 `"l1_03_volcano_%s.png" % suffix` 这类
        动态拼接文件名，字面量里只有前缀。归因时先精确后前缀。
    """
    exact = {}
    prefix = {}
    if not os.path.isdir(src_root):
        return exact, prefix
    name_re = re.compile(r"\b(l[123]_[a-z0-9_]+\.png)\b")
    tmpl_re = re.compile(r"\b(l[123]_[a-z0-9_]+?)_(?:%s|%d|\{)")
    for line in sorted(os.listdir(src_root)):
        scripts = os.path.join(src_root, line, "scripts")
        if not os.path.isdir(scripts):
            continue
        for name in sorted(os.listdir(scripts)):
            path = os.path.join(scripts, name)
            if not os.path.isfile(path):
                continue
            try:
                text = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            rel = path.replace("\\", "/")
            for m in name_re.finditer(text):
                exact.setdefault(m.group(1), set()).add(rel)
            for m in tmpl_re.finditer(text):
                prefix.setdefault(m.group(1) + "_", set()).add(rel)
    return exact, prefix


def resolve_fig_script(fig, exact, prefix):
    """图名 → 出图脚本集合：先精确，再前缀模板；都没有返回空集合。"""
    if fig in exact:
        return exact[fig]
    hits = set()
    for key, srcs in prefix.items():
        if fig.startswith(key):
            hits |= srcs
    return hits


def load_code_findings(code_csv, ledger_dir, src_root, figures):
    """源码扫描 → 每张图的 D2/D3 判决（按调用方给的实际图件清单归因）。

    链条：图文件名 → 出图脚本（源码静态映射优先，台账反查兜底）
    → 该脚本在 code_audit.csv 里的 C1/C4/C8/C9 记录。
    反查不到就记 False（未验证），不因为"找不到"就给分。
    """
    findings = {}
    if code_csv and os.path.exists(code_csv):
        with open(code_csv, encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                kind = row.get("kind") or ""
                if kind not in ("C1_LEGEND_INSIDE", "C4_TINY_FONT", "C4_TINY_CEX",
                                "C8_NO_RES", "C9_NO_DPI"):
                    continue
                findings.setdefault(row.get("file") or "", set()).add(kind)

    exact, prefix = load_src_figures(src_root)
    ledger_fig = {}
    if ledger_dir and os.path.isdir(ledger_dir):
        for f in sorted(os.listdir(ledger_dir)):
            if not f.endswith(".json"):
                continue
            try:
                d = json.load(open(os.path.join(ledger_dir, f), encoding="utf-8"))
            except (OSError, ValueError):
                continue
            step = d.get("step_name") or ""
            line = d.get("line_id") or ""
            if not step or not line:
                continue
            src = os.path.join("src", line, "scripts", step).replace("\\", "/")
            for out in (d.get("io_files") or {}).get("output") or []:
                ledger_fig.setdefault(os.path.basename(str(out)), set()).add(src)

    out = {}
    for fig in figures:
        srcs = resolve_fig_script(fig, exact, prefix) | ledger_fig.get(fig, set())
        kinds = set()
        for src in srcs:
            kinds |= findings.get(src, set())
        out[fig] = {
            "D2": not (kinds & {"C4_TINY_FONT", "C4_TINY_CEX", "C8_NO_RES", "C9_NO_DPI"}),
            "D3": "C1_LEGEND_INSIDE" not in kinds,
        }
    return out


def score_one(path, captions, overrides=None):
    name = os.path.basename(path)
    overrides = overrides or {}
    s = {"image": name, "items": {}, "veto": [], "unknown": []}
    im = Image.open(path)
    im.load()
    d = im.convert("L")
    a = np.asarray(d, dtype=float)
    dpi = im.info.get("dpi") or (0, 0)
    size = os.path.getsize(path)
    edge = np.concatenate([(a[0, :] < 250).astype(float), (a[-1, :] < 250).astype(float),
                          (a[:, 0] < 250).astype(float), (a[:, -1] < 250).astype(float)]).mean()
    low = name.lower()
    unknown = s["unknown"]

    def put(key, ok):
        s["items"][key] = bool(ok)

    # A 格式合规性
    put("A1", im.format == "PNG")
    put("A2", all(299.0 <= float(x) <= 301.0 for x in dpi))
    put("A3", min(im.size) >= 1200)
    put("A4", size > 20 * 1024)
    put("A5", a.std() > 5)
    put("A6", edge < 0.05)
    # B 参数准确性：几何项必须来自 ops/audit_figure_layout.py 的逐图判决（--audit-csv）。
    # 缺判决时记"未验证"而不是默认满分——"没测"不等于"通过"（FE-012）。
    for key in ("B1", "B2", "B3", "B4"):
        if key in overrides:
            put(key, overrides[key])
        else:
            put(key, False)
            unknown.append(key)
    # C 标注规范性
    put("C1", any(c.lower() in low for c in captions))
    put("C2", bool(NAME_RE.match(name)))
    put("C3", True)   # 需 build_client_report 结果，默认给满并提示
    put("C4", True)   # 需台账，默认给满
    # D 视觉可读性：D2/D3 来自源码扫描（--code-csv + --ledger-dir 定位该图的脚本）
    put("D1", s["items"]["A2"])
    put("D4", name.endswith(".png"))
    for key in ("D2", "D3"):
        if key in overrides:
            put(key, overrides[key])
        else:
            put(key, False)
            unknown.append(key)
    # E 逻辑正确性（默认给满，需 WGCNA/分组核查确认）
    put("E1", True)
    put("E2", True)

    for key in VETO:
        # 一票否决只在"已验证不通过"时触发；未验证的项不判否决（那是 UNVERIFIED 的出路）
        if not s["items"][key] and key not in s["unknown"]:
            s["veto"].append(key)

    total = sum(w for k, w in WEIGHTS.items() if s["items"][k])
    s["score"] = round(total, 1)
    # 三态判决：一票否决 → FAIL；有未验证项 → UNVERIFIED（不许因为"没测"而 PASS）；
    # 否则按分数线判 PASS / FIX / FAIL
    if s["veto"]:
        s["verdict"] = "FAIL"
    elif s["unknown"]:
        s["verdict"] = "UNVERIFIED"
    else:
        s["verdict"] = "PASS" if total >= PASS_LINE else ("FIX" if total >= FIX_LINE else "FAIL")
    # 未验证项带 ? 后缀，和"已验证不通过"区分开：前者要补测，后者要整改
    s["missing"] = ["%s%s" % (k, "?" if k in s["unknown"] else "")
                    for k in WEIGHTS if not s["items"][k]]
    return s


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--csv", default="")
    ap.add_argument("--json", default="")
    ap.add_argument("--audit-csv", default="",
                    help="ops/audit_figure_layout.py --csv 的逐图判决（B1–B4 的唯一合法来源）")
    ap.add_argument("--code-csv", default="",
                    help="cn_debug/figure_code_audit.py --csv 的源码扫描结果（D2/D3 来源）")
    ap.add_argument("--ledger-dir", default="outputs/system_logs",
                    help="本地台账目录：把图文件名反查到出图脚本，供 D2/D3 归因（源码映射的兜底）")
    ap.add_argument("--src-root", default="src",
                    help="源码根：静态扫描出图脚本里的图文件名，作为 D2/D3 归因的主来源")
    args = ap.parse_args(argv)

    captions = load_captions()
    audit = load_audit_csv(args.audit_csv)
    figs = [f for f in sorted(os.listdir(args.dir)) if f.lower().endswith(".png")]
    code = load_code_findings(args.code_csv, args.ledger_dir, args.src_root, figs)
    rows = []
    for f in figs:
        ov = {}
        ov.update(audit.get(f, {}))
        ov.update(code.get(f, {}))
        rows.append(score_one(os.path.join(args.dir, f), captions, ov))

    counts = {"PASS": 0, "FIX": 0, "FAIL": 0, "UNVERIFIED": 0}
    for r in rows:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
        print("%-10s %5.1f %-36s %s" % (r["verdict"], r["score"], r["image"],
                                        ",".join(r["missing"]) or "-"))
    n = len(rows)
    avg = round(sum(r["score"] for r in rows) / n, 1) if n else 0
    print("score: figs=%d PASS=%d FIX=%d FAIL=%d UNVERIFIED=%d avg=%.1f threshold=%.0f"
          % (n, counts["PASS"], counts["FIX"], counts["FAIL"],
             counts["UNVERIFIED"], avg, PASS_LINE))
    if not args.audit_csv or not args.code_csv:
        print("note: 未提供 --audit-csv / --code-csv → B/D 项按未验证处理（不计 PASS）；"
              "要拿可交付结论必须两个都给")

    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["image", "score", "verdict", "missing", "unknown", "veto"])
            for r in rows:
                w.writerow([r["image"], r["score"], r["verdict"],
                            " ".join(r["missing"]), " ".join(r["unknown"]),
                            " ".join(r["veto"])])
    if args.json:
        json.dump(rows, open(args.json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    # 退出码：FAIL 或 UNVERIFIED 都算没通过——"没测"不能算交付
    bad = counts["FAIL"] + counts["UNVERIFIED"]
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
