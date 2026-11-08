const https = require('https');
const zlib = require('zlib');

function gb(u) {
  return new Promise((res, rej) => {
    https.get(u, r => {
      const c = [];
      r.on('data', d => c.push(Buffer.from(d)));
      r.on('end', () => res(Buffer.concat(c)));
    }).on('error', rej);
  });
}
function gjson(u) { return gb(u).then(b => JSON.parse(b.toString('utf8'))); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function esearch(term, retmax) {
  const u = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gds&term='
    + encodeURIComponent(term) + '&retmax=' + retmax + '&retmode=json&sort=relevance';
  const j = await gjson(u);
  return j.esearchresult;
}
async function esummary(ids) {
  const u = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=gds&id=' + ids + '&retmode=json';
  const j = await gjson(u);
  return j.result;
}
async function seriesMatrix(acc) {
  // NCBI FTP 静态文件经本地代理时，偶发返回非 gzip 的污染响应。
  // 判据是 magic 头 1f 8b，不符则带 cache-buster 重试，最多 3 次。
  const path = geoDir(acc) + '/matrix/' + acc + '_series_matrix.txt.gz';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const url = 'https://ftp.ncbi.nlm.nih.gov/geo/series/' + path
      + (attempt ? '?cb=' + attempt : '');
    const b = await gb(url);
    if (process.env.PROBE_DEBUG) {
      console.error('DEBUG url=' + url + ' bytes=' + b.length
        + ' magic=' + b.slice(0, 4).toString('hex'));
    }
    if (b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) {
      return zlib.gunzipSync(b).toString('utf8');
    }
  }
  throw new Error('series_matrix 响应异常：3 次重试均非 gzip');
}
function geoDir(acc) {
  const m = /^([A-Za-z]+)([0-9]+)$/.exec(acc);
  if (!m) throw new Error('bad accession ' + acc);
  // GEO 目录规则：编号去掉末 3 位后补 nnn。
  // GSE252465 -> GSE252nnn；GSE351932 -> GSE351nnn。
  // 误写成取末 3 位会拼出 GSE465nnn，服务器返回 XML 错误页（magic 3c3f786d）。
  const digits = m[2];
  const head = digits.length > 3 ? digits.slice(0, -3) : digits;
  return m[1] + head + 'nnn';
}

function parseMatrix(text) {
  const rows = {};
  for (const l of text.split('\n')) {
    if (!l.startsWith('!Sample_')) continue;
    const p = l.split('\t');
    rows[p[0].replace('!Sample_', '')] = p.slice(1);
  }
  return rows;
}

async function main() {
  const acc = process.argv[2] || 'GSE252465';
  const text = await seriesMatrix(acc);
  const rows = parseMatrix(text);
  const n = rows.geo_accession.length;
  const groups = {};
  const tissues = {};
  const gsmGroups = [];
  for (let i = 0; i < n; i++) {
    const c = rows.characteristics_ch1[i] || '';
    const dm = /disease:\s*([^,"]+)/.exec(c);
    const tm = /tissue:\s*([^,"]+)/.exec(c);
    const dg = dm ? dm[1].trim() : 'UNMAPPED';
    const tg = tm ? tm[1].trim() : 'UNMAPPED';
    groups[dg] = (groups[dg] || 0) + 1;
    tissues[tg] = (tissues[tg] || 0) + 1;
    gsmGroups.push(rows.geo_accession[i] + '=' + dg);
  }
  const out = {
    accession: acc,
    n_samples: n,
    groups: groups,
    tissues: tissues,
    library_strategy: rows.library_strategy[0],
    library_source: rows.library_source[0],
    molecule: rows.molecule_ch1[0],
    instrument: rows.instrument_model[0],
    platform: rows.platform_id[0],
    gsm_groups: gsmGroups,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
