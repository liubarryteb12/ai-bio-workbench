import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TEST_TMP } from './support/test_tmp.js';

// P14 契约在 line3 侧的真落地：spatial_knockout 必须真的读 BIO_KO_GENE。
// 背景：P14 在提交层给 virtual_knockout / spatial_knockout 加了 target_ko_gene
// 必填校验并注入 export BIO_KO_GENE=...，但 line3 母版原来把敲除基因硬编码成
// Spp1（不读环境变量），于是「必填校验」只是形式，用户填的基因根本不生效。
// 本测试分两半：静态断言解析顺序，真跑断言解析结果（把解析块整段抽出来执行）。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'src', 'line3_spatial', 'scripts', 'spatial_knockout');
const SOURCE = fs.readFileSync(SCRIPT, 'utf8');

const BLOCK_START = '# 敲除基因解析（顺序与 line2 步骤 9 同口径）';
const BLOCK_END = '\necho "step_executed=spatial_knockout"';

function findBash() {
  for (const cand of [process.env.BRIDGE_GUARD_BASH, 'D:\\Git\\bin\\bash.exe', 'D:\\Git\\usr\\bin\\bash.exe', 'bash']) {
    if (typeof cand !== 'string' || cand.length === 0) continue;
    const res = spawnSync(cand, ['-n', SCRIPT], { encoding: 'utf8' });
    if (!res.error && res.status === 0) return cand;
  }
  return null;
}
const BASH = findBash();
const NEED_BASH = BASH === null ? 'HOST_MISSING_BASH: 宿主无 bash 解释器' : false;

function findPython() {
  for (const cand of [process.env.BRIDGE_TEST_PYTHON, 'python', 'python3']) {
    if (!cand) continue;
    const res = spawnSync(cand, ['-c', 'import json'], { encoding: 'utf8' });
    if (!res.error && res.status === 0) return cand;
  }
  return null;
}
const PY = findPython();
const NEED_PY = PY === null ? 'HOST_MISSING_PYTHON: 宿主无 python 解释器' : false;

/** 抽出 bash 包装层的敲除基因解析块，末尾补一行回显，便于真跑观察解析结果。 */
function extractBlock() {
  const at = SOURCE.indexOf(BLOCK_START);
  assert.notEqual(at, -1, '找不到敲除基因解析块起点（注释被改动？）');
  const end = SOURCE.indexOf(BLOCK_END, at);
  assert.notEqual(end, -1, '找不到解析块终点');
  return SOURCE.slice(at, end) + '\nprintf \'%s|%s\\n\' "$ko_gene" "$ko_gene_source"\n';
}

function runBlock({ env = {}, prefix = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(TEST_TMP, 'ko-gene-'));
  const file = path.join(dir, 'block.sh');
  fs.writeFileSync(file, prefix + extractBlock(), 'utf8');
  const res = spawnSync(BASH, [file], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { res, out: (res.stdout || '').trim() };
}

test('脚本仍是 LF、无 em dash、shebang 与 set -euo pipefail 保留', () => {
  assert.equal(SOURCE.includes('\r\n'), false, '出现 CRLF（坑 #103）');
  assert.equal(SOURCE.includes('\u2014'), false, '出现 em dash');
  assert.ok(SOURCE.startsWith('#!/usr/bin/env bash\n'), 'shebang 被改动');
  assert.ok(SOURCE.includes('\nset -euo pipefail\n'), 'set -euo pipefail 被删除');
});

test('bash 包装层有 --ko-gene 参数位，且不再有硬编码 KO_GENE 常量', () => {
  assert.ok(SOURCE.includes('--ko-gene) ko_gene="$2"; shift 2 ;;'), '缺 --ko-gene 参数解析');
  assert.ok(SOURCE.includes('ko_gene=""'), '缺 ko_gene 初值');
  assert.equal(SOURCE.includes('KO_GENE = "Spp1"'), false, 'python 侧仍有硬编码 KO_GENE = "Spp1"');
  assert.ok(SOURCE.includes('KO_GENE = os.environ.get("KO_GENE", "").strip()'), 'python 侧未从环境变量读取');
});

test('解析顺序 = 参数 > BIO_KO_GENE > project.json > Spp1 兜底', () => {
  const cli = SOURCE.indexOf('ko_gene_source="cli:--ko-gene"');
  const envAt = SOURCE.indexOf('ko_gene_source="env:BIO_KO_GENE"');
  const metaAt = SOURCE.indexOf('ko_gene_source="project.json:');
  const fbAt = SOURCE.indexOf('ko_gene_source="fallback:Spp1"');
  for (const [name, at] of [['cli', cli], ['env', envAt], ['project.json', metaAt], ['fallback', fbAt]]) {
    assert.notEqual(at, -1, '缺 ' + name + ' 来源标记');
  }
  assert.ok(cli < envAt && envAt < metaAt && metaAt < fbAt, '解析优先级顺序被打乱');
  assert.ok(SOURCE.includes('if [ -z "${ko_gene:-}" ]; then'), '缺逐级兜底判断');
});

test('解析结果经环境变量注入 python，并落台账 ko_gene / ko_gene_source', () => {
  assert.ok(SOURCE.includes('export KO_GENE="$ko_gene"'), '未导出 KO_GENE');
  assert.ok(SOURCE.includes('export KO_GENE_SOURCE="$ko_gene_source"'), '未导出 KO_GENE_SOURCE');
  assert.ok(SOURCE.includes('echo "ko_gene=${ko_gene}"'), '未回显 ko_gene');
  assert.ok(SOURCE.includes('echo "ko_gene_source=${ko_gene_source}"'), '未回显 ko_gene_source');
  assert.ok(SOURCE.includes('KO_GENE_SOURCE = os.environ.get("KO_GENE_SOURCE"'), 'python 侧未读 KO_GENE_SOURCE');
});

test('python 侧敲除基因为空即 fail（不许静默回退）', () => {
  const at = SOURCE.indexOf('KO_GENE = os.environ.get("KO_GENE", "").strip()');
  const window = SOURCE.slice(at, at + 700);
  assert.ok(window.includes('if not KO_GENE:'), '缺空值判断');
  assert.ok(window.includes('敲除基因未注入'), '缺空值报错文案');
  assert.ok(window.includes('sys.exit(1)'), '空值未以非 0 退出');
});

test('真跑：BIO_KO_GENE 生效（env:BIO_KO_GENE）', { skip: NEED_BASH }, () => {
  const { res, out } = runBlock({ env: { BIO_KO_GENE: 'Gpx4', BIOANALYS_PROJECT_JSON: '' } });
  assert.equal(res.status, 0, '解析块执行失败: ' + (res.stderr || ''));
  assert.equal(out, 'Gpx4|env:BIO_KO_GENE');
});

test('真跑：无任何指定时兜底 Spp1（fallback:Spp1）', { skip: NEED_BASH }, () => {
  const { res, out } = runBlock({ env: { BIO_KO_GENE: '', BIOANALYS_PROJECT_JSON: '' } });
  assert.equal(res.status, 0, '解析块执行失败: ' + (res.stderr || ''));
  assert.equal(out, 'Spp1|fallback:Spp1');
});

test('真跑：BIO_KO_GENE 带空白会被裁剪', { skip: NEED_BASH }, () => {
  const { res, out } = runBlock({ env: { BIO_KO_GENE: '  Acsl1 \t', BIOANALYS_PROJECT_JSON: '' } });
  assert.equal(res.status, 0, '解析块执行失败: ' + (res.stderr || ''));
  assert.equal(out, 'Acsl1|env:BIO_KO_GENE');
});

test('真跑：参数优先于环境变量（cli:--ko-gene）', { skip: NEED_BASH }, () => {
  const { res, out } = runBlock({ env: { BIO_KO_GENE: 'Gpx4', BIOANALYS_PROJECT_JSON: '' }, prefix: 'ko_gene="Cd68"\n' });
  assert.equal(res.status, 0, '解析块执行失败: ' + (res.stderr || ''));
  assert.equal(out, 'Cd68|cli:--ko-gene');
});

test('真跑：project.json 的 biological_priors.target_ko_gene 可用', { skip: NEED_BASH || NEED_PY }, () => {
  const dir = fs.mkdtempSync(path.join(TEST_TMP, 'ko-gene-meta-'));
  const meta = path.join(dir, 'project.json');
  fs.writeFileSync(meta, JSON.stringify({ biological_priors: { target_ko_gene: 'Spp1' } }), 'utf8');
  const { res, out } = runBlock({ env: { BIO_KO_GENE: '', BIOANALYS_PROJECT_JSON: meta } });
  assert.equal(res.status, 0, '解析块执行失败: ' + (res.stderr || ''));
  assert.equal(out, 'Spp1|project.json:biological_priors.target_ko_gene');
});

test('真跑：project.json 损坏或字段为空都当没指定，不把整步打挂', { skip: NEED_BASH || NEED_PY }, () => {
  const dir = fs.mkdtempSync(path.join(TEST_TMP, 'ko-gene-meta-'));
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{not json', 'utf8');
  const empty = path.join(dir, 'empty.json');
  fs.writeFileSync(empty, JSON.stringify({ biological_priors: { target_ko_gene: '   ' } }), 'utf8');
  for (const meta of [broken, empty]) {
    const { res, out } = runBlock({ env: { BIO_KO_GENE: '', BIOANALYS_PROJECT_JSON: meta } });
    assert.equal(res.status, 0, '元数据异常把解析块打挂了: ' + (res.stderr || ''));
    assert.equal(out, 'Spp1|fallback:Spp1', '元数据异常时应回落兜底');
  }
});
