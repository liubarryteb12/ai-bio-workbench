const https = require('https');
function gb(u) {
  return new Promise((res, rej) => {
    https.get(u, r => {
      const c = [];
      r.on('data', d => c.push(Buffer.from(d)));
      r.on('end', () => res(Buffer.concat(c)));
    }).on('error', rej);
  });
}
function dir(a) {
  const m = /^([A-Za-z]+)([0-9]+)$/.exec(a);
  const d = m[2];
  const h = d.length > 3 ? d.slice(0, -3) : d;
  return m[1] + h + 'nnn';
}
const accs = ['GSE262882', 'GSE272972', 'GSE275162', 'GSE351932'];
(async () => {
  for (const a of accs) {
    const u = 'https://ftp.ncbi.nlm.nih.gov/geo/series/' + dir(a) + '/' + a + '/matrix/' + a + '_series_matrix.txt.gz';
    try {
      const b = await gb(u);
      console.log(a + ' dir=' + dir(a) + ' bytes=' + b.length + ' magic=' + b.slice(0, 4).toString('hex'));
    } catch (e) { console.log(a + ' ERR ' + e.message); }
  }
})();