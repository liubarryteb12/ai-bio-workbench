import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyDelivery } from '../../tools/reporting/ed25519_tools.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'ops', 'build_client_report.py');
const ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

function detectPython() {
  const candidates = ['python3', 'python'];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'import sys; print(sys.version_info[0])'], {
      encoding: 'utf8', env: ENV,
    });
    if (probe.status === 0 && probe.stdout.trim() === '3') return candidate;
  }
  return null;
}

const PY = detectPython();
const SKIP = PY ? false : 'HOST_MISSING_PYTHON: 没有可用的 python3/python';

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function extractTar(tarPath, targetDir) {
  const result = spawnSync(
    PY,
    [
      '-c',
      "import tarfile, sys; tarfile.open(sys.argv[1], 'r:gz').extractall(sys.argv[2], filter='data')",
      tarPath,
      targetDir,
    ],
    { encoding: 'utf8', env: ENV, timeout: 60000 },
  );
  assert.equal(result.status, 0, result.stderr);
  return targetDir;
}

function collectHtmlReferences(page) {
  const refs = [
    ...page.matchAll(/\s(?:src|href)\s*=\s*["']([^"']+)["']/gi),
  ].map((match) => match[1]);
  refs.push(...[...page.matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/gi)].map((m) => m[1]));
  return refs;
}

test('交付报告自检覆盖断网图廊、DEG 与 DR 区分、五维自检与台账摘要', { skip: SKIP }, () => {
  const result = spawnSync(PY, [SCRIPT, '--self-test'], { encoding: 'utf8', env: ENV, timeout: 120000 });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes('FAIL |'), result.stdout);
  assert.ok(result.stdout.includes('300 DPI 图廊已内联'));
  assert.ok(result.stdout.includes('DEG 与 DR 标记强区分'));
  assert.ok(result.stdout.includes('五维自检与台账摘要已渲染'));
});

test('临时项目交付包包含适配代码、对账报告、公钥与二进制图件', { skip: SKIP }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-delivery-'));
  const projectId = 'PRJ_REAL_TAR';
  const projectDir = path.join(root, projectId);
  fs.mkdirSync(path.join(projectDir, 'line1_bulk', 'figures', 'adapt'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'line1_bulk', 'results'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
    project_id: projectId,
    basic_info: { name: 'real package case' },
    pipeline_dag: [{ order: 1, stepId: 'deg_limma' }],
  }), 'utf8');

  const masterSha = 'a'.repeat(64);
  fs.writeFileSync(path.join(projectDir, 'line1_bulk', 'figures', 'adapt', 'adapt_fig_l2_volcano.R'), [
    `# Master-Source: reference/05.figures/fig_l2_volcano.R | Master-SHA256: ${masterSha}`,
    '# Adapted-Project: PRJ_REAL_TAR',
    "adapt_vars <- list(input_data = 'data/line1_bulk/results/de.tsv')",
  ].join('\n') + '\n', 'utf8');

  const table = 'gene\tlogFC\tadj.P.Val\nTNF\t2.5\t0.01\n';
  fs.writeFileSync(path.join(projectDir, 'line1_bulk', 'results', 'deg_sig.tsv'), table, 'utf8');
  const pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0xff, 0x00, 0x80, 0xfe,
  ]);
  fs.writeFileSync(path.join(projectDir, 'line1_bulk', 'figures', 'binary.png'), pngBytes);

  const keys = crypto.generateKeyPairSync('ed25519');
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const result = spawnSync(PY, [SCRIPT, '--project', projectDir], {
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...ENV,
      BIO_ED25519_PRIVATE_KEY: privateKey,
      BIO_ED25519_PUBLIC_KEY: publicKey,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const tarPath = path.join(projectDir, 'deliverables', `${projectId}_Client_Delivery.tar.gz`);
  assert.ok(fs.statSync(tarPath).size > 0, 'tar.gz must exist');
  const sidecar = fs.readFileSync(`${tarPath}.sha256`, 'utf8');
  assert.match(sidecar, new RegExp(`^${sha256Bytes(fs.readFileSync(tarPath))}  `));
  const extracted = extractTar(tarPath, path.join(root, 'extracted'));
  const deliveryDir = path.join(extracted, `${projectId}_Client_Delivery`);
  const adaptedCode = path.join(deliveryDir, '01_Adapted_Code');
  const publicPath = path.join(deliveryDir, 'ED25519_PUBLIC_KEY.pem');
  const checksumsPath = path.join(deliveryDir, 'CHECKSUMS.sha256');
  const signaturePath = path.join(deliveryDir, 'CHECKSUMS.sig');
  assert.ok(fs.existsSync(path.join(adaptedCode, 'figures', 'adapt', 'adapt_fig_l2_volcano.R')));
  assert.ok(fs.existsSync(path.join(adaptedCode, '_report.txt')));
  assert.equal(fs.readFileSync(publicPath, 'utf8'), publicKey);
  assert.ok(fs.statSync(signaturePath).size === 64);

  const checksums = fs.readFileSync(checksumsPath, 'utf8');
  const pngRel = '02_Figures_and_Tables/figures/line1_bulk/binary.png';
  assert.match(checksums, new RegExp(`${sha256Bytes(pngBytes)}  ${pngRel.replace(/\./g, '\\.')}`));
  assert.deepEqual(
    fs.readFileSync(path.join(deliveryDir, pngRel)),
    pngBytes,
    'PNG must survive packaging without UTF-8 coercion',
  );

  const report = fs.readFileSync(path.join(adaptedCode, '_report.txt'), 'utf8');
  assert.match(report, /Master-Source: reference\/05\.figures\/fig_l2_volcano\.R/);
  assert.match(report, new RegExp(`Master-SHA256: ${masterSha}`));
  assert.match(report, /Delivered-SHA256: [0-9a-f]{64}/);

  const html = fs.readFileSync(
    path.join(deliveryDir, '03_Interpretation_Report', 'Analysis_Report.html'),
    'utf8',
  );
  const refs = collectHtmlReferences(html);
  assert.ok(refs.some((ref) => ref.startsWith('#')), 'HTML anchors were not collected');
  assert.ok(refs.some((ref) => ref.startsWith('data:image/png;base64,')), 'binary PNG was not inlined');
  assert.ok(refs.every((ref) => ref.startsWith('#') || ref.startsWith('data:')), refs.join(', '));

  assert.equal(verifyDelivery(deliveryDir, { publicKey }).ok, true);
  fs.appendFileSync(path.join(deliveryDir, '03_Interpretation_Report', 'Analysis_Report.md'), 'tampered\n');
  assert.equal(verifyDelivery(deliveryDir, { publicKey }).ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('local_projects 新目录布局会把 data 与 figures 纳入交付包', { skip: SKIP }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-delivery-layout-'));
  const projectId = 'PRJ_LOCAL_LAYOUT';
  const projectDir = path.join(root, projectId);
  fs.mkdirSync(path.join(projectDir, 'data', 'line1_bulk', 'processed'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'figures', 'line1_bulk'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'figures', 'adapt'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
    project_id: projectId,
    basic_info: { name: 'local layout' },
    pipeline_dag: [{ order: 1, stepId: 'deg_limma' }],
  }), 'utf8');
  fs.writeFileSync(
    path.join(projectDir, 'data', 'line1_bulk', 'processed', 'deg_sig.tsv'),
    'gene\tlogFC\tadj.P.Val\nTNF\t2\t0.01\n',
    'utf8',
  );
  fs.writeFileSync(path.join(projectDir, 'figures', 'line1_bulk', 'real.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  fs.writeFileSync(path.join(projectDir, 'figures', 'adapt', 'adapted.R'),
    '# Master-Source: reference/mock.R | Master-SHA256: ' + 'b'.repeat(64) + '\n', 'utf8');
  fs.writeFileSync(path.join(projectDir, 'figures', 'adapt', 'manifest.json'),
    '{"adapted":true}\n', 'utf8');

  const keys = crypto.generateKeyPairSync('ed25519');
  const result = spawnSync(PY, [SCRIPT, '--project', projectDir], {
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...ENV,
      BIO_ED25519_PRIVATE_KEY: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      BIO_ED25519_PUBLIC_KEY: keys.publicKey.export({ type: 'spki', format: 'pem' }),
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const tarPath = path.join(projectDir, 'deliverables', `${projectId}_Client_Delivery.tar.gz`);
  const extracted = extractTar(tarPath, path.join(root, 'extracted'));
  const deliveryDir = path.join(extracted, `${projectId}_Client_Delivery`);
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(deliveryDir);
  assert.ok(files.some((file) => file.endsWith('real.png')));
  assert.ok(files.some((file) => file.endsWith('deg_sig.tsv')));
  assert.ok(files.some((file) => file.endsWith(path.join('figures', 'adapt', 'adapted.R'))));
  assert.ok(!files.some((file) => file.endsWith(path.join('figures', 'adapt', 'manifest.json'))));
  fs.rmSync(root, { recursive: true, force: true });
});
