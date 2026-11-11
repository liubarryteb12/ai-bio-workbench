/**
 * 数据导入（aims 第 1 节「数据导入界面」+ 第 3 节「数据管理模块」）
 *
 * 职责：接收前端分片上传的原始数据文件，做格式校验与模态建议，最后落到
 * 对应线的 raw_data/。本地只做暂存与校验（不解析大矩阵，避免本地算力消耗），
 * 真正的格式解析在服务器分析步骤里做。
 *
 * 边界：文件名消毒（禁路径穿越）、扩展名白名单、magic bytes 校验、
 * 强制归属线（lineId 必须是三条线之一）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { LINES, projectLineDir, sanitizeProjectId } from './domain.js';
import { DATA_EXT, isAllowedDataFile } from '../../shared/data_formats.mjs';
import { isSafeUploadId, uploadFingerprint, uploadIdFromFingerprint } from '../../shared/upload_session.mjs';

/** uploadId 安全判定与前端本地缓存校验同源（shared/upload_session.mjs），此处转出便于单测与调用方复用 */
export { isSafeUploadId };

/** 上传暂存根（本软件工作目录内，不污染源码） */
export const UPLOAD_ROOT = path.join(process.cwd(), '.uploads');

/** 分片大小 4MB */
export const CHUNK_SIZE = 4 * 1024 * 1024;

/**
 * 允许的扩展名白名单（GEO / 10x / h5ad / 通用表）。
 * 唯一权威在仓库根 shared/data_formats.mjs（S30 / 架构评审 2.3 A8）：
 * 本文件只 re-export 既有导出名，既有 import 方（server/index.js、tests）不受影响。
 */
export const ALLOWED_EXT = DATA_EXT;

/**
 * 文件名消毒：严格拒绝含路径分隔符、.. 或隐藏文件的名字。
 * 浏览器上传时 File.name 只会是 basename（不含路径），所以严格拒绝不影响正常使用，
 * 反而能挡住任何构造的穿越尝试。
 * @returns {string|null} 合法返回名字，否则 null
 */
export function sanitizeFilename(name) {
  const raw = String(name ?? '');
  if (!raw) return null;
  if (raw === '.' || raw === '..') return null;
  if (raw.includes('/') || raw.includes('\\')) return null;
  if (raw.includes('..')) return null;
  if (raw.startsWith('.')) return null;
  // 只允许安全字符（字母数字 . _ - 空格 括号 加号 中文字符）
  if (!/^[\w\u4e00-\u9fa5.\- ()+]+$/.test(raw)) return null;
  return raw;
}

/**
 * 扩展名是否在白名单内（含双扩展名如 .mtx.gz / .tar.gz）。
 * 判定委托 shared/data_formats.mjs，与用户提交台（portal）同一口径。
 */
export function extAllowed(name) {
  return isAllowedDataFile(name);
}

/**
 * 按 magic bytes 探测真实格式（不看扩展名，防改后缀蒙混）。
 * @param {Buffer} buf 文件头（>=512 字节最佳）
 * @returns {string} 'hdf5' | 'gzip' | 'tar' | 'zip' | 'text' | 'xlsx' | 'binary' | 'unknown'
 */
export function detectMagic(buf) {
  if (!buf || buf.length < 4) return 'unknown';
  // HDF5：\x89 H D F
  if (buf[0] === 0x89 && buf[1] === 0x48 && buf[2] === 0x44 && buf[3] === 0x46) return 'hdf5';
  // gzip：\x1f \x8b
  if (buf[0] === 0x1f && buf[1] === 0x8b) return 'gzip';
  // zip / xlsx：PK\x03\x04
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'zip';
  // tar：offset 257 处 'ustar'
  if (buf.length > 262 && buf.slice(257, 262).toString('latin1') === 'ustar') return 'tar';
  // 文本启发式：前 512 字节可打印字符占比
  const sample = buf.slice(0, Math.min(512, buf.length));
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127)) printable += 1;
  }
  if (sample.length > 0 && printable / sample.length > 0.85) return 'text';
  return 'binary';
}

/**
 * 数据模态建议（aims：区分 bulk 与单细胞；空间单列）。
 * @returns {string} 'bulk' | 'scrna' | 'spatial' | 'unknown'
 */
export function suggestModality(name, magic) {
  const lower = String(name).toLowerCase();
  if (lower.endsWith('.soft') || lower.endsWith('.soft.gz')) return 'bulk';
  if (lower.includes('series_matrix')) return 'bulk';
  if (lower.endsWith('.mtx') || lower.endsWith('.mtx.gz')) return 'scrna';
  if (lower.endsWith('.loom')) return 'scrna';
  if (lower.endsWith('.h5ad')) return 'scrna';   // h5ad 单细胞/空间都常见，默认按单细胞提示
  if (lower.endsWith('.h5')) return 'spatial';   // Visium 常用 filtered_feature_bc_matrix.h5
  if (magic === 'text') return 'bulk';
  return 'unknown';
}

/**
 * 校验一个上传文件（扩展名 + magic + 模态建议）。
 * @returns {{ok: boolean, reasons: string[], warnings: string[], ext: string, magic: string, modality: string}}
 */
export function validateUpload(name, headerBuf) {
  const reasons = [];
  const warnings = [];
  const sanitized = sanitizeFilename(name);
  if (!sanitized) {
    return { ok: false, reasons: [`文件名非法或含路径穿越: ${name}`], warnings, ext: '', magic: 'unknown', modality: 'unknown' };
  }
  if (!extAllowed(sanitized)) {
    reasons.push(`扩展名不在白名单（允许：${ALLOWED_EXT.join(' ')}）`);
  }
  const magic = detectMagic(headerBuf);
  const modality = suggestModality(sanitized, magic);
  // magic 与扩展名一致性（软校验，记 warning 不阻断）
  const lower = sanitized.toLowerCase();
  if (lower.endsWith('.h5ad') && magic !== 'hdf5') {
    reasons.push(`.h5ad 应为 HDF5，实测 magic=${magic}`);
  }
  if ((lower.endsWith('.gz') || lower.endsWith('.tar.gz')) && magic !== 'gzip' && magic !== 'tar') {
    warnings.push(`.gz 文件 magic=${magic}（可能非 gzip，请确认）`);
  }
  if ((lower.endsWith('.txt') || lower.endsWith('.tsv') || lower.endsWith('.csv')) && magic !== 'text') {
    warnings.push(`文本文件 magic=${magic}（可能含二进制内容）`);
  }
  if (magic === 'binary' && modality === 'unknown') {
    warnings.push('二进制且无法识别格式，请确认');
  }
  return { ok: reasons.length === 0, reasons, warnings, ext: path.extname(sanitized), magic, modality };
}

/**
 * 上传会话目录；id 不合法返回 null。
 *
 * 判定委托 shared/upload_session.mjs 的 isSafeUploadId（与前端缓存校验同一口径）：
 * 只允许 [A-Za-z0-9._-]，拒绝空串 / 点段 / 任何含 '..' 的串 / 隐藏名。
 * 比旧实现更严格：旧实现先把非法字符「剥掉」再判定，'a/b' 会被静默改写成 'ab'，
 * 让一个非法 id 悄悄指向另一个会话目录；现在一律返回 null，由调用方报 400。
 */
export function uploadDir(uploadId) {
  return sessionDirIn(UPLOAD_ROOT, uploadId);
}

/** 会话目录（root 可注入：单测在临时目录里跑，不碰真实 .uploads） */
function sessionDirIn(root, uploadId) {
  const raw = String(uploadId ?? '');
  if (!isSafeUploadId(raw)) return null;
  return path.join(root, raw);
}

/** 创建上传会话目录（幂等：已存在时只补建，不碰已落盘分片） */
export function initUpload(uploadId) {
  const dir = uploadDir(uploadId);
  if (!dir) throw new Error(`uploadId 非法: ${uploadId}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 解析 POST /api/upload/init 的上传会话 id（纯函数，便于单测）。
 *
 * 三种来源，优先级从高到低：
 *   1. 请求带 fingerprint：客户端用 shared/upload_session.mjs 的同一纯函数算出指纹，
 *      服务端只做派生，前后端得到同一个 id（刷新 / 换浏览器都能续传）。
 *   2. 请求带 size + lastModified（脚本或老客户端）：服务端用同一纯函数重算指纹再派生；
 *      调用方必须已把 projectId / lineId / filename 换成校验后的值。
 *   3. 都不带：回落 randomUUID，保持既有 HTTP 契约（老客户端仍按服务端给的 id 上传）。
 *
 * @returns {{uploadId: string, deterministic: boolean, reason?: string}}
 */
export function resolveUploadId(requested = {}) {
  const fingerprint = requested?.fingerprint;
  // 只要请求体里出现了 fingerprint 键，就必须是合法非空字符串：宁可 400 报错，
  // 也不要悄悄回落到随机 UUID（那样前端以为能续传，实际每次都新建会话）。
  // 键完全缺省（undefined）才算「老客户端」，走下面的 size + lastModified 或 UUID 分支。
  if (fingerprint !== undefined) {
    if (
      typeof fingerprint !== 'string'
      || fingerprint.length === 0
      || fingerprint.length > 1024
      || /[\u0000-\u001f\u007f]/.test(fingerprint)
    ) {
      return { uploadId: '', deterministic: false, reason: 'invalid_fingerprint' };
    }
    return { uploadId: uploadIdFromFingerprint(fingerprint), deterministic: true };
  }
  const size = requested?.size;
  const lastModified = requested?.lastModified;
  if (Number.isFinite(size) && size >= 0 && Number.isFinite(lastModified) && lastModified >= 0) {
    const fromFacts = uploadFingerprint({
      project: requested?.projectId,
      lineId: requested?.lineId,
      name: requested?.filename,
      size,
      lastModified,
    });
    return { uploadId: uploadIdFromFingerprint(fromFacts), deterministic: true };
  }
  return { uploadId: randomUUID(), deterministic: false };
}

/** 写入一个分片 */
export function writeChunk(uploadId, index, buf) {
  const dir = uploadDir(uploadId);
  if (!dir) throw new Error(`uploadId 非法: ${uploadId}`);
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx > 100000) {
    throw new Error(`分片序号非法: ${index}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${idx}.part`), buf);
  return idx;
}

/** 已收分片列表 */
export function listChunks(uploadId) {
  const dir = uploadDir(uploadId);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.part'))
    .map((f) => Number(f.replace('.part', '')))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

/**
 * 上传会话的续传状态（纯函数，供 HTTP 层与单测复用）。
 *
 * 续传口径：nextIndex 取「从 0 开始第一个缺失的分片序号」，即最小缺失口径。
 * 例：已收 [0,1,3] → nextIndex=2，前端从 2 起补传，3 会被重写一次
 * （writeChunk 是覆盖写，幂等），assemble 仍要求 0..N 连续。
 * 之所以不用「连续段长度」口径：[0,2] 两种口径都得 1，但 [1,2] 缺 0 时
 * 连续段口径会给出 0 却让 1、2 白占空间；最小缺失口径语义更直白，
 * 且与 assembleChunks 的「必须从 0 连续」判定天然一致。
 *
 * uploadId 走 sanitizeFilename 同款消毒：'..'、路径分隔符、隐藏名一律拒绝，
 * 非法 id 只返回 reason='invalid_id'，绝不让调用方拿到可穿越的目录路径。
 *
 * @returns {{ok: boolean, uploadId: string, exists: boolean, reason?: string,
 *   chunks: number[], nextIndex: number, receivedBytes: number, chunkSize: number}}
 */
export function uploadStatus(uploadId) {
  const raw = String(uploadId ?? '');
  const base = {
    ok: false, uploadId: raw, exists: false, chunks: [],
    nextIndex: 0, receivedBytes: 0, chunkSize: CHUNK_SIZE,
  };
  const safe = sanitizeFilename(raw);
  if (!safe) return { ...base, reason: 'invalid_id' };
  const dir = path.join(UPLOAD_ROOT, safe);
  let exists = false;
  try {
    exists = fs.statSync(dir).isDirectory();
  } catch {
    exists = false;   // 没传过（目录不存在）或不可读，一律按未开始处理
  }
  if (!exists) return { ...base, reason: 'not_found' };
  // 复用 listChunks 扫描分片（不另写一套扫描）；脏文件名已被 Number 过滤，
  // 这里再滤掉负序号与重复项，避免一个 -1.part 让 nextIndex 永远算成 0。
  const chunks = [...new Set(listChunks(safe).filter((n) => n >= 0))].sort((a, b) => a - b);
  let receivedBytes = 0;
  for (const idx of chunks) {
    try {
      receivedBytes += fs.statSync(path.join(dir, `${idx}.part`)).size;
    } catch {
      // 并发删除（别的请求刚清理会话）：该片不计入字节数，不影响其余判定
    }
  }
  const present = new Set(chunks);
  let nextIndex = 0;
  while (present.has(nextIndex)) nextIndex += 1;
  return {
    ok: true, uploadId: raw, exists: true, chunks, nextIndex, receivedBytes, chunkSize: CHUNK_SIZE,
  };
}

/** 合并分片为完整文件，返回本地路径 */
export function assembleChunks(uploadId, filename) {
  const dir = uploadDir(uploadId);
  const safe = sanitizeFilename(filename);
  if (!dir || !safe) throw new Error(`参数非法: ${uploadId}/${filename}`);
  const parts = listChunks(uploadId);
  if (parts.length === 0) throw new Error('没有任何分片');
  // 分片必须从 0 连续
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i] !== i) throw new Error(`分片不连续，缺 ${i}`);
  }
  const outPath = path.join(dir, safe);
  const tmpPath = `${outPath}.assembling-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tmpPath, 'w');
  try {
    for (const idx of parts) {
      const data = fs.readFileSync(path.join(dir, `${idx}.part`));
      fs.writeSync(fd, data);
    }
    // 原子收口（2026-11-11 P1）：先写同目录临时文件再 rename，进程在合并中途
    // 崩溃时留下的是 .assembling-* 临时件而不是一个被当成「已合并完成」的半成品。
    fs.renameSync(tmpPath, outPath);
  } finally {
    fs.closeSync(fd);
    try { fs.rmSync(tmpPath, { force: true }); } catch { /* 已 rename 则不存在 */ }
  }
  return outPath;
}

/** 读文件头用于 magic 校验 */
export function readHeader(filePath, bytes = 512) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.slice(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/** 服务器目标路径（本项目本线的 raw_data） */
export function remoteRawPath(projectId, lineId, filename) {
  if (!LINES.includes(lineId)) throw new Error(`lineId 非法: ${lineId}`);
  const safeProject = sanitizeProjectId(projectId);
  if (!safeProject) throw new Error(`projectId 非法: ${projectId}`);
  const safe = sanitizeFilename(filename);
  if (!safe) throw new Error(`文件名非法: ${filename}`);
  return `${projectLineDir(safeProject, lineId)}/raw_data/${safe}`;
}

/**
 * 数据文件在远端 raw_data/ 的落盘名。
 *
 * 母版脚本按文件名特征分流（prep_matrix 认 `*grouping*` / `*GPL*` / `*series_matrix*.txt.gz`），
 * 客户上传的中文名（如「分组情况.txt」）不匹配任何规则，会直接 exit 2。
 * 因此把 group_map 角色归一为母版契约名 grouping.txt；其余角色保留原名，
 * 自有上传模式的文件名一致性校验依赖原名，改名会让校验与实际文件脱节。
 */
export function deployedRawName(file) {
  const name = String(file?.name || '');
  if (file?.role === 'group_map' && !/grouping/i.test(name)) return 'grouping.txt';
  return name;
}

/** 清理上传会话 */
export function cleanupUpload(uploadId) {
  const dir = uploadDir(uploadId);
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================
// 陈旧上传会话清理（.uploads 下超过 TTL 的 <uploadId>/ 目录）
//
// 为什么需要：客户端中断上传后会话目录会永久留在 .uploads 里，占磁盘且让
// 「这个 id 还有没有分片」的判断失真。会话目录的 mtime 随每个分片写入刷新，
// 所以「mtime 早于 now - ttl」就是「这个会话已经没人动了」的可靠信号。
// ============================================================

/** 默认 TTL：24 小时。超过这个时长没有新分片写入的会话目录视为陈旧 */
export const DEFAULT_UPLOAD_TTL_HOURS = 24;

/** 惰性清理最小间隔：10 分钟最多扫一次 .uploads，避免每个 init 都 readdir */
export const GC_MIN_INTERVAL_MS = 10 * 60 * 1000;

/** TTL 毫秒数：BIO_UPLOAD_TTL_HOURS 可覆盖（正数小时），非法值回落 24h */
export function uploadTtlMs(env = process.env) {
  const hours = Number(env?.BIO_UPLOAD_TTL_HOURS);
  if (Number.isFinite(hours) && hours > 0) return Math.round(hours * 60 * 60 * 1000);
  return DEFAULT_UPLOAD_TTL_HOURS * 60 * 60 * 1000;
}

/** 上传暂存默认总量配额：20GiB。TTL 之外的第二道闸门，防多个活跃会话把磁盘撑爆 */
export const DEFAULT_UPLOAD_QUOTA_BYTES = 20 * 1024 * 1024 * 1024;

/**
 * 总量配额字节数：BIO_UPLOAD_QUOTA_BYTES 可覆盖（字节，允许 0 表示「一个会话都不收」）。
 * 缺省、空串、非数字、负数一律回落默认值：配额读错时按最保守的默认值跑，
 * 而不是把配额当成 0 把用户全部挡在门外，也不是当成 Infinity 放任磁盘被写满。
 * @returns {number} 配额字节数
 */
export function uploadQuotaBytes(env = process.env) {
  const raw = env?.BIO_UPLOAD_QUOTA_BYTES;
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_UPLOAD_QUOTA_BYTES;
  const bytes = Number(raw);
  if (!Number.isFinite(bytes) || bytes < 0) return DEFAULT_UPLOAD_QUOTA_BYTES;
  return Math.round(bytes);
}

/**
 * 单个上传会话目录当前占用的字节数（配额统计用）。
 *
 * 口径：累加目录下普通文件的 size，不取 statSync(dir).size。
 * 理由：dir.size 在 Linux 常见文件系统上只是目录项自身大小（ext4 上长期是 4096，
 * 只随目录项数量增长），跟里面装了多少数据无关，拿它当配额等于没配；
 * 真实文件字节才是可靠口径。
 *
 * 只扫一层：本模块往会话目录里写的全是扁平文件（initUpload 建目录、
 * writeChunk 写 <index>.part、assembleChunks 写合并后的原文件），不会建子目录，
 * 所以一层扫描即覆盖全部占用。单次 readdir / stat 失败按 0 字节计并记 errors，
 * 不让一次测量失败连累整个清理（清理是旁路动作）。
 *
 * @returns {number} 该会话目录的文件字节数（测量失败按 0 计）
 */
function sessionUsageBytes(dir, name, fsImpl, errors) {
  let entries;
  try {
    entries = fsImpl.readdirSync(dir, { withFileTypes: true });
  } catch (cause) {
    errors.push({ name, message: messageOf(cause) });
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    if (!entry?.isFile?.()) continue;
    try {
      total += Number(fsImpl.statSync(path.join(dir, String(entry.name))).size) || 0;
    } catch (cause) {
      errors.push({ name, message: messageOf(cause) });
    }
  }
  return total;
}

function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * 删除 .uploads 下陈旧的会话目录（root / now / ttl / fs 全部可注入，便于单测）。
 *
 * 判定口径（第一阶段：TTL，与旧版完全一致）：
 *   - 只看 UPLOAD_ROOT 的一级目录，且目录名必须过 isSafeUploadId；不是本模块建的目录一律不碰；
 *   - 目录 mtime 比 now 早超过 ttlMs 才删（age === ttlMs 保留，边界不删）；
 *   - 单个目录的 stat / rm 失败只记 errors，不抛出：清理是旁路动作，不能连累上传请求；
 *   - UPLOAD_ROOT 不存在（还没传过任何文件）按正常状态处理，不记错。
 *
 * 判定口径（第二阶段：总量配额，本次新增）：
 *   TTL 只保证单个会话最终会被清掉，挡不住「同时活跃的会话太多把磁盘撑爆」：
 *   一个 20GB 的 h5ad 分片传一半，mtime 永远是新的，TTL 永远不删它。所以 TTL 之后
 *   再加一道总量闸门：把第一阶段留下的会话按占用字节求和，超过 quotaBytes 就从
 *   最旧（mtime 最小）的会话开始淘汰，直到降到配额内或没有可淘汰对象。
 *   - 活跃会话（now - mtime < GC_MIN_INTERVAL_MS）一律不淘汰：它正在被写入，删掉等于
 *     丢用户数据，宁可超配额也不能删。这类会话计入 kept，并在 report.active 里单列，
 *     便于运维看清「为什么清了还超」；
 *   - 配额测量失败（单次 readdir / stat 报错）按 0 字节计并记 errors：宁可低估占用，
 *     也不能因为一次测量失败把用户正在传的会话删掉。
 *
 * 报告字段语义：
 *   scanned / removed / kept / errors 沿用旧语义，removed 只装第一阶段删掉的会话；
 *   evicted 装第二阶段淘汰掉的会话（与 removed 互斥）；
 *   totalBytes 为第二阶段测量到、清理完成后仍然存活的会话总占用字节；
 *   quotaBytes 为本次生效的配额；overQuota 表示「清完仍然超配额」；
 *   active 为存活且判定为活跃的会话。
 *
 * @returns {{scanned: number, removed: string[], kept: string[], errors: Array<{name: string, message: string}>,
 *            evicted: string[], totalBytes: number, quotaBytes: number, overQuota: boolean, active: string[]}}
 */
export function gcStaleUploads({
  root = UPLOAD_ROOT,
  now = Date.now(),
  ttlMs = uploadTtlMs(),
  quotaBytes = uploadQuotaBytes(),
  fsImpl = fs,
  logger = console,
} = {}) {
  const report = {
    scanned: 0,
    removed: [],
    kept: [],
    errors: [],
    evicted: [],
    totalBytes: 0,
    quotaBytes: Number(quotaBytes),
    overQuota: false,
    active: [],
  };
  let entries;
  try {
    entries = fsImpl.readdirSync(root, { withFileTypes: true });
  } catch (cause) {
    if (cause && cause.code === 'ENOENT') return report;
    report.errors.push({ name: '', message: messageOf(cause) });
    return report;
  }
  const survivors = [];
  for (const entry of entries) {
    const name = String(entry?.name ?? '');
    if (!entry?.isDirectory?.()) continue;
    if (!isSafeUploadId(name)) continue;
    report.scanned += 1;
    const dir = path.join(root, name);
    let mtimeMs;
    try {
      mtimeMs = fsImpl.statSync(dir).mtimeMs;
    } catch (cause) {
      report.errors.push({ name, message: messageOf(cause) });
      continue;
    }
    if (now - mtimeMs <= ttlMs) {
      survivors.push({ name, dir, mtimeMs });
      continue;
    }
    try {
      fsImpl.rmSync(dir, { recursive: true, force: true });
      report.removed.push(name);
    } catch (cause) {
      report.errors.push({ name, message: messageOf(cause) });
      logger?.warn?.(`[bioanalys-desktop] 清理陈旧上传会话失败（已忽略）: ${name}: ${messageOf(cause)}`);
    }
  }
  // 第二阶段：TTL 之后仍然存活的总量配额闸门
  const quota = Number(quotaBytes);
  const measured = survivors.map((item) => ({
    ...item,
    bytes: sessionUsageBytes(item.dir, item.name, fsImpl, report.errors),
  }));
  let totalBytes = measured.reduce((sum, item) => sum + item.bytes, 0);
  report.totalBytes = totalBytes;
  if (Number.isFinite(quota) && totalBytes > quota) {
    // 最旧优先淘汰；mtime 相同按名字排序，保证淘汰顺序可重现
    const evictable = measured
      .filter((item) => now - item.mtimeMs >= GC_MIN_INTERVAL_MS)
      .sort((a, b) => a.mtimeMs - b.mtimeMs || (a.name < b.name ? -1 : 1));
    for (const item of evictable) {
      if (totalBytes <= quota) break;
      try {
        fsImpl.rmSync(item.dir, { recursive: true, force: true });
      } catch (cause) {
        report.errors.push({ name: item.name, message: messageOf(cause) });
        logger?.warn?.(`[bioanalys-desktop] 配额淘汰上传会话失败（已忽略）: ${item.name}: ${messageOf(cause)}`);
        continue;
      }
      report.evicted.push(item.name);
      totalBytes -= item.bytes;
    }
  }
  report.totalBytes = totalBytes;
  report.kept.push(...measured.filter((item) => !report.evicted.includes(item.name)).map((item) => item.name));
  report.active = measured
    .filter((item) => !report.evicted.includes(item.name) && now - item.mtimeMs < GC_MIN_INTERVAL_MS)
    .map((item) => item.name);
  report.overQuota = Number.isFinite(quota) && totalBytes > quota;
  return report;
}

/** 惰性清理的节流状态；-Infinity 表示「从未跑过」 */
let lastGcAt = Number.NEGATIVE_INFINITY;

/** 重置节流状态（仅供测试：让下一次 maybeGcStaleUploads 一定真正执行） */
export function resetUploadGcThrottle() {
  lastGcAt = Number.NEGATIVE_INFINITY;
}

/**
 * 惰性清理入口：默认 10 分钟最多执行一次，异常一律吞掉。
 *
 * 服务启动时直接调 gcStaleUploads() 跑一次全量；每次 init 调本函数（节流）。
 * 必须吞异常的理由：上传接口不能因为一次目录清理失败就 500。
 *
 * @returns {ReturnType<typeof gcStaleUploads>|null} 本次真正执行时返回报告；被节流跳过返回 null
 */
export function maybeGcStaleUploads(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const minIntervalMs = Number.isFinite(options.minIntervalMs) ? options.minIntervalMs : GC_MIN_INTERVAL_MS;
  if (now - lastGcAt < minIntervalMs) return null;
  lastGcAt = now;
  try {
    const report = gcStaleUploads({ ...options, now });
    if (report.removed.length > 0) {
      (options.logger || console)?.log?.(`[bioanalys-desktop] 清理陈旧上传会话 ${report.removed.length} 个`);
    }
    return report;
  } catch (cause) {
    (options.logger || console)?.warn?.(`[bioanalys-desktop] 上传会话清理异常（已忽略）: ${messageOf(cause)}`);
    return null;
  }
}

// ============================================================
// 会话级预留额度（reservedBytes）与分片写入前的硬闸门
//
// 为什么需要（aims v2.5 第三节 1 模块 B）：
//   原来只有 .uploads 总量配额（BIO_UPLOAD_QUOTA_BYTES），它是全局的，挡不住
//   单个会话虚报体积：客户端说 10MB，实际可以一直传下去，直到把全局配额吃满
//   才被拦；总量配额也回答不了「这个会话还能收多少字节」。所以 init 时把客户端
//   声明的 fileSize 落成会话元数据里的 reservedBytes（原子写：先 .tmp 再 rename），
//   chunk 写盘之前先按它做一次 413 硬闸门：已收 + 本片 > 预留，就一个字节都不写。
//
// 顺序与语义：
//   413（本会话额度不够）必须优先于 507（全局空间满）。前者客户端能自己修
//   （换文件，或重新 init 声明更大的 fileSize），后者只能等或清理；先报 413 才
//   不会让用户误以为「服务器满了」。
//
// 向后兼容：
//   init 不带 fileSize（老客户端 / 脚本）时 reservedBytes = null，预留闸门整体
//   跳过，除多一道总量配额判断外，行为与本次改动之前一致。
// ============================================================

/** 会话元数据文件名（与分片 <index>.part 同目录，扁平，一层扫描即可覆盖） */
export const SESSION_META_NAME = 'session.json';

/** 元数据临时文件名：先写它再 rename，保证读方永远读不到半截 JSON */
const SESSION_META_TMP = `${SESSION_META_NAME}.tmp`;

/**
 * 声明大小 -> 预留额度。只接受有限非负数字，其余（缺失 / 字符串 / 负数 / NaN /
 * Infinity）一律 null，表示「本会话没有预留额度」，闸门跳过。
 * 用 Math.floor 而不是 Math.round：预留额度只能小于或等于声明值，不能因为
 * 四舍五入把额度放大一点点，否则「正好等于文件大小」的合法上传会被 413 误杀。
 * @returns {number|null}
 */
export function normalizeReservedBytes(fileSize) {
  if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || fileSize < 0) return null;
  return Math.floor(fileSize);
}

/** 会话元数据路径；id 非法返回 null（绝不落到文件系统） */
export function sessionMetaPath(uploadId, { root = UPLOAD_ROOT } = {}) {
  const dir = sessionDirIn(root, uploadId);
  return dir ? path.join(dir, SESSION_META_NAME) : null;
}

/**
 * 原子写会话元数据：先写 session.json.tmp，再 rename 覆盖 session.json。
 * 为什么必须原子：chunk 端每个分片都要读它，若直接覆盖写，并发或中断时可能读到
 * 半截 JSON；rename 在同一文件系统内是原子的，读方要么读到旧版本要么读到新版本。
 * @returns {object} 落盘的元数据对象（字段已归一）
 */
export function writeSessionMeta(uploadId, meta = {}, { root = UPLOAD_ROOT, fsImpl = fs } = {}) {
  const dir = sessionDirIn(root, uploadId);
  if (!dir) throw new Error(`uploadId 非法: ${uploadId}`);
  fsImpl.mkdirSync(dir, { recursive: true });
  const payload = {
    uploadId: String(uploadId),
    name: meta.name ?? null,
    project: meta.project ?? null,
    lineId: meta.lineId ?? null,
    fileSize: meta.fileSize ?? null,
    reservedBytes: normalizeReservedBytes(meta.reservedBytes),
    createdAt: meta.createdAt ?? new Date().toISOString(),
  };
  fsImpl.writeFileSync(path.join(dir, SESSION_META_TMP), `${JSON.stringify(payload)}\n`);
  fsImpl.renameSync(path.join(dir, SESSION_META_TMP), path.join(dir, SESSION_META_NAME));
  return payload;
}

/**
 * 读会话元数据（绝不抛出）。
 * @returns {{ok: boolean, meta: object|null, reason?: string}}
 *   reason：'invalid_id' | 'not_found' | 'corrupt'
 *   corrupt 表示文件在但不是合法 JSON 对象（半截写入 / 人手改坏 / 非对象 JSON）：
 *   一律降级为「没有元数据」，chunk 端按无预留额度处理。一个坏文件不能把上传打死。
 */
export function readSessionMeta(uploadId, { root = UPLOAD_ROOT, fsImpl = fs } = {}) {
  const dir = sessionDirIn(root, uploadId);
  if (!dir) return { ok: false, meta: null, reason: 'invalid_id' };
  let text;
  try {
    text = fsImpl.readFileSync(path.join(dir, SESSION_META_NAME), 'utf8');
  } catch (cause) {
    const missing = cause && cause.code === 'ENOENT';
    return { ok: false, meta: null, reason: missing ? 'not_found' : 'corrupt' };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, meta: null, reason: 'corrupt' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, meta: null, reason: 'corrupt' };
  }
  return { ok: true, meta: parsed };
}

/** 清会话元数据（不存在视为已清，不抛出）。@returns {boolean} 是否删除成功 */
export function clearSessionMeta(uploadId, { root = UPLOAD_ROOT, fsImpl = fs } = {}) {
  const dir = sessionDirIn(root, uploadId);
  if (!dir) return false;
  try {
    fsImpl.rmSync(path.join(dir, SESSION_META_NAME), { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 预留额度判定（纯函数）：已收 + 本片 > 预留 -> 413。
 * 边界：恰好等于预留额度放行。客户端按 fileSize 精确切分时，最后一片往往正好
 * 顶到额度，若写成 >= 会把每一次正常上传的收尾片都判成超额。
 * @returns {{ok: true} | {ok: false, status: number, reason: string, error: string}}
 */
export function checkReservedBytes({ reservedBytes, receivedBytes, chunkLength } = {}) {
  const reserved = normalizeReservedBytes(reservedBytes);
  if (reserved === null) return { ok: true };
  const received = Number(receivedBytes) || 0;
  const length = Number(chunkLength) || 0;
  if (received + length <= reserved) return { ok: true };
  return {
    ok: false,
    status: 413,
    reason: 'reserved_exceeded',
    error: `超出本次会话预留额度：已收 ${received} 字节 + 本片 ${length} 字节 > 预留 ${reserved} 字节`,
  };
}

/** 会话目录里除 skipIndex 之外的分片字节和（同序号重传按「替换」而非「追加」计） */
function receivedBytesIn(dir, skipIndex, fsImpl) {
  let entries;
  try {
    entries = fsImpl.readdirSync(dir);
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const name = String(entry);
    if (!name.endsWith('.part')) continue;
    const idx = Number(name.slice(0, -'.part'.length));
    if (!Number.isInteger(idx) || idx === skipIndex) continue;
    try {
      total += Number(fsImpl.statSync(path.join(dir, name)).size) || 0;
    } catch {
      // 并发删除（别的请求刚清理会话）：该片不计入字节数，不影响其余判定
    }
  }
  return total;
}

/**
 * .uploads 根下所有合法会话目录的占用字节和（总量配额判定用）。
 * 口径与 gcStaleUploads 一致：只认一级目录 + isSafeUploadId + 一层扁平文件；
 * 测量失败按 0 计（宁可低估占用，也不能因为一次测量失败把正常上传挡掉）。
 */
export function uploadRootUsageBytes({ root = UPLOAD_ROOT, fsImpl = fs } = {}) {
  let entries;
  try {
    entries = fsImpl.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  const errors = [];
  let total = 0;
  for (const entry of entries) {
    const name = String(entry?.name ?? '');
    if (!entry?.isDirectory?.() || !isSafeUploadId(name)) continue;
    total += sessionUsageBytes(path.join(root, name), name, fsImpl, errors);
  }
  return total;
}

/**
 * 分片写入前的准入判定（供 POST /api/upload/chunk 调用）。
 *
 * 判定顺序固定，不可调换：
 *   1. uploadId / index / chunkLength 合法性 -> 400（与 writeChunk 的既有口径一致）；
 *   2. 会话预留额度（有 reservedBytes 且 已收 + 本片 > 预留）-> 413，一个字节都不写；
 *   3. .uploads 总量配额（本片写入后占用 > BIO_UPLOAD_QUOTA_BYTES）-> 507。
 * 同序号重传（续传时前端可能重发一片）按替换计算：先从已收里扣掉该序号已占字节，
 * 否则一次幂等重传就会被误判成超额。
 *
 * @returns {{ok: true, reservedBytes: number|null, receivedBytes: number, index: number, chunkLength: number}
 *          | {ok: false, status: number, reason: string, error: string}}
 */
export function checkChunkAdmission({
  uploadId, index, chunkLength,
  root = UPLOAD_ROOT, quotaBytes = uploadQuotaBytes(), fsImpl = fs,
} = {}) {
  const raw = String(uploadId ?? '');
  const dir = sessionDirIn(root, raw);
  if (!dir) return { ok: false, status: 400, reason: 'invalid_id', error: `uploadId 非法: ${raw}` };
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx > 100000) {
    return { ok: false, status: 400, reason: 'invalid_index', error: `分片序号非法: ${index}` };
  }
  const length = Number(chunkLength);
  if (!Number.isFinite(length) || length < 0) {
    return { ok: false, status: 400, reason: 'invalid_length', error: `分片长度非法: ${chunkLength}` };
  }
  let existingBytes = 0;
  try {
    existingBytes = Number(fsImpl.statSync(path.join(dir, `${idx}.part`)).size) || 0;
  } catch {
    existingBytes = 0;
  }
  const metaRead = readSessionMeta(raw, { root, fsImpl });
  // 元数据缺失 / 损坏都降级为「无预留额度」：老会话与坏文件照旧能传，只少一道闸门
  const reservedBytes = metaRead.ok ? normalizeReservedBytes(metaRead.meta.reservedBytes) : null;
  const receivedBytes = receivedBytesIn(dir, idx, fsImpl);
  const base = { reservedBytes, receivedBytes, index: idx, chunkLength: length };
  if (reservedBytes !== null) {
    const verdict = checkReservedBytes({ reservedBytes, receivedBytes, chunkLength: length });
    if (!verdict.ok) return { ...verdict, ...base };
  }
  const quota = Number(quotaBytes);
  if (Number.isFinite(quota)) {
    const usage = uploadRootUsageBytes({ root, fsImpl });
    const projected = usage - existingBytes + length;
    if (projected > quota) {
      return {
        ok: false,
        status: 507,
        reason: 'quota_exceeded',
        error: `上传暂存空间已满：本片写入后占用 ${projected} 字节，超过配额 ${quota} 字节；`
          + '请等待进行中的上传完成或清理旧会话后重试',
        ...base,
      };
    }
  }
  return { ok: true, ...base };
}


