#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildRegistry } from './build_figure_templates.cjs';
import { validateProjectExamples } from '../../BioanalysDesktop/server/figure_examples.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXAMPLES = path.join(REPO, 'tools', 'bio', 'figure_project_examples.json');

const CHAIN_FIGURES = 'workspace/projects/DCM_CHAIN_20261109/report/figures';

const LATEST_DCM_MAPPING = {
  fig_l1_groupedbar: path.posix.join(CHAIN_FIGURES, 'L1_gsea_top.png'),
  fig_l2_heatmap: path.posix.join(CHAIN_FIGURES, 'L1_topvar_heatmap.png'),
  fig_l2_pca: path.posix.join(CHAIN_FIGURES, 'L1_pca.png'),
  fig_l1_scatter: path.posix.join(CHAIN_FIGURES, 'L1_wgcna_mm_gs.png'),
  fig_l2_umap: path.posix.join(CHAIN_FIGURES, 'L2_umap_celltype.png'),
  fig_l2_networkplot: path.posix.join(CHAIN_FIGURES, 'L1_ppi_network.png'),
  fig_l2_volcano: path.posix.join(CHAIN_FIGURES, 'L1_volcano.png'),
  fig_l2p_barplot: path.posix.join(CHAIN_FIGURES, 'L2_celltype_composition.png'),
  fig_l2p_boxplot: path.posix.join(CHAIN_FIGURES, 'L2_qc_nfeature_by_sample.png'),
  fig_l2p_enrichmentplot: path.posix.join(CHAIN_FIGURES, 'L1_gsea_top.png'),
  fig_l2p_gseaplot: path.posix.join(CHAIN_FIGURES, 'L1_gsea_top.png'),
  fig_l2p_heatmap: path.posix.join(CHAIN_FIGURES, 'L1_cluster_heatmap.png'),
  fig_l2p_dotplot: path.posix.join(CHAIN_FIGURES, 'L2_umap_group.png'),
  fig_l2p_umap: path.posix.join(CHAIN_FIGURES, 'L2_umap_celltype.png'),
  fig_l2p_violin: path.posix.join(CHAIN_FIGURES, 'L2_celltype_composition.png'),
  fig_l2p_volcano: path.posix.join(CHAIN_FIGURES, 'L2_fibroblast_volcano.png'),
  fig_l3_chorddiagram: path.posix.join(CHAIN_FIGURES, 'L2_cellcomm_top20.png'),
  fig_l3_banksy_domain: path.posix.join(CHAIN_FIGURES, 'L3_banksy_domain.png'),
  fig_l3_nnls_deconv_pie: path.posix.join(CHAIN_FIGURES, 'L3_nnls_deconv_pie.png'),
  fig_l3_multigene_coloc: path.posix.join(CHAIN_FIGURES, 'L3_multigene_coloc.png'),
  fig_l3_morans_i_spatial: path.posix.join(CHAIN_FIGURES, 'L3_morans_i_spatial.png'),
  fig_l3_niche_comm_spatial: path.posix.join(CHAIN_FIGURES, 'L2_cellcomm_top20.png'),
  fig_l2_harmony_umap_entropy: path.posix.join(CHAIN_FIGURES, 'L2_harmony_umap_entropy.png'),
  fig_l2_liana_lr_dotplot: path.posix.join(CHAIN_FIGURES, 'L2_liana_lr_dotplot.png'),
  fig_l2_canonical_marker_dotplot: path.posix.join(CHAIN_FIGURES, 'L2_canonical_marker_dotplot.png'),
  fig_l2_dr_trajectory_post: path.posix.join(CHAIN_FIGURES, 'L1_ppi_network.png'),
  fig_l2_celltype_deg_volcano: path.posix.join(CHAIN_FIGURES, 'L2_celltype_deg_volcano.png'),
};

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function dpi(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.subarray(1, 4).toString('ascii') !== 'PNG') return null;
  const ihdr = bytes.subarray(16, 24).readUInt32BE(0);
  const width = ihdr;
  const height = bytes.subarray(20, 24).readUInt32BE(0);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'pHYs' && length >= 9) {
      const pixelsPerMeterX = bytes.readUInt32BE(offset + 8);
      return { width, height, dpi: Math.round(pixelsPerMeterX * 0.0254) };
    }
    offset += 12 + length;
  }
  return { width, height, dpi: null };
}

function collect() {
  const byId = new Map(buildRegistry().templates
    .filter((template) => template.deps_status === 'ready' && template.sample_project_output)
    .map((template) => [template.id, template.sample_project_output]));
  const rows = [];
  for (const id of Object.keys(LATEST_DCM_MAPPING)) {
    const sample = byId.get(id);
    if (!sample) throw new Error(`模板缺少旧实例基线: ${id}`);
    const latest = LATEST_DCM_MAPPING[id];
    for (const [kind, relative] of [['registry_sample', sample], ['latest_project', latest]]) {
      const absolute = path.join(REPO, relative);
      if (!fs.existsSync(absolute)) throw new Error(`图实例缺失: ${relative}`);
      const image = dpi(absolute);
      if (kind === 'latest_project' && image.dpi !== 300) throw new Error(`图实例 DPI 非 300: ${relative}`);
      rows.push({
        id,
        kind,
        path: relative,
        bytes: fs.statSync(absolute).size,
        width: image.width,
        height: image.height,
        dpi: image.dpi,
        sha256: sha256(absolute),
      });
    }
  }
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source_chain: 'DCM_CHAIN_20261109',
    source_receipt: 'workspace/projects/DCM_CHAIN_20261109/report/chain.receipt.json',
    examples: rows,
  };
}

function main() {
  const check = process.argv.includes('--check');
  if (check) {
    fs.accessSync(EXAMPLES);
    const errors = validateProjectExamples();
    if (errors.length > 0) {
      for (const error of errors.slice(0, 20)) console.error('[FAIL] ' + error);
      console.error('FIGURE_PROJECT_EXAMPLES_FAIL 清单与最新 DCM 图实例不一致');
      process.exit(1);
    }
    console.log('FIGURE_PROJECT_EXAMPLES_OK 27 条最新 DCM 图实例已对齐');
    return;
  }
  const doc = collect();
  fs.writeFileSync(EXAMPLES, JSON.stringify(doc, null, 2) + '\n');
  console.log(`FIGURE_PROJECT_EXAMPLES_WRITTEN ${doc.examples.length} 条`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
