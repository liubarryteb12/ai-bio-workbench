#!/usr/bin/env python3
"""S10 一次性探针（行为契约，不落盘到项目目录）。

验三件事，全部是"跑真脚本"级别，不是静态推断：

1. **数值来源一致**：`uns["composition"]["group_tests_json"]` 的 perm_p 按 `%.4g` 格式化后
   与 `composition_report.txt` 里同名 celltype 的 `perm_p=` 逐值相同（A3）。
2. **图上文本 == 报告文本**：在进程内 exec scrna_figures 的 PYSCRIPT heredoc，截获每张图
   `ax.texts` 里的 `perm p = ...` 文本，逐 celltype 与 1 的结果比对；并核对"每张图恰好 1 条"。
3. **负对照（无值静默不画）**：把 h5ad 副本里某一个 celltype 的 perm_p 改成 None 再跑一遍，
   断言该图 0 条括号文本、脚本仍 exit 0、其余 12 张不受影响。

用法（远端容器内）：
    python3 cn_debug/s10_perm_p_probe.py --script /path/scrna_figures --processed <processed 目录>
"""
import argparse
import io
import json
import os
import re
import shutil
import sys
import tempfile

HEREDOC = re.compile(r"<<'PYSCRIPT'\n(.*?)\nPYSCRIPT", re.S)
CELLTYPE_OF_FIG = re.compile(r"^l2_06_composition_box_(.+)\.png$")


def parse_report(path):
    """composition_report.txt → {celltype: perm_p 文本}（取 diagnosis 段）。"""
    out = {}
    level = None
    for line in io.open(path, encoding="utf-8"):
        m = re.match(r"\[group_test:(\w+)\]", line.strip())
        if m:
            level = m.group(1)
            continue
        if level != "diagnosis":
            continue
        m = re.match(r"\s+(\S+)\s+means=.*?perm_p=(\S+)", line)
        if m and m.group(2) != "n/a":
            out[m.group(1)] = m.group(2)
    return out


def parse_uns(h5ad_path):
    import anndata as ad
    a = ad.read_h5ad(h5ad_path)
    tests = json.loads(a.uns["composition"]["group_tests_json"])
    out = {}
    for rec in (tests.get("diagnosis") or {}).get("per_celltype") or []:
        if rec.get("perm_p") is not None:
            out[str(rec["celltype"])] = "%.4g" % float(rec["perm_p"])
    return out


def extract_code(script_path):
    text = io.open(script_path, encoding="utf-8").read()
    blocks = HEREDOC.findall(text)
    if not blocks:
        raise RuntimeError("未找到 PYSCRIPT heredoc: %s" % script_path)
    for code in blocks:
        if "def caption(" in code:
            return code
    return blocks[-1]


def run_and_capture(script_path, workdir, fig_input, seed="20261013"):
    """在 workdir 里 exec heredoc，截获每张图的轴内文本。返回 {figure: [text,...]}。"""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.figure as mfig

    captured = {}
    orig = mfig.Figure.savefig

    def capture(self_fig, *a, **kw):
        name = os.path.basename(str(a[0])) if a else "(unnamed)"
        texts = []
        for ax in self_fig.get_axes():
            for t in ax.texts:
                s = t.get_text().strip()
                if s:
                    texts.append(s)
        captured[name] = texts
        return None      # 不落盘：本探针只判文本契约

    mfig.Figure.savefig = capture
    prev = os.getcwd()
    os.environ["FIG_INPUT"] = fig_input
    os.environ["BIOANALYS_SEED"] = seed
    code = extract_code(script_path)
    try:
        os.chdir(workdir)
        ns = {"__name__": "__main__", "__file__": script_path}
        exec(compile(code, script_path, "exec"), ns)
    finally:
        os.chdir(prev)
        mfig.Figure.savefig = orig
    return captured


def stage(processed, dst):
    """建一个只读软链工作目录（脚本会往 ../figures 写，故不能直接跑在真 processed）。"""
    work = os.path.join(dst, "processed")
    os.makedirs(work)
    os.makedirs(os.path.join(dst, "figures"))
    for f in os.listdir(processed):
        src = os.path.join(processed, f)
        if os.path.isfile(src):
            os.symlink(src, os.path.join(work, f))
    return work


def perm_texts(texts):
    return [t for t in texts if t.startswith("perm p")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script", required=True)
    ap.add_argument("--processed", required=True)
    ap.add_argument("--seed", default="20261013")
    args = ap.parse_args()

    report = parse_report(os.path.join(args.processed, "composition_report.txt"))
    uns = parse_uns(os.path.join(args.processed, "scrna_deg.h5ad"))
    print("report celltypes=%d uns celltypes=%d" % (len(report), len(uns)))

    bad = 0
    for ct in sorted(set(report) | set(uns)):
        r, u = report.get(ct), uns.get(ct)
        ok = r == u
        bad += 0 if ok else 1
        print("%s %-28s report=%-8s uns=%s" % ("OK  " if ok else "FAIL", ct, r, u))
    print("--- 1) uns vs report: %s" % ("PASS" if bad == 0 else "FAIL"))

    # 2) 真跑：图上文本
    root = tempfile.mkdtemp(prefix="s10probe_")
    work = stage(args.processed, root)
    caps = run_and_capture(args.script, work, os.path.join(work, "scrna_deg.h5ad"),
                           seed=args.seed)
    figs = sorted(n for n in caps if CELLTYPE_OF_FIG.match(n))
    print("--- 2) 渲染出 l2_06 图 %d 张（captured total=%d）" % (len(figs), len(caps)))
    fig_bad = 0
    for name in figs:
        ct = CELLTYPE_OF_FIG.match(name).group(1)
        got = perm_texts(caps[name])
        want = report.get(ct)
        if want is None:
            ok = len(got) == 0
            detail = "expect none, got %s" % got
        else:
            ok = len(got) == 1 and got[0] == "perm p = %s" % want
            detail = "expect 'perm p = %s', got %s" % (want, got)
        fig_bad += 0 if ok else 1
        print("%s %-46s %s" % ("OK  " if ok else "FAIL", name, detail))
    print("--- 2) 图上文本 vs 报告: %s" % ("PASS" if fig_bad == 0 else "FAIL"))

    # 3) 负对照：抹掉一个 celltype 的 perm_p
    drop = sorted(report)[0]
    import anndata as ad
    a = ad.read_h5ad(os.path.join(args.processed, "scrna_deg.h5ad"))
    tests = json.loads(a.uns["composition"]["group_tests_json"])
    for rec in tests["diagnosis"]["per_celltype"]:
        if rec["celltype"] == drop:
            rec["perm_p"] = None
    a.uns["composition"]["group_tests_json"] = json.dumps(tests, ensure_ascii=False,
                                                          sort_keys=True)
    neg_root = tempfile.mkdtemp(prefix="s10probe_neg_")
    neg_work = stage(args.processed, neg_root)
    neg_h5ad = os.path.join(neg_work, "scrna_deg.h5ad")
    os.unlink(neg_h5ad)                      # 换掉软链，落一份改过的副本
    a.write_h5ad(neg_h5ad)
    neg_caps = run_and_capture(args.script, neg_work, neg_h5ad, seed=args.seed)
    neg_bad = 0
    for name in sorted(n for n in neg_caps if CELLTYPE_OF_FIG.match(n)):
        ct = CELLTYPE_OF_FIG.match(name).group(1)
        got = perm_texts(neg_caps[name])
        want = None if ct == drop else report.get(ct)
        ok = (len(got) == 0) if want is None else (len(got) == 1 and got[0] == "perm p = %s" % want)
        neg_bad += 0 if ok else 1
        if ct == drop or not ok:
            print("%s neg %-42s expect=%s got=%s"
                  % ("OK  " if ok else "FAIL", name, want, got))
    print("--- 3) 负对照（%s 无 perm_p）：%s（%d 张核对）"
          % (drop, "PASS" if neg_bad == 0 else "FAIL", len(neg_caps)))
    shutil.rmtree(root, ignore_errors=True)
    shutil.rmtree(neg_root, ignore_errors=True)

    ok_all = (bad == 0 and fig_bad == 0 and neg_bad == 0)
    print("PROBE: %s" % ("PASS" if ok_all else "FAIL"))
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
