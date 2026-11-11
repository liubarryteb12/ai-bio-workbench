// 执行计划 service（Q2 收口）：GET 与 POST 两个形态共用「读 meta -> 生成计划」流程。

import { buildProjectExecutionPlan } from '../figure_execution_plan.js';
import { buildReadProjectMetaCommand, parseProjectMeta } from '../project.js';
import { projectLineDir, sanitizeProjectId } from '../domain.js';

const RAW_ROLE_PATTERNS = Object.freeze({
  series_matrix: [/series_matrix.*\.txt\.gz$/i, /count.*\.(txt|tsv)(\.gz)?$/i, /matrix.*\.(txt|tsv)(\.gz)?$/i],
  gpl: [/gpl.*table.*\.(txt|tsv)(\.gz)?$/i, /gpl.*\.(txt|soft)(\.gz)?$/i, /gpl.*\.gz$/i],
  gpl_soft: [/gpl.*soft.*\.gz$/i, /gpl.*\.gz$/i],
  gpl_soft_mouse: [/gpl24247.*/i],
  gpl_soft_human: [/gpl24676.*/i],
  'grouping.txt': [/^grouping.*\.(txt|tsv)$/i, /group.*\.(txt|tsv)$/i],
  raw_tar: [/\.tar$/i],
});

function listRawFiles(projectId, lineId, runRemote) {
  if (!lineId) return [];
  try {
    const dir = `${projectLineDir(projectId, lineId)}/raw_data`;
    const text = runRemote(`ls -1 ${dir} 2>/dev/null || true`);
    return String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 把注册表里的输入角色名解析成计算面真实路径。
 *
 * 为什么需要：workflows.json 的 requires 写的是产物角色（series_matrix / raw_tar /
 * expr_genes.tsv），不是路径。客户端提交层历史上各自拼路径，结构化工单直接把角色名
 * 当 --input 传下去，母版只会收到 "series_matrix" 这个字符串并 exit 2。
 * 这里按「raw_data 文件名特征 + processed 同名单」统一解析，角色名与真实路径
 * 不再由调用方猜。解析不到的角色直接略过，让母版按自己的必需输入清单报错。
 */
export function resolveTaskInputs(projectId, lineId, inputs, rawFiles, speciesScope = []) {
  if (!Array.isArray(inputs) || inputs.length === 0 || !lineId) return [];
  const lineDir = projectLineDir(projectId, lineId);
  const scopeText = Array.isArray(speciesScope) ? speciesScope.join(' ').toLowerCase() : '';
  const allowHuman = !scopeText || /homo sapiens|human/.test(scopeText);
  const allowMouse = !scopeText || /mus musculus|mouse/.test(scopeText);
  const used = new Set();
  const resolved = [];
  for (const raw of inputs) {
    const token = String(raw || '').trim();
    if (!token || token === 'processed') continue;
    if (/_human\.h5ad$/i.test(token) && !allowHuman) continue;
    if (/_mouse\.h5ad$/i.test(token) && !allowMouse) continue;
    const patterns = RAW_ROLE_PATTERNS[token];
    if (patterns) {
      let hit = '';
      for (const pattern of patterns) {
        hit = rawFiles.find((file) => !used.has(file) && pattern.test(file)) || '';
        if (hit) break;
      }
      if (hit) {
        used.add(hit);
        resolved.push(`${lineDir}/raw_data/${hit}`);
      }
      continue;
    }
    const relative = token.replace(/\\/g, '/').replace(/^\.\//, '');
    const path = relative.includes('/')
      ? `${lineDir}/${relative}`
      : `${lineDir}/processed/${relative}`;
    if (!resolved.includes(path)) resolved.push(path);
  }
  return resolved;
}

/** 读远端 project.json，返回 {status, meta} 或 {status, payload}（错误已成形）。 */
function readMeta(projectId, runRemote) {
  let meta = null;
  try {
    const encoded = runRemote(buildReadProjectMetaCommand(projectId));
    if (encoded.trim()) {
      meta = parseProjectMeta(Buffer.from(encoded.trim(), 'base64').toString('utf8'));
    }
  } catch (cause) {
    return {
      status: 500,
      payload: {
        error: `读取项目执行计划失败: ${cause instanceof Error ? cause.message : String(cause)}`,
      },
    };
  }
  if (!meta) {
    return { status: 404, payload: { error: `项目 ${projectId} 不存在或缺少 project.json` } };
  }
  return { status: 200, meta };
}

/** GET /api/projects/execution-plan?project=<id> */
export function getExecutionPlan({ project, runRemote, lineFromPipeline }) {
  const projectId = sanitizeProjectId(project || '');
  if (!projectId) return { status: 400, payload: { error: 'project 参数非法' } };

  const read = readMeta(projectId, runRemote);
  if (read.status !== 200) return { status: read.status, payload: read.payload };

  const plan = buildProjectExecutionPlan(read.meta);
  if (!plan.ok) {
    return { status: 422, payload: { ok: false, projectId, errors: plan.errors } };
  }
  const lineId = read.meta.line_id || lineFromPipeline(read.meta.pipeline_dag) || null;
  const rawFiles = listRawFiles(projectId, lineId, runRemote);
  const tasks = plan.tasks.map((task) => ({
    ...task,
    inputs: resolveTaskInputs(projectId, lineId, task.inputs, rawFiles, []),
  }));
  return {
    status: 200,
    payload: {
      ok: true,
      projectId,
      lineId,
      tasks,
    },
  };
}

/** POST /api/projects/execution-plan，请求体可带覆盖用的 pipelineDag。 */
export function postExecutionPlan({ body, runRemote, lineFromPipeline }) {
  let requested;
  try {
    requested = JSON.parse(body || '{}');
  } catch (cause) {
    return { status: 400, payload: { error: `请求体不是合法 JSON: ${cause.message}` } };
  }
  const projectId = sanitizeProjectId(requested.projectId);
  if (!projectId) return { status: 400, payload: { error: 'projectId 参数非法' } };
  if (requested.pipelineDag !== undefined && !Array.isArray(requested.pipelineDag)) {
    return { status: 400, payload: { error: 'pipelineDag 必须是数组' } };
  }

  const read = readMeta(projectId, runRemote);
  if (read.status !== 200) return { status: read.status, payload: read.payload };

  const plan = buildProjectExecutionPlan({
    ...read.meta,
    pipeline_dag: Array.isArray(requested.pipelineDag) ? requested.pipelineDag : read.meta.pipeline_dag,
  });
  if (!plan.ok) {
    return { status: 422, payload: { ok: false, projectId, errors: plan.errors } };
  }
  const lineId = read.meta.line_id || lineFromPipeline(read.meta.pipeline_dag) || null;
  const rawFiles = listRawFiles(projectId, lineId, runRemote);
  const tasks = plan.tasks.map((task) => ({
    ...task,
    inputs: resolveTaskInputs(projectId, lineId, task.inputs, rawFiles, requested.speciesScope),
  }));
  return {
    status: 200,
    payload: {
      ok: true,
      projectId,
      lineId,
      tasks,
    },
  };
}
