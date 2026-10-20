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

import { LINES, projectLineDir, sanitizeProjectId } from './domain.js';

/** 上传暂存根（本软件工作目录内，不污染源码） */
export const UPLOAD_ROOT = path.join(process.cwd(), '.uploads');

/** 分片大小 4MB */
export const CHUNK_SIZE = 4 * 1024 * 1024;

/** 允许的扩展名白名单（GEO / 10x / h5ad / 通用表） */
export const ALLOWED_EXT = [
  '.h5ad', '.h5', '.loom', '.mtx', '.tar', '.gz', '.zip',
  '.txt', '.tsv', '.csv', '.soft', '.xlsx', '.rds', '.rdata',
];

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

/** 扩展名是否在白名单内（含双扩展名如 .mtx.gz / .tar.gz） */
export function extAllowed(name) {
  const lower = String(name).toLowerCase();
  return ALLOWED_EXT.some((e) => lower.endsWith(e));
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

/** 上传会话目录 */
export function uploadDir(uploadId) {
  const safe = String(uploadId).replace(/[^A-Za-z0-9._-]/g, '');
  if (!safe) return null;
  return path.join(UPLOAD_ROOT, safe);
}

/** 创建上传会话目录 */
export function initUpload(uploadId) {
  const dir = uploadDir(uploadId);
  if (!dir) throw new Error(`uploadId 非法: ${uploadId}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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
  const fd = fs.openSync(outPath, 'w');
  try {
    for (const idx of parts) {
      const data = fs.readFileSync(path.join(dir, `${idx}.part`));
      fs.writeSync(fd, data);
    }
  } finally {
    fs.closeSync(fd);
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
 * 因此把 group_map 角色归一为母版契约名 grouping.txt；其余角色保留原名——
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
