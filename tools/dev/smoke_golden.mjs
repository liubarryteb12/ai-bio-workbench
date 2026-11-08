#!/usr/bin/env node
/**
 * smoke_golden.mjs — 三线黄金数据集真机冒烟（2026-11-02，技术债 5.5 第三层）
 *
 * 设计裁定（4 Argon 第五轮 + 本机实测修正）：
 *   1. 执行通道走 run_throttled_task.sh + BIO_LOCK_NAMESPACE=smoke：
 *      冒烟测生产包装器真链路（env 注入/bridge 门禁/降权/PGID 清理），
 *      锁命名空间与热冷却跳过保证不撞生产队列。绝不直连 ssh 跑裸命令。
 *   2. 栈对齐生产：容器无 DESeq2/edgeR/squidpy（实测报 could not find function /
 *      ModuleNotFoundError），line1 用纯 limma（对齐 deg_limma），line3 用
 *      scanpy + cKDTree + 手写 Moran（对齐 spatial_domains）。
 *   3. 方向性锚点而非浮点相等：断言 GENE_UP_1 logFC>1.5 且 adj.P<0.05 这类
 *      方向/显著性布尔，防 BLAS 尾数微漂跨平台假红。
 *   4. 混合产物模式：图件在容器校验魔数+尺寸后即焚；1KB 结构化摘要
 *      拉回 tests/fixtures/golden/expected/ 进 Git 做形状基线比对。
 *   5. 包装器把执行体输出重定向进 system_logs/<task_id>.log，ssh 通道只剩
 *      wrapper 状态行，所以任务 id 由本脚本生成并在结束后 cat 日志回收断言。
 *
 * 用法：node tools/dev/smoke_golden.mjs            跑三线冒烟 + 比对 expected
 *       node tools/dev/smoke_golden.mjs --bless    跑通后把本次摘要写为 expected 基线
 * 前置：K40 链路在位，golden fixtures 已入库。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GOLDEN = path.join(REPO, 'tests', 'fixtures', 'golden');
const EXPECTED = path.join(GOLDEN, 'expected');
const REMOTE_BASE = '/mnt/ssd/bio_data/system_logs/_smoke';
const WRAPPER = '/mnt/ssd/bio_data/ops/run_throttled_task.sh';
const RBIN = '/mnt/ssd/bio_data/ops/layout_autoload/bin';

function ssh(target, cmd, timeoutMs = 300000) {
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', target, cmd],
    { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw new Error('ssh 失败: ' + r.error.message);
  return r;
}

/**
 * 把本地文件推到容器（stdin 管道）。文本资产推送前剥 \r：
 * Windows 侧 checkout/编辑混入 CRLF 会让远端 bash 报 "$'\r'"——本轮调试反复踩实。
 */
function push(localPath, remotePath) {
  let data = fs.readFileSync(localPath);
  if (/\.(csv|tsv|sh|R|r|py|mjs|js|json|md)$/i.test(localPath)) {
    data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n'), 'utf8');
  }
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', 'k40-ubuntu', 'cat > ' + remotePath],
    { input: data, timeout: 120000 });
  if (r.status !== 0) throw new Error('推送失败 ' + remotePath);
}

/** 经包装器（smoke 命名空间）跑一条远端命令，从任务日志回收执行体输出 */
function viaWrapper(lineId, stepName, execCmd, gateScript) {
  const taskId = 'smoke_' + Date.now() + '_' + stepName;
  const logPath = '/mnt/ssd/bio_data/system_logs/' + taskId + '.log';
  const cmd = [
    'export BIO_LOCK_NAMESPACE=smoke',
    'export BIO_EXEC_CMD=' + JSON.stringify(execCmd),
    'export BIO_WRAPPER_LEDGER=0',
    'bash ' + WRAPPER + ' ' + taskId + ' ' + lineId + ' ' + stepName + ' self ' + JSON.stringify(gateScript),
    'echo __WRAPPER_RC=$?',
    'echo __SMOKE_LOG_BEGIN__',
    'cat ' + logPath + ' 2>/dev/null || echo __NO_LOG__',
    'echo __SMOKE_LOG_END__',
    'rm -f ' + logPath,
  ].join('; ');
  const r = ssh('k40-ubuntu', cmd, 600000);
  const all = (r.stdout || '') + (r.stderr || '');
  const m = all.match(/__SMOKE_LOG_BEGIN__\n?([\s\S]*?)__SMOKE_LOG_END__/);
  const body = m ? m[1] : '';
  const rc = Number((all.match(/__WRAPPER_RC=(-?\d+)/) || [])[1] ?? r.status);
  return { code: rc, out: body, raw: all };
}

/**
 * 把 R/Python 脚本 base64 后经 stdin 送入解释器执行（经包装器 smoke 命名空间）。
 *
 * 为什么不用 -e 内联（2026-11-02 实测踩坑）：BIO_EXEC_CMD 要过 ssh 登录 shell 与
 * bash -c 两层双引号展开，R 代码里的 md$group 会被展开成空串，lmFit 拿到长度 1 的
 * 因子报「row dimension of design doesn't match」。base64 载荷只含 [A-Za-z0-9+/=]，
 * 对任何层引号都惰性，与生产 task.js 的 shellQuote 属同一防线的不同实现。
 */
function execScript(lineId, stepName, interp, scriptText, gateScript) {
  const b64 = Buffer.from(scriptText.replace(/\r\n/g, '\n'), 'utf8').toString('base64');
  const execCmd = 'printf %s ' + JSON.stringify(b64) + ' | base64 -d | ' + RBIN + '/' + interp;
  return viaWrapper(lineId, stepName, execCmd, gateScript);
}
// ── Line1：纯 limma（对齐生产 deg_limma；容器无 DESeq2/edgeR）──
function smokeLine1() {
  const base = REMOTE_BASE + '/line1';
  ssh('k40-ubuntu', 'mkdir -p ' + base);
  push(path.join(GOLDEN, 'line1_bulk', 'counts.csv'), base + '/counts.csv');
  push(path.join(GOLDEN, 'line1_bulk', 'metadata.csv'), base + '/metadata.csv');
  const rScript = [
    'suppressMessages(library(limma))',
    'cts <- as.matrix(read.csv("' + base + '/counts.csv", row.names=1))',
    'md <- read.csv("' + base + '/metadata.csv", stringsAsFactors=FALSE)',
    'grp <- factor(ifelse(md$group=="Case","Case","Ctrl"), levels=c("Ctrl","Case"))',
    'lib <- colSums(cts); cpm_mat <- sweep(cts, 2, lib, "/") * 1e6',
    'keep <- rowSums(cpm_mat > 1) >= 3; cpm_mat <- cpm_mat[keep,]',
    'lg <- log2(cpm_mat + 1)',
    'des <- model.matrix(~grp)',
    'fit <- eBayes(lmFit(lg, des), trend=TRUE)',
    'tt <- topTable(fit, coef="grpCase", number=Inf, sort.by="P")',
    'write.csv(tt, "' + base + '/de.csv")',
    'u <- tt["GENE_UP_1",]; d <- tt["GENE_DOWN_1",]',
    'cat("ANCHOR_UP|", u$logFC > 1.5, "|", u$adj.P.Val < 0.05, "\\n")',
    'cat("ANCHOR_DOWN|", d$logFC < -1.5, "|", d$adj.P.Val < 0.05, "\\n")',
    'cat("SHAPE|", nrow(tt), "|", paste(colnames(tt), collapse=","), "\\n")',
    'pdf("' + base + '/volcano.pdf"); plot(tt$logFC, -log10(tt$adj.P.Val), main="golden"); dev.off()',
    'cat("FIG|volcano.pdf|", file.size("' + base + '/volcano.pdf"), "\\n")',
  ].join('\n');
  const w = execScript('line1_bulk', 'smoke_deg', 'Rscript --vanilla -', rScript,
    '/mnt/ssd/bio_data/bin/line1_bulk/deg_limma');
  const out = w.out;
  const shape = (out.match(/SHAPE\| (\d+) \| ([^\r\n]+)/) || []).slice(1);
  const figSize = Number((out.match(/FIG\|volcano\.pdf\| (\d+)/) || [])[1] || 0);
  const magic = ssh('k40-ubuntu', 'head -c 4 ' + base + '/volcano.pdf').stdout.trim();
  ssh('k40-ubuntu', 'rm -f ' + base + '/volcano.pdf');
  return {
    exit0: w.code === 0,
    anchorUp: /ANCHOR_UP\| TRUE \| TRUE/.test(out),
    anchorDown: /ANCHOR_DOWN\| TRUE \| TRUE/.test(out),
    rows: shape[0] || null, columns: shape[1] || '',
    figure: { name: 'volcano.pdf', bytes: figSize, magicOk: magic.startsWith('%PDF') },
    raw: w.raw,
  };
}

// ── Line2：scanpy 最小闭环（容器已装 scanpy 1.12.4）──
function smokeLine2() {
  const base = REMOTE_BASE + '/line2';
  ssh('k40-ubuntu', 'mkdir -p ' + base);
  push(path.join(GOLDEN, 'line2_scrna', 'pbmc3k_toy.h5ad'), base + '/pbmc3k_toy.h5ad');
  const py = [
    'import scanpy as sc, numpy as np',
    'adata = sc.read_h5ad("' + base + '/pbmc3k_toy.h5ad")',
    'sc.pp.filter_cells(adata, min_genes=1)',
    'adata.layers["counts"] = adata.X.copy()',
    'sc.pp.normalize_total(adata, target_sum=1e4); sc.pp.log1p(adata)',
    'sc.pp.highly_variable_genes(adata, n_top_genes=100)',
    'adata.raw = adata',
    'sc.pp.pca(adata, n_comps=15)',
    'sc.pp.neighbors(adata, n_neighbors=10, n_pcs=15)',
    'sc.tl.leiden(adata, resolution=0.5, flavor="igraph", key_added="leiden")',
    'nc = adata.obs["leiden"].nunique()',
    'gs = list(adata.var_names).index("STAT3")',
    'm0 = float(np.asarray(adata[adata.obs.cluster=="0"].layers["counts"][:, gs]).mean())',
    'm1 = float(np.asarray(adata[adata.obs.cluster=="1"].layers["counts"][:, gs]).mean())',
    'print("SHAPE|", adata.shape[0], adata.shape[1])',
    'print("LEIDEN|", nc, nc >= 2)',
    'print("STAT3VAL|", round(m0,3), round(m1,3))',
    'print("ANCHOR_STAT3|", m0 > m1 * 2)',
  ].join('\n');
  const w = execScript('line2_scrna', 'smoke_scrna', 'python3 -', py,
    '/mnt/ssd/bio_data/bin/line2_scrna/integrate_harmony');
  const out = w.out;
  return {
    exit0: w.code === 0,
    shape: (out.match(/SHAPE\| (\d+) (\d+)/) || []).slice(1).map(Number),
    leidenClusters: Number((out.match(/LEIDEN\| (\d+)/) || [])[1] || 0),
    anchorStat3: /ANCHOR_STAT3\| True/.test(out),
    stat3Means: (out.match(/STAT3VAL\| ([-\d.]+) ([-\d.]+)/) || []).slice(1),
    raw: w.raw,
  };
}

// ── Line3：scanpy + cKDTree + 手写 Moran（容器无 squidpy，对齐 spatial_domains）──
function smokeLine3() {
  const base = REMOTE_BASE + '/line3';
  ssh('k40-ubuntu', 'mkdir -p ' + base);
  push(path.join(GOLDEN, 'line3_spatial', 'spatial_toy.h5ad'), base + '/spatial_toy.h5ad');
  const py = [
    'import scanpy as sc, anndata as ad, numpy as np, scipy.sparse as sp',
    'from scipy.spatial import cKDTree',
    'adata = ad.read_h5ad("' + base + '/spatial_toy.h5ad")',
    'coords = np.asarray(adata.obsm["spatial"], dtype=float)',
    'tree = cKDTree(coords); dists, idx = tree.query(coords, k=7)',
    'n = adata.n_obs',
    'rows = np.repeat(np.arange(n), 6); cols = idx[:,1:].ravel()',
    'W = sp.csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, n))',
    'W = W.maximum(W.T).astype(float)',
    'ga = adata.var_names.get_loc("SPATIAL_DOM_A_1")',
    'gb = adata.var_names.get_loc("SPATIAL_DOM_B_1")',
    'def moran1(v, Wm):',
    '    x = v - v.mean()',
    '    num = float(np.asarray(Wm.multiply(np.outer(x, x)).sum()).ravel()[0]); den = float((x**2).sum())',
    '    return (n / float(Wm.sum())) * (num / den)',
    'mA = moran1(np.asarray(adata.X[:, ga]).ravel(), W)',
    'sc.pp.neighbors(adata, n_neighbors=6, use_rep="X")',
    'sc.tl.leiden(adata, resolution=1.0, flavor="igraph", key_added="dom")',
    'left = coords[:,0] < 4',
    'a = np.asarray(adata.X[:, ga]).ravel(); b = np.asarray(adata.X[:, gb]).ravel()',
    'print("SHAPE|", adata.shape[0], adata.shape[1])',
    'print("MORAN|", mA, bool(mA > 0.2))',
    'print("ANCHOR_DOM|", bool(a[left].mean() > a[~left].mean() and b[~left].mean() > b[left].mean()))',
  ].join('\n');
  const w = execScript('line3_spatial', 'smoke_spatial', 'python3 -', py,
    '/mnt/ssd/bio_data/bin/line3_spatial/spatial_domains');
  const out = w.out;
  return {
    exit0: w.code === 0,
    shape: (out.match(/SHAPE\| (\d+) (\d+)/) || []).slice(1).map(Number),
    moranSignificant: /MORAN\| [-\d.e+]+ True/.test(out),
    anchorDomain: /ANCHOR_DOM\| True/.test(out),
    raw: w.raw,
  };
}

function main() {
  const bless = process.argv.includes('--bless');
  console.log('[smoke] Line1 limma 锚点…');
  const l1 = smokeLine1();
  console.log(JSON.stringify({ ...l1, raw: undefined }));
  if (!l1.exit0) console.log('L1_RAW:', String(l1.raw || '').slice(-400));
  console.log('[smoke] Line2 scanpy 闭环…');
  const l2 = smokeLine2();
  console.log(JSON.stringify({ ...l2, raw: undefined }));
  if (!l2.exit0) console.log('L2_RAW:', String(l2.raw || '').slice(-400));
  if (!l2.anchorStat3) console.log('L2_STAT3:', JSON.stringify(l2.stat3Means));
  console.log('[smoke] Line3 空间锚点…');
  const l3 = smokeLine3();
  console.log(JSON.stringify({ ...l3, raw: undefined }));
  if (!l3.exit0) console.log('L3_RAW:', String(l3.raw || '').slice(-400));

  const strip = (o) => { const { raw, ...rest } = o; return rest; };
  const summary = { line1: strip(l1), line2: strip(l2), line3: strip(l3) };
  const pass = l1.exit0 && l1.anchorUp && l1.anchorDown && l1.figure.magicOk && l1.figure.bytes > 400
    && l2.exit0 && l2.anchorStat3 && l2.leidenClusters >= 2
    && l3.exit0 && l3.moranSignificant && l3.anchorDomain;

  fs.mkdirSync(EXPECTED, { recursive: true });
  const expectedFile = path.join(EXPECTED, 'smoke_summary.json');
  if (bless) {
    if (!pass) { console.error('[smoke] 未通过，拒绝 bless 为基线'); return 1; }
    fs.writeFileSync(expectedFile, JSON.stringify(summary, null, 2) + '\n', 'utf8');
    console.log('[smoke] 已固化 expected/smoke_summary.json');
    return 0;
  }
  if (!fs.existsSync(expectedFile)) {
    console.error('[smoke] 缺 expected/smoke_summary.json，先跑 --bless');
    return 2;
  }
  const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
  const diffs = [];
  if (JSON.stringify(expected.line1.columns) !== JSON.stringify(l1.columns)) diffs.push('line1 列名漂移');
  if (!pass) diffs.push('本次断言未全过');
  if (diffs.length) { console.error('[smoke] 与基线不一致: ' + diffs.join('; ')); return 1; }
  console.log('[smoke] 三线冒烟通过，与 expected 基线一致');
  return 0;
}
process.exit(main());
