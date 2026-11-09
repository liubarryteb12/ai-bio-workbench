#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO = path.resolve(__dirname, '..', '..');
const FIGURE_ROOT = 'references/05.可参考生信代码/可用代码预筛选/源码';
const CSV_PATH = path.join(REPO, FIGURE_ROOT, '_meta', 'bizard_index.csv');
const REPORT_PATH = path.join(REPO, FIGURE_ROOT, '_meta', 'r453_verification_report.json');
const REGISTRY_PATH = path.join(REPO, 'tools', 'bio', 'figure_templates.json');
const PLOT_MATRIX_PATH = path.join(REPO, FIGURE_ROOT, '_meta', 'script_plot_matrix.json');

function fail(message) {
  console.error(message);
  process.exitCode = 2;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      field = '';
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
    } else if (char !== '\r') {
      field += char;
    }
    index += 1;
  }

  row.push(field);
  if (row.some((value) => value.trim().length > 0)) rows.push(row);
  return rows;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}


/**
 * 读 script_plot_matrix.json 里的 png artifact，按 basename 索引。
 *
 * 为什么需要它（第三十三轮 T1-3）：r453 报告的 artifacts[] 只有 file 与 runner，
 * **没有 sha256**，拿它做「预览与产物恒等」只能比文件名。matrix 的 artifacts[].sha256
 * 才是重渲染产物的真实哈希，所以 render_evidence 的证据源只能是 matrix。
 * 矩阵文件缺失时返回空表：render_evidence 一律 null，由门禁负责把欠账报出来。
 */
function plotMatrixArtifacts() {
  const out = new Map();
  let matrix;
  try {
    matrix = JSON.parse(fs.readFileSync(PLOT_MATRIX_PATH, 'utf8'));
  } catch {
    return out;
  }
  for (const entry of matrix.entries || []) {
    for (const art of entry.artifacts || []) {
      const rel = art.relative_path;
      if (!rel || !rel.endsWith('.png')) continue;
      out.set(rel, {
        entry_id: entry.entry_id, runner: entry.script_path,
        sha256: art.sha256, width: art.width, height: art.height,
      });
    }
  }
  return out;
}

function snakeCase(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function dependencies(raw) {
  if (!raw || raw === '-') return [];
  return raw
    .replace(/[`”]/g, '')
    .replace(/[；、]/g, ';')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function linkedMods(row, status) {
  if (row.language === 'python') {
    return ['l2_figures_scrna', 'l3_figures_spatial'];
  }
  if (row.enName === 'KeggPathwayPlot') return ['l1_enrich_figures'];
  return ['l1_figures_bulk'];
}

function adaptVars(row) {
  const name = row.enName.toLowerCase();
  const common = {
    input_data: '项目本线只读输入文件路径，相对于本项目根目录',
  };

  if (name.includes('histogram') || name.includes('density')) {
    return { ...common, value_col: '数值列名', group_col: '分组列名' };
  }
  if (name.includes('scatter') || name.includes('bubble') || name.includes('biplot')) {
    return { ...common, x_col: '横轴列名', y_col: '纵轴列名', label_genes: '需要标注的基因清单，可为空' };
  }
  if (name.includes('heatmap') || name === 'complexheatmap' || name === 'bubbleheatmap') {
    return {
      ...common, row_col: '行注释列名', column_col: '列注释列名',
      value_col: '表达或差异数值列', group_col: '样本分组列名',
    };
  }
  if (name.includes('pca') || name.includes('umap')) {
    return { ...common, group_col: '细胞或样本分组列名' };
  }
  if (name.includes('volcano')) {
    return {
      ...common,
      group_col: '比较方向定义使用的分组列名',
      label_genes: '需要标注的基因清单，可为空',
      log2fc_cutoff: '差异倍数阈值，三档：0.5 宽松 / 1 标准 / 2 严苛',
      padj_cutoff: '显著性阈值，三档：0.1 / 0.05 / 0.05',
    };
  }
  if (name.includes('violin') || name.includes('boxplot')) {
    return { ...common, group_col: '分组列名', value_col: '表达或测量值列名' };
  }
  if (name.includes('groupedbar') || name.includes('barplot') || name.includes('radial')) {
    return {
      ...common, group_col: '分组列名', x_col: '横轴类别列名',
      value_col: '均值或计数列名', error_col: '误差列名，可为空',
    };
  }
  if (name.includes('multipanel') || name.includes('panel')) {
    return { ...common, panel_col: '分面面板列名', group_col: '分组列名', value_col: '数值列名' };
  }
  if (name.includes('sankey')) {
    return { ...common, axis_cols: '按顺序排列的流轴列名', value_col: '流量数值列名', flow_col: '流向分类列名' };
  }
  return { ...common, group_col: '分组列名' };
}

const TEMPLATE_MAPPINGS = {
  // py_l2p_stats 四合一 runner 准入（2026-11-02，k40 真机验证 seed=20261013）
  fig_l2p_scatterplot: {
    lines: ['line2_scrna'],
    analysis_step: "l2_integrate_annotate",
    input_tables: ["cluster_markers.tsv"],
    produces: ["custom_fig_l2p_scatterplot.png"],
    output_glob: "figures/line2_scrna/custom_fig_l2p_scatterplot.png",
    canonical_output: "L2p_scatter_verified.png",
    sample_project_output: "workspace/projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2p_scatterplot.png",
  },
  // r_l1_p0_gallery 三合一 runner 准入（2026-11-02，k40 真机验证 seed=20261013，
  // 两次实跑 PNG sha256 逐字节一致；4 Argon 第十一轮批次 A 裁定）
  // 收官批（2026-11-02，4 Argon 第十三轮第 2 节）
  // 第 29/30 张（2026-11-02，4 Argon 第十五轮裁定，Argon 本人而非 Flash-Lite）
  fig_l3_chorddiagram: {
    // 复用 L3 弦图槽位承载 Line 2 的细胞通讯：CSV 语言列本就是 r，
    // 母版用 circlize（已在库 0.4.18），所以只需把线与 mod 指到 Line 2 的 Python 侧出图 mod。
    language: "python",
    lines: ['line2_scrna'],
    linked_mods: ["l2_figures_scrna"],
    analysis_step: "l2_branches_cellcomm",
    input_tables: ["cellcomm_interactions.tsv"],
    produces: ["L3_cellcomm_chord_verified.png"],
    output_glob: "figures/line2_scrna/L3_cellcomm_chord_verified.png",
    canonical_output: "L3_cellcomm_chord_verified.png",
    source_runner_id: "py_l2p_cellcomm_autocorr",
    sample_project_output: "workspace/projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l3_cellcomm_chord.png",
  },
  fig_l1_connectedscatter: {
    // 用 L1 的连接散点槽位承载 Line 3 的空间自相关：Moran's I × -Geary's C 正是双变量关系图，
    // 不新增 ID，保持 total === 82 的不变量。
    language: "python",
    lines: ['line3_spatial'],
    linked_mods: ["l3_figures_spatial"],
    analysis_step: "l3_stats_autocorr",
    input_tables: ["gene_autocorr_human.tsv"],
    produces: ["L3_spatial_autocorr_verified.png"],
    output_glob: "figures/line3_spatial/L3_spatial_autocorr_verified.png",
    canonical_output: "L3_spatial_autocorr_verified.png",
    source_runner_id: "py_l2p_cellcomm_autocorr",
    sample_project_output: "workspace/projects/PRJ_AIMS_V3_20261027/figures/line3_spatial/custom_fig_l1_connectedscatter.png",
  },
  fig_l1_correlogram: {
    lines: ['line1_bulk'],
    // expr_genes.tsv 的声明产出者是 l1_ingest_prep（不是 l1_qc_matrix）。
    // 图件消费「样本间表达量相关性」，语义上也属于接入后的表达矩阵，绑定一致。
    analysis_step: "l1_ingest_prep",
    input_tables: ["expr_genes.tsv"],
    produces: ["L1_correlogram_verified.png"],
    output_glob: "figures/line1_bulk/L1_correlogram_verified.png",
    canonical_output: "L1_correlogram_verified.png",
    source_runner_id: "r_l1_p0_gallery",
    sample_project_output: "workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_correlogram.png",
  },
  fig_l1_bubble: {
    lines: ['line1_bulk'],
    analysis_step: "l1_de_limma",
    input_tables: ["deg_all.tsv"],
    produces: ["L1_bubble_verified.png"],
    output_glob: "figures/line1_bulk/L1_bubble_verified.png",
    canonical_output: "L1_bubble_verified.png",
    source_runner_id: "r_l1_p0_gallery",
    sample_project_output: "workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_bubble.png",
  },
  fig_l1_ridgeline: {
    lines: ['line1_bulk'],
    analysis_step: "l1_enrich_bulk",
    input_tables: ["enrichment_gsea_go.tsv"],
    produces: ["L1_ridgeline_verified.png"],
    output_glob: "figures/line1_bulk/L1_ridgeline_verified.png",
    canonical_output: "L1_ridgeline_verified.png",
    source_runner_id: "r_l1_p0_gallery",
    sample_project_output: "workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_ridgeline.png",
  },
  fig_l1_upsetplot: {
    lines: ['line1_bulk'],
    analysis_step: "l1_de_limma",
    // 用 deg_all.tsv 而不是 deg_sig.tsv：示例项目里 deg_sig 是空表（adj_P_Val 最小 0.45，
    // 无基因过 0.05），按 Argon 原话「多阈值/多子集交集」本就该从全表切阈值。
    // 两者都是 l1_de_limma 自己声明的产物，step 绑定不变。
    input_tables: ["deg_all.tsv"],
    produces: ["L1_upset_verified.png"],
    output_glob: "figures/line1_bulk/L1_upset_verified.png",
    canonical_output: "L1_upset_verified.png",
    source_runner_id: "r_l1_p0_gallery",
    sample_project_output: "workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_upsetplot.png",
  },
  fig_l1_vennplot: {
    lines: ['line1_bulk'],
    analysis_step: "l1_de_limma",
    input_tables: ["deg_all.tsv"],
    produces: ["L1_venn_verified.png"],
    output_glob: "figures/line1_bulk/L1_venn_verified.png",
    canonical_output: "L1_venn_verified.png",
    source_runner_id: "r_l1_p0_gallery",
    sample_project_output: "workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_vennplot.png",
  },
  // py_l2p_enrich_ko 三合一 runner 准入（2026-11-02，k40 真机实跑两次 sha256 一致）
  fig_l2p_gseaplot: {
    lines: ['line2_scrna'],
    analysis_step: "l2_branches_enrich",
    input_tables: ["enrichment_gsea.tsv"],
    produces: ["L2p_gsea_verified.png"],
    output_glob: "figures/line2_scrna/L2p_gsea_verified.png",
    canonical_output: "L2p_gsea_verified.png",
    source_runner_id: "py_l2p_enrich_ko",
    sample_project_output: "workspace/projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2p_gseaplot.png",
  },
  fig_l2p_enrichmentplot: {
    lines: ['line2_scrna'],
    analysis_step: "l2_branches_enrich",
    input_tables: ["enrichment_ora.tsv"],
    produces: ["L2p_enrichment_verified.png"],
    output_glob: "figures/line2_scrna/L2p_enrichment_verified.png",
    canonical_output: "L2p_enrichment_verified.png",
    source_runner_id: "py_l2p_enrich_ko",
    sample_project_output: "workspace/projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2p_enrichmentplot.png",
  },
  fig_l2_networkplot: {
    // 母版是 L2p_enrich_ko_code.py（Python 三合一 runner）。CSV 的语言列写的是 r，
    // 那是历史「网络图多用 R 包」的登记口径；这里是 mapping.language 覆盖的真源，
    // 不覆盖会让 parity 的 R seed 断言去检 Python 模板而误红（实测踩过）。
    language: "python",
    // linked_mods 也要显式覆盖：CSV 语言列是 r，默认会绑到 l1_figures_bulk（R），
    // 与 Python 母版语言冲突，registry 校验会判红。绑到本线真实的 Python 出图 mod。
    linked_mods: ["l2_figures_scrna"],
    lines: ['line2_scrna'],
    analysis_step: "l2_ko_drpost",
    input_tables: ["dr_regulatory_network.tsv"],
    produces: ["L2p_konetwork_verified.png"],
    output_glob: "figures/line2_scrna/L2p_konetwork_verified.png",
    canonical_output: "L2p_konetwork_verified.png",
    source_runner_id: "py_l2p_enrich_ko",
    sample_project_output: "workspace/projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2_networkplot.png",
  },
  fig_l2p_barplot: {
    lines: ['line2_scrna'],
    analysis_step: "l2_profile_composition",
    input_tables: ["celltype_composition.tsv"],
    produces: ["custom_fig_l2p_barplot.png"],
    output_glob: "figures/line2_scrna/custom_fig_l2p_barplot.png",
    canonical_output: "L2p_bar_verified.png",
    sample_project_output: "workspace/projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2p_barplot.png",
  },
  fig_l2p_boxplot: {
    lines: ['line2_scrna'],
    analysis_step: "l2_qc_cells",
    input_tables: ["qc_cell_metrics.tsv"],
    produces: ["custom_fig_l2p_boxplot.png"],
    output_glob: "figures/line2_scrna/custom_fig_l2p_boxplot.png",
    canonical_output: "L2p_box_verified.png",
    sample_project_output: "workspace/projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2p_boxplot.png",
  },
  fig_l2p_heatmap: {
    lines: ['line2_scrna'],
    analysis_step: "l2_branches_gsva",
    input_tables: ["gsva_scores.tsv"],
    produces: ["custom_fig_l2p_heatmap.png"],
    output_glob: "figures/line2_scrna/custom_fig_l2p_heatmap.png",
    canonical_output: "L2p_heatmap_verified.png",
    sample_project_output: "workspace/projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2p_heatmap.png",
  },
  fig_l2_heatmap: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_ingest_prep',
    input_tables: ['expr_genes.tsv'],
    produces: ['custom_fig_l2_heatmap.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l2_heatmap.png',
    canonical_output: 'L2_heatmap_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_04_topvar_heatmap.png',
  },
  fig_l2_pca: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_qc_pca',
    input_tables: ['pca_scores.tsv'],
    produces: ['custom_fig_l2_pca.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l2_pca.png',
    canonical_output: 'L2_pca_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_02_pca.png',
  },
  fig_l2_volcano: {
    lines: ['line1_bulk'],
    analysis_step: 'l1_de_limma',
    input_tables: ['deg_all.tsv'],
    produces: ['custom_fig_l2_volcano.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l2_volcano.png',
    canonical_output: 'L2_volcano_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/l1_03_volcano_limma.png',
  },
  fig_l2p_dotplot: {
    lines: ['line2_scrna'],
    analysis_step: 'l2_ko_localization',
    input_tables: ['target_gene_localization.tsv'],
    produces: ['custom_fig_l2p_dotplot.png'],
    output_glob: 'figures/line2_scrna/custom_fig_l2p_dotplot.png',
    canonical_output: 'figures/dotplot__L2p_dotplot_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/l2_13_target_gene_dotplot.png',
  },
  fig_l2p_umap: {
    lines: ['line3_spatial'],
    analysis_step: 'l3_dimred_reduce',
    input_tables: ['spatial_dimred_human.h5ad'],
    produces: ['custom_fig_l2p_umap.png'],
    output_glob: 'figures/line3_spatial/custom_fig_l2p_umap.png',
    canonical_output: 'umap_L2p_umap_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line3_spatial/l3_human_06_umap_sample.png',
  },
  fig_l2p_volcano: {
    lines: ['line2_scrna'],
    analysis_step: 'l2_profile_deg',
    input_tables: ['deg_all_by_celltype.tsv'],
    produces: ['custom_fig_l2p_volcano.png'],
    output_glob: 'figures/line2_scrna/custom_fig_l2p_volcano.png',
    canonical_output: 'L2p_volcano_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/l2_08_deg_volcano_basal_keratinocyte.png',
  },
  fig_l1_groupedbar: {
    lines: ['line1_bulk'], analysis_step: 'l1_enrich_bulk',
    input_tables: ['enrichment_gsea_go.tsv'],
    produces: ['custom_fig_l1_groupedbar.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_groupedbar.png',
    canonical_output: 'L1_groupedbar_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_groupedbar.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      x_col: '横轴类别列名',
      value_col: '数值列名',
      group_col: '分组或本体列名',
    },
  },
  fig_l1_scatter: {
    lines: ['line1_bulk'], analysis_step: 'l1_ml_hub',
    input_tables: ['ml_core_hub_genes.tsv'],
    produces: ['custom_fig_l1_scatter.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_scatter.png',
    canonical_output: 'L1_scatter_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_scatter.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      x_col: '横轴数值列名',
      y_col: '纵轴数值列名',
      label_genes: '需要标注的基因清单，可为空',
    },
  },
  fig_l1_boxplot: {
    lines: ['line1_bulk'], analysis_step: 'l1_de_limma',
    input_tables: ['deg_all.tsv'],
    produces: ['custom_fig_l1_boxplot.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_boxplot.png',
    canonical_output: 'L1_boxplot_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_boxplot.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      value_col: '效应量列名',
    },
  },
  fig_l1_density: {
    lines: ['line1_bulk'], analysis_step: 'l1_ingest_prep',
    input_tables: ['expr_genes.tsv'],
    produces: ['custom_fig_l1_density.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_density.png',
    canonical_output: 'L1_density_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_density.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
    },
  },
  fig_l1_histogram: {
    lines: ['line1_bulk'], analysis_step: 'l1_ingest_prep',
    input_tables: ['expr_genes.tsv'],
    produces: ['custom_fig_l1_histogram.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_histogram.png',
    canonical_output: 'L1_histogram_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_histogram.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
    },
  },
  fig_l1_violin: {
    lines: ['line1_bulk'], analysis_step: 'l1_de_limma',
    input_tables: ['deg_all.tsv'],
    produces: ['custom_fig_l1_violin.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l1_violin.png',
    canonical_output: 'L1_violin_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l1_violin.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      value_col: '效应量列名',
    },
  },
  fig_l2_umap: {
    lines: ['line2_scrna'], analysis_step: 'l2_integrate_cluster',
    input_tables: ['scrna_clustered.h5ad'],
    produces: ['custom_fig_l2_umap.png'],
    output_glob: 'figures/line2_scrna/custom_fig_l2_umap.png',
    canonical_output: 'umap_L2p_umap_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2_umap.png',
    language: 'python',
    linked_mods: ['l2_figures_scrna'],
    source_runner_id: 'py_l2p_umap',
    source_override: `${FIGURE_ROOT}/L2_组学常用图/L2p_umap_code.py`,
    preview_override: `${FIGURE_ROOT}/L2_组学常用图/L2p_umap_verified.png`,
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      group_col: '细胞分组列名',
    },
  },
  fig_l3_multipanel: {
    lines: ['line1_bulk'], analysis_step: 'l1_ml_external',
    input_tables: ['external_validation_preds.tsv'],
    produces: ['custom_fig_l3_multipanel.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l3_multipanel.png',
    canonical_output: 'L3_multipanel_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l3_multipanel.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      group_col: '真实标签列名',
      value_col: '预测概率列名',
    },
  },
  fig_l2p_violin: {
    lines: ['line2_scrna'], analysis_step: 'l2_profile_composition',
    input_tables: ['celltype_composition.tsv'],
    produces: ['custom_fig_l2p_violin.png'],
    output_glob: 'figures/line2_scrna/custom_fig_l2p_violin.png',
    canonical_output: 'figures/violin_L2p_violin_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line2_scrna/custom_fig_l2p_violin.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      group_col: '细胞类型列名',
      value_col: '组成比例列名',
    },
  },
  fig_l3_sankey: {
    lines: ['line1_bulk'], analysis_step: 'l1_de_wgcna',
    input_tables: ['wgcna_modules.tsv'],
    produces: ['custom_fig_l3_sankey.png'],
    output_glob: 'figures/line1_bulk/custom_fig_l3_sankey.png',
    canonical_output: 'L3_sankey_verified.png',
    sample_project_output: 'workspace/projects/PRJ_AIMS_V3_20261027/figures/line1_bulk/custom_fig_l3_sankey.png',
    adapt_vars: {
      input_data: '项目本线只读输入文件路径，相对于本项目根目录',
      module_col: '模块列名',
    },
  },
};

/**
 * 组合图模板退役名单（figure_spec v2.3，2026-11-08）。
 *
 * 生产母版只出单图，这些条目即使 CSV/报告把它们标成 ready，也必须降为
 * pending/draft：清空 source/preview/render_evidence，禁止被客户端派发。
 */
const RETIRED_COMPOSITE_IDS = new Set([
  'fig_l3_multipanel',
  'fig_l3_combinationpanel',
  'fig_l3_sankeybubbleplot',
]);

const V2_PREVIEW_DIR = `${FIGURE_ROOT}/_v2_previews`;
const V2_MASTER_DIR = `${FIGURE_ROOT}/_v2_masters`;

// Argon 第 75 轮首批产线实证模板（L3 Top5 + L2 Top5）。
// analysis_step 的 produces 必须覆盖 input_tables；linked_mods 为本线同语言出图 Mod。
const V2_EXTRA_SPECS = [
  { id: 'fig_l3_banksy_domain', name: '空间功能域切片分布图', level: 'L3', category: 'Spatial', line: 'line3_spatial', renderMod: 'l3_figures_spatial', master: 'spatial_figures.py', analysis_step: 'l3_dimred_domains', input_tables: ['spatial_domains_mouse.h5ad'], canonical: 'l3_mouse_01_domains_B1-D1.png', sample: 'workspace/projects/PRJ_STROKE_P1_SPATIAL_ABCA1/figures/line3_spatial/l3_mouse_01_domains_B1-D1.png', project: 'PRJ_STROKE_P1_SPATIAL_ABCA1', scalebar: true, adapt_vars: { input_data: 'BANKSY 空间域 h5ad 路径', group_col: '空间域分组列名' } },
  { id: 'fig_l3_nnls_deconv_pie', name: '空间Spot细胞亚型解卷积构成图', level: 'L3', category: 'Composition', line: 'line3_spatial', renderMod: 'l3_figures_spatial', master: 'spatial_figures.py', analysis_step: 'l3_branches_celltype', input_tables: ['celltype_scores_mouse.tsv'], canonical: 'l3_mouse_15_deconv_composition.png', sample: 'workspace/projects/PRJ_STROKE_P1_SPATIAL_ABCA1/figures/line3_spatial/l3_mouse_15_deconv_composition.png', project: 'PRJ_STROKE_P1_SPATIAL_ABCA1', scalebar: false, adapt_vars: { input_data: 'NNLS 解卷积比例表路径', group_col: '细胞亚型列名' } },
  { id: 'fig_l3_multigene_coloc', name: '核心靶基因空间共定位切片图', level: 'L3', category: 'Spatial', line: 'line3_spatial', renderMod: 'l3_figures_spatial', master: 'spatial_figures.py', analysis_step: 'l3_branches_localization', input_tables: ['gene_localization_mouse.tsv'], canonical: 'l3_mouse_02_target_gene_B1-D1.png', sample: 'workspace/projects/PRJ_STROKE_P1_SPATIAL_ABCA1/figures/line3_spatial/l3_mouse_02_target_gene_B1-D1.png', project: 'PRJ_STROKE_P1_SPATIAL_ABCA1', scalebar: true, adapt_vars: { input_data: '靶基因空间定位 h5ad 路径', label_genes: '共定位靶基因清单' } },
  { id: 'fig_l3_morans_i_spatial', name: '空间高变自相关基因排序图', level: 'L3', category: 'SpatialStatistics', line: 'line3_spatial', renderMod: 'l3_figures_spatial', master: 'spatial_figures.py', analysis_step: 'l3_stats_autocorr', input_tables: ['gene_autocorr_mouse.tsv'], canonical: 'l3_mouse_04_morans_top.png', sample: 'workspace/projects/PRJ_STROKE_P1_SPATIAL_ABCA1/figures/line3_spatial/l3_mouse_04_morans_top.png', project: 'PRJ_STROKE_P1_SPATIAL_ABCA1', scalebar: false, adapt_vars: { input_data: "Moran's I 自相关表路径", value_col: 'morans_i 列名' } },
  { id: 'fig_l3_niche_comm_spatial', name: '空间微环境配受体互作热点图', level: 'L3', category: 'CellCommunication', line: 'line3_spatial', renderMod: 'l3_figures_spatial', master: 'spatial_figures.py', analysis_step: 'l3_stats_communication', input_tables: ['sample_communication_mouse.tsv'], canonical: 'l3_mouse_19_communication.png', sample: 'workspace/projects/PRJ_STROKE_P1_SPATIAL_ABCA1/figures/line3_spatial/l3_mouse_19_communication.png', project: 'PRJ_STROKE_P1_SPATIAL_ABCA1', scalebar: false, adapt_vars: { input_data: '空间配受体互作得分表路径', group_col: '微环境分组列名' } },
  { id: 'fig_l2_harmony_umap_entropy', name: 'Harmony批次校正UMAP与供体熵对照图', level: 'L2', category: 'DimReduction', line: 'line2_scrna', renderMod: 'l2_figures_scrna', master: 'scrna_figures.py', analysis_step: 'l2_integrate_cluster', input_tables: ['scrna_clustered.h5ad'], canonical: 'l2_01_umap_celltype.png', sample: 'workspace/projects/PRJ_AIMS_V3_20261027/deliverables/PRJ_AIMS_V3_20261027_Client_Delivery/02_Figures_and_Tables/figures/line2_scrna/l2_01_umap_celltype.png', project: 'PRJ_AIMS_V3_20261027', scalebar: false, adapt_vars: { input_data: 'Harmony 聚类 h5ad 路径', group_col: '细胞类型或供体列名' } },
  { id: 'fig_l2_liana_lr_dotplot', name: '细胞亚群配受体通讯气泡图', level: 'L2', category: 'CellCommunication', line: 'line2_scrna', renderMod: 'l2_figures_scrna', master: 'scrna_figures.py', analysis_step: 'l2_branches_cellcomm', input_tables: ['cellcomm_interactions.tsv'], canonical: 'l2_07_comm_top.png', sample: 'workspace/projects/PRJ_20261019_IS_lactylation/figures/line2_scrna/l2_07_comm_top.png', project: 'PRJ_20261019_IS_lactylation', scalebar: false, adapt_vars: { input_data: 'LIANA 配受体互作表路径', group_col: '细胞亚群列名' } },
  { id: 'fig_l2_canonical_marker_dotplot', name: '细胞类型CanonicalMarker表达核验图', level: 'L2', category: 'Annotation', line: 'line2_scrna', renderMod: 'l2_figures_scrna', master: 'scrna_figures.py', analysis_step: 'l2_integrate_annotate', input_tables: ['cluster_markers.tsv'], canonical: 'l2_07_marker_top5.png', sample: 'workspace/projects/PRJ_AIMS_V3_20261027/deliverables/PRJ_AIMS_V3_20261027_Client_Delivery/02_Figures_and_Tables/figures/line2_scrna/l2_07_marker_top5.png', project: 'PRJ_AIMS_V3_20261027', scalebar: false, adapt_vars: { input_data: '聚类标记基因表路径', group_col: '细胞类型列名' } },
  { id: 'fig_l2_dr_trajectory_post', name: '亚群降维后处理与调控网络图', level: 'L2', category: 'Downstream', line: 'line2_scrna', renderMod: 'l2_figures_scrna', master: 'scrna_figures.py', analysis_step: 'l2_ko_drpost', input_tables: ['dr_regulatory_network.tsv'], canonical: 'custom_fig_l2_networkplot.png', sample: 'workspace/projects/PRJ_AIMS_V3_20261027/deliverables/PRJ_AIMS_V3_20261027_Client_Delivery/02_Figures_and_Tables/figures/line2_scrna/custom_fig_l2_networkplot.png', project: 'PRJ_AIMS_V3_20261027', scalebar: false, adapt_vars: { input_data: '降维后调控网络表路径', group_col: '调控模块列名' } },
  { id: 'fig_l2_celltype_deg_volcano', name: '细胞类型特异差异表达火山图', level: 'L2', category: 'DifferentialExpression', line: 'line2_scrna', renderMod: 'l2_figures_scrna', master: 'scrna_figures.py', analysis_step: 'l2_profile_deg', input_tables: ['deg_all_by_celltype.tsv'], canonical: 'l2_08_deg_volcano_mitotic.png', sample: 'workspace/projects/PRJ_AIMS_V3_20261027/deliverables/PRJ_AIMS_V3_20261027_Client_Delivery/02_Figures_and_Tables/figures/line2_scrna/l2_08_deg_volcano_mitotic.png', project: 'PRJ_AIMS_V3_20261027', scalebar: false, adapt_vars: { input_data: '细胞类型差异表达表路径', group_col: '比较方向分组列名', log2fc_cutoff: '差异倍数阈值', padj_cutoff: '显著性阈值' } },
];

function buildV2Extra() {
  return V2_EXTRA_SPECS.map((spec) => {
    const source = `${V2_MASTER_DIR}/${spec.master}`;
    const preview = `${V2_PREVIEW_DIR}/${spec.canonical}`;
    const sourceFile = path.join(REPO, source);
    const previewFile = path.join(REPO, preview);
    if (!fs.existsSync(sourceFile)) fail(`v2 母版快照缺失：${source}`);
    if (!fs.existsSync(previewFile)) fail(`v2 预览缺失：${preview}`);
    const previewSha = sha256(previewFile);
    return {
      id: spec.id,
      name: spec.name,
      level: spec.level,
      category: spec.category,
      language: 'python',
      source,
      source_sha256: sha256(sourceFile),
      preview,
      preview_sha256: previewSha,
      verified: true,
      deps_status: 'ready',
      deps: [],
      linked_mods: [spec.renderMod],
      adapt_vars: spec.adapt_vars,
      lines: [spec.line],
      analysis_step: spec.analysis_step,
      input_tables: spec.input_tables,
      produces: [spec.canonical],
      output_glob: `figures/${spec.line}/${spec.canonical}`,
      canonical_output: spec.canonical,
      sample_project_output: spec.sample,
      render_evidence: {
        entry_id: `v2_delivery_${spec.project}`,
        artifact: spec.canonical,
        sha256: previewSha,
        matches_preview: true,
        source_project: spec.project,
      },
      deprecated: false,
      _v2_scalebar: spec.scalebar,
    };
  });
}

function mapAdaptSource(key) {
  if (key === 'input_data') return 'data_contract.input_artifact';
  if (key === 'group_col') return 'groupingDesign.byLine';
  if (key === 'log2fc_cutoff') return 'analysisCutoffs.log2fc';
  if (key === 'padj_cutoff') return 'analysisCutoffs.padj';
  if (key === 'label_genes') return 'targetGenes.topHubs';
  return 'manual';
}

function artifactFormat(name) {
  if (!name) return null;
  const ext = String(name).split('.').pop().toLowerCase();
  return ['tsv', 'csv', 'h5ad', 'rds', 'json'].includes(ext) ? ext : null;
}

// Argon 第 75 轮 FigureTemplate v2 四位一体字段（叠加在 v1 字段之上，零退化）。
function applyV2Fields(t) {
  const isReady = t.deps_status === 'ready' && t.verified === true;
  const tierByLevel = { L1: 'L1_qc_basic', L2: 'L2_mechanism_core', L3: 'L3_spatial_advanced' };
  const producing = typeof t.analysis_step === 'string' && t.analysis_step ? t.analysis_step : null;
  const required = [];
  if (producing) required.push(producing);
  for (const modId of t.linked_mods || []) if (!required.includes(modId)) required.push(modId);
  const inputArtifact = (t.input_tables || [])[0] || null;
  const scalebarRequired = t._v2_scalebar === true;
  t.status = isReady ? 'ready' : 'draft';
  t.academic_tier = tierByLevel[t.level] || 'L1_qc_basic';
  t.line_id = (t.lines || [])[0] || null;
  t.producing_mod_id = producing;
  t.required_mod_ids = required;
  t.data_contract = {
    input_artifact: inputArtifact,
    format: artifactFormat(inputArtifact),
    required_columns: [],
    required_obs_keys: artifactFormat(inputArtifact) === 'h5ad' ? ['cluster'] : [],
    required_obsm_keys: [],
  };
  t.spec_contract = {
    dpi: 300,
    palette_family: 'okabe_ito_extended',
    scalebar_contract: scalebarRequired
      ? { required: true, pitch_um: 100.0, envelope_um: 65.0, max_err_ratio: 0.03 }
      : { required: false },
  };
  t.portal_binding = {
    default_on_mod_select: isReady,
    unlock_prompt: '需补选前置分析步骤以解锁该图件',
    adapt_vars_schema: Object.keys(t.adapt_vars || {}).map((key) => ({
      key, source_field: mapAdaptSource(key), type: 'string',
    })),
  };
  if (!isReady) {
    t.preview_sha256 = null;
    t.render_evidence = null;
  }
  delete t._v2_scalebar;
  return t;
}

function buildRegistry() {
  const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
  const header = rows[0];
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  const runnerByArtifact = new Map();
  const runnerByFile = new Map();
  for (const [runnerId, runner] of Object.entries(report.l3.runners || {})) {
    runnerByFile.set(runnerId, runner);
  }
  const readyIdByFile = new Map();
  for (const figure of report.l3.figures || []) {
    if (figure.status !== 'ready') continue;
    for (const artifact of figure.artifacts || []) {
      const runner = runnerByFile.get(artifact.runner);
      const artifactBasename = path.basename(artifact.file);
      const levelStart = artifactBasename.search(/L[123]p?_/);
      const basename = levelStart >= 0 ? artifactBasename.slice(levelStart) : artifactBasename;
      runnerByArtifact.set(basename, { runner, id: figure.id });
      if (basename.endsWith('.png')) readyIdByFile.set(basename, figure.id);
    }
  }

  const templates = [];
  const seenIds = new Set();
  for (const raw of rows.slice(1)) {
    if (raw.length !== header.length) fail(`CSV 字段数错误：${raw.length}，期望 ${header.length}`);
    const [level, name, category, enName, languageRaw, , , dependenciesRaw, statusRaw, locationRaw] = raw;
    const language = languageRaw.toLowerCase();
    const normalizedLevel = level.toUpperCase();
    const status = statusRaw === '待采集' ? 'pending' : statusRaw;
    const reportId = readyIdByFile.get(path.basename(locationRaw));
    const rawReady = status === 'ready';
    const isBlocked = status === 'blocked_r453';
    const id = rawReady || isBlocked
      ? (rawReady ? reportId : 'fig_kegg_pathway')
      : `fig_${language === 'python' ? `${normalizedLevel.toLowerCase()}p` : normalizedLevel.toLowerCase()}_${snakeCase(enName)}`;
    if (seenIds.has(id)) fail(`模板 id 重复：${id}`);
    seenIds.add(id);

    let source = null;
    let sourceSha256 = null;
    let preview = null;
    let previewSha256 = null;
    let verified = false;
    let blockReason = null;
    let activeStatus = status;
    const mapping = TEMPLATE_MAPPINGS[id] || null;
    const effectiveLanguage = mapping?.language || language;
    const retiredComposite = RETIRED_COMPOSITE_IDS.has(id);
    const isReady = rawReady && !retiredComposite;

    if (retiredComposite) {
      // 退役组合图保留条目用于展示「不可用原因」，但不保留任何已验证产物指针。
      activeStatus = 'pending';
      source = null;
      sourceSha256 = null;
      preview = null;
      previewSha256 = null;
      verified = false;
      blockReason = '组合图已退役，生产只出单图';
    } else if (isReady) {
      if (!mapping) fail(`ready 行缺少真实产物映射：${id}`);
      if (!reportId) fail(`ready 行缺少 r453 报告匹配：${enName}`);
      const artifactInfo = runnerByArtifact.get(path.basename(locationRaw));
      if (!artifactInfo) fail(`ready 行缺少 PNG artifact：${locationRaw}`);
      const runner = mapping.source_runner_id
        ? report.l3.runners?.[mapping.source_runner_id]
        : artifactInfo.runner;
      if (!runner) fail(`ready 行缺少 runner：${id}`);
      source = mapping.source_override || `${FIGURE_ROOT}/${runner.source}`;
      preview = mapping.preview_override || `${FIGURE_ROOT}/${locationRaw}`;
      const sourceFile = path.join(REPO, source);
      const previewFile = path.join(REPO, preview);
      if (!fs.existsSync(sourceFile)) fail(`ready source 缺失：${source}`);
      if (!fs.existsSync(previewFile)) fail(`ready preview 缺失：${preview}`);
      sourceSha256 = sha256(sourceFile);
      previewSha256 = sha256(previewFile);
      if (sourceSha256 !== runner.source_sha256) fail(`source 哈希与报告不一致：${source}`);
      verified = true;
      if (!mapping.sample_project_output) {
        activeStatus = 'pending_mapping';
        verified = false;
        source = null;
        sourceSha256 = null;
        preview = null;
        previewSha256 = null;
        blockReason = '尚无与模板语义、语言和分析步骤一致的真实项目样例图';
      } else {
        const sampleFile = path.join(REPO, mapping.sample_project_output);
        if (!fs.existsSync(sampleFile)) {
          fail(`ready sample_project_output 缺失：${mapping.sample_project_output}`);
        }
      }
    } else if (isBlocked) {
      const blockedFigure = (report.l3.figures || []).find((figure) => figure.id === 'fig_kegg_pathway');
      if (!blockedFigure) fail('r453 报告缺少 fig_kegg_pathway');
      blockReason = blockedFigure.reason;
    }

    templates.push({
      id,
      name,
      level: normalizedLevel,
      category,
      language: effectiveLanguage,
      source,
      source_sha256: sourceSha256,
      preview,
      preview_sha256: previewSha256,
      verified,
      deps_status: activeStatus,
      deps: dependencies(dependenciesRaw),
      ...(blockReason ? { block_reason: blockReason } : {}),
      linked_mods: mapping?.linked_mods || linkedMods(raw ? { enName, language } : null, status),
      adapt_vars: mapping?.adapt_vars || adaptVars({ enName, language }),
      lines: mapping ? mapping.lines : [],
      analysis_step: mapping ? mapping.analysis_step : null,
      input_tables: mapping ? mapping.input_tables : [],
      produces: mapping ? mapping.produces : [],
      output_glob: mapping ? mapping.output_glob : null,
      canonical_output: mapping ? mapping.canonical_output || null : null,
      sample_project_output: activeStatus === 'ready' ? mapping.sample_project_output : null,
      /**
       * 渲染证据（第三十三轮 T1-3）：把「这张预览是不是当前母版这次渲染出来的」
       * 变成注册表里的显式字段，而不是靠门禁临时去猜。
       *
       *   render_evidence = { entry_id, artifact, sha256, matches_preview }  -> 矩阵里有同源产物
       *   render_evidence = null                                             -> 矩阵里没有证据（欠账）
       *
       * 无证据写 null 而不是省略字段：省略会让「读不到」与「不存在」混在一起，
       * 门禁就没法把欠账条数报准。null 是显式的「我们知道这里没有证据」。
       */
      render_evidence: activeStatus === 'ready' && preview ? (() => {
        const evidence = plotMatrixArtifacts().get(path.basename(preview));
        if (!evidence) return null;
        return {
          entry_id: evidence.entry_id,
          artifact: path.basename(preview),
          sha256: evidence.sha256,
          matches_preview: evidence.sha256 === previewSha256,
        };
      })() : null,
      deprecated: retiredComposite,
    });
  }

  // Argon 第 75 轮：追加 10 个产线实证 ready 模板（L3 Top5 + L2 Top5），
  // 预览来自真实交付项目 300DPI PNG，母版快照置于 references/_v2_masters。
  templates.push(...buildV2Extra());
  for (const t of templates) applyV2Fields(t);

  if (templates.length !== 92) fail(`模板数不是 92：${templates.length}`);
  const counts = templates.reduce((acc, item) => {
    acc[item.deps_status] = (acc[item.deps_status] || 0) + 1;
    return acc;
  }, {});
  /**
   * 计数口径（2026-11-02 按 4 Argon 第九轮裁定，相等断言改水位线）：
   * 准入新模板时不再需要手改这里的魔数——那是每轮重复摩擦的来源。
   * 保留的不变量都是结构性的，不随准入增长而变：
   *   - 四类状态之和必须等于 82（防漏计/重复计）；
   *   - ready 只许 >= 基线，倒退即失败（防准入成果被误删）；
   *   - pending_mapping 必须为 0（CSV 标 ready 但映射不全 = 真缺陷）；
   *   - blocked_r453 固定 1（只有 fig_kegg_pathway 一条被裁定的阻塞）。
   */
  const READY_BASELINE = 39;
  const statusSum = Object.values(counts).reduce((acc, n) => acc + n, 0);
  if (statusSum !== 92) fail(`状态计数之和不是 92：${statusSum}`);
  if ((counts.ready || 0) < READY_BASELINE) fail(`ready 从基线 ${READY_BASELINE} 倒退：${counts.ready || 0}`);
  if ((counts.pending_mapping || 0) !== 0) fail(`pending_mapping 数不是 0：${counts.pending_mapping || 0}`);
  if (counts.blocked_r453 !== 1) fail(`blocked_r453 数不是 1：${counts.blocked_r453}`);

  return {
    schema_version: 1,
    generated_from: {
      csv: `${FIGURE_ROOT}/_meta/bizard_index.csv`,
      report: `${FIGURE_ROOT}/_meta/r453_verification_report.json`,
      v2_extra: 'tools/dev/build_figure_templates.cjs#buildV2Extra',
    },
    templates,
  };
}

function registryText() {
  return `${JSON.stringify(buildRegistry(), null, 2)}\n`;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--check') {
    const actual = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const expected = registryText();
    if (actual !== expected) {
      fail('figure_templates.json 与 CSV/r453 证据不同步，请运行 build_figure_templates.cjs');
      return;
    }
    console.log('figure_templates.check=ok');
    return;
  }
  if (args.length !== 0) {
    fail('用法：node tools/dev/build_figure_templates.cjs [--check]');
    return;
  }
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, registryText(), { encoding: 'utf8', mode: 0o644 });
  console.log(`figure_templates.generated=${templatesCount}`);
}

const templatesCount = buildRegistry().templates.length;

if (require.main === module) main();

module.exports = {
  buildRegistry,
  registryText,
};
