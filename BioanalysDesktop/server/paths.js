/**
 * 路径真源：资产根与数据根分离。
 *
 * - ASSET_ROOT：只读资产与代码所在根（tools/、schemas/、references/、configs/、shared/、dist/）。
 * - DATA_HOME：可写数据根（workspace/、portal/、.tmp/、.ops_state/、.uploads/、ledger/）。
 *   未设置时回落 ASSET_ROOT，保持仓库内开发与既有测试行为不变。
 * - 桌面打包运行时由 Electron 主进程注入 BIO_ASSET_ROOT 与 BIO_DATA_HOME。
 *
 * 约定：任何写操作必须走 dataPath()，任何随包只读资产必须走 assetPath()。
 * 新增路径前先看这里，不要在业务模块里另造根。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 只读资产根：默认取 server/ 上两级（仓库根或打包后的 resources/runtime）。 */
export const ASSET_ROOT = process.env.BIO_ASSET_ROOT
  ? path.resolve(process.env.BIO_ASSET_ROOT)
  : path.resolve(HERE, '..', '..');

/** 可写数据根：未设置时为 null，所有 dataPath 回落资产根。 */
export const DATA_HOME = process.env.BIO_DATA_HOME
  ? path.resolve(process.env.BIO_DATA_HOME)
  : null;

/** 当前实际数据根。开发与测试默认等于仓库根。 */
export const DATA_ROOT = DATA_HOME ?? ASSET_ROOT;

/** 是否处于打包运行面（数据根与资产根分离）。 */
export const IS_PACKAGED_RUNTIME = Boolean(DATA_HOME);

export function assetPath(...parts) {
  return path.join(ASSET_ROOT, ...parts);
}

export function dataPath(...parts) {
  return path.join(DATA_ROOT, ...parts);
}

/** 动态工作区四层收敛路径真源 */
export function referencesDbPath(...parts) {
  return dataPath('workspace', 'references_db', ...parts);
}

export function inboxPath(...parts) {
  return dataPath('workspace', 'inbox', ...parts);
}

export function runsPath(...parts) {
  return dataPath('workspace', 'runs', ...parts);
}

export function deliverablesPath(...parts) {
  return dataPath('workspace', 'deliverables', ...parts);
}

/**
 * 先数据根、后资产根解析一个仓库内相对路径。
 *
 * 用途：打包时示例图随资产根分发，用户产物落数据根；同名路径优先用户产物。
 * 非法路径（绝对路径、含 .. 段）返回 null，调用方按缺失处理。
 */
export function resolveDataOrAsset(relativePath) {
  const rel = String(relativePath ?? '').replace(/\\/g, '/');
  if (!rel || path.isAbsolute(rel) || rel.split('/').includes('..')) return null;
  const dataCandidate = path.resolve(DATA_ROOT, rel);
  if (fs.existsSync(dataCandidate)) return dataCandidate;
  return path.resolve(ASSET_ROOT, rel);
}

/** 文件是否位于给定根内（含根本身）。路径穿越与跨根引用判据统一走这里。 */
export function isInsideRoot(filePath, root) {
  const resolvedRoot = path.resolve(String(root));
  const resolvedFile = path.resolve(String(filePath));
  return resolvedFile === resolvedRoot || resolvedFile.startsWith(resolvedRoot + path.sep);
}
