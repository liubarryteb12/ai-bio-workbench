#!/usr/bin/env python3
"""S7 切片验证：ops/build_client_report.py 的 STEP_CATALOG 结构与图名声明。

覆盖验收 A1–A3（A4 序号冲突只打印记录，不改 src/）：
  1. 结构：STEP_CATALOG 具备 line 维度，dict 字面量无重复键（旧版 enrichment 被覆盖的根因）；
  2. (line2, enrichment) 与 (line3, enrichment) 是两条不同条目，line2 的 label/legend 与
     results/enrichment_ora.tsv 声明仍在；
  3. S6 §2.5 表逐行：声明的图名必须能命中脚本真实写出的图名（本地存档或 src 源码）；
  4. scenic_figures（line2）、line3 enrichment_figures / dr_post_analysis / normalize_hvg 已登记；
  5. 本地 outputs/default/<line>/figures 里每张真实图都被本线某步骤声明覆盖（无孤儿图）；
  6. 每条声明都能在磁盘或本线脚本源码里找到依据（不留「应该存在」的声明）；
  7. 已确认不存在的旧声明（l2_01_umap_clusters / l2_10_cellchat / track_genes.tsv 等）已删除。

只读仓库，不写盘、不连远端、不跑分析。用法：
    python cn_debug/2026-10-19_verify_step_catalog.py
退出码 0 = 全 PASS；1 = 有 FAIL。
"""

import ast
import fnmatch
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORT_PY = os.path.join(ROOT, "ops", "build_client_report.py")
PROJECT_JS = os.path.join(ROOT, "BioanalysDesktop", "server", "project.js")
SRC = os.path.join(ROOT, "src")
ARCHIVE = os.path.join(ROOT, "outputs", "default")

sys.path.insert(0, os.path.join(ROOT, "ops"))
import build_client_report as m  # noqa: E402

FAILED = []
NOTES = []


def check(label, cond, detail=""):
    if not cond:
        FAILED.append(label)
    print("%s | %s%s" % ("PASS" if cond else "FAIL", label, (" | " + detail) if detail else ""))


def note(text):
    NOTES.append(text)
    print("NOTE | " + text)


def glob_hit(pattern, name):
    return fnmatch.fnmatchcase(name, pattern)


def decl_matches(pattern, name):
    """声明（可含 *）是否命中某个真实文件名。"""
    return glob_hit(pattern, name)


def step_outputs(line, step):
    return list(m.STEP_CATALOG.get(line, {}).get(step, {}).get("outputs", []))


def line_declarations(line):
    out = []
    for step, meta in m.STEP_CATALOG.get(line, {}).items():
        for rel in meta.get("outputs", []):
            out.append((step, rel))
    return out


def src_text(line, step):
    path = os.path.join(SRC, line, "scripts", step)
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return None


def disk_files(line, sub):
    d = os.path.join(ARCHIVE, line, sub)
    if not os.path.isdir(d):
        return []
    return sorted(sub + "/" + n for n in os.listdir(d) if os.path.isfile(os.path.join(d, n)))


# ---------------------------------------------------------------- 1. 结构
print("== 1. STEP_CATALOG 结构 ==")
try:
    tree = ast.parse(open(REPORT_PY, encoding="utf-8").read())
    check("ops/build_client_report.py 可被 ast.parse 解析", True)
except SyntaxError as cause:  # 语法错误必须先暴露，否则后面全是假 PASS
    check("ops/build_client_report.py 可被 ast.parse 解析", False, str(cause))
    raise SystemExit(1)

check("顶层键恰为三条线", sorted(m.STEP_CATALOG) == sorted(m.LINES),
      str(sorted(m.STEP_CATALOG)))
counts = {ln: len(m.STEP_CATALOG[ln]) for ln in m.STEP_CATALOG}
print("     条目数：" + "，".join("%s=%d" % (k, v) for k, v in counts.items()))

catalog_node = None
for node in tree.body:
    if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "STEP_CATALOG" for t in node.targets):
        catalog_node = node.value
        break
check("STEP_CATALOG 是可解析的 dict 字面量", isinstance(catalog_node, ast.Dict))


def dup_keys(node, path=""):
    """递归找出 dict 字面量里的重复键（旧版 enrichment 被覆盖的直接根因）。"""
    found = []
    if isinstance(node, ast.Dict):
        seen = {}
        for k, v in zip(node.keys, node.values):
            if isinstance(k, ast.Constant):
                if k.value in seen:
                    found.append((path + "." + str(k.value), k.lineno))
                seen[k.value] = k.lineno
            found.extend(dup_keys(v, path + "." + str(getattr(k, "value", "?"))))
    return found


dups = dup_keys(catalog_node)
check("dict 字面量无重复键", not dups, str(dups) if dups else "0 处")

# ---------------------------------------------------------------- 2. (line, step) 唯一取到
print("\n== 2. (line, step) 唯一取条目 ==")
e2 = m.step_meta("enrichment", "line2_scrna")
e3 = m.step_meta("enrichment", "line3_spatial")
check("(line2, enrichment) 与 (line3, enrichment) 都存在", bool(e2) and bool(e3))
check("两条 enrichment 不是同一对象", e2 is not e3)
check("line2 enrichment 声明 results/enrichment_ora.tsv",
      "results/enrichment_ora.tsv" in e2.get("outputs", []), str(e2.get("outputs")))
check("line2 enrichment 声明 results/enrichment_gsea.tsv",
      "results/enrichment_gsea.tsv" in e2.get("outputs", []))
check("line3 enrichment 声明带物种段的 ora 表",
      any("enrichment_ora_*" in o for o in e3.get("outputs", [])), str(e3.get("outputs")))
check("line2 enrichment 的 label 未丢", bool(e2.get("label")), e2.get("label", ""))
check("line2 enrichment 的 legend 未丢", bool(e2.get("legend")), e2.get("legend", ""))
check("两条 enrichment 的 label 不同（证明没有被覆盖成同一条）",
      e2.get("label") != e3.get("label"),
      "%s vs %s" % (e2.get("label"), e3.get("label")))
check("step_meta 未知步骤返回空 dict", m.step_meta("no_such_step", "line2_scrna") == {})

# ---------------------------------------------------------------- 3. 步骤覆盖
print("\n== 3. 与工作台 LINE_STEPS 的步骤覆盖 ==")
js = open(PROJECT_JS, encoding="utf-8").read()
block = js.split("export const LINE_STEPS = {", 1)[1].split("\n};", 1)[0]
for line, body in re.findall(r"(\w+):\s*\[(.*?)\]", block, re.S):
    steps = re.findall(r"'([^']+)'", body)
    missing = [s for s in steps if s not in m.STEP_CATALOG.get(line, {})]
    check("%s 的 %d 个步骤全部有目录条目" % (line, len(steps)), not missing,
          "缺：%s" % missing if missing else "")

# ---------------------------------------------------------------- 4. §2.5 逐行对齐
print("\n== 4. S6 §2.5 图名声明 vs 实际产物 ==")

# (行号, line, 承载该图的步骤, 实际写出的具体图名, 说明)
ROWS = [
    ("§2.5-1", "line2_scrna", "cluster_umap", None,
     "l2_01_umap_clusters.png 不存在：该步骤只写 h5ad + cluster_report.txt"),
    ("§2.5-2", "line2_scrna", "scrna_figures", "figures/l2_05_composition_stack.png",
     "组成堆叠图由 scrna_figures 产，不在 scrna_composition 声明"),
    ("§2.5-3", "line2_scrna", "scrna_figures", "figures/l2_08_deg_volcano_basal_keratinocyte.png",
     "火山图带 celltype 后缀，按通配声明"),
    ("§2.5-4", "line2_scrna", "cell_communication", None,
     "l2_10_cellchat.png 不存在，且 l2_10 序号已被 l2_10_pca_diagnosis.png 占用"),
    ("§2.5-5", "line2_scrna", "target_gene_localization", "figures/l2_13_target_gene_dotplot.png", ""),
    ("§2.5-6", "line2_scrna", "gsva_pathways", "figures/l2_14_gsva_heatmap.png", ""),
    ("§2.5-7", "line2_scrna", "dr_post_analysis", "figures/l2_15_dr_gsea_top.png", "漏登记 3 张 → 补"),
    ("§2.5-8", "line2_scrna", "dr_post_analysis", "figures/l2_16_dr_regulatory_network.png", ""),
    ("§2.5-9", "line2_scrna", "dr_post_analysis", "figures/l2_17_dr_overlap.png", ""),
    ("§2.5-10", "line2_scrna", "scrna_figures", "figures/l2_01_umap_celltype.png",
     "scrna_figures 原声明 l2_01_umap_clusters.png（不存在）→ 改为真实图名"),
    ("§2.5-11", "line2_scrna", "scenic_figures", "figures/l2_scenic_01_regulon_heatmap.png", "整步未登记 → 新建"),
    ("§2.5-12", "line2_scrna", "scenic_figures", "figures/l2_scenic_02_top_regulons.png", ""),
    ("§2.5-13", "line3_spatial", "spatial_figures", "l3_human_01_domains_JBO014.png", "含物种段 + 样本段"),
    ("§2.5-14", "line3_spatial", "spatial_figures", "l3_mouse_04_morans_top.png", "原声明 l3_moran.png"),
    ("§2.5-15", "line3_spatial", "spatial_figures", "l3_human_02_target_gene_JBO014.png",
     "原声明 l3_target_spatial_map.png"),
    ("§2.5-16", "line3_spatial", "celltype_annotation", "l3_mouse_14_deconv_umap.png",
     "原声明缺物种段 l3_14_deconv_umap.png"),
    ("§2.5-17", "line3_spatial", "celltype_annotation", "l3_mouse_15_deconv_composition.png", ""),
    ("§2.5-18", "line3_spatial", "spatial_figures", "l3_mouse_09_ko_dr_by_domain.png",
     "spatial_figures 原声明 l3_domains.png（不存在）"),
    ("§2.5-19", "line3_spatial", "dr_post_analysis", "l3_human_10_dr_gsea_top.png",
     "line3 原复用 line2 条目（无图）→ 独立条目 + 补 2 张图"),
    ("§2.5-20", "line3_spatial", "dr_post_analysis", "l3_human_11_dr_overlap.png", ""),
    ("§2.5-21", "line3_spatial", "enrichment_figures", "l3_human_12_ora_top.png", "整步未登记 → 新建"),
    ("§2.5-22", "line3_spatial", "enrichment_figures", "l3_human_13_gsea_top.png", ""),
]

for tag, line, step, actual, why in ROWS:
    outputs = step_outputs(line, step)
    if actual is None:
        # 该步骤不应再声明任何图件
        bad = [o for o in outputs if o.startswith("figures/")]
        check("%s %s/%s 不再声明图件" % (tag, line, step), not bad, str(bad))
        continue
    name = actual if actual.startswith("figures/") else "figures/" + actual
    hit = [o for o in outputs if decl_matches(o, name)]
    check("%s %s/%s 声明命中 %s" % (tag, line, step, name), bool(hit),
          ("声明=%s" % hit[0]) if hit else ("现有声明=%s" % outputs))
    if why:
        note("%s %s" % (tag, why))

# 旧的错误声明必须已经消失
print("\n== 5. 旧错误声明已清除 ==")
DEAD = [
    "figures/l2_01_umap_clusters.png", "figures/l2_10_cellchat.png",
    "figures/l2_05_composition.png", "figures/l2_08_deg_volcano.png",
    "figures/l2_13_target_gene.png", "figures/l2_14_gsva.png",
    "figures/l3_domains.png", "figures/l3_moran.png", "figures/l3_target_spatial_map.png",
    "figures/l3_14_deconv_umap.png", "figures/l3_15_deconv_composition.png",
    "results/track_genes.tsv", "results/scrna_raw.h5ad", "results/scrna_harmony.h5ad",
    "results/subcluster.h5ad", "results/pseudotime.h5ad", "results/cellchat_lr.tsv",
    "results/spatial_raw.h5ad",
]
for dead in DEAD:
    holders = [(ln, st) for ln in m.STEP_CATALOG for st, meta in m.STEP_CATALOG[ln].items()
               if dead in meta.get("outputs", [])]
    check("目录中不再出现 %s" % dead, not holders, str(holders))

# ---------------------------------------------------------------- 6. 真实图件全覆盖
print("\n== 6. 本地存档图件是否被本线声明覆盖 ==")
for line in ("line2_scrna", "line3_spatial"):
    figs = disk_files(line, "figures")
    decls = [rel for st, rel in line_declarations(line) if rel.startswith("figures/")]
    orphan = [f for f in figs if not any(decl_matches(d, f) for d in decls)]
    check("%s：%d 张真实图件全部有声明" % (line, len(figs)), not orphan,
          ("孤儿图 %d 张：%s" % (len(orphan), orphan[:5])) if orphan else "")

# ---------------------------------------------------------------- 7. 每条声明都有依据
print("\n== 7. 每条声明都能在磁盘或本线脚本源码里找到依据 ==")
for line in ("line2_scrna", "line3_spatial"):
    # 直接复用生产代码的解析逻辑（含 results/ → processed/ 的落点回退）
    entry = {"results": disk_files(line, "results"), "figures": disk_files(line, "figures"),
             "processed": disk_files(line, "processed")}
    unbacked = []
    for step, rel in line_declarations(line):
        if m.resolve_artifact(rel, entry):
            continue
        text = src_text(line, step)
        # 脚本里写的是裸文件名 + %s/%d 模板，只拿 basename 去比；声明里的 * 对应模板段
        base = rel.split("/", 1)[1]
        rx = re.escape(base).replace(r"\*", ".+")
        if text is not None and re.search(rx, text):
            continue
        unbacked.append((step, rel))
    check("%s：%d 条声明均有磁盘或源码依据" % (line, len(line_declarations(line))),
          not unbacked, str(unbacked[:5]))

# ---------------------------------------------------------------- 8. l2_10 序号冲突记录
print("\n== 8. 序号冲突记录（不改 src/）==")
scrna_fig_decls = step_outputs("line2_scrna", "scrna_figures")
conflict = [o for o in scrna_fig_decls if "l2_10_" in o]
check("l2_10 现由 pca_diagnosis 独占（scrna_figures 声明）",
      conflict == ["figures/l2_10_pca_diagnosis.png"], str(conflict))
cellchat = [(ln, st, o) for ln in m.STEP_CATALOG for st, meta in m.STEP_CATALOG[ln].items()
            for o in meta.get("outputs", []) if "cellchat" in o.lower()]
check("目录中无任何 cellchat 图声明", not cellchat, str(cellchat))
note("l2_10 序号冲突：l2_10_pca_diagnosis.png 已占用该序号；cell_communication 若日后出图，"
     "应改用 l2_18（需改 src/line2_scrna/scripts/cell_communication 的命名，超出 S7 切片范围）")

# ---------------------------------------------------------------- 9. 行为：按台账线号取到正确的条目
print("\n== 9. 行为验证：chapter3 按 line 取条目 ==")
import json  # noqa: E402  （脚本前部只用标准库，这里集中引入便于阅读）
import shutil  # noqa: E402
import tempfile  # noqa: E402

tmp = tempfile.mkdtemp(prefix="s7_catalog_")
old_logs = os.environ.get("BIO_SYSTEM_LOGS")
os.environ["BIO_SYSTEM_LOGS"] = os.path.join(tmp, "system_logs")
os.makedirs(os.environ["BIO_SYSTEM_LOGS"])


def build_project(pid, line, files, step):
    """造一个只有一条线的最小项目 + 一条 completed 台账。"""
    proj = os.path.join(tmp, pid)
    proc = os.path.join(proj, line, "processed")
    os.makedirs(proc)
    with open(os.path.join(proj, "project.json"), "w", encoding="utf-8") as fh:
        json.dump({"project_id": pid, "pipeline_dag": [{"order": 1, "stepId": step}]}, fh)
    for name in files:
        with open(os.path.join(proc, name), "w", encoding="utf-8") as fh:
            fh.write("Term\tadj_p\nGO:1\t0.01\n")
    with open(os.path.join(os.environ["BIO_SYSTEM_LOGS"], "%s_%s.json" % (pid, step)),
              "w", encoding="utf-8") as fh:
        json.dump({"project_id": pid, "line_id": line, "step_name": step,
                   "status": "completed", "task_id": "s7test01",
                   "environment": {"language": "Python"}}, fh)
    return m.scan_project(proj)


def render(ctx):
    return m.render_markdown(m.build_meta(ctx), m.collect_chapters(ctx))


try:
    md2 = render(build_project("PRJ_L2", "line2_scrna",
                               ["enrichment_ora.tsv", "enrichment_gsea.tsv"], "enrichment"))
    check("line2 项目：enrichment 步骤标题取 line2 的 label",
          "步骤 1 · 单细胞多维功能富集" in md2)
    check("line2 项目：line2 的 ora 表被认到（results/ → processed/ 回退）",
          "`processed/enrichment_ora.tsv`" in md2)
    check("line2 项目：未混入 line3 的物种段声明",
          "enrichment_ora_*.tsv" not in md2)
    check("line2 项目：line2 的图注模板生效",
          "Multi-database functional enrichment of cell-type specific DEG." in md2)

    md3 = render(build_project("PRJ_L3", "line3_spatial",
                               ["enrichment_ora_human.tsv"], "enrichment"))
    check("line3 项目：enrichment 步骤标题取 line3 的 label",
          "步骤 1 · 功能富集" in md3 and "步骤 1 · 单细胞多维功能富集" not in md3)
    check("line3 项目：物种段通配声明命中真实文件",
          "`processed/enrichment_ora_*.tsv`（1 个文件）" in md3,
          md3.split("**② 数据与统计依据**")[1][:140] if "**② 数据与统计依据**" in md3 else "无第二章②")
    check("line3 项目：line3 未写出的 gsea 表如实标未找到",
          "未找到：`results/enrichment_gsea_*.tsv`" in md3)
finally:
    if old_logs is None:
        os.environ.pop("BIO_SYSTEM_LOGS", None)
    else:
        os.environ["BIO_SYSTEM_LOGS"] = old_logs
    shutil.rmtree(tmp, ignore_errors=True)

# ---------------------------------------------------------------- 汇总
print("\n== 汇总 ==")
print("STEP_CATALOG 条目：%s" % "，".join("%s=%d" % (k, v) for k, v in counts.items()))
print("声明总数：%d" % sum(len(line_declarations(ln)) for ln in ("line2_scrna", "line3_spatial")))
print("%s" % ("全部 PASS" if not FAILED else "%d 条 FAIL：%s" % (len(FAILED), FAILED)))
sys.exit(0 if not FAILED else 1)
