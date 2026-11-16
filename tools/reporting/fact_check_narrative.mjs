/**
 * tools/reporting/fact_check_narrative.mjs
 * 报告正文槽位绑定与防幻觉验真（Fact-Check Narrative Gate）。
 *
 * 存在理由：模型写正文时最危险的不是文风，是它"记住"了一个看起来合理的数字。
 * 所以正文里所有统计数值必须写成槽位 {{metric:<mod_id>.<path>}}，由本模块
 * 用指标卡真值唯一填充。正文里出现裸写数字即视为幻觉，直接拒绝签发。
 *
 * 三条硬判据（任一不通过即 409 ERR_NARRATIVE_HALLUCINATION_DETECTED）：
 *   1. 没有裸写的统计数值（p =、AUC =、log2FC =、n = 等）；
 *   2. 所有槽位都能在指标卡槽位索引里命中，且没有重复定义冲突；
 *   3. 正文引用的图件 template_id 全部在 Ready 白名单内。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeMetricSlots } from '../../shared/step_metrics_v1.mjs';

export const NARRATIVE_GATE_ERROR_CODE = 'ERR_NARRATIVE_HALLUCINATION_DETECTED';

/** 槽位语法：{{metric:<mod_id>.<path>}}，path 允许点号与数组下标。 */
export const SLOT_PATTERN = /\{\{\s*metric\s*:\s*([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+|\[\d+\])*)\s*\}\}/g;

/**
 * 裸写统计数值的识别规则。
 *
 * 判据必须锚定到「等号 + 数值」这种真实数值声明，而不是任何出现在正文里的数字
 * （否则 "2026 年" "图 3" 都会误伤，门禁会被当成噪声关掉）。
 */
export const UNBOUND_METRIC_RULES = Object.freeze([
  { name: 'P_VALUE', re: /\bp\s*(?:value)?\s*[=<>]\s*0?\.\d+/gi, sample: 'p = 0.03' },
  { name: 'PADJ', re: /\b(?:padj|adj\.?\s*p|q\s*value|fdr)\s*[=<>]\s*0?\.\d+/gi, sample: 'padj = 0.01' },
  { name: 'LOG2FC', re: /\blog2?\s*fc\s*[=<>]\s*[+-]?\d+(?:\.\d+)?/gi, sample: 'log2FC = 1.2' },
  { name: 'AUC', re: /\bauc\s*[=<>]\s*0?\.\d+/gi, sample: 'AUC = 0.87' },
  { name: 'HR_OR', re: /\b(?:hr|or|rr)\s*[=<>]\s*\d+(?:\.\d+)?/gi, sample: 'HR = 2.1' },
  { name: 'N_SAMPLES', re: /\bn\s*=\s*\d{1,5}\b/g, sample: 'n = 24' },
  { name: 'CORRELATION_R', re: /\br\s*=\s*[+-]?0?\.\d+/gi, sample: 'r = 0.62' },
  { name: 'MORANS_I', re: /moran\s*'?s?\s*i\s*[=<>]\s*[+-]?0?\.\d+/gi, sample: "Moran's I = 0.31" },
  { name: 'Z_SCORE', re: /\bz\s*(?:score)?\s*[=<>]\s*[+-]?\d+(?:\.\d+)?/gi, sample: 'Z = 4.2' },
  { name: 'CI_95', re: /\b95\s*%\s*ci\s*[=:]\s*[\[(]?\s*[+-]?0?\.\d+/gi, sample: '95% CI = 0.71' },
]);

/** 图件引用：![...](figures/...)，或显式 {{figure:fig_xxx}}。 */
const FIGURE_MD_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g;
const FIGURE_SLOT_RE = /\{\{\s*figure\s*:\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

export function loadReadyFigureIds(allowlistPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
    if (Array.isArray(raw)) return new Set(raw);
    if (Array.isArray(raw.ids)) return new Set(raw.ids);
    if (Array.isArray(raw.ready)) return new Set(raw.ready);
    return new Set();
  } catch {
    return new Set();
  }
}

/** 从图件路径里抽出模板 ID：`figures/fig_l1_scatter.v2.png` -> `fig_l1_scatter`。 */
export function templateIdFromPath(relativePath) {
  const base = String(relativePath || '').split(/[\\/]/).pop() || '';
  const stem = base.replace(/\.[A-Za-z0-9]+$/, '');
  const match = stem.match(/^(fig_[A-Za-z0-9_]+?)(?:\.v\d+)?(?:\.[A-Za-z0-9]+)?$/);
  return match ? match[1] : null;
}

/**
 * 找出正文里的裸写统计数值。
 * 槽位内是安全的：先把槽位替换成占位符再扫描，避免 `{{metric:...}}` 被误判。
 */
export function findUnboundMetrics(narrative) {
  const text = String(narrative || '').replace(SLOT_PATTERN, ' SLOT ');
  const hits = [];
  for (const rule of UNBOUND_METRIC_RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      hits.push({ rule: rule.name, text: m[0].trim(), index: m.index });
    }
  }
  return hits;
}

/** 解析正文里所有槽位引用。 */
export function collectSlotRefs(narrative) {
  const refs = [];
  const re = new RegExp(SLOT_PATTERN.source, SLOT_PATTERN.flags);
  let m;
  while ((m = re.exec(String(narrative || ''))) !== null) {
    refs.push({ raw: m[0], key: m[1], index: m.index });
  }
  return refs;
}

function formatSlotValue(value) {
  if (typeof value === 'boolean') return value ? '达标' : '未达标';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    return String(Number(value.toFixed(4)));
  }
  return String(value);
}

/**
 * 执行验真并可选填充。
 *
 * 返回结构：
 *   { ok, code?, reason?, unboundedMetrics, unresolvedSlots, unreadyFigures,
 *     slotCount, figureCount, rendered, audit }
 *
 * rendered 只有 ok=true 时才有意义：它是把槽位替换成真值后的正文。
 */
export function verifyNarrative({
  narrative = '',
  metricsCards = [],
  allowlistPath,
  readyFigureIds = null,
} = {}) {
  const unboundedMetrics = findUnboundMetrics(narrative);
  const slotRefs = collectSlotRefs(narrative);
  const { slots, conflicts } = mergeMetricSlots(metricsCards);

  const unresolvedSlots = [];
  const renderedParts = [];
  let cursor = 0;
  const text = String(narrative || '');
  const re = new RegExp(SLOT_PATTERN.source, SLOT_PATTERN.flags);
  let m;
  while ((m = re.exec(text)) !== null) {
    renderedParts.push(text.slice(cursor, m.index));
    const key = m[1];
    if (!slots.has(key)) {
      unresolvedSlots.push(key);
      renderedParts.push(m[0]);
    } else {
      renderedParts.push(formatSlotValue(slots.get(key)));
    }
    cursor = m.index + m[0].length;
  }
  renderedParts.push(text.slice(cursor));
  const rendered = renderedParts.join('');

  // 图件白名单核验
  const readyIds = readyFigureIds || loadReadyFigureIds(allowlistPath);
  const unreadyFigures = [];
  const figureRefs = [];
  let fm;
  const mdRe = new RegExp(FIGURE_MD_RE.source, FIGURE_MD_RE.flags);
  while ((fm = mdRe.exec(text)) !== null) {
    const src = fm[1];
    const tpl = templateIdFromPath(src);
    figureRefs.push(tpl || src);
    if (readyIds.size > 0 && (!tpl || !readyIds.has(tpl))) {
      unreadyFigures.push(tpl || src);
    }
  }
  const slotFigRe = new RegExp(FIGURE_SLOT_RE.source, FIGURE_SLOT_RE.flags);
  while ((fm = slotFigRe.exec(text)) !== null) {
    const tpl = fm[1];
    figureRefs.push(tpl);
    if (readyIds.size > 0 && !readyIds.has(tpl)) {
      unreadyFigures.push(tpl);
    }
  }

  const audit = {
    code: NARRATIVE_GATE_ERROR_CODE,
    slot_refs: slotRefs.length,
    distinct_slots: new Set(slotRefs.map((r) => r.key)).size,
    resolved_slots: slotRefs.filter((r) => slots.has(r.key)).length,
    metric_cards: metricsCards.map((c) => c?.mod_id || 'unknown'),
    figure_refs: figureRefs.length,
    ready_allowlist_size: readyIds.size,
    unbounded_count: unboundedMetrics.length,
    unresolved_count: unresolvedSlots.length,
    unready_figure_count: unreadyFigures.length,
    slot_conflicts: conflicts,
  };

  if (unboundedMetrics.length > 0) {
    return {
      ok: false,
      code: NARRATIVE_GATE_ERROR_CODE,
      reason: `正文存在 ${unboundedMetrics.length} 处未绑定槽位的裸写统计数值（示例：${unboundedMetrics[0].text}）；所有数值必须写成 {{metric:...}}`,
      unboundedMetrics,
      unresolvedSlots,
      unreadyFigures,
      slotCount: slotRefs.length,
      figureCount: figureRefs.length,
      rendered,
      audit,
    };
  }
  if (unresolvedSlots.length > 0) {
    return {
      ok: false,
      code: NARRATIVE_GATE_ERROR_CODE,
      reason: `正文有 ${unresolvedSlots.length} 个槽位在指标卡里找不到真值：${unresolvedSlots.slice(0, 5).join(', ')}`,
      unboundedMetrics,
      unresolvedSlots,
      unreadyFigures,
      slotCount: slotRefs.length,
      figureCount: figureRefs.length,
      rendered,
      audit,
    };
  }
  if (unreadyFigures.length > 0) {
    return {
      ok: false,
      code: NARRATIVE_GATE_ERROR_CODE,
      reason: `正文引用了 ${unreadyFigures.length} 个不在 27 Ready 白名单内的图件：${unreadyFigures.slice(0, 5).join(', ')}`,
      unboundedMetrics,
      unresolvedSlots,
      unreadyFigures,
      slotCount: slotRefs.length,
      figureCount: figureRefs.length,
      rendered,
      audit,
    };
  }
  if (conflicts.length > 0) {
    return {
      ok: false,
      code: NARRATIVE_GATE_ERROR_CODE,
      reason: `指标卡槽位冲突（同名键多个真值）：${conflicts.slice(0, 5).join(', ')}`,
      unboundedMetrics,
      unresolvedSlots,
      unreadyFigures,
      slotCount: slotRefs.length,
      figureCount: figureRefs.length,
      rendered,
      audit,
    };
  }

  return {
    ok: true,
    unboundedMetrics: [],
    unresolvedSlots: [],
    unreadyFigures: [],
    slotCount: slotRefs.length,
    figureCount: figureRefs.length,
    rendered,
    audit,
  };
}

/** CLI 入口：对一份正文与一组指标卡做验真，机器可读输出。 */
export function main(argv = process.argv.slice(2)) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const narrativePath = args[0];
  const metricsPaths = args.slice(1);
  if (!narrativePath) {
    console.error('用法: node tools/reporting/fact_check_narrative.mjs <narrative.md> <card1.metrics.json> [card2...]');
    return 2;
  }
  const narrative = fs.readFileSync(narrativePath, 'utf8');
  const cards = metricsPaths.map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));
  const allowlistPath = argv.find((a) => a.startsWith('--allowlist='))?.split('=')[1];
  const verdict = verifyNarrative({
    narrative,
    metricsCards: cards,
    allowlistPath: allowlistPath || new URL('../dev/figure_ready_allowlist.json', import.meta.url).pathname,
  });
  console.log(JSON.stringify(verdict.audit, null, 2));
  if (!verdict.ok) {
    console.error(`[ RED ] ${NARRATIVE_GATE_ERROR_CODE}: ${verdict.reason}`);
    return 1;
  }
  console.log('[ OK ] 槽位全部命中真值，无裸写数值，图件全部在 Ready 白名单内');
  return 0;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exitCode = main();
}
