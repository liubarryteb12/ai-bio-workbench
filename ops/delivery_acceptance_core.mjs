/**
 * 交付四关验收核（纯 Node，无子进程）。2026-11-03 4 Argon 第二十轮 Q1 裁定的落地：
 * 打包管线末尾内联触发验收 + 未持有效回执禁止放行交付（409 ERR_DELIVERY_UNVERIFIED）。
 *
 * 单一真源：四道关的判据只写在这一个文件里。
 *   ops/delivery_acceptance.ps1 退化成人用的一行包装（保留 -SkipExtract 等开关）；
 *   BioanalysDesktop/server/report.js 在打包末尾直接 import 本模块，
 *   进程单接缝门禁（proc_seam_guard）禁止 server/ 起子进程，所以解包必须是
 *   纯 Node 实现（zlib gunzip + ustar 解析），不借道 tar.exe。
 *
 * 四道关（任一道红即整体红）：
 *   1. tar 本体 SHA256 与侧车一致（两种历史命名都认：tar_sha256_sidecar.txt
 *      与 <name>.tar.gz.sha256）
 *   2. 解包成功且交付根目录含三件套 CHECKSUMS.sha256 / CHECKSUMS.sig /
 *      delivery_manifest.json
 *   3. 清单逐文件哈希 + Ed25519 验签 VERIFIED（复用 ops/ed25519_tools.mjs 的
 *      verifyDelivery，验签口径不许有第二份）
 *   4. 清单与磁盘双向差集（幽灵 ghosts / 漂移 missingFiles）、CHECKSUMS
 *      覆盖完备性、counts 逐类一致
 *
 * CLI：node ops/delivery_acceptance_core.mjs --tar <path.tar.gz>
 *       [--delivery-dir <dir>] [--public-key <pem>] [--skip-extract]
 *       [--receipt-out <file>] [--project-id <id>]
 *   成功哨兵 DELIVERY_ACCEPTANCE_OK，失败 ACCEPTANCE_FAILED <n> 项，exit 0/1。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { verifyDelivery } from './ed25519_tools.mjs';
import { fileURLToPath } from 'node:url';

const OPS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(OPS_DIR, '..');

export const ACCEPTANCE_VERSION = 'delivery-acceptance-core/1.0.0';
/** 生产脱敏审计流（Argon 第二十一轮 Q2）：append-only JSONL，必须落在 gitignore 区。 */
export const AUDIT_LEDGER_NAME = 'acceptance_audit.jsonl';
/** project_id 在审计流里的哈希盐前缀：只防一眼看穿的明文枚举，不是保密承诺。 */
const AUDIT_ID_SALT = 'bioanalys-delivery-audit/v1';
export const RECEIPT_SUBDIR = path.join('ops', 'delivery_acceptance', 'records');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function failRow(failures, msg) { failures.push(msg); return false; }

// ── 关 1：tar 侧车哈希 ──
export function findSidecar(tarPath) {
  const dir = path.dirname(tarPath);
  const legacy = path.join(dir, 'tar_sha256_sidecar.txt');
  if (fs.existsSync(legacy)) return legacy;
  const alt = tarPath + '.sha256';
  if (fs.existsSync(alt)) return alt;
  return null;
}

// ── 纯 Node ustar 解包（zip-slip 防护：条目名含 .. 或绝对路径直接拒） ──
// 交付 tar 由 GNU tar 在 Linux 侧生成，长路径走 PAX 扩展头（././@PaxHeader type 'x'）
// 与 GNU 'L'/'K' 机制。只认经典 ustar 的解析器会把扩展头的数据块当成下一条主头，
// 当场读出 bad_octal_field（第 21 轮在演练包上实测）。这里按 POSIX.1-2017 消费
// 'x'/'g'/'L'/'K' 四种数据型条目，并把 path=/size= 覆盖应用到后继条目。
// zip-slip 防护：条目名含 .. 段、绝对路径或盘符前缀，解包前直接拒。
function headerField(header, off, len) {
  return header.slice(off, off + len).toString('latin1').replace(/\0.*$/s, '').trimEnd();
}

function headerSize(header, off, len) {
  const raw = header.slice(off, off + len);
  if (raw[0] === 0x80 || raw[0] === 0xff) {
    // base-256（大文件）：逐字节累加，交付包实际用不到，但解析器不能读错步长
    let n = 0;
    for (let i = 1; i < raw.length; i++) n = n * 256 + raw[i];
    return n;
  }
  const text = headerField(header, off, len);
  if (!/^[0-7]*$/.test(text)) throw new Error('bad_octal_field:' + JSON.stringify(text));
  return text ? parseInt(text, 8) : 0;
}

function sanitizeEntryName(name) {
  const unified = String(name).replace(/\\/g, '/');
  if (!unified || unified.startsWith('/') || /^[A-Za-z]:/.test(unified)) {
    throw new Error('unsafe_tar_path:' + name);
  }
  if (unified.split('/').includes('..')) throw new Error('unsafe_tar_path:' + name);
  return unified.replace(/^\.\//, '');
}

function parsePaxRecords(block) {
  const out = {};
  let pos = 0;
  const text = block.toString('utf8');
  while (pos < text.length) {
    const sp = text.indexOf(' ', pos);
    if (sp < 0) break;
    const len = Number(text.slice(pos, sp));
    if (!Number.isFinite(len) || len <= 0) break;
    const record = text.slice(sp + 1, pos + len).replace(/\0.*$/s, '');
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1).replace(/[\r\n]+$/s, '');
    pos += len + (text[pos + len] === '\n' ? 1 : 0);
  }
  return out;
}

export function extractTarGz(tarPath, destDir) {
  const tar = zlib.gunzipSync(fs.readFileSync(tarPath));
  const entries = [];
  let off = 0;
  let pending = null; // 扩展头累积：{ path?, size? }
  while (off + 512 <= tar.length) {
    const header = tar.slice(off, off + 512);
    if (header.every((b) => b === 0)) break; // 结尾零块
    const rawName = headerField(header, 0, 100);
    const prefix = headerField(header, 345, 155);
    const size = headerSize(header, 124, 12);
    const typeflag = String.fromCharCode(header[156]);
    off += 512;
    const data = tar.slice(off, off + size);
    off += Math.ceil(size / 512) * 512;
    if (typeflag === 'x' || typeflag === 'g') {
      const rec = parsePaxRecords(data);
      pending = { ...(pending || {}), ...rec };
      continue;
    }
    if (typeflag === 'L') { pending = { ...(pending || {}), path: data.toString('utf8').replace(/\0.*$/s, '') }; continue; }
    if (typeflag === 'K') { pending = { ...(pending || {}), linkpath: data.toString('utf8').replace(/\0.*$/s, '') }; continue; }
    const name = sanitizeEntryName(pending && pending.path ? pending.path : (prefix ? prefix + '/' + rawName : rawName));
    const effSize = pending && pending.size !== undefined ? Number(pending.size) : size;
    pending = null;
    if (typeflag === '5' || typeflag === '7') { entries.push({ name, kind: 'dir' }); continue; }
    if (typeflag !== '0' && typeflag !== '\0') continue; // 硬链/软链/设备件：交付包不该有，跳过即如实不写
    entries.push({ name, kind: 'file', data: data.subarray(0, effSize) });
  }
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  for (const e of entries) {
    const target = path.join(destDir, ...e.name.split('/').filter(Boolean));
    if (e.kind === 'dir') { fs.mkdirSync(target, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.data);
  }
  return entries.filter((e) => e.kind === 'file').map((e) => e.name);
}

// ── 关 4 的白名单口径（与旧 ps1 一致，注释里写明为什么放行） ──
const metaFiles = ['CHECKSUMS.sha256', 'CHECKSUMS.sig', 'delivery_manifest.json', 'ED25519_PUBLIC_KEY.pem'];
// 解读报告不在 manifest 登记表内：交付必需但不入哈希清单
const allowedUnlistedPrefixes = ['03_Interpretation_Report/'];
const allowedUnlistedFiles = ['01_Adapted_Code/_report.txt', 'README.md'];
const sectionDir = {
  scripts: '01_Adapted_Code',
  adapted_code: '01_Adapted_Code',
  figures: '02_Figures_and_Tables',
  tables: '02_Figures_and_Tables',
};
// CHECKSUMS 覆盖检查只排除这三件（delivery_manifest.json 本身受 CHECKSUMS 保护，
// 排除它会误判成幽灵登记——第 36 轮实测踩过）
const coverageMeta = ['CHECKSUMS.sha256', 'CHECKSUMS.sig', 'ED25519_PUBLIC_KEY.pem'];

function normalizeChecksumPath(value) {
  let rel = String(value).trim().replace(/\\/g, '/');
  if (rel.startsWith('*')) rel = rel.slice(1); // sha256sum 二进制模式前缀
  if (rel.startsWith('./')) rel = rel.slice(2);
  if (rel.startsWith('/')) rel = rel.slice(1);
  return rel;
}

export function gateSidecar(tarPath) {
  const sidecar = findSidecar(tarPath);
  if (!sidecar) return { ok: false, detail: '缺侧车文件（tar_sha256_sidecar.txt 或 <name>.tar.gz.sha256），无法校验 tar 本体' };
  const expected = fs.readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0].toLowerCase();
  const actual = sha256File(tarPath);
  if (expected !== actual) return { ok: false, detail: 'tar SHA256 不一致：期望 ' + expected + ' 实际 ' + actual };
  return { ok: true, detail: 'tar SHA256 与侧车一致：' + actual.slice(0, 16) + '...（侧车 ' + path.basename(sidecar) + '）', tarSha256: actual };
}

export function gateUnpack(tarPath, unpackRoot, skipExtract) {
  if (skipExtract) {
    if (!fs.existsSync(unpackRoot)) {
      return { ok: false, detail: '-SkipExtract 要求 unpacked 目录已存在（先不带该开关跑一次生成）' };
    }
  } else {
    extractTarGz(tarPath, unpackRoot);
  }
  const roots = fs.readdirSync(unpackRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  if (roots.length !== 1) return { ok: false, detail: '解包后应恰有一个一级目录，实际 ' + roots.length + ' 个' };
  const delivery = path.join(unpackRoot, roots[0].name);
  const missing = ['CHECKSUMS.sha256', 'CHECKSUMS.sig', 'delivery_manifest.json'].filter((n) => !fs.existsSync(path.join(delivery, n)));
  if (missing.length > 0) return { ok: false, detail: '交付包缺 ' + missing.join(', '), delivery };
  return { ok: true, detail: skipExtract ? '复用既有解包目录（-SkipExtract，未重新解包）：' + roots[0].name : '解包完成：' + roots[0].name, delivery };
}

export function gateSignature(deliveryDir, publicKeyPath) {
  if (!publicKeyPath || !fs.existsSync(publicKeyPath)) {
    return { ok: false, detail: '公钥缺失：' + String(publicKeyPath) };
  }
  const result = verifyDelivery(deliveryDir, { publicKey: fs.readFileSync(publicKeyPath) });
  if (result.ok) return { ok: true, detail: '清单哈希与 Ed25519 验签通过：VERIFIED ' + result.count, verifiedCount: result.count };
  return { ok: false, detail: '验签失败：VERIFICATION_FAILED ' + result.reason };
}

export function diskFilesRecursive(dir) {
  const out = [];
  const walk = (base, relBase) => {
    for (const entry of fs.readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = relBase ? relBase + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(path.join(base, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(dir, '');
  return out;
}

export function gateSetEquality(deliveryDir) {
  const failures = [];
  const mf = JSON.parse(fs.readFileSync(path.join(deliveryDir, 'delivery_manifest.json'), 'utf8'));
  const declared = new Set();
  for (const [section, list] of Object.entries(mf.files || {})) {
    const prefix = sectionDir[section];
    for (const rel of list || []) {
      if (rel == null) continue;
      declared.add((prefix ? prefix + '/' + rel : String(rel)).replace(/\\/g, '/'));
    }
  }
  const diskAll = diskFilesRecursive(deliveryDir);
  const diskBusiness = diskAll.filter((f) => !metaFiles.includes(f));
  const ghosts = diskBusiness.filter((f) => !declared.has(f));
  const ghostsFinal = ghosts.filter((f) =>
    !(allowedUnlistedFiles.includes(f) || allowedUnlistedPrefixes.some((p) => f.startsWith(p))));
  if (ghostsFinal.length > 0) failRow(failures, '发现 ' + ghostsFinal.length + ' 个未登记文件（幽灵私货）：' + ghostsFinal.join(', '));
  const missingFiles = [...declared].filter((f) => !fs.existsSync(path.join(deliveryDir, ...f.split('/'))));
  if (missingFiles.length > 0) failRow(failures, '清单有 ' + missingFiles.length + ' 条在磁盘缺失（漂移）：' + missingFiles.join(', '));

  const checksumsPath = path.join(deliveryDir, 'CHECKSUMS.sha256');
  if (!fs.existsSync(checksumsPath)) {
    failRow(failures, '缺 CHECKSUMS.sha256，无法校验哈希覆盖完备性');
  } else {
    const protectedSet = new Set();
    for (const line of fs.readFileSync(checksumsPath, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) protectedSet.add(normalizeChecksumPath(parts.slice(1).join(' ')));
    }
    const coverageDisk = diskAll.filter((f) => !coverageMeta.includes(f));
    const uncovered = coverageDisk.filter((f) => !protectedSet.has(f));
    const phantom = [...protectedSet].filter((p) => !coverageDisk.includes(p));
    if (uncovered.length > 0) failRow(failures, '有 ' + uncovered.length + ' 个业务文件未被 CHECKSUMS 保护：' + uncovered.join(', '));
    if (phantom.length > 0) failRow(failures, 'CHECKSUMS 登记了 ' + phantom.length + ' 个磁盘不存在的文件：' + phantom.join(', '));
  }

  const mismatch = [];
  let sumCounted = 0;
  for (const [section, value] of Object.entries(mf.counts || {})) {
    sumCounted += Number(value);
    const declaredInSection = (mf.files?.[section] || []).length;
    if (declaredInSection !== 0 && Number(value) !== declaredInSection) {
      mismatch.push(section + '：counts=' + value + ' 条目=' + declaredInSection);
    }
  }
  if (mismatch.length > 0) failRow(failures, 'counts 与清单条目不一致：' + mismatch.join('；'));
  return {
    ok: failures.length === 0,
    detail: failures.length === 0
      ? '无幽灵文件（磁盘业务 ' + diskBusiness.length + ' 个全在清单/白名单内）、无漂移、CHECKSUMS 覆盖完备、counts 一致（合计 ' + sumCounted + '）'
      : failures.join('；'),
    coverageOk: failures.length === 0,
  };
}

export function acceptDelivery({
  tarPath,
  deliveryDir,
  publicKeyPath = path.join(OPS_DIR, 'secrets', 'ed25519_public.pem'),
  skipExtract = false,
} = {}) {
  if (!tarPath || !fs.existsSync(tarPath)) throw new Error('tar 不存在：' + String(tarPath));
  const base = deliveryDir || path.dirname(tarPath);
  const unpackRoot = path.join(base, 'unpacked');
  const gates = [];
  const g1 = gateSidecar(tarPath);
  gates.push({ name: 'sidecar', ...g1 });
  if (!g1.ok) return summarize(gates, null);
  const g2 = gateUnpack(tarPath, unpackRoot, skipExtract);
  gates.push({ name: 'unpack', ...g2 });
  if (!g2.ok || !g2.delivery) return summarize(gates, null);
  const g3 = gateSignature(g2.delivery, publicKeyPath);
  gates.push({ name: 'signature', ...g3 });
  if (!g3.ok) return summarize(gates, g2.delivery);
  const g4 = gateSetEquality(g2.delivery);
  gates.push({ name: 'set_equality', ...g4 });
  return summarize(gates, g2.delivery);
}

function summarize(gates, deliveryDir) {
  const failures = gates.filter((g) => !g.ok).map((g) => '[' + g.name + '] ' + g.detail);
  const ok = failures.length === 0 && gates.length === 4;
  return {
    ok,
    gates,
    failures,
    deliveryDir,
    tarSha256: gates[0]?.tarSha256 || null,
    verifiedCount: (gates.find((g) => g.name === 'signature') || {}).verifiedCount ?? null,
    coverageOk: !!(gates.find((g) => g.name === 'set_equality') || {}).ok,
    sentinel: ok ? 'DELIVERY_ACCEPTANCE_OK 四道关全绿' : 'ACCEPTANCE_FAILED ' + failures.length + ' 项',
  };
}

// ── 回执：落 ops/delivery_acceptance/records/<project_id>.receipt.json（Argon 指定的独立落点，
// 严禁混入 docs/generated/SYSTEM_LEDGER.json——那是架构模具台账，回执是业务运行时产物） ──
export function receiptPathFor(projectId, recordsDir) {
  const safe = String(projectId || '');
  if (!/^[A-Za-z0-9._-]+$/.test(safe) || safe.startsWith('.')) throw new Error('projectId 非法：' + safe);
  // 落点优先级：显式参数 > BIO_DELIVERY_RECORDS_DIR（测试/抽检隔离）> 仓库受控区。
  // Argon：records 目录可放行最新演练回执入库，生产客户回执可指向项目目录。
  const dir = recordsDir || process.env.BIO_DELIVERY_RECORDS_DIR || path.join(REPO_ROOT, RECEIPT_SUBDIR);
  return path.join(dir, safe + '.receipt.json');
}


// ── 脱敏审计流（Argon 第二十一轮 Q2 裁定） ──
// 落点优先级：显式 auditPath > BIO_DELIVERY_AUDIT_PATH（测试/抽检隔离）> 与回执同目录。
// 生产由 server/report.js 指向 <deliverables>/acceptance_audit.jsonl（gitignore 区），
// 绝不写进仓库受控区——那会污染 git status 并泄漏项目号与交付节奏。
export function auditPathFor(baseDir) {
  return path.join(baseDir, AUDIT_LEDGER_NAME);
}

/** 项目号脱敏：sha256(盐 + id) 前 16 位。审计流里不出现可枚举的明文项目号。 */
export function hashedProjectId(projectId) {
  return crypto.createHash('sha256').update(AUDIT_ID_SALT + ':' + String(projectId)).digest('hex').slice(0, 16);
}

/**
 * 追加一行脱敏审计（约 400B）。字段固定，不含任何宿主绝对路径或客户明文名称：
 *   at / project_id_sha256 / tar_sha256 / verified_count / coverage_ok / verifier_version
 * 返回 { path, entry } 便于调用方回执与日志引用；写入失败抛错（审计流不可静默丢）。
 */
export function appendAuditEntry({ projectId, verdict, verifiedAt, auditPath }) {
  if (!verdict || verdict.ok !== true) {
    throw new Error('验收未通过，禁止写审计流：' + ((verdict && verdict.failures) || []).join('；'));
  }
  const file = auditPath || process.env.BIO_DELIVERY_AUDIT_PATH || null;
  if (!file) throw new Error('审计流路径缺失：需要显式 auditPath 或 BIO_DELIVERY_AUDIT_PATH');
  const entry = {
    schema_version: 1,
    at: verifiedAt || new Date().toISOString(),
    project_id_sha256: hashedProjectId(projectId),
    tar_sha256: verdict.tarSha256,
    verified_count: verdict.verifiedCount,
    coverage_ok: true,
    verifier_version: ACCEPTANCE_VERSION,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  return { path: file, entry };
}

/** 读审计流（只读、容错跳过坏行）：返回 [{ line, entry }]。 */
export function readAuditLedger(auditPath) {
  if (!auditPath || !fs.existsSync(auditPath)) return [];
  const out = [];
  const lines = fs.readFileSync(auditPath, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    try { out.push({ line: i + 1, entry: JSON.parse(lines[i]) }); } catch { /* 坏行跳过，不连坐 */ }
  }
  return out;
}

export function writeReceipt({ projectId, verdict, recordsDir, auditPath, now }) {
  if (!verdict.ok) throw new Error('验收未通过，禁止写回执：' + verdict.failures.join('；'));
  const receipt = {
    schema_version: 1,
    project_id: projectId,
    tar_sha256: verdict.tarSha256,
    verified_count: verdict.verifiedCount,
    coverage_ok: true,
    verified_at: (now || new Date()).toISOString(),
    verifier_version: ACCEPTANCE_VERSION,
  };
  const file = receiptPathFor(projectId, recordsDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  // Argon Q2 双落点：随包全量回执 + 代理侧脱敏审计流（append-only，一行一条）。
  // 审计流刻意不含宿主机绝对路径，项目号只留哈希，删掉几十 GB 旧包后仍保有一份历史总账。
  const audit = appendAuditEntry({
    projectId,
    verdict,
    verifiedAt: receipt.verified_at,
    // 审计落点：显式 auditPath 优先（服务端指向 deliverables 根，而不是 records 子目录）；
    // 否则与回执同目录（CLI/演练场景），保证调用方不传也有地方落。
    auditPath: auditPath || (recordsDir ? auditPathFor(recordsDir) : undefined),
  });
  return { file, receipt, audit };
}

export function loadReceipt(projectId, recordsDir) {
  let file;
  try { file = receiptPathFor(projectId, recordsDir); } catch { return null; }
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed.project_id !== projectId || typeof parsed.tar_sha256 !== 'string') return null;
    return parsed;
  } catch { return null; }
}

// 放行判据：回执存在 且 其 tar_sha256 与当前包实时哈希相等（包被换/改即失效）
export function verifyTarReceipt(projectId, tarPath, recordsDir) {
  const receipt = loadReceipt(projectId, recordsDir);
  if (!receipt) {
    return { ok: false, code: 'ERR_DELIVERY_UNVERIFIED', reason: '无验收回执：交付包未经四关验收，禁止标记 DELIVERED 或开放下载' };
  }
  if (!fs.existsSync(tarPath)) {
    return { ok: false, code: 'ERR_DELIVERY_UNVERIFIED', reason: 'tar 包不存在，回执无从咬合：' + path.basename(tarPath) };
  }
  const actual = sha256File(tarPath);
  if (actual !== receipt.tar_sha256) {
    return { ok: false, code: 'ERR_DELIVERY_UNVERIFIED', reason: '回执哈希与当前 tar 不一致（包已被替换或篡改）：receipt=' + receipt.tar_sha256.slice(0, 16) + '... actual=' + actual.slice(0, 16) + '...' };
  }
  return { ok: true, receipt };
}

export function main(argv = process.argv.slice(2)) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  // 位置参数也当 tar 路径：npm run delivery:verify -- <tar_path>（Argon Q1 给的抽检口）
  const positional = argv.find((a) => !a.startsWith('--'));
  const tarPath = value('--tar') || positional;
  const deliveryDir = value('--delivery-dir');
  if (!tarPath && !deliveryDir) {
    process.stderr.write('usage: node ops/delivery_acceptance_core.mjs --tar <path.tar.gz> [--delivery-dir <dir>] [--public-key <pem>] [--skip-extract] [--project-id <id>] [--receipt-out <dir>]' + String.fromCharCode(10));
    return 2;
  }
  let tar = tarPath;
  if (!tar) {
    tar = fs.readdirSync(deliveryDir).filter((n) => /_Client_Delivery\.tar\.gz$/.test(n)).sort().pop();
    if (!tar) { process.stderr.write('目录里没有 *Client_Delivery.tar.gz' + String.fromCharCode(10)); return 1; }
    tar = path.join(deliveryDir, tar);
  }
  const verdict = acceptDelivery({
    tarPath: tar,
    deliveryDir,
    publicKeyPath: value('--public-key'),
    skipExtract: argv.includes('--skip-extract'),
  });
  for (const g of verdict.gates) {
    process.stdout.write((g.ok ? '[ OK  ] ' : '[ RED ] ') + g.name + ': ' + g.detail + String.fromCharCode(10));
  }
  if (verdict.ok && value('--project-id')) {
    const r = writeReceipt({ projectId: value('--project-id'), verdict, recordsDir: value('--receipt-out') });
    process.stdout.write('RECEIPT_WRITTEN ' + r.file + String.fromCharCode(10));
  }
  process.stdout.write(verdict.sentinel + String.fromCharCode(10));
  return verdict.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exitCode = main();
}
