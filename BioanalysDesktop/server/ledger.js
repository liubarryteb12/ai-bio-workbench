/**
 * 台账合规判定
 *
 * 规则与 docs/ledger-schema.md 一致，也与服务器侧 ops/03_check_logs_remote.sh 同口径。
 * 两份实现各自独立（一个 Node 一个 bash）不是为了重复，而是因为调用面不同：
 * 03 在服务器上跑全量文件，这里在本地对已取回/已读到的台账做判定。
 * 判定规则若变更，两边都要改，并在测试里用同一批样例断言结论一致。
 */

import { LINES, DEFAULT_PROJECT, sanitizeProjectId } from './domain.js';

const PUBLIC_MARKER = '/public_references/';
const LOGS_MARKER = '/system_logs/';
const PROJECTS_MARKER = '/projects/';

/** 归一化路径：统一分隔符与大小写，堵掉变体 */
function normalizePath(pathLike) {
  return '/' + String(pathLike).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '') + '/';
}

/**
 * 从路径里抽出项目段：`.../projects/<project>/...` 返回 `<project>`，否则 null。
 * 旧结构（迁移前顶层三线）路径不含 /projects/，返回 null 视为 legacy。
 *
 * 只统一分隔符，**不转小写**：Linux 路径大小写敏感，项目目录名按客户填写的
 * project_id 原样创建（PRJ_2026_001 与 prj_2026_001 是两个目录）。
 * 这里若转小写，再与 project_id 原样比较，会把每个合法台账都误判成"跨项目"
 * （2026-10-19 实测：产物正常但台账全部被拒落盘）。
 */
function extractProject(pathLike) {
  const normalized = String(pathLike).replace(/\\/g, '/');
  const idx = normalized.toLowerCase().indexOf(PROJECTS_MARKER);
  if (idx < 0) return null;
  const rest = normalized.slice(idx + PROJECTS_MARKER.length);
  const segment = rest.split('/')[0];
  return segment || null;
}

/**
 * 判定路径归属：某条线、共享区、台账区，或不在任何合法根下。
 */
function classifyPath(pathLike) {
  const normalized = normalizePath(pathLike).toLowerCase();
  if (normalized.includes(PUBLIC_MARKER)) return 'public';
  if (normalized.includes(LOGS_MARKER)) return 'logs';
  for (const line of LINES) {
    if (normalized.includes(`/${line.toLowerCase()}/`)) return line;
  }
  return null;
}

/**
 * 审计单条台账。
 * @param {object} entry 台账 JSON 对象
 * @returns {{projectId: string, lineId: string|null, stepName: string|null, status: string|null, problems: string[], legal: boolean}}
 */
export function auditLedgerEntry(entry) {
  const problems = [];
  const data = entry || {};

  const lineId = data.line_id ?? null;
  const stepName = data.step_name ?? null;
  const status = data.status ?? null;

  // project_id 缺失视为 default（兼容迁移前的历史台账）；提供则必须合法
  let projectId = DEFAULT_PROJECT;
  if (data.project_id !== undefined && data.project_id !== null) {
    const safe = sanitizeProjectId(data.project_id);
    if (!safe) {
      problems.push(`project_id 非法: ${JSON.stringify(data.project_id)}`);
    } else {
      projectId = safe;
    }
  }

  if (!LINES.includes(lineId)) {
    problems.push(`line_id 非法: ${JSON.stringify(lineId)}，必须是 ${LINES.join(' / ')} 之一`);
  }

  const environment = data.environment || {};
  const checkpoint = data.checkpoint_status;
  if (checkpoint === 'passed' && (environment.random_seed === undefined || environment.random_seed === null)) {
    problems.push('checkpoint_status=passed 但 environment.random_seed 为空（步骤不可复现）');
  }

  if (status === 'failed' && (data.error_log === undefined || data.error_log === null)) {
    problems.push('status=failed 但 error_log 为空（无法定位失败原因）');
  }

  const io = data.io_files || {};
  for (const direction of ['input', 'output']) {
    for (const pathLike of io[direction] || []) {
      const owner = classifyPath(pathLike);
      if (owner === null) {
        problems.push(`io_files.${direction} 路径不在任何合法根下: ${pathLike}`);
        continue;
      }
      if (owner !== 'public' && owner !== 'logs' && owner !== lineId) {
        problems.push(`io_files.${direction} 跨线: ${pathLike} 属于 ${owner}，但 line_id=${lineId}`);
      }
      if (direction === 'output' && owner === 'public') {
        problems.push(`io_files.output 不得写 public_references（只读共享区）: ${pathLike}`);
      }
      // 项目段一致性：新结构路径必须落在本台账 project_id 指向的项目内
      const pathProject = extractProject(pathLike);
      if (pathProject !== null && pathProject !== projectId) {
        problems.push(`io_files.${direction} 跨项目: ${pathLike} 属于项目 ${pathProject}，但 project_id=${projectId}`);
      }
    }
  }

  return { projectId, lineId, stepName, status, problems, legal: problems.length === 0 };
}

/**
 * 汇总一批台账：总数、合法数、违规数、按线分组、按状态分组。
 * @param {Array<object>} entries
 */
export function summarizeLedger(entries) {
  const byLine = {};
  for (const line of LINES) {
    byLine[line] = { legal: 0, violations: 0, steps: {} };
  }

  let legal = 0;
  let violations = 0;
  const details = [];

  for (const entry of entries || []) {
    const result = auditLedgerEntry(entry);
    if (result.legal) legal += 1;
    else violations += 1;
    details.push(result);

    const bucket = result.lineId && byLine[result.lineId];
    if (bucket) {
      if (result.legal) bucket.legal += 1;
      else bucket.violations += 1;
      if (result.stepName) {
        bucket.steps[result.stepName] = result.legal ? 'legal' : 'violation';
      }
    }
  }

  return {
    total: (entries || []).length,
    legal,
    violations,
    byLine,
    details,
  };
}
