/**
 * ppi_string 离线化测试（P12 切片）
 *
 * 覆盖点与理由：
 *   1. 离线优先：K40 上 STRING API 偶发超时导致步骤失败，边表改由本机 v12.0 文件供给。
 *   2. 阈值与环境变量覆盖：BIO_STRING_MIN_SCORE 默认 400，必须能改且改后生效。
 *   3. .gz 与未压缩 .txt 双读法：运维手里两种形态都可能存在，按扩展名选读取方式。
 *   4. 映射缺失不静默：protein.info 查不到符号时保留 ENSP 原名并 warn，不许丢边。
 *   5. 两条路都失败必须给下载指引并 exit 1，不许静默降级成空边表。
 *   6. 输出列名与量纲必须与改动前一致（下游 key_genes 读 ppi_hubs.tsv 的 gene/degree）。
 *
 * 全程离线：所有子进程都带 HTTPS_PROXY/HTTP_PROXY=http://127.0.0.1:9（死端口），
 * 一旦脚本尝试联网就立刻失败。所以"离线路径能跑通"本身就是"没有触网"的证据。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'tools', 'bio', 'line1_bulk', 'scripts', 'ppi_string');
const SRC = fs.readFileSync(SCRIPT, 'utf8');

const DEAD_PROXY = 'http://127.0.0.1:9';

/** 定位 bash：还要求该 bash 里的 python3 带 pandas + matplotlib，否则真跑没意义。 */
function findBash() {
  const cands = [process.env.PPI_TEST_BASH, 'D:\\Git\\bin\\bash.exe', 'D:\\Git\\usr\\bin\\bash.exe', 'bash'];
  for (const cand of cands) {
    if (!cand) continue;
    const res = spawnSync(cand, ['-c', 'python3 -c "import pandas, matplotlib"'], { encoding: 'utf8' });
    if (!res.error && res.status === 0) return cand;
  }
  return null;
}
const BASH = findBash();
const NEED = BASH === null ? 'HOST_MISSING_BASH: 宿主无 bash 或 python3 缺 pandas/matplotlib' : false;

// --- fixture：1 个低分边、1 组反向重复边、1 个 info 表里查不到的 ENSP、2 条查询集外的边 ---
const LINKS_HEADER = 'protein1 protein2 combined_score';
const LINKS_ROWS = [
  '9606.ENSP00000000001 9606.ENSP00000000002 900',
  '9606.ENSP00000000002 9606.ENSP00000000001 900',
  '9606.ENSP00000000001 9606.ENSP00000000003 350',
  '9606.ENSP00000000003 9606.ENSP00000000004 800',
  '9606.ENSP00000000005 9606.ENSP00000000006 700',
  '9606.ENSP00000000002 9606.ENSP00000000004 450',
  '9606.ENSP00000000001 9606.ENSP00000000009 860',
];
const INFO_HEADER = '#string_protein_id\tpreferred_name\tprotein_size\tannotation';
import { TEST_TMP } from './support/test_tmp.js';
const INFO_ROWS = [
  '9606.ENSP00000000001\tTP53\t393\tNA',
  '9606.ENSP00000000002\tEGFR\t1210\tNA',
  '9606.ENSP00000000003\tMYC\t439\tNA',
  '9606.ENSP00000000004\tBRCA1\t1863\tNA',
  '9606.ENSP00000000005\tACTB\t375\tNA',
  '9606.ENSP00000000006\tGAPDH\t335\tNA',
];

// 期望产物（combined_score 统一 0..1 浮点，按分数降序再按基因名升序，可复现）
const EXPECTED_EDGES = [
  'gene_a\tgene_b\tcombined_score',
  'EGFR\tTP53\t0.9',
  'ENSP00000000009\tTP53\t0.86',
  'BRCA1\tMYC\t0.8',
  'BRCA1\tEGFR\t0.45',
  '',
].join('\n');
const EXPECTED_HUBS = [
  'gene\tdegree',
  'BRCA1\t2',
  'EGFR\t2',
  'TP53\t2',
  'ENSP00000000009\t1',
  'MYC\t1',
  '',
].join('\n');

function writeMaybeGz(file, text) {
  const buf = Buffer.from(text, 'utf8');
  if (file.endsWith('.gz')) fs.writeFileSync(file, zlib.gzipSync(buf));
  else fs.writeFileSync(file, buf);
}

function readIf(dir, name) {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}

/**
 * 造一棵最小项目树：processed（步骤 cwd，含 WGCNA 输入）+ figures（图件落点）+ stringdb（离线数据）。
 * ENSP00000000009 直接以 ENSP 形式出现在 wgcna_modules 里，用来触发"符号映射缺失"分支。
 */
function buildTree(opts) {
  const o = opts || {};
  const root = fs.mkdtempSync(path.join(TEST_TMP, 'ppi12-'));
  const processed = path.join(root, 'processed');
  const figures = path.join(root, 'figures');
  const stringdb = path.join(root, 'stringdb');
  for (const d of [processed, figures, stringdb]) fs.mkdirSync(d, { recursive: true });

  const genes = o.genes || ['TP53', 'EGFR', 'MYC', 'BRCA1', 'ENSP00000000009'];
  const modLines = ['gene\tmodule'];
  genes.forEach((g, i) => modLines.push(g + '\t' + (i === 3 ? 'turquoise' : 'tan')));
  fs.writeFileSync(path.join(processed, 'wgcna_modules.tsv'), modLines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(processed, 'wgcna_module_trait.tsv'),
    'module\tsignificant\ntan\t1\nturquoise\t1\nblue\t0\n', 'utf8');

  const linksPath = path.join(stringdb, '9606.protein.links.v12.0' + (o.linksExt || '.txt.gz'));
  const infoPath = path.join(stringdb, '9606.protein.info.v12.0' + (o.infoExt || '.txt.gz'));
  if (!o.skipLinks) writeMaybeGz(linksPath, [LINKS_HEADER].concat(LINKS_ROWS).join('\n') + '\n');
  if (!o.skipInfo) writeMaybeGz(infoPath, [INFO_HEADER].concat(INFO_ROWS).join('\n') + '\n');
  return { root, processed, figures, stringdb, linksPath, infoPath };
}

/** 跑真脚本：cwd=processed，输入走 --input，其余全走环境变量；代理指死端口保证离线。 */
function runStep(tree, env) {
  const childEnv = Object.assign({}, process.env, {
    BIOANALYS_SEED: '20261013',
    HTTPS_PROXY: DEAD_PROXY,
    HTTP_PROXY: DEAD_PROXY,
    NO_PROXY: '',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  });
  for (const k of ['BIO_STRING_LINKS', 'BIO_STRING_INFO', 'BIO_STRING_MIN_SCORE']) delete childEnv[k];
  Object.assign(childEnv, env || {});
  const res = spawnSync(BASH, [SCRIPT,
    '--input', 'wgcna_modules.tsv',
    '--input', 'wgcna_module_trait.tsv',
  ], { cwd: tree.processed, encoding: 'utf8', env: childEnv, timeout: 180000 });
  return {
    code: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    dir: tree.processed,
    edges: readIf(tree.processed, 'ppi_edges.tsv'),
    hubs: readIf(tree.processed, 'ppi_hubs.tsv'),
    report: readIf(tree.processed, 'ppi_report.txt'),
  };
}

/** 同一场景只真跑一次，多个断言共享同一次运行结果。 */
const CACHE = new Map();
function scenario(key, build) {
  if (!CACHE.has(key)) CACHE.set(key, build());
  return CACHE.get(key);
}
function gzScenario() {
  return scenario('gz', () => {
    const tree = buildTree({});
    return runStep(tree, { BIO_STRING_LINKS: tree.linksPath, BIO_STRING_INFO: tree.infoPath });
  });
}

test('静态：shebang、set -euo pipefail、LF 换行、无 em dash', () => {
  assert.ok(SRC.startsWith('#!/usr/bin/env bash\n'), 'shebang 必须在第一行');
  assert.match(SRC, /^set -euo pipefail$/m, '必须严格模式');
  assert.equal(SRC.includes('\r'), false, '分析脚本必须 LF，不许 CRLF');
  assert.equal(SRC.includes(String.fromCharCode(0x2014)), false, '不许出现 em dash');
});

test('静态：先解析离线文件，网络回落只此一处', () => {
  const iResolve = SRC.indexOf('links_file = resolve_offline(links_target)');
  const iApi = SRC.indexOf('edges_out, err = fetch_api_edges(genes, MIN_SCORE)');
  assert.ok(iResolve > 0, '必须存在离线解析锚点');
  assert.ok(iApi > 0, '必须存在网络回落锚点');
  assert.ok(iResolve < iApi, '离线解析必须在网络回落之前');
  assert.equal((SRC.match(/fetch_api_edges/g) || []).length, 2, 'fetch_api_edges 只能定义 1 处 + 调用 1 处');
  assert.equal((SRC.match(/urlopen/g) || []).length, 1, '联网只允许在 fetch_api_edges 里出现一次');
  assert.ok(SRC.includes('/mnt/ssd/bio_data/public_references/stringdb'), '默认目录必须是 public_references/stringdb');
  assert.ok(SRC.includes('9606.protein.links.v12.0.txt.gz'), '默认 links 文件名必须固定');
  assert.ok(SRC.includes('9606.protein.info.v12.0.txt.gz'), '默认 info 文件名必须固定');
  for (const name of ['BIO_STRING_LINKS', 'BIO_STRING_INFO', 'BIO_STRING_MIN_SCORE']) {
    assert.ok(SRC.includes(name), '必须支持环境变量 ' + name);
  }
});

test('静态：下载指引给出 v12.0 两个 URL 与目标路径，并以 1 退出', () => {
  assert.ok(SRC.includes('https://stringdb-downloads.org/download/protein.links.v12.0/9606.protein.links.v12.0.txt.gz'));
  assert.ok(SRC.includes('https://stringdb-downloads.org/download/protein.info.v12.0/9606.protein.info.v12.0.txt.gz'));
  assert.ok(SRC.includes('links 目标') && SRC.includes('info  目标'), '指引必须写明应放置的目标路径');
  assert.match(SRC, /sys\.exit\(1\)/, '失败必须非零退出');
});

test('静态：links 按行流式读，只取前 3 列（不整表读入内存）', () => {
  const body = SRC.slice(SRC.indexOf('def scan_links'), SRC.indexOf('def edges_to_table'));
  assert.ok(body.length > 0, '必须能切出 scan_links 函数体');
  assert.match(body, /for line in fh/, '必须逐行迭代');
  assert.equal(body.includes('readlines'), false, '不许 readlines 整表');
  assert.equal(/\.read\(\)/.test(body), false, '不许 .read() 整表');
  assert.ok(body.includes('split(None, 3)[:3]'), '每行只保留前 3 列');
  assert.match(body, /score < min_score/, '必须先按阈值过滤再落字典');
});

test('bash -n 语法检查通过', { skip: NEED }, () => {
  const res = spawnSync(BASH, ['-n', SCRIPT], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
});

test('真跑：gz 离线文件出边表（阈值过滤 + 去重 + 符号映射 + 不触网）', { skip: NEED }, () => {
  const out = gzScenario();
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.edges, EXPECTED_EDGES);
  assert.equal(out.hubs, EXPECTED_HUBS);
  assert.match(out.report, /source=offline:9606\.protein\.links\.v12\.0\.txt\.gz/);
  assert.match(out.stdout, /offline_scan rows=7 low_score=1 dup=1 self=0 kept=4/);
});

test('真跑：只有未压缩 .txt 时按扩展名走纯文本读法', { skip: NEED }, () => {
  const out = scenario('txt', () => {
    const tree = buildTree({ linksExt: '.txt', infoExt: '.txt' });
    // 故意把环境变量指向不存在的 .gz，验证 .txt 同名文件能被兜住
    return runStep(tree, {
      BIO_STRING_LINKS: path.join(tree.stringdb, '9606.protein.links.v12.0.txt.gz'),
      BIO_STRING_INFO: path.join(tree.stringdb, '9606.protein.info.v12.0.txt.gz'),
    });
  });
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.edges, EXPECTED_EDGES);
  assert.match(out.stdout, /offline_source links=\S+\.txt info=/);
});

test('真跑：BIO_STRING_MIN_SCORE 覆盖默认阈值 400', { skip: NEED }, () => {
  const dflt = gzScenario();
  assert.equal(dflt.edges.includes('0.35'), false, '默认 400 必须把 350 分的边挡掉');
  const low = scenario('min300', () => {
    const tree = buildTree({});
    return runStep(tree, {
      BIO_STRING_LINKS: tree.linksPath,
      BIO_STRING_INFO: tree.infoPath,
      BIO_STRING_MIN_SCORE: '300',
    });
  });
  assert.equal(low.code, 0, low.stderr);
  assert.ok(low.edges.includes('MYC\tTP53\t0.35'), '阈值 300 时 350 分的边必须进来');
  assert.match(low.stdout, /low_score=0/);
  assert.equal(low.hubs.split('\n')[1], 'TP53\t3', 'TP53 的 degree 应变为 3');
});

test('真跑：protein.info 缺符号时保留 ENSP 原名并 warn，不静默丢边', { skip: NEED }, () => {
  const out = gzScenario();
  assert.ok(out.edges.includes('ENSP00000000009\tTP53\t0.86'), '缺映射的边必须保留');
  assert.match(out.stderr, /warn/, '必须打 warn');
  assert.match(out.stderr, /ENSP00000000009/, 'warn 必须指名缺映射的 ENSP');
  assert.match(out.stderr, /protein\.info/, 'warn 必须指明是哪张表缺');
});

test('真跑：输出列名与 combined_score 量纲与改动前一致', { skip: NEED }, () => {
  const out = gzScenario();
  const lines = out.edges.trim().split('\n');
  assert.equal(lines[0], 'gene_a\tgene_b\tcombined_score');
  const scores = lines.slice(1).map((ln) => Number(ln.split('\t')[2]));
  assert.deepEqual(scores, [0.9, 0.86, 0.8, 0.45]);
  for (const s of scores) assert.ok(s > 0 && s <= 1, 'combined_score 必须是 0..1 浮点，实际 ' + s);
  assert.equal(out.hubs.trim().split('\n')[0], 'gene\tdegree');
});

test('真跑：hub 表 degree 与边表逐行对账', { skip: NEED }, () => {
  const out = gzScenario();
  const deg = new Map();
  for (const ln of out.edges.trim().split('\n').slice(1)) {
    const parts = ln.split('\t');
    deg.set(parts[0], (deg.get(parts[0]) || 0) + 1);
    deg.set(parts[1], (deg.get(parts[1]) || 0) + 1);
  }
  const rows = out.hubs.trim().split('\n').slice(1);
  assert.equal(rows.length, deg.size, 'hub 表基因数必须等于边表节点数');
  for (const ln of rows) {
    const parts = ln.split('\t');
    assert.equal(Number(parts[1]), deg.get(parts[0]), parts[0] + ' 的 degree 与边表不一致');
  }
});

test('真跑：离线文件完全不存在且网络不可用 → exit 1 + 下载指引 + 不落半成品', { skip: NEED }, () => {
  const out = scenario('bothfail', () => {
    const tree = buildTree({ skipLinks: true, skipInfo: true });
    return runStep(tree, {});
  });
  assert.equal(out.code, 1, '两条路都失败必须 exit 1');
  assert.match(out.stderr, /https:\/\/stringdb-downloads\.org\/download\/protein\.links\.v12\.0\/9606\.protein\.links\.v12\.0\.txt\.gz/);
  assert.match(out.stderr, /https:\/\/stringdb-downloads\.org\/download\/protein\.info\.v12\.0\/9606\.protein\.info\.v12\.0\.txt\.gz/);
  assert.ok(out.stderr.includes('/mnt/ssd/bio_data/public_references/stringdb/9606.protein.links.v12.0.txt.gz'));
  assert.ok(out.stderr.includes('/mnt/ssd/bio_data/public_references/stringdb/9606.protein.info.v12.0.txt.gz'));
  assert.equal(out.edges, null, '失败时不许留下半成品边表');
  assert.equal(out.hubs, null, '失败时不许留下半成品 hub 表');
});

test('真跑：只有 links 没有 info → 不回落网络，exit 1 且指名缺 info', { skip: NEED }, () => {
  const out = scenario('noinfo', () => {
    const tree = buildTree({ skipInfo: true });
    return runStep(tree, {
      BIO_STRING_LINKS: tree.linksPath,
      BIO_STRING_INFO: path.join(tree.stringdb, '9606.protein.info.v12.0.txt.gz'),
    });
  });
  assert.equal(out.code, 1);
  assert.match(out.stderr, /离线数据不完整/);
  assert.match(out.stderr, /protein\.info/);
  assert.equal(out.edges, null);
});

/** 下载中断场景：.gz 只写到一半（缺 end-of-stream 标记），解析必须折成可执行的修复指引。 */
function truncatedScenario() {
  return scenario('truncated', () => {
    // BASH 缺失时提前返回可断言的形状，而不是 spawnSync(null) 直接抛 TypeError。
    // 静态守卫测试已经覆盖脚本源码口径；真跑用例另加 { skip: NEED } 守卫。
    if (!BASH) {
      return { code: null, stdout: '', stderr: 'host has no bash', dir: '', edges: null, hubs: null, report: null };
    }
    const tree = buildTree({});
    // 先造一份足够长的边表，再截断到 55%：保证截断点落在流中间而不是尾部对齐处。
    const rows = [LINKS_HEADER];
    for (let i = 0; i < 4000; i += 1) {
      const a = '9606.ENSP' + String(i % 50).padStart(11, '0');
      const b = '9606.ENSP' + String((i + 7) % 50).padStart(11, '0');
      rows.push(a + ' ' + b + ' ' + (500 + (i % 400)));
    }
    const full = zlib.gzipSync(Buffer.from(rows.join('\n') + '\n', 'utf8'));
    fs.writeFileSync(tree.linksPath, full.subarray(0, Math.floor(full.length * 0.55)));
    return runStep(tree, { BIO_STRING_LINKS: tree.linksPath, BIO_STRING_INFO: tree.infoPath });
  });
}

test('静态：离线读失败必须折成修复指引，不许裸 traceback', () => {
  assert.ok(SRC.includes('READ_ERRORS = ('), '缺 READ_ERRORS 异常白名单');
  assert.ok(SRC.includes('def read_failure_msg('), '缺 read_failure_msg 说明生成器');
  assert.ok(SRC.includes('fail(read_failure_msg("protein.links"'), 'protein.links 读取未包 try');
  assert.ok(SRC.includes('fail(read_failure_msg("protein.info"'), 'protein.info 读取未包 try');
  assert.ok(/import zlib/.test(SRC), 'zlib.error 要在白名单里，必须 import zlib');
});

test('下载中断的残片 .gz：exit 1 且给 gzip -t 指引，不冒 traceback', { skip: NEED }, () => {
  const r = truncatedScenario();
  assert.equal(r.code, 1, '残片必须硬失败，不许静默出半套边表');
  assert.match(r.stderr, /离线 protein\.links 读取失败/, 'stderr 要点名是哪份离线文件');
  assert.match(r.stderr, /下载中断/, 'stderr 要指出最可能的原因');
  assert.match(r.stderr, /gzip -t/, 'stderr 要给可执行的验证命令');
  assert.equal(r.stderr.includes('Traceback'), false, '不许把 Python traceback 甩给运维');
  assert.equal(r.edges, null, '失败时不许留下 ppi_edges.tsv');
});
