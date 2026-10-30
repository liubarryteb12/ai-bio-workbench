#!/usr/bin/env python3
"""出图布局合规审计（docs/figure_spec.md v2.2 §三之三 的机器判据）。

为什么需要它：PNG 只能靠肉眼审，肉眼审会在轮次之间漂移（131 张图审三次仍漏）。
本脚本把"图框内不越界 / 图例与图注在框外 / 标注不重叠"变成可复现的几何判定，
出图脚本每次重渲染都能顺带跑一遍，违规直接以 FAIL 退出。

用法（必须 Agg，无显示面；本地与服务器容器均可）：

    # 审计单个出图脚本（用当前目录的数据重渲染，但不落盘）
    python3 audit_figure_layout.py --script src/line2_scrna/scripts/scenic_figures \
        --cwd /mnt/ssd/bio_data/projects/default/line2_scrna/processed

    # 批量（默认不写盘，只判定）
    python3 audit_figure_layout.py --script <脚本> --cwd <目录> [--script ... --cwd ...]

判定项（全部为几何判定，容差 3px）：
    A 轴内标注（ax.texts）必须完整落在坐标轴框内       —— 对应"标签超出图框"
    B 图例必须落在坐标轴框外                          —— 对应"图例看图框外"
    C 图注（fig.texts）必须落在坐标轴框外且不与框相交  —— 对应"图注看图框外"
    D 轴内标注之间、图例条目之间不得互相重叠
    E tick 标签超出画布边界 —— FAIL：固定画布不会用 tight bbox 扩边，
      超出边界的刻度文字会被真实裁切。

退出码：0 = 全部 PASS；1 = 存在 FAIL；2 = 调用/环境错误。
"""

import argparse
import csv
import glob
import io
import json
import os
import re
import sys
import traceback

TOL = 3.0          # 像素容差
MIN_OVERLAP = 6.0  # 重叠面积阈值（px^2），小于此值视为相邻不算压字


def _bbox_intersect(a, b):
    x0, y0 = max(a.x0, b.x0), max(a.y0, b.y0)
    x1, y1 = min(a.x1, b.x1), min(a.y1, b.y1)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return (x1 - x0) * (y1 - y0)


def _outside(inner, outer, tol=TOL):
    """inner 是否完整落在 outer 之内（含容差）。"""
    return (inner.x0 >= outer.x0 - tol and inner.x1 <= outer.x1 + tol
            and inner.y0 >= outer.y0 - tol and inner.y1 <= outer.y1 + tol)


def audit_fig(fig, name):
    """对已绘制完成的图对象做几何判定，返回 (违规列表, 提示列表)。"""
    from matplotlib.colorbar import Colorbar

    fig.canvas.draw()
    rend = fig.canvas.get_renderer()
    figbb = fig.bbox
    viol = []
    info = []
    data_axes = [a for a in fig.get_axes() if not isinstance(a, Colorbar)]
    if not data_axes:
        return viol, info

    for ai, ax in enumerate(data_axes):
        abb = ax.get_window_extent()

        # A. 轴内标注必须落在坐标轴框内
        texts = [t for t in ax.texts if t.get_text().strip()]
        for t in texts:
            bb = t.get_window_extent(renderer=rend)
            if not _outside(bb, abb):
                viol.append("A 标注越出坐标轴框 axes%d %r "
                            "(bbox %.0f,%.0f-%.0f,%.0f vs 轴框 %.0f,%.0f-%.0f,%.0f)"
                            % (ai, t.get_text()[:24], bb.x0, bb.y0, bb.x1, bb.y1,
                               abb.x0, abb.y0, abb.x1, abb.y1))

        # D1. 轴内标注互相不压字
        for i in range(len(texts)):
            for j in range(i + 1, len(texts)):
                ov = _bbox_intersect(texts[i].get_window_extent(renderer=rend),
                                     texts[j].get_window_extent(renderer=rend))
                if ov > MIN_OVERLAP:
                    viol.append("D 标注重叠 axes%d %r <-> %r (%.0fpx^2)"
                                % (ai, texts[i].get_text()[:16],
                                   texts[j].get_text()[:16], ov))

        # E. tick 标签越出画布边界：固定画布不会自动扩边
        for t in list(ax.get_xticklabels()) + list(ax.get_yticklabels()):
            if not t.get_text().strip():
                continue
            bb = t.get_window_extent(renderer=rend)
            if not _outside(bb, figbb, TOL * 2):
                viol.append(
                    "E tick 标签越出画布 axes%d %r "
                    "(bbox %.0f,%.0f-%.0f,%.0f vs 画布 %.0f,%.0f-%.0f,%.0f)"
                    % (ai, t.get_text()[:24], bb.x0, bb.y0, bb.x1, bb.y1,
                       figbb.x0, figbb.y0, figbb.x1, figbb.y1)
                )

        # B/D2. 图例必须在轴框外、条目互不重叠
        leg = ax.get_legend()
        if leg is not None:
            lbb = leg.get_window_extent(renderer=rend)
            if _bbox_intersect(lbb, abb) > MIN_OVERLAP:
                viol.append("B 图例压在坐标轴框内 axes%d (重叠 %.0fpx^2)"
                            % (ai, _bbox_intersect(lbb, abb)))
            entries = [t for t in leg.get_texts() if t.get_text().strip()]
            for i in range(len(entries)):
                for j in range(i + 1, len(entries)):
                    ov = _bbox_intersect(entries[i].get_window_extent(renderer=rend),
                                         entries[j].get_window_extent(renderer=rend))
                    if ov > MIN_OVERLAP:
                        viol.append("D 图例条目重叠 axes%d %r <-> %r"
                                    % (ai, entries[i].get_text()[:16],
                                       entries[j].get_text()[:16]))

    # C. 图注必须在轴框外
    for t in fig.texts:
        if not t.get_text().strip():
            continue
        bb = t.get_window_extent(renderer=rend)
        for ai, ax in enumerate(data_axes):
            if _bbox_intersect(bb, ax.get_window_extent()) > MIN_OVERLAP:
                viol.append("C 图注压在坐标轴框内 axes%d %r"
                            % (ai, t.get_text().splitlines()[0][:32]))
    return viol, info


class _Auditor:
    """接管 fig.savefig：先判定再决定是否落盘（默认不落盘）。"""

    def __init__(self, write):
        self.write = write
        self.report = []
        self.fail = 0
        self.figs = 0

    def install(self):
        import matplotlib.figure
        orig = matplotlib.figure.Figure.savefig
        me = self

        def savefig(self_fig, *a, **kw):
            name = os.path.basename(str(a[0])) if a else "(unnamed)"
            me.figs += 1
            try:
                viol, info = audit_fig(self_fig, name)
            except Exception:
                viol = ["X 审计自身异常 %s" % traceback.format_exc(limit=1).strip()]
                info = []
            if viol:
                me.fail += 1
            me.report.append((name, viol, info))
            if me.write:
                return orig(self_fig, *a, **kw)
            return None

        matplotlib.figure.Figure.savefig = savefig

    def dump(self, stream=sys.stdout):
        for name, viol, info in self.report:
            tag = "FAIL" if viol else "PASS"
            stream.write("%s %s\n" % (tag, name))
            for v in viol:
                stream.write("      %s\n" % v)
            for v in info:
                stream.write("      %s\n" % v)
        stream.write("audit: figs=%d fail=%d write=%s\n"
                     % (self.figs, self.fail, self.write))
        return self.fail


HEREDOC = re.compile(r"<<'PYSCRIPT'\n(.*?)\nPYSCRIPT", re.S)

# bash 分流里 `*pattern*) var="$path"` 的模式→变量对，用来推断该步骤读了哪些输入文件
CASE_PAT = re.compile(r"^\s*(\S+)\)\s*([a-z_][a-z0-9_]*)=\"\$path\"", re.M)
# `var="${var:-literal}"` 的 cwd 回退默认值
DEFAULT_PAT = re.compile(r"^\s*([a-z_][a-z0-9_]*)=\"\$\{\1:-([^}\"]*)\}\"", re.M)
# 环境注入：`UPPER="$lower"`，一行里可以有多个（bash 用反斜杠续行拼长前缀）
ENV_PAT = re.compile(r"([A-Z][A-Z0-9_]*)=\"\$([a-z_][a-z0-9_]*)\"")
# 环境注入：`UPPER="${lower:-default}"`（带空默认值的可选输入，如 KEY_FILE / DEG_FILE）
ENV_DEF_PAT = re.compile(r"([A-Z][A-Z0-9_]*)=[\"']?\$\{([a-z_][a-z0-9_]*):-([^}]*)\}")


def extract_heredoc(script_path):
    """抽出出图脚本里所有 python3 - <<'PYSCRIPT' 块，返回含出图代码的那一块。

    多数脚本只有一块；ml_hub_analysis / gsva_pathways 有两块（前一块是中间计算，
    后一块才是出图）。判据是 `def caption(` —— 17 个出图脚本的图注函数只有出图块有。
    """
    with io.open(script_path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    blocks = HEREDOC.findall(text)
    if not blocks:
        raise RuntimeError("未在 %s 找到 PYSCRIPT heredoc" % script_path)
    for code in blocks:
        if "def caption(" in code:
            return code
    return blocks[-1]


def emulate_env(script_path, cwd):
    """按 bash 包装段模拟环境变量。

    为什么要模拟：python 块用 os.environ 取输入（FIG_DIR / FIG_INPUT / EXPR_FILE ...），
    这些值由 bash 段解析 --input 后 export。审计只跑 python 块，必须补上这层，
    否则 KeyError 把审计打断（不是图的问题却报错）。
    """
    with io.open(script_path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    lower = {}
    for pat, var in CASE_PAT.findall(text):
        if var in lower:
            continue
        hits = sorted(f for f in glob.glob(os.path.join(cwd, pat)) if os.path.isfile(f))
        if hits:
            lower[var] = hits[0]
    for var, literal in DEFAULT_PAT.findall(text):
        if var not in lower and literal:
            lower[var] = os.path.join(cwd, literal)
    env = {}
    for name, src in ENV_PAT.findall(text):
        if src in lower:
            env[name] = lower[src]
    for name, src, dflt in ENV_DEF_PAT.findall(text):
        if src in lower:
            env[name] = lower[src]
        elif dflt:
            env[name] = os.path.join(cwd, dflt)
    # FIG_DIR 是 bulk/enrichment 出图脚本的直接工作目录（bash 里由 --input 或 pwd 推导）
    if re.search(r'FIG_DIR="\$', text):
        env["FIG_DIR"] = cwd
    return env


def derive_inputs(script_path, cwd):
    """从脚本自己的 `case "$path" in` 分流反推 --input：把 pattern 当 glob 在 cwd 里找文件。

    每个变量只取一个文件：bash 的 for/case 是"后来者覆盖前者"，多给几个候选反而
    会盖成错的那个（spatial_figures 的 *mouse*.h5ad 一旦命中 qc 版就没有 obs['domain']）。
    候选多时优先取脚本注释里点名过的那个文件名（脚本的 docstring 就是它期望的输入）。
    """
    with io.open(script_path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    base = os.path.abspath(cwd)
    out, seen_var = [], set()
    for pat, var in CASE_PAT.findall(text):
        if var in seen_var:
            continue
        cands = [f for f in sorted(glob.glob(os.path.join(base, pat)))
                 if os.path.isfile(f)]
        if not cands:
            continue
        mentioned = [f for f in cands if os.path.basename(f) in text]
        pick = (mentioned or cands)[0]
        seen_var.add(var)
        out.append(pick)
    return out


# 注入脚本：让真实 bash 步骤里的每个 python3 子进程都带上同一套几何审计。
# 为什么要走权威 bash 而不是直接 exec heredoc：多块脚本（ml_hub_analysis / gsva_pathways）
# 前一块产出后一块的输入，且输入来自 bash 段 export 的环境变量，只有跑真脚本才对得上。
SHIM = '''\
import json
import os
import sys

_out = os.environ.get("BIOANALYS_AUDIT_OUT")
if _out:
    sys.path.insert(0, os.environ["BIOANALYS_AUDIT_LIB"])
    import audit_figure_layout as _afl
    import matplotlib.figure as _mf
    _orig = _mf.Figure.savefig

    def _savefig(self_fig, *a, **kw):
        name = os.path.basename(str(a[0])) if a else "(unnamed)"
        try:
            viol, info = _afl.audit_fig(self_fig, name)
        except Exception as exc:
            viol, info = ["X 审计自身异常 %s" % exc], []
        with open(_out, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"name": name, "viol": viol, "info": info},
                                ensure_ascii=False) + "\\n")
        if os.environ.get("BIOANALYS_AUDIT_WRITE") == "1":
            return _orig(self_fig, *a, **kw)
        return None

    _mf.Figure.savefig = _savefig
'''


def _stage_dir(cwd):
    """建一个临时目录树，把 cwd 的输入软链进来，并镜像其兄弟目录。

    为什么不让脚本直接在真 processed 目录跑：审计模式下不落图，但步骤还会写自己的
    中间产物（key_genes.tsv / _ml_pool.tsv 等），落到真目录就改了用户的正本。
    软链进来的输入仍指向真文件（只读），产物落到临时目录，真 processed 目录零改动。

    为什么镜像兄弟目录：脚本按 `../references/gmt_cache` 这种相对路径取参考数据
    （line2 dr_post_analysis / gsva_pathways 依赖），不在同一父目录下就找不到。
    references 是只读输入（软链），figures/results 会造成"产物落进真目录"的风险，
    一律用空目录顶替。
    """
    import tempfile
    base = os.path.abspath(cwd)
    parent = os.path.dirname(base)
    root = tempfile.mkdtemp(prefix="figaudit_root_")
    work = os.path.join(root, os.path.basename(base) or "processed")
    os.makedirs(work)
    for f in os.listdir(base):
        src = os.path.join(base, f)
        if os.path.isfile(src):
            try:
                # 软链目标必须绝对路径：相对目标会按"链接所在目录"解析，链接直接失效
                os.symlink(src, os.path.join(work, f))
            except OSError:
                pass
    for sibling, mode in (("references", "link"), ("raw_data", "link"),
                          ("figures", "empty"), ("results", "empty")):
        real = os.path.join(parent, sibling)
        dst = os.path.join(root, sibling)
        if mode == "link" and os.path.isdir(real):
            os.symlink(real, dst)
        else:
            os.makedirs(dst, exist_ok=True)
    return work


def run_bash(script_path, cwd, write=False, seed="20261018"):
    """按权威路径跑真实 bash 出图脚本，并用 sitecustomize 注入几何审计。"""
    import shutil
    import subprocess
    import tempfile
    if not shutil.which("bash"):
        raise RuntimeError("本机没有 bash，无法用 bash runner")
    libdir = os.path.dirname(os.path.abspath(__file__))
    shimdir = tempfile.mkdtemp(prefix="figaudit_shim_")
    with io.open(os.path.join(shimdir, "sitecustomize.py"), "w",
                 encoding="utf-8", newline="\n") as fh:
        fh.write(SHIM)
    out_jsonl = os.path.join(shimdir, "audit.jsonl")
    run_cwd = cwd if write else _stage_dir(cwd)
    cmd = ["bash", script_path, "--seed", seed, "--output", "../figures"]
    for f in derive_inputs(script_path, cwd):
        cmd += ["--input", f]
    env = dict(os.environ)
    env.update({
        "BIOANALYS_SEED": seed,
        "PYTHONPATH": shimdir,
        "BIOANALYS_AUDIT_OUT": out_jsonl,
        "BIOANALYS_AUDIT_LIB": libdir,
        "BIOANALYS_AUDIT_WRITE": "1" if write else "0",
    })
    proc = subprocess.run(cmd, cwd=run_cwd, env=env, capture_output=True, text=True)
    sys.stdout.write((proc.stdout or "")[-4000:])
    if proc.returncode != 0:
        sys.stderr.write("bash 退出码 %d：\n%s\n"
                         % (proc.returncode, (proc.stderr or "")[-2000:]))
    aud = _Auditor(write)
    if os.path.exists(out_jsonl):
        with io.open(out_jsonl, encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                rec = json.loads(line)
                aud.figs += 1
                if rec["viol"]:
                    aud.fail += 1
                aud.report.append((rec["name"], rec["viol"], rec["info"]))
    return aud


def run_raw_python(script_path, cwd, write=False, seed="20261018"):
    """Run an adapted standalone Python figure script under the audit hook."""
    import matplotlib
    matplotlib.use("Agg")

    aud = _Auditor(write)
    aud.install()
    os.environ["BIOANALYS_SEED"] = seed
    prev = os.getcwd()
    try:
        os.chdir(cwd)
        with io.open(script_path, encoding="utf-8", errors="replace") as fh:
            code = fh.read()
        ns = {"__name__": "__main__", "__file__": script_path}
        try:
            exec(compile(code, script_path, "exec"), ns)
        except SystemExit as exc:
            if exc.code not in (None, 0):
                raise
    finally:
        os.chdir(prev)
    return aud


def run_one(script_path, cwd, write=False, seed="20261018", runner="auto"):
    import shutil

    if runner == "auto":
        if script_path.endswith(".py"):
            runner = "python"
        else:
            runner = "bash" if shutil.which("bash") else "exec"
    if runner == "bash":
        return run_bash(script_path, cwd, write=write, seed=seed)
    if runner == "python":
        return run_raw_python(script_path, cwd, write=write, seed=seed)

    import matplotlib
    matplotlib.use("Agg")

    code = extract_heredoc(script_path)
    # 出图脚本自带 layout guard（落盘前先版式收口），审计要挂在它外层才能审到最终版式；
    # 同一进程审多个脚本时先把上一轮的 guard 摘掉，避免结论记到旧实例上。
    from matplotlib.figure import Figure
    if getattr(Figure.savefig, "_layout_guard", False):
        Figure.savefig = Figure.savefig._orig_savefig
    aud = _Auditor(write)
    aud.install()
    os.environ["BIOANALYS_SEED"] = seed
    for k, v in emulate_env(script_path, cwd).items():
        os.environ[k] = v
    prev = os.getcwd()
    try:
        os.chdir(cwd)
        ns = {"__name__": "__main__", "__file__": script_path}
        exec(compile(code, script_path, "exec"), ns)
    finally:
        os.chdir(prev)
    return aud


def main(argv=None):
    ap = argparse.ArgumentParser(description="出图布局合规审计")
    ap.add_argument("--script", action="append", required=True)
    ap.add_argument("--cwd", action="append", required=True)
    ap.add_argument("--write", action="store_true",
                    help="同时落盘（默认只判定不写盘）")
    ap.add_argument("--json", action="store_true", help="输出 JSON 结论")
    ap.add_argument("--runner", choices=["auto", "bash", "python", "exec"], default="auto",
                    help="auto：.py 走裸脚本审计，其他有 bash 就跑真脚本；"
                         "python：直接执行适配后的 .py；exec：只跑出图 heredoc")
    ap.add_argument("--csv", default="",
                    help="逐图判决写出 CSV（figure,verdict,violations），供打分系统导入（FE-012）")
    ap.add_argument("--seed", default="20261018",
                    help="跑真脚本时注入的 BIOANALYS_SEED。**必须与被审计项目的种子一致**，"
                         "否则报告里的 seed= 行会被写成审计种子，污染 provenance"
                         "（2026-10-19 实测踩到：四份报告被写成 20261018，真值 20261013）")
    args = ap.parse_args(argv)
    if len(args.script) != len(args.cwd):
        sys.stderr.write("--script 与 --cwd 必须成对出现且数量一致\n")
        return 2

    total_fail = 0
    summary = []
    per_fig = []
    for script, cwd in zip(args.script, args.cwd):
        sys.stdout.write("=== %s @ %s\n" % (script, cwd))
        try:
            aud = run_one(script, cwd, write=args.write, runner=args.runner, seed=args.seed)
        except Exception:
            sys.stderr.write(traceback.format_exc())
            return 2
        f = aud.dump()
        total_fail += f
        summary.append({"script": script, "figs": aud.figs, "fail": f})
        for name, viol, _info in aud.report:
            per_fig.append((name, "FAIL" if viol else "PASS", "; ".join(viol)))
    if args.json:
        sys.stdout.write(json.dumps({"summary": summary,
                                     "fail": total_fail}, ensure_ascii=False) + "\n")
    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["figure", "verdict", "violations"])
            for row in per_fig:
                w.writerow(row)
        sys.stdout.write("audit-csv: %s (%d 图)\n" % (args.csv, len(per_fig)))
    return 1 if total_fail else 0


if __name__ == "__main__":
    sys.exit(main())
