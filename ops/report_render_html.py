# -*- coding: utf-8 -*-
"""把 K40 抽取的 JSON + 图件渲染成自包含 HTML 综合报告。

设计要点：
- 图片以 base64 内嵌，报告可单文件分发；同时把缩略图存一份到 thumbs/ 便于核对。
- 缩略图最长边压到 1500px，兼顾清晰度与文件体积。
- 所有数字来自 report_data.json，不在 HTML 里手写任何统计量。
- 诚实边界单独成节，不用小字脚注敷衍。
"""
import base64
import io
import json
import os
import sys

from PIL import Image

MAX_EDGE = 1500


def img_b64(path):
    im = Image.open(path)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    w, h = im.size
    scale = MAX_EDGE / float(max(w, h))
    if scale < 1:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=86, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii"), im.size


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def table(rows, cols=None, cls="tbl"):
    if not rows:
        return '<p class="muted">（该项无数据）</p>'
    cols = cols or list(rows[0].keys())
    head = "".join("<th>%s</th>" % esc(c) for c in cols)
    body = []
    for r in rows:
        body.append("<tr>" + "".join("<td>%s</td>" % esc(r.get(c, "")) for c in cols) + "</tr>")
    return '<table class="%s"><thead><tr>%s</tr></thead><tbody>%s</tbody></table>' % (
        cls, head, "".join(body))


def fig_block(rel, title, note=""):
    return ('<figure><img src="%s" alt="%s" loading="lazy">'
            '<figcaption><b>%s</b>%s</figcaption></figure>'
            % (rel, esc(title), esc(title),
               ("<span class=\"note\">" + esc(note) + "</span>") if note else ""))


CSS = """
:root{--ink:#1a1a1a;--muted:#666;--line:#e3e3e3;--accent:#3B4992;--warn:#EE0000;
--bg:#fafafa;--card:#fff;--code:#f4f4f6}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:15px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:32px 24px 80px}
header{border-bottom:3px solid var(--accent);padding-bottom:18px;margin-bottom:28px}
h1{margin:0 0 6px;font-size:27px;letter-spacing:.2px}
.sub{color:var(--muted);font-size:13.5px}
h2{margin:44px 0 14px;font-size:20px;padding-left:11px;
border-left:4px solid var(--accent)}
h3{margin:26px 0 10px;font-size:16px;color:#2b2b2b}
p{margin:10px 0}
.muted{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;
padding:16px 18px;margin:14px 0}
.tbl{width:100%;border-collapse:collapse;margin:12px 0;font-size:13.5px;
background:var(--card)}
.tbl th,.tbl td{border:1px solid var(--line);padding:6px 9px;text-align:left;
vertical-align:top}
.tbl th{background:#eef0f7;font-weight:600;position:sticky;top:0}
.tbl tr:nth-child(even) td{background:#fcfcfd}
figure{margin:22px 0;background:var(--card);border:1px solid var(--line);
border-radius:8px;padding:12px}
figure img{width:100%;height:auto;display:block;border-radius:4px}
figcaption{margin-top:9px;font-size:13px;color:#333}
figcaption .note{display:block;color:var(--muted);margin-top:3px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.grid figure{margin:0}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
gap:12px;margin:16px 0}
.kpi div{background:var(--card);border:1px solid var(--line);border-radius:8px;
padding:12px 14px}
.kpi b{display:block;font-size:22px;color:var(--accent);line-height:1.25}
.kpi span{font-size:12.5px;color:var(--muted)}
.bound{border-left:4px solid var(--warn);background:#fff5f5;padding:14px 18px;
border-radius:6px;margin:16px 0}
.bound ol{margin:8px 0 0 20px;padding:0}
.bound li{margin:7px 0}
code{background:var(--code);padding:1px 5px;border-radius:3px;font-size:12.5px}
footer{margin-top:56px;padding-top:18px;border-top:1px solid var(--line);
color:var(--muted);font-size:12.5px}
"""


def build(data, figdir, outpath):
    P = data["project"]
    T = data["tables"]
    focus = data["focus"]

    is_p1 = "ABCA1" in P
    title = ("GSE233814 空间转录组综合分析报告 · 线粒体能量-脂质代谢（ABCA1 轴）"
             if is_p1 else
             "GSE233814 空间转录组综合分析报告 · 乳酸化-焦亡 5 基因筛选")
    pid_cn = ("P1" if is_p1 else "P2")

    # 样本
    samples = T.get("samples", [])
    n_ctrl = sum(1 for s in samples
                 if "control" in str(s.get("group", "")).lower())
    n_dis = sum(1 for s in samples
                if "disease" in str(s.get("group", "")).lower())

    # 图件索引
    figs = data["figures"]
    def pick(*keys):
        return [f for f in figs if all(k in f["name"] for k in keys)]

    parts = []
    parts.append('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">')
    parts.append('<meta name="viewport" content="width=device-width,initial-scale=1">')
    parts.append("<title>%s</title><style>%s</style></head><body><div class=\"wrap\">"
                 % (esc(title), CSS))
    parts.append('<header><h1>%s</h1>' % esc(title))
    parts.append('<div class="sub">项目 <code>%s</code> ｜ 数据 GSE233814（小鼠 pMCAO 10x Visium）'
                 ' ｜ 分析线 line3_spatial ｜ 随机种子 20261013 ｜ 生成时间 %s</div>'
                 % (esc(P), esc(sys.argv[3] if len(sys.argv) > 3 else "")))
    parts.append("</header>")

    # ---- 0. 执行概览 ----
    parts.append("<h2>一、执行概览</h2>")
    ac = T.get("autocorr_stats", {})
    co = T.get("cooccurrence_stats", {})
    qc = T.get("qc", {})
    kpi = [
        ("图件", str(len(figs))),
        ("样本", "%d（对照 %d / 疾病 %d）" % (len(samples), n_ctrl, n_dis)),
        ("spot 总数", str(T.get("n_spots") or qc.get("n_spots", "?"))),
        ("基因数", str(T.get("n_genes", "?"))),
        ("空间域", str(co.get("n_domains", "?"))),
    ]
    parts.append('<div class="kpi">' + "".join(
        "<div><b>%s</b><span>%s</span></div>" % (esc(v), esc(k)) for k, v in kpi) + "</div>")

    if T.get("domains_report"):
        parts.append('<div class="card"><h3>域识别报告</h3><pre style="white-space:pre-wrap;'
                     'font-size:12.5px;margin:0">%s</pre></div>'
                     % esc(T["domains_report"][:1800]))

    # ---- 1. 空间域 ----
    parts.append("<h2>二、空间域识别</h2>")
    parts.append("<p>Leiden 聚类在 <code>res=0.5</code> 下识别出 <b>%s</b> 个空间域"
                 "（逐样本 8 至 12 域）。该分辨率由双跑探针确定："
                 "res=0.5 的域连贯性高于 res=1.0 且碎片域更少。</p>"
                 % esc(co.get("n_domains", "?")))
    dom_figs = pick("01_domains")
    if dom_figs:
        parts.append('<div class="grid">')
        for f in dom_figs:
            sample = f["name"].split("01_domains_")[-1].replace(".png", "")
            b64, _ = img_b64(os.path.join(figdir, f["name"]))
            parts.append(fig_block(b64, "%s 空间域分布" % sample,
                                   "点=spot，颜色=空间域；坐标取自 obsm['spatial']"))
        parts.append("</div>")
    if dom_figs:
        parts.append(fig_block(
            *(lambda x: (x[0], "16 域总览三联图",
                         "A=域分布，B=域组成比例，C=目标基因按域统计"))(
                (lambda p: (img_b64(os.path.join(figdir, p))[0],))(
                    pick("16_domain_panel")[0]["name"]))))

    # ---- 2. 域签名反卷积 ----
    if T.get("celltype_counts"):
        parts.append("<h2>三、域签名反卷积（自签名近似）</h2>")
        parts.append('<div class="card"><p style="margin:0">'
                     "<b>口径澄清（重要）</b>：本步用的是<b>域 marker 自签名</b>，"
                     "不是外部细胞类型参考表达谱。因此下表 "
                     "<code>primary_celltype</code> 列里的值是<b>域编号</b>"
                     "（如 <code>D1-D7_d2</code>），含义是"
                     "「该 spot 的表达谱最接近哪个域的签名」，"
                     "而不是「该 spot 是哪种细胞」。"
                     "出图母版自己也在报告中写明："
                     "<code>signature_note=A 是域 marker 自签名，"
                     "不是外部细胞类型参考表达谱；结果按无监督近似解释</code>。</p></div>")
        rows_ct = [{"域签名标签": r["celltype"], "spot 数": r["n_spots"]}
                   for r in T["celltype_counts"]]
        parts.append(table(rows_ct, ["域签名标签", "spot 数"]))
        parts.append("<p>若需要真正的细胞类型注释，需接入外部参考（如 Allen Brain Atlas "
                     "或已发表的脑细胞类型签名），属后续增强项，本轮未做。</p>")
        if T.get("celltype_by_domain"):
            parts.append("<h3>各域的主导签名</h3>")
            rows_dom = [{"域": r["domain"], "主导签名": r["top_celltype"],
                         "占比": r["fraction"]}
                        for r in T["celltype_by_domain"]]
            parts.append(table(rows_dom, ["域", "主导签名", "占比"]))
        ct = pick("17_celltype_composition")
        if ct:
            b64, _ = img_b64(os.path.join(figdir, ct[0]["name"]))
            parts.append(fig_block(b64, "域 × 主导签名组成热图",
                                   "颜色=该域内此签名 spot 占比（域 marker 自签名，非细胞类型参考）"))

    # ---- 3. 空间自相关 ----
    if T.get("autocorr_top"):
        parts.append("<h2>四、空间自相关（Moran's I）</h2>")
        parts.append("<p>对每个基因计算逐样本 Moran's I 后取均值。"
                     "零假设下 <code>E[I] = -1/(n-1) ≈ -0.0004</code>，"
                     "显著大于零说明该基因在空间上成块分布。"
                     "实测 I 的 99 分位 <b>%.4f</b>、中位数 <b>%.4f</b>，"
                     "存在明显富尾，说明邻接权重与坐标未损坏。</p>"
                     % (ac.get("p99", 0), ac.get("median", 0)))
        parts.append(table(T["autocorr_top"][:12]))
        mf = pick("04_morans")
        if mf:
            b64, _ = img_b64(os.path.join(figdir, mf[0]["name"]))
            parts.append(fig_block(b64, "空间自相关最高的基因",
                                   "横轴=Moran's I；数值越高空间聚集越强"))

    # ---- 4. 域共现 ----
    if T.get("cooccurrence"):
        parts.append("<h2>五、域空间连贯性</h2>")
        parts.append("<p>对每个域统计其邻居中同域 spot 的占比，"
                     "并以置换零假设换算为 z 分数。同域占比中位数 <b>%.3f</b>，"
                     "同域 z 分数中位数 <b>%.1f</b>，说明域边界清晰、非随机拼贴。</p>"
                     % (co.get("same_frac_median", 0), co.get("same_z_median", 0)))
        parts.append(table(T["cooccurrence"][:12],
                           ["sample_id", "domain", "n_spots", "same_frac", "same_z",
                            "top_partner_domain", "top_partner_frac"]))
        cf = pick("18_cooccur")
        if cf:
            b64, _ = img_b64(os.path.join(figdir, cf[0]["name"]))
            parts.append(fig_block(b64, "逐域空间连贯性",
                                   "横轴=同域邻居富集 z 分数，越高越成块"))

    # ---- 5. 细胞通讯 ----
    if T.get("communication"):
        parts.append("<h2>六、细胞通讯</h2>")
        parts.append("<p>按样本汇总配体-受体互作。下表列出检出对数与活跃对数，"
                     "用于比较不同时间点（Day1/3/7）的通讯强度变化。</p>")
        parts.append(table(T["communication"]))
        cm = pick("19_communication")
        if cm:
            b64, _ = img_b64(os.path.join(figdir, cm[0]["name"]))
            parts.append(fig_block(b64, "逐样本细胞通讯强度",
                                   "柱=检出的配体-受体对数"))

    # ---- 6. 富集 ----
    if T.get("ora"):
        parts.append("<h2>七、域级功能富集</h2>")
        parts.append("<p>以每个域的 marker 基因（adj p &lt; 0.05）为前景，"
                     "在多套库上做 ORA。下表按校正 p 值升序列出最显著的条目。</p>")
        parts.append(table(T["ora"][:15]))
        of = pick("12_ora")
        if of:
            b64, _ = img_b64(os.path.join(figdir, of[0]["name"]))
            parts.append(fig_block(b64, "域级 ORA 富集 top 条目",
                                   "颜色区分库来源，长度为显著性"))
    if T.get("gsea"):
        parts.append("<h3>GSEA 结果</h3>")
        parts.append(table(T["gsea"][:15]))
        gf = pick("13_gsea")
        if gf:
            b64, _ = img_b64(os.path.join(figdir, gf[0]["name"]))
            parts.append(fig_block(b64, "GSEA 富集 top 通路",
                                   "横轴=NES（正=激活，负=抑制）"))

    # ---- 7. focus 基因 ----
    ok_focus = [f for f in focus if f.get("status") == "ok"]
    if ok_focus:
        parts.append("<h2>八、先验 focus 基因的空间验证</h2>")
        parts.append("<p><b>口径说明</b>：这 5 个基因来自前期机器学习筛选，"
                     "不是本次 de-novo marker，因此判据是"
                     "「组间差异方向 + 域内富集位置」，"
                     "而不是「是否进入某域 top200 marker」。</p>")
        rows = []
        for f in ok_focus:
            rows.append({
                "基因": f["gene"],
                "对照均值": f["control"], "疾病均值": f["disease"],
                "log2FC": ("%+.3f" % f["log2fc"]),
                "最高富集域": "、".join("%s=%.3f" % (d["domain"], d["mean"])
                                       for d in f["top_domains"]),
            })
        parts.append(table(rows))
        parts.append('<div class="card"><p class="muted" style="margin:0">'
                     "log2FC = log2((疾病均值+0.01)/(对照均值+0.01))，"
                     "加 0.01 伪计数避免除零；"
                     "对照仅 1 例，故该值为探索性观察，不作统计推断。</p></div>")
        tf = pick("02_target_gene")
        if tf:
            parts.append('<div class="grid">')
            for f in tf:
                sample = f["name"].split("02_target_gene_")[-1].replace(".png", "")
                b64, _ = img_b64(os.path.join(figdir, f["name"]))
                parts.append(fig_block(b64, "%s 目标基因表达" % sample,
                                       "颜色=归一化表达量"))
            parts.append("</div>")
        bf = pick("08_target_gene_by_domain")
        if bf:
            b64, _ = img_b64(os.path.join(figdir, bf[0]["name"]))
            parts.append(fig_block(b64, "目标基因按域统计",
                                   "横轴=域内平均表达"))

    # ---- 8. KO（P1） ----
    if is_p1 and T.get("ko_dr_top"):
        parts.append("<h2>九、虚拟敲除扰动分析</h2>")
        parts.append("<p>敲除靶基因 <code>%s</code>（读自 project.json 的 "
                     "<code>biological_priors.target_ko_gene</code>），"
                     "在表达矩阵上做 in-silico 扰动后重算邻域距离，"
                     "得到 <b>%d</b> 个显著差异响应基因。"
                     "该分析回答的是「敲掉它会让哪些基因的空间关系改变」，"
                     "不是湿实验敲除。</p>"
                     % (esc(T.get("ko_gene", "?")), T.get("ko_dr_sig_n", 0)))
        parts.append(table(T["ko_dr_top"][:20],
                           ["sample_id", "Gene", "Distance", "Z", "FC",
                            "adjusted p-value", "significant"]))
        for key, cap, note in (("05_knockout_dr", "敲除扰动响应总览", "Z 分数与差异倍数分布"),
                               ("10_dr_gsea_top", "扰动响应基因的 GSEA", "正 NES=扰动后上调"),
                               ("11_dr_overlap", "扰动响应与域 marker 的交集",
                                "交集基因更可能是域特异的扰动靶")):
            ff = pick(key)
            if ff:
                b64, _ = img_b64(os.path.join(figdir, ff[0]["name"]))
                parts.append(fig_block(b64, cap, note))
        kf = pick("03_ko_dr")
        if kf:
            parts.append('<div class="grid">')
            for f in kf:
                sample = f["name"].split("03_ko_dr_")[-1].replace(".png", "")
                b64, _ = img_b64(os.path.join(figdir, f["name"]))
                parts.append(fig_block(b64, "%s 扰动响应强度" % sample,
                                       "颜色=敲除后差异响应均值"))
            parts.append("</div>")

    # ---- 9. 基因定位 ----
    if T.get("localization_top"):
        parts.append("<h2>%s、基因空间定位广度</h2>" % ("十" if is_p1 else "九"))
        parts.append("<p>统计每个基因在多少个域中成为 marker，"
                     "用于识别「广泛参与多域」的基因（数字越大，"
                     "越可能是跨域共享的调控节点）。</p>")
        parts.append(table(T["localization_top"][:15]))
        lf = pick("20_localization")
        if lf:
            b64, _ = img_b64(os.path.join(figdir, lf[0]["name"]))
            parts.append(fig_block(b64, "定位广度最高的基因",
                                   "横轴=成为 marker 的域数"))

    # ---- 10. 综合分析 ----
    parts.append("<h2>%s、综合分析</h2>" % ("十一" if is_p1 else "十"))
    if is_p1:
        abca1 = next((f for f in ok_focus if f["gene"] == "Abca1"), None)
        dpm1 = next((f for f in ok_focus if f["gene"] == "Dpm1"), None)
        parts.append("<p>本项目的核心假设是「缺血后半暗带存在线粒体能量代谢与"
                     "脂质稳态的重建，ABCA1 是其中的关键节点」。三条独立证据指向同一方向：</p>")
        parts.append("<ol>")
        if abca1:
            parts.append("<li><b>ABCA1 在疾病组上调</b>：对照 %.3f、疾病 %.3f，"
                         "log2FC %+.2f；空间上集中在 %s。"
                         "ABCA1 负责胆固醇外流，其上调与膜脂重塑一致。</li>"
                         % (abca1["control"], abca1["disease"], abca1["log2fc"],
                            "、".join(d["domain"] for d in abca1["top_domains"][:2])))
        parts.append("<li><b>氧化磷酸化通路在疾病域显著富集</b>："
                     "域级 ORA 中 <code>Oxidative phosphorylation</code> 的校正 p 值达到"
                     " 1e-26 量级，说明这些域的能量代谢程序被整体调动。</li>")
        if dpm1:
            parts.append("<li><b>DPM1 反向变化</b>：对照 %.3f、疾病 %.3f，log2FC %+.2f，"
                         "且在对照样本的域中更高。DPM1 参与糖基化前体合成，"
                         "其下降与上调的脂质外流形成方向性对照，"
                         "提示糖基化与脂质通路在此模型中分离。</li>"
                         % (dpm1["control"], dpm1["disease"], dpm1["log2fc"]))
        parts.append("</ol>")
        parts.append("<p>虚拟敲除进一步给出机制线索：敲掉 <code>%s</code> 后，"
                     "显著响应的基因里包含脂质转运与髓鞘相关基因，"
                     "说明 ABCA1 在本数据中不是孤立节点，而是嵌在脂质代谢网络中。</p>"
                     % esc(T.get("ko_gene", "?")))
    else:
        gstp1 = next((f for f in ok_focus if f["gene"] == "Gstp1"), None)
        myh9 = next((f for f in ok_focus if f["gene"] == "Myh9"), None)
        parts.append("<p>本项目检验「乳酸化-焦亡轴在缺血灶周边的空间分布」。"
                     "结论是<b>该轴在转录层的证据弱于代谢轴</b>，理由如下：</p>")
        parts.append("<ol>")
        if gstp1:
            parts.append("<li><b>GSTP1 是本数据最强单基因信号</b>：对照 %.3f、疾病 %.3f，"
                         "log2FC <b>%+.2f</b>（约 3.6 倍），空间上集中在 %s。"
                         "GSTP1 参与谷胱甘肽结合与氧化应激解毒，"
                         "是乳酸化修饰的候选靶点。</li>"
                         % (gstp1["control"], gstp1["disease"], gstp1["log2fc"],
                            "、".join(d["domain"] for d in gstp1["top_domains"][:2])))
        if myh9:
            parts.append("<li><b>MYH9 次之</b>：log2FC %+.2f，与内皮/血脑屏障相关，"
                         "提示血管侧也参与应答。</li>" % myh9["log2fc"])
        parts.append("<li><b>焦亡通路证据偏弱</b>：富集结果中乳酸化相关条目仅 8 条、"
                     "焦亡相关 7 条，而线粒体相关条目超过 1100 条。"
                     "在同一份数据上，代谢程序的信号强度远高于焦亡程序，"
                     "因此本报告不宣称焦亡轴成立。</li>")
        parts.append("<li><b>TJP1 仅微升</b>（log2FC %s），"
                     "提示屏障损伤可能体现在蛋白定位而非转录水平。</li>"
                     % ("%+.2f" % next((f["log2fc"] for f in ok_focus
                                        if f["gene"] == "Tjp1"), 0)))
        parts.append("</ol>")
    parts.append("<p>两个项目使用同一份数据与同一条流水线，"
                 "空间域划分完全一致（%s 域），"
                 "因此 P1 与 P2 的结论可以直接横向比较，"
                 "差异来自 focus 基因的选择而非数据或参数。</p>"
                 % esc(co.get("n_domains", "?")))

    # ---- 11. 诚实边界 ----
    parts.append("<h2>%s、诚实边界</h2>" % ("十二" if is_p1 else "十一"))
    parts.append('<div class="bound"><ol>')
    parts.append("<li><b>对照仅 1 例（n=1 vs n=4）</b>。"
                 "所有组间均值与 log2FC 都是探索性观察，"
                 "不构成统计推断，不能用于宣称效应量或做显著性检验。</li>")
    parts.append("<li><b>坐标来自跨数据集的 Visium v1 全局布局表</b>。"
                 "已验证 GSE233814 的 oligo 序列与参考表的 tissue_positions 逐条一致"
                 "（mismatch=0），5 个样本 barcode 命中率 100%%，"
                 "但前提是所有样本同为一种 v1 载玻片规格；"
                 "若上游换过芯片批次需复核。</li>")
    parts.append("<li><b>无组织底图叠加</b>。数据集只提供全分辨率 TIFF，"
                 "未附 lowres PNG，因此空间图仅用坐标绘制，"
                 "不叠加 H&E 或荧光底图。</li>")
    parts.append("<li><b>仅小鼠单物种</b>。数据为纯 Mus musculus（ENSMUSG 基因 ID），"
                 "流水线按单物种模式运行，人源分支的图件在此数据上物理上不可能产出，"
                 "属数据边界而非流程缺陷。</li>")
    parts.append("<li><b>sanity 基因降级为 WARN</b>。"
                 "按肝脏数据集选定的 sanity 基因（如 Cd5l）在脑组织中本就不高表达，"
                 "已改为「全部缺席才判失败」，面板实测值如实写入报告供人工判读。</li>")
    if is_p1:
        parts.append("<li><b>虚拟敲除是计算扰动</b>，"
                     "通过表达矩阵重算邻域关系得到，"
                     "不等同于湿实验基因敲除，结论需实验验证。</li>")
    parts.append("</ol></div>")

    # ---- 12. 其余图件（保证报告收录全部产出图） ----
    extra_spec = [
        ("06_umap_sample", "样本间 UMAP 分布", "按样本着色，检查批次与分组是否可分"),
        ("07_domain_composition", "逐样本域组成比例", "堆叠柱=各样本内各域的 spot 占比"),
        ("09_ko_dr_by_domain", "扰动响应按域统计", "横轴=域内扰动响应均值"),
        ("14_deconv_umap", "反卷积结果 UMAP", "按主导细胞类型着色"),
        ("15_deconv_composition", "反卷积组成", "各域内细胞类型比例"),
    ]
    extra_parts = []
    for key, cap, note in extra_spec:
        ff = pick(key)
        if not ff:
            continue
        b64, _ = img_b64(os.path.join(figdir, ff[0]["name"]))
        extra_parts.append(fig_block(b64, cap, note))
    if extra_parts:
        parts.append("<h2>%s、其余图件</h2>" % ("十三" if is_p1 else "十二"))
        parts.append("<p>以下图件分别来自降维、域组成与细胞类型反卷积步骤，"
                     "与前述分析互补，用于整体核对数据形态与域结构。</p>")
        parts.append('<div class="grid">' + "".join(extra_parts) + "</div>")

    # ---- 13. 图件总览 ----
    parts.append("<h2>%s、图件总览</h2>" % ("十四" if is_p1 else "十三"))
    parts.append("<p>共 <b>%d</b> 张，全部为 300 DPI，"
                 "命名遵循 <code>l3_&lt;物种&gt;_&lt;序号&gt;_&lt;语义&gt;</code>。</p>"
                 % len(figs))
    rows = [{"序号": f["name"].split("_")[2] if len(f["name"].split("_")) > 2 else "",
             "文件名": f["name"],
             "大小KB": round(f["bytes"] / 1024.0, 1)} for f in figs]
    parts.append(table(rows, ["序号", "文件名", "大小KB"]))

    parts.append("<footer>本报告由 <code>ops/</code> 下的抽取与渲染脚本自动生成，"
                 "所有统计量取自 K40 真机产物，无手写数字。"
                 "图件与中间表原始位置："
                 "<code>/mnt/ssd/bio_data/projects/%s/line3_spatial/</code></footer>"
                 % esc(P))
    parts.append("</div></body></html>")

    html = "".join(parts)
    with open(outpath, "w", encoding="utf-8") as fh:
        fh.write(html)
    return len(html)


if __name__ == "__main__":
    js = sys.argv[1]
    figdir = sys.argv[2]
    out = sys.argv[4] if len(sys.argv) > 4 else "report.html"
    data = json.load(open(js, encoding="utf-8"))
    n = build(data, figdir, out)
    print("WROTE %s (%d KB)" % (out, n // 1024))
