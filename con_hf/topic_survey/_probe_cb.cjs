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
const BASE = 'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE262nnn/GSE262882/matrix/GSE262882_series_matrix.txt.gz';
(async () => {
  const a = await gb(BASE);
  console.log('no-cb   bytes=' + a.length + ' magic=' + a.slice(0, 4).toString('hex'));
  const b = await gb(BASE + '?cb=1');
  console.log('with-cb bytes=' + b.length + ' magic=' + b.slice(0, 4).toString('hex'));
})();