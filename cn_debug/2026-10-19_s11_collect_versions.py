#!/usr/bin/env python3
"""S11 版本采集探针（在远端容器内运行，只读，不改环境）。

用途：把本项目三条分析线实际在用的 R / Python 包版本、两个解释器版本，
      以机器可读 JSON 打到 stdout。每条都带 `source`（真实探测命令），
      供 `docs/software_versions.json` 引用与复核。

红线：只读。不安装、不升级、不改任何包。

用法（远端）：
    python3 /tmp/s11_collect_versions.py > /tmp/s11_versions_raw.json
"""
import json
import platform
import subprocess
import sys

# R 包：三线脚本里实际 library() 过的包（见 src/<line>/scripts/ 的 grep 结果）
R_PACKAGES = [
    "WGCNA", "limma", "ggplot2", "clusterProfiler", "Seurat", "pheatmap",
    "data.table", "glmnet", "GSVA", "matrixStats", "survival",
    "org.Hs.eg.db", "ComplexHeatmap", "pROC", "GSEABase",
]

# Python 包：三线脚本里实际 import 过的包 + 派发单点名要登记的包
PY_PACKAGES = [
    "scanpy", "anndata", "pandas", "numpy", "scipy", "scikit-learn",
    "matplotlib", "seaborn", "networkx", "statsmodels",
    "harmonypy", "liana", "pyscenic", "gseapy", "scTenifold", "squidpy",
    "arboreto", "shap", "h5py", "Pillow", "adjustText",
]


def run(cmd):
    """执行探测命令，返回 (ok, stdout_stripped)。失败不抛，交给上层如实记录。"""
    try:
        out = subprocess.run(cmd, shell=False, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as exc:
        return False, "%s: %s" % (type(exc).__name__, exc)
    if out.returncode != 0:
        return False, (out.stderr or out.stdout).strip().splitlines()[-1] if (out.stderr or out.stdout).strip() else "exit %d" % out.returncode
    return True, out.stdout.strip()


def r_version(pkg):
    expr = 'if (requireNamespace("%s", quietly=TRUE)) cat(as.character(packageVersion("%s"))) else cat("__MISSING__")' % (pkg, pkg)
    cmd = ["Rscript", "-e", expr]
    ok, txt = run(cmd)
    src = "Rscript -e '%s'" % expr
    if not ok:
        return {"installed": False, "version": None, "source": src, "error": txt}
    if txt == "__MISSING__":
        return {"installed": False, "version": None, "source": src, "error": "package not installed"}
    return {"installed": True, "version": txt, "source": src, "error": None}


def py_version(pkg):
    mod = {"scikit-learn": "sklearn", "Pillow": "PIL"}.get(pkg, pkg)
    # 有些包（arboreto）不导出 __version__，退回 importlib.metadata 的发行版版本号
    expr = (
        "import importlib, sys\n"
        "m = importlib.import_module(%r)\n"
        "v = getattr(m, '__version__', None)\n"
        "if not v:\n"
        "    import importlib.metadata as md\n"
        "    v = md.version(%r)\n"
        "print(v)\n" % (mod, pkg)
    )
    cmd = [sys.executable, "-c", expr]
    ok, txt = run(cmd)
    src = ("python3 -c 'import %s; print(getattr(%s, \"__version__\", None) or "
           "__import__(\"importlib.metadata\", fromlist=[\"x\"]).version(\"%s\"))'" % (mod, mod, pkg))
    if not ok:
        return {"installed": False, "version": None, "source": src, "error": txt}
    return {"installed": True, "version": txt, "source": src, "error": None}


def main():
    payload = {
        "probe_host": platform.node(),
        "probe_python": sys.version.split()[0],
        "interpreters": {},
        "r_packages": {},
        "python_packages": {},
    }
    ok, txt = run(["Rscript", "--version"])
    payload["interpreters"]["R"] = {
        "version": txt.splitlines()[0] if ok else None,
        "source": "Rscript --version",
        "error": None if ok else txt,
    }
    ok, txt = run([sys.executable, "--version"])
    payload["interpreters"]["python3"] = {
        "version": txt.replace("Python ", "") if ok else None,
        "source": "python3 --version",
        "error": None if ok else txt,
    }
    for pkg in R_PACKAGES:
        payload["r_packages"][pkg] = r_version(pkg)
    for pkg in PY_PACKAGES:
        payload["python_packages"][pkg] = py_version(pkg)
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
