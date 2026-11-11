// 模式 A 全链路验证：从疾病名出发，跑完 L0 到 L4，产出结果单。
// 用法：node workspace/handoff/topic_survey/survey_run.mjs "<疾病名>" [--kinds bulk,scrna] [--ticket TSV-xxx]
//
// 这一步补上评审指出的缺口：此前只验证了「给定 GSE 抽要素卡」，
// 没有验证「给定方向检索出候选集」，也没有跑 L2 到 L4。
import https from 'node:https';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// FTP 静态文件必须绕开系统代理：本机代理对 ftp.ncbi.nlm.nih.gov 会返回
// 非 gzip 的污染响应（约 990 字节，magic 3c3f786d）。直连正常。
// 这是实测抓到的第四个坑，SOP 第三节已记。
// 做法是在进程级清掉代理变量，只影响本进程，不动用户环境。
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.ALL_PROXY;
delete process.env.all_proxy;

const EU = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const FTP = 'https://ftp.ncbi.nlm.nih.gov/geo/series';
const INBOX = path.join(__dirname, 'inbox_test');
const RETMAX = 40;

function gb(u) {
  return new Promise((res, rej) => {
    https.get(u, r => {
      const c = [];
      r.on('data', d => c.push(Buffer.from(d)));
      r.on('end', () => res(Buffer.concat(c)));
    }).on('error', rej);
  });
}

// FTP 静态文件不走系统代理：代理会对 ftp.ncbi.nlm.nih.gov 返回非 gzip 的污染响应
// （magic 3c3f786d，约 990 字节）。直连正常。这是实测抓到的第四个坑。
function gbDirect(u) {
  return new Promise((res, rej) => {
    const req = https.get(u, { agent: false }, r => {
      const c = [];
      r.on('data', d => c.push(Buffer.from(d)));
      r.on('end', () => res(Buffer.concat(c)));
    });
    req.on('error', rej);
  });
}
const gjson = u => gb(u).then(b => JSON.parse(b.toString('utf8')));

// 肿瘤/免疫词面快筛（准入第一道闸）：复用权威实现，不另写正则。
// 权威实现是 ESM，本文件是 .cjs，用 require 会走 CJS 解析并污染全局
// （实测导致后续 https 请求被改写）。改成顶层 await import。
const { checkTumorBlacklist } = await import('../../../BioanalysDesktop/server/tumor_blacklist.js');

function geoDir(acc) {
  const m = /^([A-Za-z]+)([0-9]+)$/.exec(acc);
  if (!m) throw new Error('bad accession ' + acc);
  const digits = m[2];
  const head = digits.length > 3 ? digits.slice(0, -3) : digits;
  return m[1] + head + 'nnn';
}

function parseMatrix(text) {
  const rows = {};
  for (const l of text.split('\n')) {
    if (!l.startsWith('!Sample_')) continue;
    const p = l.split('\t');
    const key = p[0].replace('!Sample_', '');
    if (!rows[key]) rows[key] = [];
    rows[key].push(p.slice(1));
  }
  return rows;
}
const clean = s => String(s == null ? '' : s).replace(/"/g, '').trim();

function characteristicsOf(rows, idx) {
  const out = {};
  for (const line of rows.characteristics_ch1 || []) {
    const cell = clean(line[idx]);
    const m = /^([A-Za-z][A-Za-z0-9 _-]*):\s*(.+)$/.exec(cell);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

async function seriesMatrix(acc) {
  const p = geoDir(acc) + '/matrix/' + acc + '_series_matrix.txt.gz';
  for (let i = 0; i < 3; i += 1) {
    const url = FTP + '/' + p + (i ? '?cb=' + i : '');
    const b = await gbDirect(url);
    if (process.env.SURVEY_DEBUG) {
      console.error('DBG ' + acc + ' url=' + url + ' bytes=' + b.length + ' magic=' + b.slice(0, 4).toString('hex'));
    }
    if (b[0] === 0x1f && b[1] === 0x8b) return zlib.gunzipSync(b).toString('utf8');
  }
  throw new Error(acc + ' series_matrix 三次重试均非 gzip');
}

function guessDataType(rows) {
  const src = clean(rows.library_source[0][0]).toLowerCase();
  if (src.includes('single cell')) return 'scrna';
  const title = clean(rows.title[0][0]).toLowerCase();
  if (title.includes('single cell') || title.includes('scrna')) return 'scrna';
  const sup = clean(rows.supplementary_file ? rows.supplementary_file[0][0] : '');
  if (/tissue_positions|scalefactors|\.gef|\.gem/i.test(sup)) return 'spatial';
  if (/\.CEL/i.test(sup)) return 'array';
  return 'bulk';
}

function guessGroups(rows) {
  const n = rows.geo_accession[0].length;
  const keys = ['disease', 'disease state', 'group', 'condition', 'treatment'];
  const tally = {};
  const per = [];
  for (let i = 0; i < n; i += 1) {
    const ch = characteristicsOf(rows, i);
    let dg = 'UNMAPPED';
    for (const k of keys) { if (ch[k]) { dg = ch[k]; break; } }
    tally[dg] = (tally[dg] || 0) + 1;
    per.push(clean(rows.geo_accession[0][i]) + '=' + dg);
  }
  return { tally, per };
}

// L2 评分：六维权重见筛子第五部分。规模分位无参照集，按固定阈值兜底并标注。
function scoreL2(card, sup) {
  const dims = {};
  const supU = sup.toUpperCase();
  if (/H5AD|RDS|TSV|CSV|MTX|TABULAR|TXT/.test(supU)) dims.availability = 25;
  else if (/CEL|H5|TAR/.test(supU)) dims.availability = 15;
  else dims.availability = 5;

  const mapped = Object.keys(card.groups).filter(k => k !== 'UNMAPPED').length;
  dims.grouping = mapped >= 2 ? 20 : (mapped === 1 ? 10 : 0);

  const n = card.n_samples;
  dims.scale = n >= 50 ? 15 : (n >= 20 ? 10 : 5);

  dims.clinical = card.has_clinical ? 15 : 10;

  dims.species_tissue = 15;

  dims.access = 10;

  const total = Object.values(dims).reduce((a, b) => a + b, 0);
  const grade = total >= 80 ? 'A' : (total >= 60 ? 'B' : 'C');
  return { dims, total, grade, scale_basis: 'fixed_threshold_no_reference_set' };
}

// L4 反推：按筛子第七部分决策树，九类课题逐条标满足或缺失。
function inferL4(cards) {
  const byKind = {};
  cards.forEach(c => { byKind[c.data_type] = byKind[c.data_type] || []; byKind[c.data_type].push(c); });
  const has = k => (byKind[k] || []).length > 0;
  const hasFollowup = cards.some(c => c.has_clinical);
  const maxN = cards.reduce((m, c) => Math.max(m, c.n_samples), 0);

  const T = [
    { id: 'T1', name: '诊断标志物模型', need: ['bulk', 'array'], methods: '差异分析 → WGCNA → LASSO/RF/SVM/XGBoost → AUC/DCA/校准/列线图' },
    { id: 'T2', name: '分子分型', need: ['bulk'], methods: '共识聚类 → 亚型差异 → GSVA → 亚型临床关联' },
    { id: 'T3', name: '关键基因三级串联', need: ['bulk', 'scrna', 'spatial'], methods: 'bulk 差异+WGCNA+PPI → hub gene → sc 定位 → ST 空间分布' },
    { id: 'T4', name: '细胞图谱与拟时序', need: ['scrna'], methods: 'QC → 整合 → 注释 → 亚群差异 → Monocle/CellRank 拟时序' },
    { id: 'T5', name: '细胞通讯', need: ['scrna', 'spatial'], methods: 'CellChat/NicheNet → 通路强度组间比较 → ST 共定位验证' },
    { id: 'T6', name: '空间生态位', need: ['spatial'], methods: '反卷积 → niche 聚类 → 邻域/共定位分析' },
    { id: 'T7', name: '预后/进展预测', need: ['bulk'], methods: 'Cox → LASSO-Cox → 风险评分 → 分层生存 → Nomogram' },
    { id: 'T8', name: '跨物种保守性', need: ['human', 'mouse'], methods: '人源发现 → 同源基因转换 → 鼠源独立验证' },
    { id: 'T9', name: '代谢/通路重编程', need: ['bulk'], methods: 'GSVA/GSEA/ssGSEA → 通路活性评分 → 与表型关联' },
  ];
  const orgs = new Set(cards.map(c => c.organism));

  return T.map(t => {
    const satisfied = [];
    const missing = [];
    for (const k of t.need) {
      if (k === 'human' || k === 'mouse') {
        const want = k === 'human' ? 'Homo sapiens' : 'Mus musculus';
        if (orgs.has(want)) satisfied.push(k === 'human' ? '人源数据' : '鼠源数据');
        else missing.push(k === 'human' ? '人源数据' : '鼠源数据');
      } else if (has(k)) satisfied.push(k);
      else missing.push(k);
    }
    if (t.id === 'T7') {
      if (hasFollowup) satisfied.push('随访信息');
      else missing.push('随访信息（有随访才能做预后）');
    }
    if (t.id === 'T1' || t.id === 'T2' || t.id === 'T9') {
      if (maxN >= 20) satisfied.push('样本量 ' + maxN);
      else missing.push('发现队列每组建议 ≥20，当前最大 ' + maxN);
    }
    if (t.id === 'T8') {
      if (orgs.size >= 2) satisfied.push('双物种');
      else missing.push('第二物种数据');
    }
    return {
      id: t.id, name: t.name, methods: t.methods,
      satisfied, missing,
      recommended: missing.length === 0,
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const disease = args[0];
  if (!disease) { console.log('用法：node survey_run.mjs "<疾病名>" [--kinds bulk,scrna] [--ticket TSV-xxx]'); process.exit(2); }

  let kinds = ['bulk'];
  let ticket = null;
  for (let i = 1; i < args.length; i += 1) {
    if (args[i] === '--kinds') { kinds = args[i + 1].split(','); i += 1; }
    else if (args[i] === '--ticket') { ticket = args[i + 1]; i += 1; }
  }

  const startedAt = new Date().toISOString();

  // L0 第一道：词面快筛（权威正则）
  const bl = checkTumorBlacklist(disease);
  if (bl.hit) {
    console.log(JSON.stringify({ l0: { verdict: '排除', basis: '命中词面快筛', matched: bl.matches } }, null, 2));
    process.exit(0);
  }

  // L0 第二道：语义级准入。边缘病表来自筛子 3.2，命中即标 manual 不拍板。
  const EDGE = {
    'asthma': '气道炎症为核心机制，倾向免疫方向；若聚焦气道重塑/平滑肌/纤维化可纳入',
    'copd': '同上', 'endometriosis': '有免疫与激素双重成分，需按课题聚焦点判定',
  };
  const key = disease.toLowerCase();
  const edge = EDGE[key];
  const manual = [];
  if (edge) manual.push({ kind: '边缘病准入', detail: edge, field: 'disease' });
  manual.push({ kind: 'BioProject 去重', detail: '需外查 BioProject/SRA 编号，本地判不了', field: 'bioproject' });
  manual.push({ kind: '批次与分组混杂', detail: '需做批次与分组交叉表，字段不全时判不了', field: 'batch' });

  // 检索：esearch 到 esummary
  const term = disease + ' AND gse[Entry Type]';
  const searchUrl = EU + '/esearch.fcgi?db=gds&term=' + encodeURIComponent(term)
    + '&retmax=' + RETMAX + '&retmode=json&sort=relevance';
  const sr = await gjson(searchUrl);
  const count = Number(sr.esearchresult.count);
  const ids = sr.esearchresult.idlist;
  const trace = {
    started_at: startedAt,
    term, retmax: RETMAX, sort: 'relevance',
    total_count: count, returned: ids.length, uids: ids,
    search_url: searchUrl,
  };

  const summaryUrl = EU + '/esummary.fcgi?db=gds&id=' + ids.join(',') + '&retmode=json';
  const sm = await gjson(summaryUrl);
  trace.summary_url = summaryUrl;

  // 标题级 L0 复筛 + 类型初判
  const shortlist = [];
  for (const k of Object.keys(sm.result)) {
    if (k === 'uids') continue;
    const v = sm.result[k];
    const t = String(v.title || '');
    const tb = checkTumorBlacklist(t);
    if (tb.hit) continue;
    shortlist.push({ uid: v.uid, accession: v.accession, title: t, n: v.n_samples, gpl: v.gpl, bp: v.bioproject, sup: v.suppfile || '' });
  }
  trace.shortlist = shortlist.map(s => s.accession);

  // 取前若干个下钻 series_matrix，填要素卡 + L2 评分
  const want = Number(process.env.SURVEY_DEEP || 3);
  const cards = [];
  for (const s of shortlist.slice(0, want)) {
    try {
      const rows = parseMatrix(await seriesMatrix(s.accession));
      const n = rows.geo_accession[0].length;
      const g = guessGroups(rows);
      const chAll = [];
      for (let i = 0; i < n; i += 1) chAll.push(characteristicsOf(rows, i));
      const hasClinical = chAll.some(c => Object.keys(c).some(k => /age|sex|gender|stage|grade|smok/i.test(k)));
      const tissue = (chAll.map(c => c.tissue).filter(Boolean)[0]) || '';
      const card = {
        accession: s.accession,
        title: s.title,
        organism: clean(rows.organism_ch1[0][0]) || 'Homo sapiens',
        tissue,
        n_samples: n,
        groups: g.tally,
        gsm_groups: g.per,
        data_type: guessDataType(rows),
        platform: clean(rows.platform_id[0][0]),
        instrument: clean(rows.instrument_model[0][0]),
        library_source: clean(rows.library_source[0][0]),
        bioproject: s.bp,
        suppfile: s.sup,
        has_clinical: hasClinical,
      };
      card.l2 = scoreL2(card, s.sup);
      cards.push(card);
    } catch (e) {
      cards.push({ accession: s.accession, title: s.title, error: e.message, data_type: 'bulk', n_samples: s.n, groups: {}, grade: 'C' });
    }
  }

  const topics = inferL4(cards);
  const okCards = cards.filter((c) => c.l2);
  const failedCards = cards.filter((c) => !c.l2);
  // 下钻全失败时不得输出九类课题：那会产出一个看起来完整、实则无依据的清单。
  // 如实回报"数据不足"，把失败原因写进 manual，让人看见缺口。
  if (okCards.length === 0) {
    manual.push({
      kind: '数据下钻失败',
      detail: `短名单 ${shortlist.length} 条，取前 ${cards.length} 条下钻全部失败（`
        + failedCards.map((c) => c.accession + ': ' + (c.error || '未知')).join('; ')
        + '）。要素卡为空，L2 与 L4 结论不成立，请勿据此立项。',
      field: 'series_matrix',
    });
  }
  const result = {
    l0: {
      verdict: edge ? '边缘（待人工裁定）' : '纳入',
      basis: edge || '未触及肿瘤与免疫排除清单',
      first_gate: '词面快筛未命中',
    },
    datasets: cards,
    // 没有任何一张卡算出 L2 时，课题清单置空而不是给九类空壳。
    topics: okCards.length === 0 ? [] : topics,
    topics_status: okCards.length === 0 ? 'insufficient_data' : 'ok',
    manual,
    trace,
  };

  const out = {
    ticket_id: ticket || ('TSV-RUN-' + startedAt.slice(0, 10).replace(/-/g, '')),
    kind: 'topic_survey_request',
    schema_version: 1,
    created_at: startedAt,
    finished_at: new Date().toISOString(),
    request: { disease, interest: '', organism: 'any', tissue: '', data_kinds: kinds, clue: '' },
    status: 'completed',
    result,
  };

  const dir = path.join(__dirname, 'runs');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, disease.replace(/[^A-Za-z0-9]+/g, '_') + '_' + startedAt.slice(0, 10) + '.json');
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    ticket: out.ticket_id, disease, l0: result.l0.verdict,
    total_count: count, shortlist: trace.shortlist.length, cards: cards.length,
    topics: topics.map(t => t.id + (t.recommended ? '*' : '')).join(' '),
    manual: manual.length, saved: f,
  }, null, 2));
}

main().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
