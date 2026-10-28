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
gb('https://ftp.ncbi.nlm.nih.gov/geo/series/GSE262nnn/GSE262882/matrix/GSE262882_series_matrix.txt.gz')
  .then(b => {
    console.log('len=' + b.length);
    console.log(b.toString('utf8').slice(0, 700));
  });