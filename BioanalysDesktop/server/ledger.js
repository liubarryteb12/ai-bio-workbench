/**
 * 台账合规判定
 *
 * 规则与 docs/ledger-schema.md 一致，也与服务器侧 tools/ops/03_check_logs_remote.sh 同口径。
 * 两份实现各自独立（一个 Node 一个 bash）不是为了重复，而是因为调用面不同：
 * 03 在服务器上跑全量文件，这里在本地对已取回/已读到的台账做判定。
 * 判定规则若变更，两边都要改，并在测试里用同一批样例断言结论一致。
 *
 * 2026-10-21 对齐 S29 遗留口径差（见 workspace/handoff/dispatch/S29_report.md 遗留风险 2/3）：
 * 此前"路径是否在合法根下"有两套实现，台账审计走 marker 判定，任务提交走 SSD_ROOT 判定，
 * 导致 projects/<pid>/ 下的非三线子路径与裸相对文件名在提交侧放行、在审计侧被判违规。
 * 现在 analyzePath 是唯一事实源，各调用方只按自己的口径取字段：
 *   - 台账审计（auditLedgerEntry / classifyPath）：归属分类，保留历史兼容分支；
 *   - 任务提交（server/index.js 的 validateTaskPaths / inspectTaskPath）：严格合法根，
 *     不继承历史分支，并叠加只读共享区、系统目录、跨项目等 ownership 规则；
 *   - 测试（tests/ledger.test.js）：同一批样例断言两处结论一致。
 */

import { LINES, DEFAULT_PROJECT, sanitizeProjectId, SSD_ROOT } from './domain.js';

const PUBLIC_MARKER = '/public_references/';
const LOGS_MARKER = '/system_logs/';
const PROJECTS_MARKER = '/projects/';
const SSD_ROOT_PREFIX = `${SSD_ROOT}/`;

/** 统一分隔符、折叠重复斜杠；不转小写（Linux 路径大小写敏感，见 extractProject 注释） */
function unifyPath(pathLike) {
  return String(pathLike).replace(/\\/g, '/').replace(/\/+/g, '/');
}

/**
 * 归一化路径：统一分隔符与大小写，堵掉变体。
 * 只给 marker 判定用（大小写不敏感），项目段抽取不走这里。
 */
function normalizePath(pathLike) {
  return '/' + unifyPath(pathLike).replace(/^\/+/, '').replace(/\/+$/, '') + '/';
}

/**
 * 路径命中的共享区 / 台账区 / 三线标记，与 tools/ops/03_check_logs_remote.sh 的 classify 同口径。
 * 返回 'public' | 'logs' | <line> | null。
 */
function markerRoot(pathLike) {
  const normalized = normalizePath(pathLike).toLowerCase();
  if (normalized.includes(PUBLIC_MARKER)) return 'public';
  if (normalized.includes(LOGS_MARKER)) return 'logs';
  for (const line of LINES) {
    if (normalized.includes(`/${line.toLowerCase()}/`)) return line;
  }
  return null;
}

/**
 * 从路径里抽出项目段：`.../projects/<project>/...` 返回 `<project>`，否则 null。
 * 旧结构（迁移前顶层三线）路径不含 /projects/，返回 null 视为 legacy。
 *
 * 相对形态 `projects/<project>/...` 也支持：先补一个前导斜杠再找标记。
 *
 * 只统一分隔符，**不转小写**：Linux 路径大小写敏感，项目目录名按客户填写的
 * project_id 原样创建（PRJ_2026_001 与 prj_2026_001 是两个目录）。
 * 这里若转小写，再与 project_id 原样比较，会把每个合法台账都误判成"跨项目"
 * （2026-10-19 实测：产物正常但台账全部被拒落盘）。
 */
function extractProject(pathLike) {
  const normalized = '/' + unifyPath(pathLike).replace(/^\/+/, '');
  const idx = normalized.toLowerCase().indexOf(PROJECTS_MARKER);
  if (idx < 0) return null;
  const rest = normalized.slice(idx + PROJECTS_MARKER.length);
  const segment = rest.split('/')[0];
  return segment || null;
}

/**
 * 路径合法根分析：唯一事实源。
 *
 * @param {string} pathLike 待判路径
 * @param {object} [options]
 * @param {string|null} [options.lineId] 裸相对文件名按"相对当前线目录"解释时归属的线
 * @param {boolean} [options.allowLegacyOutsideRoot=true] 是否保留历史兼容分支：
 *   绝对路径即使不在 SSD_ROOT 之下，只要含 /<line>/、/public_references/、/system_logs/
 *   标记就按对应根归类。保留原因是服务器侧 ops/03 与既有样例
 *   （cn_debug/samples/system_logs 里的 /data/data/.../bio_data_logs_test/...）就是这个口径，
 *   删掉会让 Node 与 bash 判定漂移；提交层显式关掉，历史路径不得作为新任务输入/输出。
 * @returns {{ok: false, reason: string, detail: string}
 *   | {ok: true, kind: string, head: string|null, lineId: string|null, projectId: string|null, legacy?: boolean}}
 *   kind：'public' | 'logs' | <line> | 'projects' | 'dataRoot' | 'relative'
 *   head：绝对路径在 SSD_ROOT 下的一级目录名；相对路径为 'projects'；裸文件名/历史分支为 null
 */
export function analyzePath(pathLike, options = {}) {
  const { lineId = null, allowLegacyOutsideRoot = true } = options;
  if (typeof pathLike !== 'string' || pathLike.trim() === '') {
    return { ok: false, reason: '空路径', detail: '路径为空或不是字符串' };
  }

  const unified = unifyPath(pathLike.trim());
  const segments = unified.split('/').filter((segment) => segment !== '');
  if (segments.includes('..')) {
    return { ok: false, reason: '含 ..', detail: '禁止用 .. 穿越目录' };
  }
  if (/^[A-Za-z]:\//.test(unified)) {
    return { ok: false, reason: 'Windows 绝对路径', detail: `远端是 Linux，路径必须位于 ${SSD_ROOT}` };
  }

  const projectId = extractProject(unified);
  const marker = markerRoot(unified);

  if (unified.startsWith('/')) {
    if (unified === SSD_ROOT || unified === SSD_ROOT_PREFIX) {
      return { ok: false, reason: '不是文件路径', detail: `指向数据根 ${SSD_ROOT}` };
    }
    if (!unified.startsWith(SSD_ROOT_PREFIX)) {
      // SSD_ROOT 之外：仅审计侧按历史兼容分支放行，提交侧不继承
      if (allowLegacyOutsideRoot && marker) {
        return {
          ok: true,
          kind: marker,
          head: null,
          lineId: LINES.includes(marker) ? marker : null,
          projectId,
          legacy: true,
        };
      }
      return { ok: false, reason: '不在数据根之下', detail: `必须位于 ${SSD_ROOT}` };
    }

    const rest = unified.slice(SSD_ROOT_PREFIX.length);
    const head = rest.split('/')[0] || '';
    if (head === 'projects') {
      const second = rest.split('/')[1];
      if (!second) {
        return { ok: false, reason: '缺少项目段', detail: `期望 ${SSD_ROOT}/projects/<项目>/...` };
      }
      return {
        ok: true,
        kind: marker || 'projects',
        head,
        lineId: LINES.includes(marker) ? marker : null,
        projectId: second,
      };
    }
    // 数据根下的共享区、台账区、历史三线、以及其他目录（bin/envs/ops 等）
    return {
      ok: true,
      kind: marker || 'dataRoot',
      head,
      lineId: LINES.includes(marker) ? marker : null,
      projectId,
    };
  }

  // 相对路径：只接受裸文件名与 projects/<项目>/... 两种形态
  if (!unified.includes('/')) {
    return {
      ok: true,
      kind: lineId || 'relative',
      head: null,
      lineId: lineId || null,
      projectId: null,
    };
  }
  const head = unified.split('/')[0];
  if (head !== 'projects') {
    return {
      ok: false,
      reason: '相对路径缺少合法根',
      detail: '只接受裸文件名（无目录分隔符）或 projects/<项目>/... 形态',
    };
  }
  const second = unified.split('/')[1];
  if (!second) {
    return { ok: false, reason: '缺少项目段', detail: '相对路径须为 projects/<项目>/... 形态' };
  }
  return {
    ok: true,
    kind: marker || 'projects',
    head,
    lineId: LINES.includes(marker) ? marker : null,
    projectId: second,
  };
}

/**
 * 判定路径归属：某条线、共享区、台账区、项目内、数据根其他目录，或 null（不在任何合法根下）。
 * 审计口径：保留历史兼容分支（allowLegacyOutsideRoot 默认开）。
 *
 * @param {string} pathLike
 * @param {string|null} [lineId] 裸相对文件名按"相对当前线目录"解释时归属的线
 */
export function classifyPath(pathLike, lineId = null) {
  const info = analyzePath(pathLike, { lineId });
  return info.ok ? info.kind : null;
}

/**
 * 严格口径：路径是否位于合法根下（不含历史兼容分支）。
 * 合法根：SSD_ROOT 之下（任意子路径）、裸相对文件名、projects/<项目>/... 相对形态。
 */
export function isPathUnderLegalRoot(pathLike, options = {}) {
  return analyzePath(pathLike, { ...options, allowLegacyOutsideRoot: false }).ok;
}

/**
 * 任务提交侧的单路径校验：严格合法根 + ownership 规则。
 * 返回 null 表示放行，否则 {reason, detail}；文本与 S29 的 validateTaskPaths 错误消息兼容。
 *
 * @param {string} pathLike
 * @param {string} projectId 当前任务项目
 * @param {'input'|'output'} direction
 */
export function inspectTaskPath(pathLike, projectId, direction) {
  const info = analyzePath(pathLike, { allowLegacyOutsideRoot: false });
  if (!info.ok) return { reason: info.reason, detail: info.detail };

  if (info.head === 'projects') {
    if (info.projectId !== projectId) {
      return { reason: '跨项目', detail: `属于项目 ${info.projectId}，当前项目为 ${projectId}` };
    }
    return null;
  }
  if (info.kind === 'public') {
    if (direction === 'output') {
      return { reason: '输出不得写只读共享区', detail: 'public_references 是只读共享读入口' };
    }
    return null;
  }
  if (info.kind === 'logs') {
    return { reason: '系统目录禁止作为任务输入/输出', detail: 'system_logs 由台账通道写入' };
  }
  if (info.head && LINES.includes(info.head)) return null; // 历史三线形态
  if (info.kind === 'relative') return null; // 裸相对文件名，由 shell 在 <项目>/<线>/processed/ 下解析
  return {
    reason: '不属于本项目',
    detail: `既不在 ${SSD_ROOT}/projects/${projectId}/ 下，也不是历史三线形态`,
  };
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
      // 审计口径：裸相对文件名按本台账 line_id 所属线解释；历史兼容分支默认开
      const info = analyzePath(pathLike, { lineId });
      if (!info.ok) {
        problems.push(`io_files.${direction} 路径不在任何合法根下: ${pathLike}`);
        continue;
      }
      const owner = info.kind;
      if (LINES.includes(owner) && owner !== lineId) {
        problems.push(`io_files.${direction} 跨线: ${pathLike} 属于 ${owner}，但 line_id=${lineId}`);
      }
      if (direction === 'output' && owner === 'public') {
        problems.push(`io_files.output 不得写 public_references（只读共享区）: ${pathLike}`);
      }
      // 项目段一致性：新结构路径必须落在本台账 project_id 指向的项目内
      if (info.projectId !== null && info.projectId !== projectId) {
        problems.push(`io_files.${direction} 跨项目: ${pathLike} 属于项目 ${info.projectId}，但 project_id=${projectId}`);
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
