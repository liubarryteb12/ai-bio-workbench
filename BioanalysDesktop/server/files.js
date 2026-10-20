/**
 * 数据面文件浏览
 *
 * 边界规则：浏览一定限定在"本项目本线"内。越界路径（别的项目、别的线、
 * bio_data 根以外、.. 穿越、绝对路径逃逸）一律拒绝。public_references 是唯一合法共享读入口。
 */

import { LINES, PUBLIC_REFERENCES, projectLineDir, sanitizeProjectId } from './domain.js';

/** 归一化：统一分隔符、折叠 . 与 ..、去掉首尾多余斜杠 */
function normalize(pathLike) {
  const unified = String(pathLike).replace(/\\/g, '/');
  const absolute = unified.startsWith('/');
  const parts = [];
  for (const segment of unified.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      // .. 上一级不存在时丢掉（对应根上方的越界），存在则真的退一级
      if (parts.length > 0) parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return (absolute ? '/' : '') + parts.join('/');
}

/**
 * 断言路径属于指定项目的指定线（或唯一合法共享区）。
 * @param {string} pathLike 待校验路径
 * @param {string} projectId 归属项目
 * @param {string} lineId 归属线
 * @returns {{ok: boolean, reason: string|null, normalized: string}}
 */
export function assertPathInsideProject(pathLike, projectId, lineId) {
  if (!LINES.includes(lineId)) {
    return { ok: false, reason: `line_id 非法: ${lineId}`, normalized: null };
  }
  const safeProject = sanitizeProjectId(projectId);
  if (!safeProject) {
    return { ok: false, reason: `project_id 非法: ${projectId}`, normalized: null };
  }

  const normalized = normalize(pathLike);
  const lineRoot = normalize(projectLineDir(safeProject, lineId));
  const sharedRoot = normalize(PUBLIC_REFERENCES);

  if (normalized === lineRoot || normalized.startsWith(`${lineRoot}/`)) {
    return { ok: true, reason: null, normalized };
  }
  if (normalized === sharedRoot || normalized.startsWith(`${sharedRoot}/`)) {
    return { ok: true, reason: null, normalized };
  }

  // 说清为什么拒：属于同项目的别的线、别的项目，还是完全不在合法根下
  for (const other of LINES) {
    if (other !== lineId && normalized.startsWith(`${normalize(projectLineDir(safeProject, other))}/`)) {
      return {
        ok: false,
        reason: `路径 ${pathLike} 属于 ${other}，与 line_id=${lineId} 不一致（三线互不交叉）`,
        normalized,
      };
    }
  }
  if (normalized.includes('/projects/') && !normalized.startsWith(`${normalize(`${projectLineDir(safeProject, lineId)}`)}`)) {
    return {
      ok: false,
      reason: `路径 ${pathLike} 不在项目 ${safeProject} 内（项目之间物理隔离）`,
      normalized,
    };
  }

  return {
    ok: false,
    reason: `路径 ${pathLike} 不属于 ${lineRoot} 或共享区 ${sharedRoot}`,
    normalized,
  };
}

/**
 * 把 `find` 的结构化输出解析成目录树。
 *
 * 期望每行格式：`<abs_path>|<d|f>|<size_bytes>|<mtime_epoch>`
 * 用 | 分隔而不是默认输出格式，是因为默认格式里文件名可能带空格，容易解错。
 *
 * 树形完全由路径推导：先按路径字典序排序，保证父目录一定先于子节点出现；
 * 中间目录若在 find 输出里缺失，则顺带补出一个占位目录，避免产物被静默丢掉。
 * 只认线根（含）以下的条目，线根本身不作为节点出现，它的子节点才是树的顶层。
 *
 * @param {string} raw find 的输出
 * @param {string} projectId
 * @param {string} lineId
 * @returns {{name: string, children: Array<TreeNode>}}
 */
export function buildTreeFromFind(raw, projectId, lineId) {
  const lineRoot = normalize(projectLineDir(projectId, lineId));
  const entries = String(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((row) => {
      const [absPath, type, size, mtime] = row.split('|');
      return { path: normalize(absPath || ''), type, size: Number(size) || 0, mtime: Number(mtime) || 0 };
    })
    .filter((entry) => entry.path && (entry.type === 'd' || entry.type === 'f'))
    // 越界条目直接丢：宁可漏一棵树也不展示不该看的内容
    .filter((entry) => assertPathInsideProject(entry.path, projectId, lineId).ok)
    // 字典序排序：父路径一定是子路径的前缀，故父一定排在子前面
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const byPath = new Map();
  for (const entry of entries) {
    const node = {
      name: entry.path.split('/').pop() || entry.path,
      path: entry.path,
      type: entry.type,
      size: entry.size,
      mtime: entry.mtime,
      children: [],
    };
    byPath.set(entry.path, node);
  }
  // 线根本身入表但只在收尾时取 children，不作为一个可见节点返回。
  // find 输出漏掉线根本身时（只给 -mindepth 1 之类）也要有容器可挂。
  if (!byPath.has(lineRoot)) {
    byPath.set(lineRoot, {
      name: lineId,
      path: lineRoot,
      type: 'd',
      size: 0,
      mtime: 0,
      children: [],
    });
  }

  // 逐级确保父链存在：路径字典序已保证父先于子出现，这里只补 find 漏掉的中间层
  for (const entry of entries) {
    const parentPath = entry.path.slice(0, entry.path.lastIndexOf('/'));
    if (parentPath.length > lineRoot.length) {
      ensureChain(byPath, lineRoot, parentPath);
    }
    const parent = byPath.get(parentPath);
    if (parent) parent.children.push(byPath.get(entry.path));
  }

  // 顶层 = 直接挂在 lineRoot 下的节点
  const root = byPath.get(lineRoot);
  return { name: lineId, children: root ? root.children : [] };
}

/**
 * 从 lineRoot 开始逐级建出缺失的中间目录，并把每层挂到父层下。
 * 挂载失败（父层不在 lineRoot 之下）时静默返回，由调用方的越界过滤兜底。
 */
function ensureChain(byPath, lineRoot, targetPath) {
  const segmentsAfterRoot = targetPath.slice(lineRoot.length + 1).split('/').filter(Boolean);
  let currentPath = lineRoot;
  for (const segment of segmentsAfterRoot) {
    currentPath = `${currentPath}/${segment}`;
    if (byPath.has(currentPath)) continue;
    const parent = byPath.get(currentPath.slice(0, currentPath.lastIndexOf('/')));
    if (!parent) return;
    const placeholder = {
      name: segment,
      path: currentPath,
      type: 'd',
      size: 0,
      mtime: 0,
      children: [],
    };
    byPath.set(currentPath, placeholder);
    parent.children.push(placeholder);
  }
}

/** 字节数格式化为人类可读 */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** exponent;
  return `${scaled.toFixed(1)} ${units[exponent]}`;
}
