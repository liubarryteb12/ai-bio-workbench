/**
 * D-22：gmt 缓存目录必须可被 BIO_GMT_CACHE 覆盖，且默认值保持 <cwd>/../references/gmt_cache。
 *
 * 背景：6 个母版（line2 enrichment / dr_post_analysis / tf_activity / gsva_pathways，
 * line3 enrichment / dr_post_analysis）曾把 gmt 缓存硬编码成相对路径，母版 cwd 固定为
 * <项目>/<线>/processed，于是缓存只能落在项目内，无法跨项目共享、也无法在真机取证时
 * 指向已预热的 PRJ_E2E_* 缓存。D-22 拍板：加 BIO_GMT_CACHE 覆盖，默认值不变（向后兼容）。
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const PY_MASTERS = [
  'tools/bio/line2_scrna/scripts/enrichment',
  'tools/bio/line2_scrna/scripts/tf_activity',
  'tools/bio/line2_scrna/scripts/dr_post_analysis',
  'tools/bio/line3_spatial/scripts/enrichment',
  'tools/bio/line3_spatial/scripts/dr_post_analysis',
];
const R_MASTERS = ['tools/bio/line2_scrna/scripts/gsva_pathways'];

function codeLines(file) {
  const text = fs.readFileSync(path.join(REPO, file), 'utf8');
  return text.split('\n').filter((line) => {
    const t = line.trim();
    return t.length > 0 && !t.startsWith('#');
  });
}

test('D-22：5 个 Python 母版用 os.environ.get("BIO_GMT_CACHE") 且默认值不变', () => {
  assert.ok(PY_MASTERS.length >= 5, '应覆盖 5 个 Python 母版');
  for (const file of PY_MASTERS) {
    const joined = codeLines(file).join('\n');
    assert.match(joined, /os\.environ\.get\(\s*["']BIO_GMT_CACHE["']/, file + ' 必须读 BIO_GMT_CACHE');
    assert.match(joined, /references["']\s*,\s*["']gmt_cache["']|join\(["']\.\.["']\s*,\s*["']references["']\s*,\s*["']gmt_cache["']\)/, file + ' 默认值必须仍是 ../references/gmt_cache');
  }
});

test('D-22：Python 母版里不得残留硬编码 CACHE 赋值（未走环境变量）', () => {
  for (const file of PY_MASTERS) {
    const joined = codeLines(file).join('\n');
    assert.doesNotMatch(joined, /^CACHE\s*=\s*os\.path\.join\(["']\.\.["']/m, file + ' 仍把 CACHE 硬编码');
    assert.doesNotMatch(joined, /^gmt_dir\s*=\s*os\.path\.join\(["']\.\.["']/m, file + ' 仍把 gmt_dir 硬编码');
  }
});

test('D-22：R 侧 gsva 用 Sys.getenv("BIO_GMT_CACHE") 且默认值不变', () => {
  for (const file of R_MASTERS) {
    const joined = codeLines(file).join('\n');
    assert.match(joined, /Sys\.getenv\(\s*["']BIO_GMT_CACHE["']\s*,\s*unset\s*=\s*["']\.\.\/references\/gmt_cache["']\s*\)/, file + ' R 侧必须用 Sys.getenv 且 unset 默认值不变');
    assert.doesNotMatch(joined, /list\.files\(\s*["']\.\.\/references\/gmt_cache["']/, file + ' R 侧仍硬编码 list.files 路径');
  }
});

test('D-22：失败文案带上实际目录，便于定位缓存缺失', () => {
  for (const file of R_MASTERS) {
    const joined = codeLines(file).join('\n');
    assert.match(joined, /gmt_cache 下无 gmt 文件（目录:/, file + ' 失败文案要带目录');
  }
});

test('D-22：母版保持 LF-only（P-01：CRLF 会让 awk 数值比较退化）', () => {
  for (const file of [...PY_MASTERS, ...R_MASTERS]) {
    const raw = fs.readFileSync(path.join(REPO, file));
    const text = raw.toString('utf8');
    const crlf = (text.match(/\r\n/g) || []).length;
    assert.equal(crlf, 0, file + ' 出现 ' + crlf + ' 处 CRLF');
    assert.ok(raw.includes(Buffer.from('#!/', 'utf8')) || text.startsWith('#!'), file + ' 缺 shebang');
  }
});

test('D-22：SPEC_DECISIONS.md 有 D-22 条目且写明三个备选', () => {
  const text = fs.readFileSync(path.join(REPO, 'workspace', 'handoff', 'SPEC_DECISIONS.md'), 'utf8');
  assert.match(text, /### D-22 /, '缺 D-22 条目');
  const d22 = text.slice(text.indexOf('### D-22'));
  assert.ok(d22.includes('BIO_GMT_CACHE'), 'D-22 要点名环境变量');
  assert.ok(/备选方案对比/.test(d22), 'D-22 要有备选对比');
  assert.ok(/向后兼容/.test(d22), 'D-22 要说明为什么选覆盖而非改默认值');
});
