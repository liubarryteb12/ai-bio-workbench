import fs from 'node:fs';

/**
 * 删除临时口令文件（BIO_AUTH_RUNTIME_FILE 显式指定时才存在）。
 *
 * 08 号书第 3 项：Windows 的 0o600 是无效权限位，明文口令只能写临时文件，
 * 且进程退出与 SIGINT/SIGTERM 时必须销毁。单独成模块是为了让这条契约
 * 有一个不启动 HTTP 服务的测试面。
 */
export function cleanupAuthRuntimeFile(filePath = process.env.BIO_AUTH_RUNTIME_FILE) {
  if (!filePath) return false;
  try {
    fs.rmSync(filePath, { force: true });
    return true;
  } catch (cause) {
    console.error(`[SECURITY][D-29] 临时口令文件清理失败: ${cause.message}`);
    return false;
  }
}
