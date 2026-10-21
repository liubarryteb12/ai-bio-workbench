/**
 * 上传会话（断点续传）的纯逻辑，供 App.tsx 与 node 测试共用。
 *
 * 为什么单独成模块：这些函数原来散在 App.tsx 里，只能靠浏览器手测。
 * 抽出来以后 node --test 可以直接 import 本文件（Node 22.6+ 的类型擦除），
 * 覆盖指纹稳定性、nextIndex 夹取、localStorage 损坏退化这些分支。
 * 只使用可擦除语法（type / interface / 纯函数），不引入任何运行时依赖。
 *
 * 指纹与 uploadId 的权威定义在仓库根 shared/upload_session.mjs：
 * 服务端（server/upload.js）与前端都从那里取，保证两边算出同一个 id。
 */
import {
  UPLOAD_ID_PREFIX,
  isSafeUploadId,
  uploadFingerprint,
  uploadIdFromFingerprint,
} from '../../../shared/upload_session.mjs';

export { UPLOAD_ID_PREFIX, isSafeUploadId, uploadFingerprint, uploadIdFromFingerprint };

/** 本地缓存键前缀（localStorage 键 = 前缀 + 指纹）；只用于老版本 randomUUID 会话的升级兼容 */
export const UPLOAD_ID_STORE_PREFIX = 'bioanalys.uploadId.';

/** GET /api/upload/status 的响应（字段全部可选：前端只认 typeof 校验过的值） */
export type UploadStatus = {
  ok?: boolean;
  uploadId?: string;
  exists?: boolean;
  reason?: string;
  chunks?: number[];
  nextIndex?: number;
  receivedBytes?: number;
  chunkSize?: number;
  /** 向后兼容字段：与 chunks 同内容（服务端既有键） */
  received?: number[];
  error?: string;
};

/** localStorage 的最小接口：测试里可以注入 Map 假实现，不必有真浏览器 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * 浏览器 localStorage；非浏览器环境（node 测试）或隐私模式不可用时返回 null。
 * 读不到就退化为「不跨刷新续传」，不影响上传本身。
 */
export function browserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 从浏览器 File（或任何有 name/size/lastModified 的对象）算指纹；字段顺序与 shared 模块一致 */
export function fileFingerprint(
  project: string,
  lineId: string,
  file: { name: string; size: number; lastModified: number },
): string {
  return uploadFingerprint({
    project,
    lineId,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
  });
}

/**
 * 读本地缓存的上传会话 id。
 *
 * 缓存值必须过 isSafeUploadId：localStorage 可能被手改、也可能是旧版本留下的脏值，
 * 拿去查 status 只会白跑一次请求；不合法一律当「没有」。
 */
export function readStoredUploadId(
  fingerprint: string,
  storage: StorageLike | null = browserStorage(),
): string | null {
  if (!fingerprint || !storage) return null;
  try {
    const cached = storage.getItem(UPLOAD_ID_STORE_PREFIX + fingerprint);
    if (typeof cached !== 'string') return null;
    return isSafeUploadId(cached) ? cached : null;
  } catch {
    return null;
  }
}

/** 写本地缓存；写不进去（隐私模式 / 配额满）返回 false，不抛给用户 */
export function storeUploadId(
  fingerprint: string,
  uploadId: string,
  storage: StorageLike | null = browserStorage(),
): boolean {
  if (!fingerprint || !isSafeUploadId(uploadId) || !storage) return false;
  try {
    storage.setItem(UPLOAD_ID_STORE_PREFIX + fingerprint, uploadId);
    return true;
  } catch {
    return false;
  }
}

/** 删除本地缓存；失败静默（缓存删不掉只会多一次无效 status 查询，不影响上传） */
export function forgetUploadId(
  fingerprint: string,
  storage: StorageLike | null = browserStorage(),
): void {
  if (!fingerprint || !storage) return;
  try {
    storage.removeItem(UPLOAD_ID_STORE_PREFIX + fingerprint);
  } catch {
    // 同上
  }
}

/**
 * 服务端 nextIndex 夹到 [0, total]：异常值一律回 0（宁可重传，不越界）。
 * total 非法（非数 / 非有限 / <=0）也回 0。
 */
export function resumeStartIndex(status: UploadStatus | null | undefined, total: number): number {
  const limit = typeof total === 'number' && Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const raw = status && typeof status.nextIndex === 'number' ? status.nextIndex : 0;
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(Math.floor(raw), limit);
}
