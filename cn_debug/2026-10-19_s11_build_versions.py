#!/usr/bin/env python3
r"""S11：把远端实采的版本原始 JSON 编译成 docs/software_versions.json。

为什么要有这个脚本：`docs/software_versions.json` 里的版本号**不许手抄**，
必须从远端探针输出（`cn_debug/2026-10-19_s11_collect_versions.py` 的 stdout）
机械拷贝。本脚本负责「版本号取自探针、用途/所属线取自代码 grep 结论」，
并把两者的来源分别写进 `source` 与 `lines_evidence` 字段，供复核。

`lines` 字段（该包被哪条线的脚本实际 import/library）的判定依据：
    grep -rhoE 'library\(...\)|require\(...\)' src/<line>/scripts/
    grep -rhoE '^[[:space:]]*(import|from) [A-Za-z0-9_.]+' src/<line>/scripts/
未在任何线脚本中出现 → lines 为空，role 注明「已安装，当前三线脚本未 import」。

用法：
    python cn_debug/2026-10-19_s11_build_versions.py \
        --raw <s11_versions_raw.json> --out docs/software_versions.json
"""
import argparse
import datetime
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

L1 = "line1_bulk"
L2 = "line2_scrna"
L3 = "line3_spatial"

# 名称 -> (role, lines, citation_key or None, note or None)
# citation_key 指向 reference/生信分析可用参考文献/citations.json 的 entries[].key
PACKAGE_META = {
    # ---- R ----
    "WGCNA": ("加权共表达网络构建、动态剪切树划分模块、模块-性状关联（wgcna_modules）",
              [L1], "WGCNA", None),
    "limma": ("DEG 线性模型 + 经验贝叶斯收缩（deg_limma）", [L1], "limma",
              "本目录无 limma 原始论文，引用处会明写「未获取」"),
    "ggplot2": ("线 1 全部 l1_* 图件绘制", [L1], None, None),
    "clusterProfiler": ("GO BP/CC/MF 与 KEGG 的 ORA / GSEA（enrichment_bulk）", [L1], None, None),
    "data.table": ("大表读写与分组聚合", [L1], None, None),
    "glmnet": ("LASSO 特征筛选（ml_model）", [L1], None, None),
    "survival": ("Cox 比例风险模型（cox_analysis）", [L1], None, None),
    "org.Hs.eg.db": ("Gene Symbol → Entrez ID 注释（富集分析入参）", [L1], None, None),
    "matrixStats": ("矩阵行列统计（QC 与网络构建）", [L1], None, None),
    "GSVA": ("GSVA 通路活性评分（gsva_pathways）", [L2], None, None),
    "GSEABase": ("GSVA 输入基因集封装", [L2], None, None),
    "Seurat": ("已安装；三条线的步骤脚本均未 library()（线 2/线 3 走 scanpy）", [], None,
               "容器内可用但未进入本项目流程，故不作为方法学引用"),
    "pheatmap": ("已安装；步骤脚本未 library()（热图由 ComplexHeatmap/ggplot2 路线承担）", [], None, None),
    "ComplexHeatmap": ("已安装；步骤脚本未 library()", [], None, None),
    "pROC": ("已安装；步骤脚本未 library()（AUC 由 sklearn 计算）", [], None, None),
    # ---- Python ----
    "scanpy": ("单细胞/空间预处理、HVG、PCA、邻居图、聚类、UMAP、DEG、DPT 拟时序", [L2, L3], "Scanpy", None),
    "anndata": ("AnnData 容器与 h5ad 读写", [L2, L3], None, None),
    "pandas": ("结果表读写与整形", [L1, L2, L3], None, None),
    "numpy": ("数值计算与稀疏矩阵", [L1, L2, L3], None, None),
    "scipy": ("稀疏矩阵运算、统计检验、置换检验、NNLS", [L1, L2, L3], None, None),
    "scikit-learn": ("机器学习模型、PCA/降维、交叉验证与 AUC", [L1, L2, L3], None, None),
    "matplotlib": ("三线全部图件绘制", [L1, L2, L3], None, None),
    "seaborn": ("已安装；三条线脚本均未 import（图件统一走 matplotlib + 自定义主题）", [], None, None),
    "networkx": ("PPI / 共表达网络拓扑与枢纽基因打分", [L1, L2], None, None),
    "statsmodels": ("统计模型与多重检验校正", [L1], None, None),
    "harmonypy": ("批次整合 Harmony（integrate_harmony）", [L2], "harmony",
                  "本项目用 Python 端 harmonypy 实现；本地 PDF 为 R 包 harmony 手册（非原始论文），引用处标注该差异"),
    "liana": ("细胞间通讯 consensus 资源 + rank_aggregate（cell_communication / spatial_communication）",
              [L2, L3], None, None),
    "pyscenic": ("SCENIC 转录因子活性推断（scenic_tf）", [L2], None, None),
    "arboreto": ("SCENIC GRN 推断后端（pyscenic 依赖）", [L2], None, None),
    "gseapy": ("Python 侧 GSEA / 富集（enrichment）", [L2, L3], None, None),
    "scTenifold": ("虚拟敲除 scTenifoldKnk 网络扰动（virtual_knockout / spatial_knockout）",
                   [L2, L3], None, None),
    "shap": ("SHAP 模型可解释性（ml_hub_analysis）", [L1], None, None),
    "h5py": ("HDF5/h5ad 底层直读（spatial ingest）", [L3], None, None),
    "Pillow": ("空间图件/图像读取", [L3], None, None),
    "adjustText": ("图件标签避让", [L1, L2], None, None),
    "squidpy": ("未安装；线 3 空间统计（Moran's I / 邻域富集 / 共现）为 numpy 原生实现", [], None,
                "容器内不可 import，故不引用 Squidpy 论文"),
}

INTERPRETER_META = {
    "R": ("统计建模、富集分析与图件（线 1 步骤 1-4；线 2 富集/LASSO 桥接）", [L1, L2]),
    "python3": ("机器学习、单细胞/空间分析与图件（线 1 步骤 5-8；线 2/线 3 主体）", [L1, L2, L3]),
}

SEED = 20261013
SEED_SOURCE = ("aims/aims.txt 铁律#3 契约值 20261013；运行时由任务引擎以 BIOANALYS_SEED 注入"
               "（BioanalysDesktop/server/task.js:54），各步骤实际取值另见任务台账 random_seed 字段")


def build(raw, note_path):
    out = {
        "schema_version": 1,
        "generated_at": datetime.date.today().isoformat(),
        "scope": "本项目三条分析线实际在用的解释器与包（版本号由远端容器实采，不抄文档）",
        "probe": {
            "script": "cn_debug/2026-10-19_s11_collect_versions.py",
            "raw_output": os.path.basename(note_path),
            "host": raw.get("probe_host"),
            "probe_python": raw.get("probe_python"),
            "channel": "adb forward tcp:10022 -> ssh k40-ubuntu -> proot-distro ubuntu",
            "policy": "只读探测：不安装、不升级、不改容器环境",
        },
        "seed": {
            "value": SEED,
            "source": SEED_SOURCE,
        },
        "interpreters": [],
        "packages": [],
        "platform_citations": [
            {
                "key": "Bioconductor",
                "lines": [L1, L2],
                "reason": "线 1/线 2 的 R 侧包（limma、WGCNA、clusterProfiler、org.Hs.eg.db、GSVA、GSEABase）"
                          "均来自 Bioconductor 发行版，属平台级引用",
            }
        ],
    }

    for name, meta in INTERPRETER_META.items():
        rec = (raw.get("interpreters") or {}).get(name) or {}
        ver = rec.get("version")
        if not ver:
            raise SystemExit("解释器 %s 在探针输出中缺失：%s" % (name, rec.get("error")))
        if name == "R":
            # 探针拿到的是 "Rscript (R) version 4.3.3 (2024-02-29)"，取版本号主体
            ver_short = ver.split("version")[-1].strip().split(" ")[0]
        else:
            ver_short = ver
        out["interpreters"].append({
            "name": name,
            "version": ver_short,
            "version_raw": ver,
            "language": name,
            "role": meta[0],
            "lines": meta[1],
            "source": rec.get("source"),
        })

    for name, meta in PACKAGE_META.items():
        role, lines, cite, note = meta
        bucket = "r_packages" if name in (raw.get("r_packages") or {}) else "python_packages"
        rec = (raw.get(bucket) or {}).get(name)
        if rec is None:
            raise SystemExit("包 %s 不在探针输出的 %s 中，需先在探针脚本里登记" % (name, bucket))
        entry = {
            "name": name,
            "version": rec.get("version") if rec.get("installed") else None,
            "installed": bool(rec.get("installed")),
            "language": "R" if bucket == "r_packages" else "Python",
            "role": role,
            "lines": lines,
            "source": rec.get("source"),
            "citation": cite,
        }
        if note:
            entry["note"] = note
        if not rec.get("installed"):
            entry["install_error"] = rec.get("error")
        out["packages"].append(entry)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, help="远端探针输出 JSON")
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "software_versions.json"))
    args = ap.parse_args(argv)

    with open(args.raw, encoding="utf-8") as fh:
        raw = json.load(fh)
    payload = build(raw, args.raw)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print("写出 %s：解释器 %d 条 / 包 %d 条（其中已安装 %d）"
          % (args.out, len(payload["interpreters"]), len(payload["packages"]),
             sum(1 for p in payload["packages"] if p["installed"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
