/**
 * atomic_write.js —— Node 侧双语原子落盘保护（4 Argon 第 74 轮 Q2/Phase 2 契约）
 *
 * 规范：统一先写同目录隐藏临时文件 .tmp.<basename>.<pid>.<uuid>，
 * 刷新落盘后原子 rename 到正式目标路径。
 * 若中途异常抛错或被强杀，清理临时文件，正式目标路径绝不留半截残缺脏文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function atomicWriteFileSync(filePath, data, options = 'utf8') {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const rand = crypto.randomBytes(4).toString('hex');
  const tmpPath = path.join(dir, `.tmp.${base}.${process.pid}.${rand}`);

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, data, options);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}
