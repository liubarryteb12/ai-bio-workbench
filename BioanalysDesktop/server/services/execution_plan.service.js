// 执行计划 service（Q2 收口）：GET 与 POST 两个形态共用「读 meta -> 生成计划」流程。

import { buildProjectExecutionPlan } from '../figure_execution_plan.js';
import { buildReadProjectMetaCommand, parseProjectMeta } from '../project.js';
import { sanitizeProjectId } from '../domain.js';

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
  return {
    status: 200,
    payload: {
      ok: true,
      projectId,
      lineId: read.meta.line_id || lineFromPipeline(read.meta.pipeline_dag) || null,
      tasks: plan.tasks,
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
  return {
    status: 200,
    payload: {
      ok: true,
      projectId,
      lineId: read.meta.line_id || lineFromPipeline(read.meta.pipeline_dag) || null,
      tasks: plan.tasks,
    },
  };
}