/**
 * P13 DoD 取证：line2_scrna 全 22 步真机跑批（LINE_STEPS.line2_scrna 顺序）。
 *
 * 每步都走真实 HTTP 契约 POST /api/tasks/submit；完成判定靠 /api/tasks 列表里任务消失；
 * 结果判定只认远端台账 system_logs/*<PROJECT>*<line>*<step>_*.json 的 status 与 exit_code，
 * 不看"看起来成功"。失败 20s 后重试一次（容器会重启，重试一次是既有口径）。
 *
 * 额外取证（P13 新增）：
 *   - 逐步耗时（下发到任务消失的墙钟）、台账 start_time/end_time、checkpoint_status；
 *   - 逐步产物增量：processed/ 下新增或变大的文件字节数 + figures/ 图件数量；
 *   - 每步之间探测容器活性（只跑 `echo ALIVE`；容器内 ps/pgrep 会 abort proot，见 pitfalls_ledger P-23）；
 *   - 虚拟敲除步骤的靶基因：优先环境变量 KO_GENE，其次项目元数据，
 *     都没有就用远端 python 现场探候选基因在 Psoriasis 群体的表达占比后自动选；
 *   - 敲除步与 GSVA 步跑完读回 h5ad 的 uns 口径，验证 ko_gene 与 input_matrix 是否如实记录。
 *
 * 用法（工作台需已在跑，且是包含 targetKoGene 支持的最新代码）：
 *   BASE=http://127.0.0.1:18901 node cn_debug/2026-10-21_m1_line2_chain.mjs
 *   ONLY_STEP=gsva_pathways BASE=... node cn_debug/2026-10-21_m1_line2_chain.mjs
 *   START_INDEX=10 BASE=... node cn_debug/2026-10-21_m1_line2_chain.mjs
 *   KO_GENE=STAT3 BASE=... node ...   # 跳过自动选基因
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:18901';
const PROJECT = process.env.PROJECT_ID || 'PRJ_E2E_SCRNA';
const LINE = 'line2_scrna';
const SEED = 20261021;
const P = `/mnt/ssd/bio_data/projects/${PROJECT}/${LINE}`;
const LOGS = '/mnt/ssd/bio_data/system_logs';
const START = Number(process.env.START_INDEX || 0);
const ONLY = process.env.ONLY_STEP || '';
const RESULT_FILE = 'cn_debug/2026-10-21_m1_line2_chain.result.md';
const KO_STEPS = ['virtual_knockout'];

// 候选敲除基因：都是银屑病/角质形成细胞增殖与炎症轴上的常见基因，
// 刻意避开肿瘤相关词（本线群体是 Psoriasis，不是肿瘤）。
const KO_CANDIDATES = ['STAT3', 'NFKB1', 'JUN', 'FOS', 'IL1B', 'CXCL8',
  'S100A8', 'S100A9', 'RELA', 'TCF4', 'IL17A', 'JUNB', 'EGR1'];

const results = [];
const rows = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// 连接级抖动（10022 端口被对端关闭 / 超时）重试；命令本身失败不重试，避免副作用命令重复执行。
const RETRYABLE_SSH = /Connection closed|Connection reset|Broken pipe|kex_exchange|closed by|timed out|Timeout/;

function ssh(cmd, timeout = 180000) {
  let lastError = null;
  for (let tryNo = 1; tryNo <= 4; tryNo += 1) {
    try {
      return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'k40-ubuntu', cmd],
        { encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
    } catch (cause) {
      lastError = cause;
      const msg = String(cause.message || '');
      if (!RETRYABLE_SSH.test(msg) || tryNo === 4) throw cause;
      sleepSync(2000 * tryNo);
    }
  }
  throw lastError;
}

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
  return ok;
}

/**
 * 容器活性：能跑通一条最小命令即视为活着。
 * 刻意不用 ps / pgrep —— 它们遍历 /proc 会触发 proot 的 path.c 断言并 abort 整个容器，
 * 把正在跑的分析任务一起杀掉（2026-10-21 实测，见 con_hf/pitfalls_ledger.md P-23）。
 */
function containerAlive() {
  try {
    const out = ssh('echo ALIVE');
    return { alive: /ALIVE/.test(out), detail: 'echo ok' };
  } catch (cause) {
    return { alive: false, detail: cause.message.slice(0, 120) };
  }
}

/** processed/ 文件字节数 + figures/ 图件清单，用于算每步产物增量。 */
function snapshot() {
  const cmd = `cd '${P}' && { for f in processed/*; do [ -f "$f" ] && printf 'F\\t%s\\t%s\\n' "$f" "$(stat -c %s "$f")"; done; for f in figures/*.png; do [ -f "$f" ] && printf 'G\\t%s\\n' "$f"; done; } 2>/dev/null`;
  const files = new Map();
  const figures = [];
  let out = '';
  try { out = ssh(cmd); } catch { return { files, figures }; }
  for (const line of out.split('\n')) {
    const parts = line.split('\t');
    if (parts[0] === 'F' && parts[1]) files.set(parts[1], Number(parts[2]));
    if (parts[0] === 'G' && parts[1]) figures.push(parts[1]);
  }
  return { files, figures };
}

function diffSnapshot(before, after) {
  const created = [];
  const grown = [];
  for (const [file, size] of after.files) {
    if (!before.files.has(file)) created.push({ file, size });
    else if (size > before.files.get(file)) grown.push({ file, size, was: before.files.get(file) });
  }
  const figs = after.figures.filter((f) => !before.figures.includes(f));
  return { created, grown, figs };
}

// 台账定位口径（P13 修）：提交前先快照已有台账文件名集合，提交后只认「新出现」的文件。
// 之前用 start_time 与本地 submittedAt 比大小，但 K40 容器是 UTC、本地是 CST(+8)，
// 永远判「不是新的」，于是每步都白等 180s 再重试一遍（整链时间翻倍）。
// 文件名用严格正则 _<step>_<8hex>.json，避免 *enrichment_*.json 误命中 enrichment_figures。
function ledgerFileNames() {
  try {
    const out = ssh(`ls ${LOGS}/*${PROJECT}_${LINE}_*.json 2>/dev/null | sed 's#.*/##'`);
    return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function ledgerForStep(step, known) {
  const re = new RegExp('_' + step + '_[0-9a-f]{8}\\.json$');
  let names = [];
  try {
    const out = ssh(`ls -t ${LOGS}/*${PROJECT}_${LINE}_*.json 2>/dev/null | sed 's#.*/##'`);
    names = out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
  const fresh = names.filter((n) => re.test(n) && !known.has(n));
  if (!fresh.length) return null;
  const file = `${LOGS}/${fresh[0]}`;
  try {
    return { file, ...JSON.parse(ssh(`cat '${file}'`)) };
  } catch {
    return null;
  }
}

async function waitLedger(step, known, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ledger = ledgerForStep(step, known);
    if (ledger) return ledger;
    await sleep(5000);
  }
  return null;
}

async function runningIds() {
  const res = await fetch(`${BASE}/api/tasks`);
  const body = await res.json();
  return new Set((body.tasks || []).map((t) => t.taskId));
}

/** 远端 python 读 h5ad 的 uns 口径（只取需要的键，不加载矩阵）。 */
function readUns(h5ad, unsKey) {
  const script = `cd '${P}/processed' && python3 - '${h5ad}' '${unsKey}' <<'PYUNS'
import json
import sys

import anndata as ad

try:
    obj = ad.read_h5ad(sys.argv[1], backed='r')
    payload = dict(obj.uns.get(sys.argv[2], {}))
except Exception as exc:  # noqa: BLE001
    print(json.dumps({"error": str(exc)[:200]}))
    raise SystemExit(0)
def plain(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in list(value.items())[:12]}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in list(value)[:12]]
    return str(type(value).__name__)
print(json.dumps({k: plain(v) for k, v in payload.items()}, ensure_ascii=False)[:1500])
PYUNS`;
  try {
    return JSON.parse(ssh(script, 300000));
  } catch (cause) {
    return { error: String(cause.message || cause).slice(0, 200) };
  }
}

/** 虚拟敲除靶基因：环境变量 > 项目元数据 > 现场探表达占比后自动选。 */
function resolveKoGene() {
  if (process.env.KO_GENE) return { gene: process.env.KO_GENE.trim(), source: 'env:KO_GENE', probe: [] };
  try {
    const meta = JSON.parse(ssh(`cat /mnt/ssd/bio_data/projects/${PROJECT}/project.json 2>/dev/null || echo '{}'`));
    const gene = meta?.biological_priors?.target_ko_gene || meta?.acl_and_output?.target_ko_gene;
    if (typeof gene === 'string' && gene.trim()) {
      return { gene: gene.trim(), source: 'project.json', probe: [] };
    }
  } catch {
    // project.json 不存在或不可解析都当"没指定"，继续走现场探测
  }

  const script = `cd '${P}/processed' && python3 - <<'PYKO'
import json
import sys

import anndata as ad
import numpy as np
import pandas as pd

cands = json.loads(sys.argv[1]) if len(sys.argv) > 1 else []
ann = ad.read_h5ad('scrna_annotated.h5ad', backed='r')
obs = ann.obs
pop = obs['diagnosis'].astype(str) == 'Psoriasis'
hvg = set(pd.read_csv('hvg_genes.tsv', sep='\t')['gene'].astype(str))
norm = ad.read_h5ad('scrna_norm.h5ad')
mask = (norm.obs_names.isin(obs.index[pop]))
counts = norm.layers['counts'][mask]
var = [str(g) for g in norm.var_names]
idx = {g: i for i, g in enumerate(var)}
rows = []
for gene in cands:
    if gene not in idx:
        rows.append({"gene": gene, "frac": 0.0, "hvg": gene in hvg, "reason": "not_in_var"})
        continue
    col = counts[:, idx[gene]]
    dense = np.asarray(col.todense()).ravel() if hasattr(col, 'todense') else np.asarray(col).ravel()
    rows.append({"gene": gene, "frac": round(float((dense > 0).mean()), 4), "hvg": gene in hvg})
print(json.dumps({"n_pop": int(mask.sum()), "rows": rows}, ensure_ascii=False))
PYKO`;
  let probe = { n_pop: 0, rows: [] };
  try {
    probe = JSON.parse(ssh(script, 600000));
  } catch (cause) {
    return { gene: 'TNF', source: 'fallback:probe_failed', probe: [], error: String(cause.message || cause).slice(0, 200) };
  }
  // 过两道闸（HVG 网内 + 表达占比留 1 个百分点余量），再按候选顺序取第一个，
  // 候选顺序本身已经按"银屑病生物学相关性"排过，不是纯按表达量。
  const passing = probe.rows.filter((r) => r.hvg && r.frac > 0.06);
  const picked = passing.length ? passing[0] : null;
  return {
    gene: picked ? picked.gene : 'TNF',
    source: picked ? 'auto:probe' : 'fallback:probe_no_candidate',
    probe: probe.rows,
    nPop: probe.n_pop,
  };
}

async function attempt(spec, index, tryNo, koGene) {
  const label = `${index + 1}. ${spec.step}${tryNo > 1 ? ` (retry ${tryNo - 1})` : ''}`;
  const knownLedgers = ledgerFileNames();
  const startedAt = Date.now();
  const body = {
    projectId: PROJECT, lineId: LINE, step: spec.step,
    inputs: spec.inputs, outputs: [], seed: SEED,
  };
  // P14 契约：虚拟敲除必须显式指定靶基因，服务端会把它注入远端环境变量 BIO_KO_GENE。
  if (KO_STEPS.includes(spec.step)) body.targetKoGene = koGene;

  const submit = await fetch(`${BASE}/api/tasks/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await submit.json();
  if (!submit.ok) {
    check(`${label} 下发`, false, payload.error || `HTTP ${submit.status}`);
    return { ok: false, ledger: null };
  }
  check(`${label} 下发`, true, payload.taskId);

  const deadline = Date.now() + 45 * 60 * 1000;
  let stillRunning = true;
  while (Date.now() < deadline) {
    await sleep(3000);
    const ids = await runningIds();
    if (!ids.has(payload.taskId)) { stillRunning = false; break; }
  }
  const wallSec = Math.round((Date.now() - startedAt) / 1000);
  if (stillRunning) {
    check(`${label} 完成`, false, '超时 45 分钟仍在运行');
    return { ok: false, ledger: null, wallSec };
  }

  await sleep(1500);
  const ledger = await waitLedger(spec.step, knownLedgers);
  if (!ledger) {
    check(`${label} 台账`, false, '180s 内未找到台账文件');
    return { ok: false, ledger: null, wallSec };
  }
  const ok = ledger.status === 'completed' && ledger.exit_code === 0;
  check(`${label} 结果`, ok,
    `status=${ledger.status} exit=${ledger.exit_code} checkpoint=${ledger.checkpoint_status} ${ledger.start_time}→${ledger.end_time}`
    + (ok ? '' : `\n    error=${String(ledger.error_log || '').replace(/\n/g, '\n    ').slice(0, 1200)}`));
  return { ok, ledger, wallSec };
}

async function runStep(spec, index, koGene) {
  const before = snapshot();
  for (let tryNo = 1; tryNo <= 2; tryNo += 1) {
    if (tryNo > 1) { console.log('  失败，20s 后重试一次（容器可能重启过）'); await sleep(20000); }
    const attemptResult = await attempt(spec, index, tryNo, koGene);
    if (attemptResult.ok) {
      const after = snapshot();
      const delta = diffSnapshot(before, after);
      const row = {
        index: index + 1,
        step: spec.step,
        wallSec: attemptResult.wallSec,
        start: attemptResult.ledger.start_time,
        end: attemptResult.ledger.end_time,
        status: attemptResult.ledger.status,
        exitCode: attemptResult.ledger.exit_code,
        checkpoint: attemptResult.ledger.checkpoint_status,
        created: delta.created,
        grown: delta.grown,
        figs: delta.figs,
        extra: spec.after ? spec.after() : '',
      };
      rows.push(row);
      const art = [...delta.created.map((f) => `${f.file.split('/').pop()}(${f.size})`),
        ...delta.grown.map((f) => `${f.file.split('/').pop()}(${f.was}→${f.size})`)].join(' ');
      console.log(`  产物：${art || '无新文件'}${delta.figs.length ? ` | 图件+${delta.figs.length}` : ''}`);
      return true;
    }
  }
  return false;
}

const STEPS = [
  { step: 'ingest_counts', inputs: [`${P}/raw_data/GSE254707_RAW.tar`, `${P}/raw_data/GPL21697_family.soft.gz`, `${P}/raw_data/grouping.txt`] },
  { step: 'qc_cells', inputs: [`${P}/processed/scrna_counts.h5ad`] },
  { step: 'normalize_hvg', inputs: [`${P}/processed/scrna_qc.h5ad`] },
  { step: 'integrate_harmony', inputs: [`${P}/processed/scrna_norm.h5ad`] },
  { step: 'cluster_umap', inputs: [`${P}/processed/scrna_integrated.h5ad`] },
  { step: 'annotate_celltypes', inputs: [`${P}/processed/scrna_clustered.h5ad`] },
  { step: 'scrna_composition', inputs: [`${P}/processed/scrna_annotated.h5ad`] },
  { step: 'deg_groups', inputs: [`${P}/processed/scrna_composition.h5ad`] },
  { step: 'subcluster', inputs: [`${P}/processed/scrna_deg.h5ad`] },
  { step: 'enrichment', inputs: [`${P}/processed/deg_all_by_celltype.tsv`, `${P}/processed/deg_significant_by_celltype.tsv`] },
  { step: 'enrichment_figures', inputs: [`${P}/processed`] },
  { step: 'pseudotime', inputs: [`${P}/processed/scrna_annotated.h5ad`] },
  { step: 'cell_communication', inputs: [`${P}/processed/scrna_annotated.h5ad`, `${P}/processed/scrna_norm.h5ad`] },
  { step: 'scenic_tf', inputs: [`${P}/processed/scrna_annotated.h5ad`, `${P}/processed/scrna_norm.h5ad`] },
  { step: 'scenic_figures', inputs: [`${P}/processed`] },
  { step: 'tf_activity', inputs: [`${P}/processed/deg_all_by_celltype.tsv`, `${P}/processed/deg_significant_by_celltype.tsv`] },
  { step: 'virtual_knockout', inputs: [`${P}/processed/scrna_annotated.h5ad`, `${P}/processed/scrna_norm.h5ad`, `${P}/processed/hvg_genes.tsv`] },
  { step: 'summarize_dr', inputs: [`${P}/processed/scrna_knockout.h5ad`, `${P}/processed/ko_dr_genes.tsv`] },
  { step: 'target_gene_localization', inputs: [`${P}/processed/scrna_deg.h5ad`, `${P}/processed/deg_all_by_celltype.tsv`, `${P}/processed/ko_dr_genes.tsv`] },
  { step: 'gsva_pathways', inputs: [`${P}/processed/scrna_integrated.h5ad`, `${P}/processed/scrna_deg.h5ad`] },
  { step: 'dr_post_analysis', inputs: [`${P}/processed/scrna_knockout.h5ad`, `${P}/processed/ko_dr_genes.tsv`, `${P}/processed/scenic_regulons.csv`, `${P}/processed/deg_all_by_celltype.tsv`] },
  { step: 'scrna_figures', inputs: [`${P}/processed/scrna_deg.h5ad`] },
];

function renderMarkdown(koGene) {
  const lines = [
    '| # | step | status | exit | 耗时(s) | checkpoint | 新增/更新产物 | 图件 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const art = [...row.created.map((f) => `${f.file.split('/').pop()} ${f.size}B`),
      ...row.grown.map((f) => `${f.file.split('/').pop()} ${f.was}→${f.size}B`)].join('<br>');
    lines.push(`| ${row.index} | ${row.step} | ${row.status} | ${row.exitCode} | ${row.wallSec} | ${row.checkpoint} | ${art || '-'} | ${row.figs.length} |`);
  }
  lines.push('');
  lines.push(`敲除靶基因：${koGene}`);
  lines.push('');
  lines.push('| # | step | start_time | end_time |');
  lines.push('| --- | --- | --- | --- |');
  for (const row of rows) lines.push(`| ${row.index} | ${row.step} | ${row.start} | ${row.end} |`);
  return lines.join('\n');
}

async function main() {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check('工作台在线', health.ok === true, `port=${health.port}`);

  const alive = containerAlive();
  check('容器存活（proot etime）', alive.alive, alive.detail);

  // 敲除靶基因必须等到 annotated 产物出现后才能解析（探针要读 obs['diagnosis'] 与 counts），
  // 所以改成在 virtual_knockout 前一步惰性解析，不在脚本启动时算（首跑就是在这里踩的坑）。
  let koGene = process.env.KO_GENE || '';
  let koSource = koGene ? 'env:KO_GENE' : '';

  for (let i = START; i < STEPS.length; i += 1) {
    if (ONLY && STEPS[i].step !== ONLY) continue;
    const spec = STEPS[i];
    console.log(`\n[${i + 1}/${STEPS.length}] ${spec.step}`);
    const aliveBefore = containerAlive();
    if (!aliveBefore.alive) console.log('  警告：下发前未见 proot 进程：' + aliveBefore.detail);
    if (KO_STEPS.includes(spec.step) && !koGene) {
      const resolved = resolveKoGene();
      koGene = resolved.gene;
      koSource = resolved.source;
      console.log(`  敲除靶基因：${koGene}（来源 ${koSource}）`);
      if (resolved.probe?.length) {
        console.log('  候选表达占比（Psoriasis 群体 n=' + resolved.nPop + '）：'
          + resolved.probe.map((r) => `${r.gene}=${r.frac}${r.hvg ? '' : '(非HVG)'}`).join(' '));
      }
      if (resolved.error) console.log('  探测异常：' + resolved.error);
      check('敲除靶基因已确定', Boolean(koGene), `${koGene}（${koSource}）`);
    }
    const ok = await runStep(spec, i, koGene);
    if (!ok) {
      console.log('\n中断：该步骤失败，后续步骤依赖其产物，停止下发。');
      rows.push({ index: i + 1, step: spec.step, wallSec: 0, status: 'failed', exitCode: '?', checkpoint: '?', created: [], grown: [], figs: [] });
      break;
    }
    if (spec.step === 'virtual_knockout') {
      const uns = readUns('scrna_knockout.h5ad', 'virtual_knockout');
      console.log('  uns[virtual_knockout]=' + JSON.stringify({ ko_gene: uns.ko_gene, ko_gene_source: uns.ko_gene_source, ko_expression_fraction: uns.ko_expression_fraction, ko_gene_provenance: uns.ko_gene_provenance }));
    }
    if (spec.step === 'gsva_pathways') {
      const uns = readUns('scrna_gsva.h5ad', 'gsva');
      console.log('  uns[gsva].input_matrix=' + uns.input_matrix + ' n_pathways=' + uns.n_pathways);
    }
  }

  const md = renderMarkdown(koGene);
  writeFileSync(RESULT_FILE, md + '\n', 'utf8');
  console.log('\n' + md);
  console.log(`\n结果表已写 ${RESULT_FILE}`);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果：${pass}/${results.length} 通过`);
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch((cause) => {
  console.error('脚本异常:', cause.stack || cause.message);
  process.exitCode = 1;
});
