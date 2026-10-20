/**
 * S30 验证脚本（一次性，可重复运行）：同一批文件名在两端判定矩阵。
 *
 * 目的：架构评审 2.3 / A8 指出"同一份数据走两个入口校验结论不同"。S30 把白名单
 * 收敛到 shared/data_formats.mjs 后，本脚本导入两端真实模块（不是复制逻辑），
 * 对同一批文件名逐条比对：
 *   8787 工作台：BioanalysDesktop/server/upload.js 的 extAllowed（白名单口径）
 *   8080 提交台：portal/lib/archive.mjs 的 validateDataFiles（端到端校验口径，
 *                这里用 role=other、size=10 的空 payload，只让白名单规则生效）
 *
 * 同时核对：两端导出的列表是否就是 shared 的同一引用；portal/index.html 的
 * 字面量副本是否逐项一致；MAX_DATA_BYTES 默认值是否一致。
 *
 * 运行：node cn_debug/2026-10-21_verification_s30_whitelist.mjs
 * 退出码：0 = 全部一致；1 = 发现不一致（会打印不一致明细）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DATA_EXT as SHARED_DATA_EXT,
  MAX_DATA_BYTES as SHARED_MAX_DATA_BYTES,
  extOf,
} from '../shared/data_formats.mjs';
import { ALLOWED_EXT, extAllowed } from '../BioanalysDesktop/server/upload.js';
import {
  DATA_EXT as PORTAL_DATA_EXT,
  MAX_DATA_BYTES as PORTAL_MAX_DATA_BYTES,
  validateDataFiles,
} from '../portal/lib/archive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const INDEX_HTML = path.join(REPO_ROOT, 'portal', 'index.html');

const failures = [];

/** 8787 工作台白名单判定 */
function judgeUpload(name) {
  return extAllowed(name);
}

/** 8080 提交台端到端判定（空 payload，只触发白名单这一层） */
function judgePortal(name) {
  const r = validateDataFiles([{ role: 'other', bind: '', name, size: 10 }], {});
  return { ok: r.ok, errors: r.errors };
}

/** 展示宽度：CJK 按 2 列算，让表格对齐 */
function width(s) {
  let w = 0;
  for (const ch of String(s)) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  return w;
}
function pad(s, n) {
  return String(s) + ' '.repeat(Math.max(0, n - width(s)));
}

const NAMES = [
  // 14 项并集，每项一个
  'counts.h5ad',
  'filtered_feature_bc_matrix.h5',
  'adata.loom',
  'matrix.mtx',
  'raw_bundle.tar',
  'GSE277173_series_matrix.txt.gz',
  'supplementary.zip',
  'GPL11532-32230.txt',
  'mouse_cortex.tsv',
  'sample_sheet.csv',
  'GPL11532_family.soft',
  '样本信息.xlsx',
  'seurat_obj.rds',
  'workspace.rdata',
  // 双扩展名 / 大写 / 中文 / 带路径
  'matrix.mtx.gz',
  'raw data.tar.gz',
  'UPPER.H5AD',
  '分组 情况.txt',
  'dir/sub/x.tsv',
  // 非法扩展名
  'evil.sh',
  'run.exe',
  'script.bat',
  'app.js',
  'notes.py',
  'noext',
  'x.h5ad.bak',
  'x.tar.gz.exe',
  '.hidden',
];

console.log('=== S30 两端白名单判定矩阵 ===');
console.log('权威模块: shared/data_formats.mjs');
console.log('工作台判定: BioanalysDesktop/server/upload.js extAllowed()');
console.log('提交台判定: portal/lib/archive.mjs validateDataFiles()（空 payload，仅白名单层）');
console.log('');
console.log(pad('#', 4) + pad('文件名', 36) + pad('extOf', 10) + pad('8787', 8) + pad('8080', 8) + '一致');
console.log('-'.repeat(80));

let sameCount = 0;
NAMES.forEach((name, i) => {
  const up = judgeUpload(name);
  const portal = judgePortal(name);
  const same = up === portal.ok;
  if (!same) {
    failures.push(`判定不一致: ${name} → 8787=${up} 8080=${portal.ok}（${portal.errors.join('; ')}）`);
  } else {
    sameCount += 1;
  }
  console.log(
    pad(i + 1, 4) + pad(name, 36) + pad(extOf(name) || '(无)', 10) +
    pad(up ? '放行' : '拒绝', 8) + pad(portal.ok ? '放行' : '拒绝', 8) + (same ? '是' : '否')
  );
});
console.log('-'.repeat(80));
console.log(`共 ${NAMES.length} 个文件名，判定一致 ${sameCount} 个，不一致 ${NAMES.length - sameCount} 个`);

// ---------- 常量与副本核对 ----------
console.log('');
console.log('=== 常量与副本核对 ===');

const extSame = JSON.stringify(ALLOWED_EXT) === JSON.stringify(SHARED_DATA_EXT);
const extIdentity = ALLOWED_EXT === SHARED_DATA_EXT;
console.log(`shared DATA_EXT 项数 = ${SHARED_DATA_EXT.length}: ${SHARED_DATA_EXT.join(' ')}`);
console.log(`工作台 ALLOWED_EXT 与 shared 同内容 = ${extSame}，同引用 = ${extIdentity}`);
if (!extSame) failures.push('工作台 ALLOWED_EXT 与 shared DATA_EXT 内容不一致');

const portalExtIdentity = PORTAL_DATA_EXT === SHARED_DATA_EXT;
console.log(`提交台 DATA_EXT 与 shared 同引用 = ${portalExtIdentity}`);
if (!portalExtIdentity) failures.push('提交台 DATA_EXT 与 shared DATA_EXT 不是同一引用');

const html = fs.readFileSync(INDEX_HTML, 'utf8');
const m = html.match(/var DATA_EXT\s*=\s*\[([^\]]*)\]\s*;/);
if (!m) {
  failures.push('portal/index.html 里找不到 var DATA_EXT 字面量');
  console.log('portal/index.html DATA_EXT 副本: 未找到（FAIL）');
} else {
  const htmlExt = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
  const htmlSame = JSON.stringify(htmlExt) === JSON.stringify(SHARED_DATA_EXT);
  console.log(`portal/index.html DATA_EXT 副本项数 = ${htmlExt.length}，与 shared 逐项相等 = ${htmlSame}`);
  if (!htmlSame) failures.push('portal/index.html DATA_EXT 副本与 shared 不一致: ' + htmlExt.join(' '));
}

console.log(`shared MAX_DATA_BYTES = ${SHARED_MAX_DATA_BYTES}（5 GiB）`);
const envOverride = Number(process.env.PORTAL_MAX_DATA_BYTES) > 0;
console.log(`提交台 MAX_DATA_BYTES = ${PORTAL_MAX_DATA_BYTES}（env 覆盖 = ${envOverride ? '是' : '否'}）`);
if (!envOverride && PORTAL_MAX_DATA_BYTES !== SHARED_MAX_DATA_BYTES) {
  failures.push('提交台 MAX_DATA_BYTES 默认值与 shared 不一致');
}

const newlyAllowed = ['.h5', '.loom', '.tar', '.soft', '.rdata'];
console.log('');
console.log(`本次并集新增（提交台旧白名单没有、工作台旧白名单已有）: ${newlyAllowed.join(' ')}`);

console.log('');
if (failures.length === 0) {
  console.log('RESULT: PASS（两端判定一致，副本与常量均对齐）');
  process.exit(0);
} else {
  console.log('RESULT: FAIL');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
