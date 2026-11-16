/**
 * tools/reporting/extract_step_metrics.mjs
 * 从已落盘的分析产物中确定性地提取千字节级指标卡（step_metrics/v1）。
 *
 * 存在理由：模型不许读原始矩阵，也不许自己写数字。唯一可信来源是母版跑完
 * 落到 processed/ 的报告与汇总表。本模块把那些文件解析成 <mod_id>.metrics.json，
 * 单文件严格小于 32KB，供 Pi CLI 与报告构建器消费。
 *
 * 判据（每条都能判定做完没做完）：
 *   1. 每个指标卡的每个数值都能在该 Mod 的产物文件里找到字面出处；
 *   2. 解析不到的字段直接省略，绝不填空值或猜测；
 *   3. 落盘前过 validateStepMetrics，不合契约即失败，不写半成品。
 *
 * 用法：
 *   node tools/reporting/extract_step_metrics.mjs --project=<id> [--line=line1_bulk]
 *        [--processed=<dir>] [--out=<dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateStepMetrics, collectRegisteredModIds } from '../../shared/step_metrics_v1.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = path.resolve(HERE, '..', '..');

/** `key=value` 报告行解析。末值保留原样字符串，由调用方决定转数字还是留文本。 */
export function parseKeyValueReport(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim();
  }
  return out;
}

/** TSV 读取（首行表头）。只在文件小于阈值时整表读入，避免把大矩阵灌进内存。 */
export function readTsv(file, { maxBytes = 8 * 1024 * 1024 } = {}) {
  const stat = fs.statSync(file);
  if (stat.size > maxBytes) {
    return { headers: [], rows: [], truncated: true, bytes: stat.size };
  }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [], truncated: false, bytes: stat.size };
  const headers = lines[0].split('\t');
  const rows = lines.slice(1).map((line) => {
    const cols = line.split('\t');
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i]; });
    return row;
  });
  return { headers, rows, truncated: false, bytes: stat.size };
}

function pickNumber(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  const m = text.match(/^[+]?(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** 解析 "Ctrl:12 DCM:58" -> { Ctrl: 12, DCM: 58 } */
export function parseGroupCounts(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/([A-Za-z0-9_.-]+)\s*:\s*(\d+)/g)) {
    out[m[1]] = Number(m[2]);
  }
  return out;
}

/** 解析 "variance_explained=PC1:52.4% PC2:7.5% ..." */
export function parseVariance(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/(PC\d+)\s*:\s*([\d.]+)\s*%/g)) {
    out[m[1].toLowerCase()] = Number(m[2]) / 100;
  }
  return out;
}

/** 解析 "sig_genes=3649 (up=3260 down=389)" */
export function parseSigGenes(text) {
  const m = String(text || '').match(/(\d+)\s*\(\s*up\s*=\s*(\d+)\s+down\s*=\s*(\d+)\s*\)/i);
  if (!m) return {};
  return { total: Number(m[1]), up: Number(m[2]), down: Number(m[3]) };
}

/** 解析 "top10_by_p=PPP2R3B(4.1e-84) AKAP17A(1.6e-79) ..." */
export function parseTopGenes(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/([A-Za-z0-9_.-]+)\(([\d.eE+-]+)\)/g)) {
    out.push({ gene_symbol: m[1], p_value: Number(m[2]) });
  }
  return out;
}

/** 解析 WGCNA 报告里的模块-性状行表。 */
export function parseWgcnaModules(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s+([a-z]+)\s+n=\s*(\d+)\s+cor=\s*([+-]?[\d.]+)\s+p=\s*([\d.eE+-]+)/);
    if (m) rows.push({ module: m[1], n_genes: Number(m[2]), cor: Number(m[3]), p: Number(m[4]) });
  }
  return rows;
}

function sha256OfText(text) {
  // 轻量指纹：只用于证明"这一版指标卡基于哪一版输入"，不宣称密码学强度以外的含义。
  const src = String(text || '');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < src.length; i += 1) {
    h1 = (h1 ^ src.charCodeAt(i)) * 0x01000193 >>> 0;
    h2 = (h2 + src.charCodeAt(i) * (i + 1)) >>> 0;
  }
  return `fnv${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

function stableDigest(files) {
  const parts = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const stat = fs.statSync(file);
    parts.push(`${path.basename(file)}:${stat.size}`);
  }
  return sha256OfText(parts.join('|'));
}

function buildCard({ modId, lineId, projectId, seed, metrics, qcFlags = [], figures = [], inputs }) {
  const card = {
    schema_version: 'step_metrics/v1',
    mod_id: modId,
    line_id: lineId,
    project_id: projectId,
    status: qcFlags.some((f) => f.severity === 'block') ? 'blocked'
      : qcFlags.some((f) => f.severity === 'warn') ? 'warn' : 'ok',
    generated_at: new Date().toISOString(),
    seed: Number.isInteger(seed) ? seed : null,
    input_fingerprint: {
      inputs_digest: stableDigest(inputs),
      file_count: inputs.filter((f) => fs.existsSync(f)).length,
    },
    metrics,
  };
  if (qcFlags.length > 0) card.qc_flags = qcFlags;
  if (figures.length > 0) card.figures = figures;
  return card;
}

/**
 * 线 1 提取器。每个 mod 只读它自己 produces 的文件，缺一个就跳过该 mod。
 */
export function extractLine1({ processedDir, projectId, figureDir }) {
  const cards = [];
  const p = (name) => path.join(processedDir, name);
  const fig = (name) => path.join(figureDir || path.join(processedDir, '..', '..', 'figures', 'line1_bulk'), name);
  const readIf = (name) => (fs.existsSync(p(name)) ? fs.readFileSync(p(name), 'utf8') : null);

  const qcText = readIf('qc_report.txt');
  if (qcText) {
    const kv = parseKeyValueReport(qcText);
    const groups = parseGroupCounts(kv.groups);
    const sampleCount = pickNumber(kv.samples);
    const metrics = {
      sample_count: sampleCount,
      group_counts: groups,
      sample_count_case: Number.isFinite(sampleCount)
        ? Object.entries(groups).sort((a, b) => b[1] - a[1])[0]?.[1]
        : undefined,
      sample_count_control: Number.isFinite(sampleCount)
        ? Object.entries(groups).sort((a, b) => a[1] - b[1])[0]?.[1]
        : undefined,
      gene_count: pickNumber(kv.genes),
      qc_gate: kv.qc_gate || null,
      outlier_policy: kv.outlier_policy || null,
      spearman_cor_range: kv.spearman_cor_range || null,
      outlier_count: /outliers\s*=\s*(无|\d+)/.test(qcText) ? (/无/.test(qcText) ? 0 : pickNumber(kv.outliers)) : undefined,
    };
    const qcFlags = [];
    if (Number.isFinite(sampleCount) && sampleCount < 12) {
      qcFlags.push({
        code: 'CELL_COUNT_LOW',
        severity: 'warn',
        message: `样本量 ${sampleCount} 偏小，结论按探索性表述`,
        metric_key: 'sample_count',
      });
    }
    cards.push(buildCard({
      modId: 'l1_qc_matrix', lineId: 'line1_bulk', projectId,
      seed: pickNumber(kv.seed), metrics, qcFlags, inputs: [p('qc_report.txt'), p('sample_qc.tsv')],
    }));
  }

  const pcaText = readIf('pca_report.txt');
  if (pcaText) {
    const kv = parseKeyValueReport(pcaText);
    const variance = parseVariance(kv.variance_explained);
    cards.push(buildCard({
      modId: 'l1_qc_pca', lineId: 'line1_bulk', projectId,
      seed: pickNumber(kv.seed),
      metrics: {
        sample_count: pickNumber(kv.samples),
        top_variable_genes: pickNumber(kv.top_variable_genes),
        pc1_var_explained: variance.pc1,
        pc2_var_explained: variance.pc2,
        pc3_var_explained: variance.pc3,
      },
      inputs: [p('pca_report.txt'), p('pca_scores.tsv')],
    }));
  }

  const degText = readIf('deg_report.txt');
  if (degText) {
    const kv = parseKeyValueReport(degText);
    const sig = parseSigGenes(kv.sig_genes);
    const thresholdMatch = String(kv.thresholds || '').match(/\|log2FC\|>([\d.]+).*?<([\d.]+)/);
    const metrics = {
      gene_count_tested: pickNumber(kv.genes_tested),
      deg_total: sig.total,
      deg_up: sig.up,
      deg_down: sig.down,
      log2fc_cutoff: thresholdMatch ? Number(thresholdMatch[1]) : undefined,
      padj_cutoff: thresholdMatch ? Number(thresholdMatch[2]) : undefined,
      contrast: kv.contrast || null,
      method: kv.method || null,
      top_genes: parseTopGenes(kv.top10_by_p).slice(0, 10),
      max_abs_log2fc: pickNumber(kv.max_abs_log2FC),
    };
    const qcFlags = [];
    if (Number.isFinite(sig.total)) {
      if (sig.total < 10) {
        qcFlags.push({
          code: 'DEG_COUNT_LOW', severity: 'warn',
          message: `当前阈值下仅 ${sig.total} 个差异基因，建议阶梯放宽 |log2FC| 或切换 padj 口径前先核对分组与批次`,
          metric_key: 'deg_total',
        });
      } else if (sig.total > 3000) {
        qcFlags.push({
          code: 'DEG_COUNT_HIGH', severity: 'warn',
          message: `当前阈值下 ${sig.total} 个差异基因偏多，建议收紧 |log2FC| 并复查批次混杂`,
          metric_key: 'deg_total',
        });
      }
    }
    cards.push(buildCard({
      modId: 'l1_de_limma', lineId: 'line1_bulk', projectId,
      seed: pickNumber(kv.seed), metrics, qcFlags,
      figures: [{ template_id: 'fig_l1_volcano', producing_mod_id: 'l1_de_limma', panel_count: 1 }],
      inputs: [p('deg_report.txt'), p('deg_sig.tsv')],
    }));
  }

  const wgcnaText = readIf('wgcna_report.txt');
  if (wgcnaText) {
    const kv = parseKeyValueReport(wgcnaText);
    const modules = parseWgcnaModules(wgcnaText);
    const top = modules[0];
    const powerMatch = String(kv.network || '').match(/power\s*=\s*(\d+)/);
    // 软阈值拟合度：报告里写的是判据（R^2>=0.8 达标），不是实测值。
    // 实测值缺失时只回判据达成状态，绝不把判据阈值当成测量结果写进指标卡。
    const meetsScaleFree = /R\^2\s*>?=\s*[\d.]+\s*(达标|ok|TRUE)/i.test(String(kv.soft_power_note || ''));
    const modulesMatch = String(kv.modules || '').match(/^(\d+)/);
    const metrics = {
      sample_count: pickNumber(kv.samples),
      gene_count_input: pickNumber(kv.genes_input),
      gene_count_used: pickNumber(kv.genes_used),
      power: powerMatch ? Number(powerMatch[1]) : undefined,
      scale_free_r2_ok: meetsScaleFree,
      module_count: modulesMatch ? Number(modulesMatch[1]) : modules.length,
      top_module: top?.module,
      top_module_trait_r: top?.cor,
      top_module_trait_p: top?.p,
      top_module_size: top?.n_genes,
      significant_module_count: pickNumber(kv.significant_modules),
      hub_gene_count: pickNumber(String(kv.hub_genes || '').match(/^(\d+)/)?.[1]),
    };
    const qcFlags = [];
    if (String(kv.soft_power_note || '').trim() && !meetsScaleFree) {
      qcFlags.push({
        code: 'WGCNA_SCALE_FREE_LOW', severity: 'warn',
        message: '无标度拓扑拟合度未达 0.80，建议改 bicor 或复查离群样本',
        metric_key: 'scale_free_r2_ok',
      });
    }
    cards.push(buildCard({
      modId: 'l1_de_wgcna', lineId: 'line1_bulk', projectId,
      seed: pickNumber(kv.seed), metrics, qcFlags,
      inputs: [p('wgcna_report.txt'), p('wgcna_module_trait.tsv')],
    }));
  }

  const lassoText = readIf('ml_lasso_summary.tsv');
  if (lassoText) {
    const { rows } = readTsv(p('ml_lasso_summary.tsv'));
    const lookup = {};
    for (const row of rows) lookup[row.metric] = row.value;
    cards.push(buildCard({
      modId: 'l1_ml_keygenes', lineId: 'line1_bulk', projectId,
      seed: undefined,
      metrics: {
        lambda_min: pickNumber(lookup['lambda.min']),
        lambda_1se: pickNumber(lookup['lambda.1se']),
        selected_feature_count: pickNumber(lookup.n_selected),
        selection_rule: lookup.selection_rule || null,
        fold_count: pickNumber(lookup.nfolds),
      },
      inputs: [p('ml_lasso_summary.tsv'), p('ml_lasso_genes.tsv')],
    }));
  }

  const mlText = readIf('ml_report.txt');
  if (mlText) {
    const kv = parseKeyValueReport(mlText);
    const logregAuc = pickNumber(kv.logreg_auc);
    const rfAuc = pickNumber(kv.rf_auc);
    cards.push(buildCard({
      modId: 'l1_ml_model', lineId: 'line1_bulk', projectId,
      seed: pickNumber(kv.seed),
      metrics: {
        sample_count: pickNumber(String(kv.samples || '').match(/^(\d+)/)?.[1]),
        feature_count: pickNumber(String(kv.features || '').match(/^(\d+)/)?.[1]),
        train_auc: logregAuc,
        train_acc: pickNumber(kv.logreg_acc),
        rf_auc: rfAuc,
        evaluation: kv.eval || null,
      },
      inputs: [p('ml_report.txt'), p('ml_feature_importance.tsv')],
    }));
  }

  const diagText = readIf('ml_diag_metrics.tsv');
  if (diagText) {
    const { rows } = readTsv(p('ml_diag_metrics.tsv'));
    const lookup = {};
    for (const row of rows) lookup[row.metric] = row.internal;
    cards.push(buildCard({
      modId: 'l1_ml_diag', lineId: 'line1_bulk', projectId,
      metrics: {
        sample_count: pickNumber(lookup.n_samples),
        auc_loocv: pickNumber(lookup.auc_model_loocv),
        auc_best_single_gene: pickNumber(lookup.auc_best_single_gene),
        calibration_slope: pickNumber(lookup.calibration_slope),
        calibration_intercept: pickNumber(lookup.calibration_intercept),
      },
      inputs: [p('ml_diag_metrics.tsv')],
    }));
  }

  const keyText = readIf('key_genes_report.txt');
  if (keyText) {
    const kv = parseKeyValueReport(keyText);
    const three = String(kv.three_way_genes || '').match(/'([^']+)'|"([^"]+)"/g);
    cards.push(buildCard({
      modId: 'l1_ml_hub', lineId: 'line1_bulk', projectId,
      seed: pickNumber(kv.seed),
      metrics: {
        deg_count_used: pickNumber(String(kv.n_deg || '').match(/^(\d+)/)?.[1]),
        wgcna_hub_count: pickNumber(String(kv.n_wgcna || '').match(/^(\d+)/)?.[1]),
        ppi_hub_count: pickNumber(String(kv.n_ppi || '').match(/^(\d+)/)?.[1]),
        intersection_deg_wgcna: pickNumber(kv.n_deg_wgcna),
        intersection_three_way: pickNumber(kv.n_three),
        three_way_genes: three ? three.map((s) => s.replace(/['"]/g, '')) : [],
        deg_criteria: kv.deg_criteria || null,
      },
      inputs: [p('key_genes_report.txt'), p('key_genes.tsv')],
    }));
  }

  const ppiText = readIf('ppi_report.txt');
  if (ppiText) {
    const kv = parseKeyValueReport(ppiText);
    cards.push(buildCard({
      modId: 'l1_enrich_ppi', lineId: 'line1_bulk', projectId,
      seed: pickNumber(kv.seed),
      metrics: {
        hub_count: pickNumber(String(kv.hubs || kv.hub_genes || '').match(/^(\d+)/)?.[1]),
        edge_count: pickNumber(String(kv.edges || '').match(/^(\d+)/)?.[1]),
        database: kv.database || kv.source || null,
      },
      figures: [{ template_id: 'fig_l1_ppi_network', producing_mod_id: 'l1_enrich_ppi', panel_count: 1 }],
      inputs: [p('ppi_report.txt'), p('ppi_hubs.tsv')],
    }));
  }

  const enrichText = readIf('enrichment_report.txt');
  if (enrichText) {
    const kv = parseKeyValueReport(enrichText);
    cards.push(buildCard({
      modId: 'l1_enrich_bulk', lineId: 'line1_bulk', projectId,
      seed: pickNumber(kv.seed),
      metrics: {
        go_term_count: pickNumber(String(kv.go_terms || '').match(/^(\d+)/)?.[1]),
        kegg_term_count: pickNumber(String(kv.kegg_terms || '').match(/^(\d+)/)?.[1]),
        gsea_term_count: pickNumber(String(kv.gsea_terms || '').match(/^(\d+)/)?.[1]),
        padj_cutoff: pickNumber(String(kv.padj_cutoff || '').match(/^([\d.]+)/)?.[1]),
      },
      inputs: [p('enrichment_report.txt'), p('enrichment_gsea_go.tsv')],
    }));
  }

  return cards;
}

/**
 * 主入口：按分析线分派。目前线 1 提取器最完整；线 2/线 3 读取各自报告的
 * `key=value` 行，缺产物就少出卡（不造假）。
 */
export function extractStepMetrics({
  projectId,
  lineId = 'line1_bulk',
  processedDir,
  figureDir,
} = {}) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(projectId || ''))) {
    throw new Error(`projectId 非法: ${JSON.stringify(projectId)}`);
  }
  if (lineId === 'line1_bulk') return extractLine1({ processedDir, projectId, figureDir });
  return extractGeneric({ processedDir, projectId, lineId, figureDir });
}

/**
 * 线 2 / 线 3 通用提取器：读取目录下形如 `<mod>.report.txt` 或 `*_report.txt` 的
 * key=value 报告，把可识别字段映射到 metrics。未知字段不猜，只保留数值型。
 */
export function extractGeneric({ processedDir, projectId, lineId, figureDir }) {
  const cards = [];
  if (!fs.existsSync(processedDir)) return cards;
  const ALLOWED_PREFIX = lineId === 'line2_scrna' ? 'l2' : 'l3';
  for (const entry of fs.readdirSync(processedDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('_report.txt')) continue;
    const text = fs.readFileSync(path.join(processedDir, entry.name), 'utf8');
    const kv = parseKeyValueReport(text);
    const modGuess = kv.step ? `${ALLOWED_PREFIX}_${kv.step}` : null;
    if (!modGuess) continue;
    const metrics = {};
    for (const [key, value] of Object.entries(kv)) {
      if (key === 'step' || key === 'seed') continue;
      const num = pickNumber(value);
      if (num !== undefined && /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(String(value).trim())) {
        metrics[key] = num;
      }
    }
    if (Object.keys(metrics).length === 0) continue;
    cards.push(buildCard({
      modId: modGuess, lineId, projectId,
      seed: pickNumber(kv.seed),
      metrics,
      inputs: [path.join(processedDir, entry.name)],
    }));
  }
  return cards;
}

/** 校验并落盘。返回 { written, rejected }，rejected 带原因，绝不静默丢卡。 */
export function writeMetricCards(cards, { outDir, workflowsPath }) {
  const registeredModIds = collectRegisteredModIds(workflowsPath);
  const written = [];
  const rejected = [];
  fs.mkdirSync(outDir, { recursive: true });
  for (const card of cards) {
    const verdict = validateStepMetrics(card, { registeredModIds });
    if (!verdict.ok) {
      rejected.push({ mod_id: card?.mod_id, errors: verdict.errors });
      continue;
    }
    const target = path.join(outDir, `${card.mod_id}.metrics.json`);
    fs.writeFileSync(target, JSON.stringify(card, null, 2), 'utf8');
    written.push({ mod_id: card.mod_id, path: target, bytes: verdict.bytes });
  }
  return { written, rejected };
}

export function main(argv = process.argv.slice(2)) {
  const projectId = argv.find((a) => a.startsWith('--project='))?.split('=')[1];
  const lineId = argv.find((a) => a.startsWith('--line='))?.split('=')[1] || 'line1_bulk';
  const processedArg = argv.find((a) => a.startsWith('--processed='))?.split('=')[1];
  const outArg = argv.find((a) => a.startsWith('--out='))?.split('=')[1];
  if (!projectId) {
    console.error('用法: node tools/reporting/extract_step_metrics.mjs --project=<id> [--line=line1_bulk] [--processed=<dir>] [--out=<dir>]');
    return 2;
  }
  const processedDir = processedArg || path.join(
    DEFAULT_REPO_ROOT, 'workspace', 'projects', projectId, 'data', lineId, 'processed',
  );
  const outDir = outArg || path.join(DEFAULT_REPO_ROOT, 'workspace', 'projects', projectId, 'metrics');
  const cards = extractStepMetrics({ projectId, lineId, processedDir });
  const { written, rejected } = writeMetricCards(cards, {
    outDir,
    workflowsPath: path.join(DEFAULT_REPO_ROOT, 'tools', 'bio', 'workflows.json'),
  });
  for (const item of written) {
    console.log(`[ OK ] ${item.mod_id}.metrics.json  ${item.bytes} B`);
  }
  for (const item of rejected) {
    console.error(`[ RED] ${item.mod_id}: ${item.errors.join('；')}`);
  }
  console.log(`指标卡落盘 ${written.length} 张，拒绝 ${rejected.length} 张 -> ${outDir}`);
  return rejected.length > 0 ? 1 : 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exitCode = main();
}
