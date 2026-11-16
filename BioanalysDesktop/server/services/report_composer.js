/**
 * BioanalysDesktop/server/services/report_composer.js
 * 阶段四 AI 解读报告合成器与防幻觉确定性锚定守卫（Fact-Check Gate）。
 *
 * 核心职责：
 *   1. 单图独立原则：每张图按 producing_mod_id 与 Ready 模板 ID 独立锚定嵌入，严禁复合大图；
 *   2. 数值与实体反向核验（Fact-Check Gate）：对 Pi Agent 生成的解读段落做确定性抽取比对，
 *      核验样本数、显著 DEG 数、上/下调数、seed 及提及的基因/数值必须存在于输入摘要中，
 *      发现大模型编造未计算数值或幻觉基因时立即抛出 FACT_CHECK_HALLUCINATION_ABORT。
 */
import fs from 'node:fs';
import { loadReadyFigureTemplateIds } from '../pi_runner.js';

/**
 * 解析 TSV 文本为对象数组（保留首行表头键名）。
 */
export function parseTsvRecords(tsvText = '') {
  const lines = String(tsvText || '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split('\t').map((c) => c.trim());
    const row = {};
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = cols[j] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

/**
 * 确定性数值与基因名反向锚定校验（Fact-Check Gate）。
 * 返回 { ok: boolean, mismatches: string[] }，若 strict=true 且不通过则直接抛出异常。
 */
export function verifyNarrativeFactCheck({
  narrativeText = '',
  summaryStats = {},
  topDegsTsv = '',
  enrichmentTsv = '',
  strict = true,
} = {}) {
  const text = String(narrativeText || '');
  const mismatches = [];

  // 1. 核验核心全局统计量（若文本中提及则必须与 summary_stats.json 一致）
  const statChecks = [
    { key: 'sample_count', patterns: [/样本(?:总)?数[为是：:\s]*(\d+)/g, /n\s*=\s*(\d+)\s*samples/gi] },
    { key: 'deg_up', patterns: [/上调(?:基因)?[数为：:\s]*(\d+)/g] },
    { key: 'deg_down', patterns: [/下调(?:基因)?[数为：:\s]*(\d+)/g] },
    { key: 'deg_total', patterns: [/显著\s*DEG\s*(?:总)?[数为：:\s]*(\d+)/gi] },
    { key: 'seed', patterns: [/(?:随机种子|seed)[为是：:\s]*(\d+)/gi] },
  ];

  for (const check of statChecks) {
    if (summaryStats[check.key] === undefined || summaryStats[check.key] === null) continue;
    const expected = String(summaryStats[check.key]);
    for (const re of check.patterns) {
      let match;
      while ((match = re.exec(text)) !== null) {
        if (match[1] !== expected) {
          mismatches.push(`统计量 '${check.key}' 幻觉不一致：正文声明 ${match[1]}，真实摘要为 ${expected}`);
        }
      }
    }
  }

  // 2. 构建真实基因与数值索引（来自 top_degs.tsv 与 enrichment_summary.tsv）
  const degRows = parseTsvRecords(topDegsTsv);
  const enrichRows = parseTsvRecords(enrichmentTsv);
  const knownGenes = new Map();

  for (const row of degRows) {
    const gene = String(row.gene || row.symbol || row.Gene || row.SYMBOL || '').trim();
    if (gene) {
      knownGenes.set(gene.toUpperCase(), {
        gene,
        log2FC: row.log2FC ?? row.logFC ?? null,
        padj: row.padj ?? row.FDR ?? row.p_val_adj ?? null,
      });
    }
  }
  for (const row of enrichRows) {
    const genesCol = String(row.geneID || row.genes || row.Genes || '');
    for (const g of genesCol.split(/[/,;,\s]+/).filter(Boolean)) {
      if (!knownGenes.has(g.toUpperCase())) {
        knownGenes.set(g.toUpperCase(), { gene: g, log2FC: null, padj: null });
      }
    }
  }

  // 3. 抽取正文中带统计数值引用的基因（如 `TP53 (log2FC=2.4, padj=1e-6)` 或 `基因 FAKEGENE`）
  if (knownGenes.size > 0) {
    const geneStatRe = /\b([A-Za-z][A-Za-z0-9_.-]{1,20})\s*\(\s*(?:log2FC|logFC)\s*=\s*([+-]?\d+(?:\.\d+)?)(?:\s*,\s*(?:padj|FDR)\s*=\s*([0-9.eE+-]+))?\s*\)/g;
    let gm;
    while ((gm = geneStatRe.exec(text)) !== null) {
      const citedGene = gm[1];
      const citedFc = gm[2];
      const citedPadj = gm[3];
      const record = knownGenes.get(citedGene.toUpperCase());
      if (!record) {
        mismatches.push(`基因实体幻觉：正文引用了 '${citedGene}'，但该基因不在 top_degs/enrichment 摘要中`);
        continue;
      }
      if (record.log2FC !== null && Number(citedFc) !== Number(record.log2FC)) {
        mismatches.push(`数值幻觉：基因 '${citedGene}' 正文 log2FC=${citedFc}，真实值为 ${record.log2FC}`);
      }
      if (citedPadj !== undefined && record.padj !== null && Number(citedPadj) !== Number(record.padj)) {
        mismatches.push(`数值幻觉：基因 '${citedGene}' 正文 padj=${citedPadj}，真实值为 ${record.padj}`);
      }
    }

    const explicitGeneTagRe = /(?:核心基因|关键基因|靶基因)[：:\s]*([A-Za-z][A-Za-z0-9_.-]{1,20})/g;
    let tm;
    while ((tm = explicitGeneTagRe.exec(text)) !== null) {
      const g = tm[1];
      if (!knownGenes.has(g.toUpperCase())) {
        mismatches.push(`基因实体幻觉：正文声明核心基因 '${g}' 不在真实计算摘要表内`);
      }
    }
  }

  if (strict && mismatches.length > 0) {
    const err = new Error(`FACT_CHECK_HALLUCINATION_ABORT: ${mismatches.join('；')}`);
    err.code = 'FACT_CHECK_HALLUCINATION_ABORT';
    err.mismatches = mismatches;
    throw err;
  }

  return { ok: mismatches.length === 0, mismatches };
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 合成脱敏友好的独立单图解读报告（HTML + Markdown）。
 */
export function composeStandaloneReport({
  jobId,
  title = '生信分析解读报告',
  narrativeText = '',
  summaryStats = {},
  topDegsTsv = '',
  enrichmentTsv = '',
  figures = [],
  allowlistPath,
} = {}) {
  // 1. 强执行 Fact-Check 反向核验
  verifyNarrativeFactCheck({
    narrativeText,
    summaryStats,
    topDegsTsv,
    enrichmentTsv,
    strict: true,
  });

  // 2. 动态读取 Ready 模板注册表，校验单图独立原则
  const readyIds = new Set(loadReadyFigureTemplateIds(allowlistPath));
  const validatedFigures = [];
  for (const fig of figures) {
    if (fig.is_composite || (Number(fig.panel_count) > 1)) {
      throw new Error(`COMPOSITE_FIGURE_FORBIDDEN: 图件 '${fig.template_id || fig.file}' 违反单图独立原则`);
    }
    if (readyIds.size > 0 && fig.template_id && !readyIds.has(fig.template_id)) {
      throw new Error(`UNREGISTERED_FIGURE_TEMPLATE: 图件模板 '${fig.template_id}' 不在 Ready 白名单中`);
    }
    validatedFigures.push(fig);
  }

  const figureHtmlBlocks = validatedFigures.map((fig, idx) => {
    const modId = escapeHtml(fig.producing_mod_id || 'mod_unknown');
    const tplId = escapeHtml(fig.template_id || 'tpl_custom');
    const caption = escapeHtml(fig.caption || `Figure ${idx + 1}`);
    const src = escapeHtml(fig.relative_path || fig.file || '');
    return [
      `<figure class="standalone-figure" data-mod-id="${modId}" data-template-id="${tplId}">`,
      `  <img src="${src}" alt="${caption}" />`,
      `  <figcaption class="figure-note-bottom-left">Fig ${idx + 1}. ${caption} (${modId})</figcaption>`,
      `</figure>`,
    ].join('\n');
  }).join('\n');

  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="UTF-8" />',
    `  <title>${escapeHtml(title)} - ${escapeHtml(jobId)}</title>`,
    '  <style>body{font-family:sans-serif;max-width:960px;margin:2rem auto;line-height:1.6;} .standalone-figure{margin:1.5rem 0;border:1px solid #e5e7eb;padding:1rem;} .figure-note-bottom-left{font-size:0.9rem;color:#4b5563;margin-top:0.5rem;}</style>',
    '</head>',
    '<body>',
    `  <h1>${escapeHtml(title)}</h1>`,
    `  <section class="summary-narrative"><p>${escapeHtml(narrativeText).replace(/\n/g, '<br/>')}</p></section>`,
    `  <section class="figures-section">\n${figureHtmlBlocks}\n  </section>`,
    '</body>',
    '</html>',
  ].join('\n');

  const markdown = [
    `# ${title}`,
    '',
    narrativeText,
    '',
    ...validatedFigures.map((fig, idx) =>
      `![Fig ${idx + 1}. ${fig.caption || fig.template_id}](${fig.relative_path || fig.file})`),
  ].join('\n');

  return {
    html,
    markdown,
    figureCount: validatedFigures.length,
    verifiedFacts: summaryStats,
  };
}
