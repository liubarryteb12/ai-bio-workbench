/**
 * D2 解包六项硬指标契约测试（Gemini 第三轮裁定）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { extractTarGzLimited } from '../../tools/reporting/delivery_acceptance_core.mjs';

function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

function tarHeader(name, { type = '0', size = 0 } = {}) {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, 'utf8');
  header.write(octal(0o644, 8), 100, 8, 'latin1');
  header.write(octal(0, 8), 108, 8, 'latin1');
  header.write(octal(0, 8), 116, 8, 'latin1');
  header.write(octal(size, 12), 124, 12, 'latin1');
  header.write(octal(0, 12), 136, 12, 'latin1');
  header.write('        ', 148, 8, 'latin1');
  header.write(type, 156, 1, 'latin1');
  header.write('ustar\0', 257, 6, 'latin1');
  header.write('00', 263, 2, 'latin1');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'latin1');
  return header;
}

function makeTarGz(entries) {
  const blocks = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data || '');
    blocks.push(tarHeader(entry.name, { type: entry.type || '0', size: data.length }));
    blocks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(blocks));
}

function writeTar(t, buffer, name = 'pkg.tar.gz') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tar-limits-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, name);
  fs.writeFileSync(file, buffer);
  return { root, file, dest: path.join(root, 'out') };
}

test('合法包：普通文件与目录正常解包', (t) => {
  const { file, dest } = writeTar(t, makeTarGz([
    { name: 'requirement.json', data: '{}' },
    { name: 'raw_data/', type: '5' },
    { name: 'raw_data/matrix.tsv', data: 'gene\ts1\nA\t1\n' },
  ]));
  const files = extractTarGzLimited(file, dest);
  assert.deepEqual(files.sort(), ['raw_data/matrix.tsv', 'requirement.json']);
  assert.equal(fs.existsSync(path.join(dest, 'raw_data', 'matrix.tsv')), true);
});

test('symlink 条目拒绝', (t) => {
  const { file, dest } = writeTar(t, makeTarGz([{ name: 'link', type: '2' }]));
  assert.throws(() => extractTarGzLimited(file, dest), /unsafe_tar_entry/);
});

test('路径深度超过 4 拒绝', (t) => {
  const { file, dest } = writeTar(t, makeTarGz([{ name: 'a/b/c/d/e.txt', data: 'x' }]));
  assert.throws(() => extractTarGzLimited(file, dest), /tar_depth_exceeded/);
});

test('非 ASCII 文件名拒绝', (t) => {
  const { file, dest } = writeTar(t, makeTarGz([{ name: '中文.txt', data: 'x' }]));
  assert.throws(() => extractTarGzLimited(file, dest), /tar_non_ascii_name/);
});

test('条目数超过 64 拒绝', (t) => {
  const entries = Array.from({ length: 65 }, (_, index) => ({ name: `f${index}.txt`, data: 'x' }));
  const { file, dest } = writeTar(t, makeTarGz(entries));
  assert.throws(() => extractTarGzLimited(file, dest), /tar_entries_exceeded/);
});

test('膨胀率超过 25 倍拒绝', (t) => {
  const { file, dest } = writeTar(t, makeTarGz([{ name: 'zeros.txt', data: Buffer.alloc(1024 * 1024, 0) }]));
  assert.throws(
    () => extractTarGzLimited(file, dest, { ratioExemptBytes: 0 }),
    /tar_ratio_exceeded/,
  );
});
