/**
 * shared/upload_session.mjs：上传会话「确定性 uploadId」的唯一权威
 *
 * 为什么要有这个文件（架构评审 R5 续传的遗留缺口）：
 *   工作台上传原来每次 POST /api/upload/init 都 randomUUID，服务端分片目录名与文件本身
 *   没有任何稳定关系。刷新页面或换浏览器后，客户端只能靠 localStorage 记住旧 id 才可能续传，
 *   换浏览器/清缓存就必然从 0 重传。
 *   本模块把「文件指纹 -> uploadId」收敛为一个纯函数：同一个文件（同项目、同归属线、同文件名、
 *   同字节数、同修改时间）在任何浏览器、任何刷新后都算出同一个 id，服务端按 id 落盘，
 *   续传只需 GET /api/upload/status 查已收分片，不再依赖任何本地存储。
 *
 * 唯一权威：前端（BioanalysDesktop/src/lib/uploadSession.ts 转出）与服务端
 *   （BioanalysDesktop/server/upload.js 的 resolveUploadId）都从这里取函数，
 *   不允许任何一端另写一份派生规则；改格式只改本文件。
 *
 * 零依赖 ESM：不 import 任何模块（SHA-256 自带实现，浏览器与 Node 都能直接加载），
 *   与 shared/data_formats.mjs 同一风格。sha256Hex 只用于非安全场景的会话命名，
 *   不作为任何鉴权/校验依据（uploadId 最终还会过 isSafeUploadId 白名单）。
 */

/** uploadId 前缀：固定 'up-'，目录名一眼可辨，且只含 [A-Za-z0-9._-] 白名单字符 */
export const UPLOAD_ID_PREFIX = 'up-';

/** 截取的 SHA-256 十六进制长度：16 hex = 64 bit，会话命名空间足够且目录名短 */
export const UPLOAD_ID_HEX_LEN = 16;

/** SHA-256 轮常量 */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** 浏览器与 Node 都有 TextEncoder；极端环境缺失时退回手写 UTF-8（保持纯函数、无 import） */
const textEncoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;

/** 字符串 -> UTF-8 字节（手写兜底分支只在没有 TextEncoder 的运行时执行） */
function utf8Bytes(text) {
  const str = String(text ?? '');
  if (textEncoder) return textEncoder.encode(str);
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else {
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
  }
  return Uint8Array.from(out);
}

/** 32 位循环右移（JS 位运算是 32 位有符号，结果统一 >>>0 回无符号） */
function rotr(value, bits) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/**
 * SHA-256（同步纯函数，返回小写十六进制）。
 *
 * 自己实现而不 import node:crypto：前端浏览器里没有 node:crypto，若本模块依赖它，
 * 前后端就不可能用同一个函数。实现与标准一致，单测用 node:crypto 逐条对拍。
 *
 * @param {string} input 任意字符串（按 UTF-8 编码）
 * @returns {string} 64 位十六进制摘要
 */
export function sha256Hex(input) {
  const bytes = utf8Bytes(input);
  const bitLength = bytes.length * 8;
  // 补位：0x80 + 若干 0x00，使长度 ≡ 56 (mod 64)，最后 8 字节写大端位长
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const high = Math.floor(bitLength / 0x100000000);
  view.setUint32(padded.length - 8, high, false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((part) => part.toString(16).padStart(8, '0'))
    .join('');
}

/** 转义指纹分量里的分隔符与转义符，避免 'a|b' + 'c' 与 'a' + 'b|c' 撞成同一个指纹 */
function escapePart(value) {
  return String(value ?? '').replace(/%/g, '%25').replace(/\|/g, '%7C');
}

/** 数字分量统一成十进制字符串；非法值按 0（调用方应先校验，这里只保证确定性） */
function numberPart(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? String(Math.trunc(num)) : '0';
}

/**
 * 文件指纹：project|lineId|name|size|lastModified（纯函数、无状态）。
 *
 * 字段顺序即契约，前后端与既有 localStorage 键格式（S32）保持一致，升级后旧缓存仍可读。
 * 其中 size / lastModified 保证「同名但内容已变」的文件不会误续传。
 *
 * @param {{project?: string, lineId?: string, name?: string, size?: number, lastModified?: number}} file
 * @returns {string}
 */
export function uploadFingerprint(file = {}) {
  return [
    escapePart(file.project),
    escapePart(file.lineId),
    escapePart(file.name),
    numberPart(file.size),
    numberPart(file.lastModified),
  ].join('|');
}

/**
 * 由指纹派生确定性 uploadId：'up-' + sha256(fingerprint) 前 16 位十六进制。
 * 指纹为空时返回 ''（调用方据此回落 randomUUID，兼容不带指纹的老客户端）。
 *
 * @param {string} fingerprint uploadFingerprint(...) 的返回值
 * @returns {string}
 */
export function uploadIdFromFingerprint(fingerprint) {
  const text = String(fingerprint ?? '');
  if (!text) return '';
  return UPLOAD_ID_PREFIX + sha256Hex(text).slice(0, UPLOAD_ID_HEX_LEN);
}

/**
 * uploadId 是否可安全用作 .uploads 下的单级目录名。
 *
 * 服务端 uploadDir / 清理逻辑与前端本地缓存校验共用这一个判定：
 * 只允许 [A-Za-z0-9._-]，拒绝空串、点段、任何含 '..' 的串与隐藏名（与 sanitizeFilename 同口径），
 * 避免 '..' 让 path.join 跳出上传根。
 *
 * @param {unknown} uploadId
 * @returns {boolean}
 */
export function isSafeUploadId(uploadId) {
  const raw = String(uploadId ?? '');
  if (!raw || raw.length > 128) return false;
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) return false;
  if (raw === '.' || raw === '..' || raw.includes('..')) return false;
  if (raw.startsWith('.')) return false;
  return true;
}
