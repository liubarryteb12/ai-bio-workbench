// 模式 A 最小可行性验证：IPF 方向，从零跑完 L0 -> L1，产出要素卡。
// 数据源：NCBI E-utilities（esearch / esummary）+ GEO FTP（series_matrix）。
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');

function gb(u) {
  return new Promise((res, rej) => {
    https.get(u, r => {
      const c = [];
      r.on('data', d => c.push(Buffer.from(d)));
      r.on('end', () => res(Buffer.concat(c)));
    }).on('error', rej);
  });
}

// GEO series_matrix 的解析规则：同一字段名可能占多行，每行仍是「一行一样本列」。
// 因此 rows[key] 必须是二维数组，不能覆盖。这是本次验证抓到的第一个坑。
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

function clean(s) { return String(s == null ? '' : s).replace(/"/g, '').trim(); }

// characteristics 每个样本可能跨多行，每行一个 key: value。
function characteristicsOf(rows, idx) {
  const out = {};
  for (const line of rows.characteristics_ch1 || []) {
    const cell = clean(line[idx]);
    const m = /^([A-Za-z][A-Za-z0-9 _-]*):\s*(.+)$/.exec(cell);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function guessDataType(rows) {
  const src = clean(rows.library_source[0][0]).toLowerCase();
  if (src.includes('single cell')) return '单细胞';
  const title = clean(rows.title[0][0]).toLowerCase();
  if (title.includes('single cell') || title.includes('scrna')) return '单细胞';
  return 'bulk';
}

const ACC = 'GSE252465';
const FTP_URL = 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE252nnn/'
  + ACC + '/matrix/' + ACC + '_series_matrix.txt.gz';
const OUT = 'con_hf/2026-10-24_topic_survey_probe/' + ACC + '_series_matrix.txt.gz';

gb(FTP_URL)
  .then(b => {
    fs.writeFileSync(OUT, b);
    if (!(b[0] === 0x1f && b[1] === 0x8b)) throw new Error('非 gzip 响应，len=' + b.length);
    const rows = parseMatrix(zlib.gunzipSync(b).toString('utf8'));
    const n = rows.geo_accession[0].length;
    const groups = {};
    const tissues = {};
    const gsmGroups = [];
    for (let i = 0; i < n; i++) {
      const ch = characteristicsOf(rows, i);
      const dg = ch.disease || 'UNMAPPED';
      const tg = ch.tissue || 'UNMAPPED';
      groups[dg] = (groups[dg] || 0) + 1;
      tissues[tg] = (tissues[tg] || 0) + 1;
      gsmGroups.push(clean(rows.geo_accession[0][i]) + '=' + dg);
    }
    const card = {
      L0_disease: 'idiopathic pulmonary fibrosis',
      L0_verdict: '纳入（纤维化为主，非肿瘤非免疫）',
      L1_accession: ACC,
      L1_title: clean(rows.title[0][0]),
      L1_n_samples: n,
      L1_data_type: guessDataType(rows),
      L1_groups: groups,
      L1_tissues: tissues,
      L1_library_strategy: clean(rows.library_strategy[0][0]),
      L1_library_source: clean(rows.library_source[0][0]),
      L1_molecule: clean(rows.molecule_ch1[0][0]),
      L1_instrument: clean(rows.instrument_model[0][0]),
      L1_platform: clean(rows.platform_id[0][0]),
      L1_gsm_groups: gsmGroups,
    };
    console.log(JSON.stringify(card, null, 2));
    fs.writeFileSync('con_hf/2026-10-24_topic_survey_probe/' + ACC + '_card.json',
      JSON.stringify(card, null, 2));
  })
  .catch(e => { console.log('ERR ' + e.message); process.exit(1); });