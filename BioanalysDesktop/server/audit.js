/**
 * 命令审计：执行前拦下任何跨线引用
 *
 * 这是 docs/isolation.md 的执行层。三条线之间不互相取参考、不合并、不跨线验证。
 * 前端按线收敛选项只是第一道，这里是无条件兜底：命令文本里出现其他线的
 * line_id，无论从哪来，一律拒绝。
 */

import { LINES } from './domain.js';

export class AuditError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuditError';
  }
}

/**
 * @typedef {{ allowed: boolean, reason: string|null, hits: Array<{line: number, token: string}> }} AuditResult
 */

/**
 * 把路径归一化后再比对，堵掉 `\` 分隔符、大小写、前后空格这些变体。
 * Windows 习惯的路径在服务器侧是非法的，但为防手滑仍按跨线引用对待。
 */
function normalize(text) {
  return text.replace(/\\/g, '/').toLowerCase();
}

/**
 * 审计一条（可能多行的）命令是否越界。
 *
 * @param {string} command 待执行的命令文本，可为多行
 * @param {string} lineId 本任务的归属线，必须是 LINES 之一
 * @returns {AuditResult}
 * @throws {AuditError} lineId 非法时
 */
export function auditCommand(command, lineId) {
  if (!LINES.includes(lineId)) {
    throw new AuditError(`line_id 非法: ${lineId}，必须是 ${LINES.join(' / ')} 之一`);
  }

  const others = LINES.filter((line) => line !== lineId);
  const hits = [];

  const lines = String(command).split(/\r?\n/);
  lines.forEach((raw, index) => {
    const normalized = normalize(raw);
    for (const other of others) {
      if (normalized.includes(normalize(other))) {
        hits.push({ line: index + 1, token: other });
      }
    }
  });

  if (hits.length > 0) {
    const where = hits.map((hit) => `第 ${hit.line} 行含 ${hit.token}`).join('；');
    return {
      allowed: false,
      reason: `跨线引用被拒绝（line_id=${lineId}）：${where}。三条线互不交叉，见 docs/isolation.md`,
      hits,
    };
  }

  return { allowed: true, reason: null, hits: [] };
}
