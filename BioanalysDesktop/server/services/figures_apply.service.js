// 图件应用 service（Q2 收口）：把 /api/projects/figures/apply 的处理体抽出。
//
// 这套流程有严格的顺序语义，抽出时逐字保留（改顺序会破坏回读对账）：
//   校验入参 -> 读远端 meta -> 校验分析线 -> 准备图任务 -> 合并 -> 生成执行计划
//   -> 上传脚本 -> 写回 meta -> 回读对账（长度必须与合并后一致）

import { LINES, PROJECTS_ROOT, sanitizeProjectId } from '../domain.js';
import { buildProjectExecutionPlan, mergeFigureProjectTasks } from '../figure_execution_plan.js';
import { prepareFigureProjectTasks } from '../figure_project_plan.js';
import { buildReadProjectMetaCommand, parseProjectMeta } from '../project.js';
import { shellQuote } from '../proc.js';

export async function applyFigures({ body }, deps) {
  const { lineFromPipeline, runRemote, runRemoteRaw, uploadPreparedFigureScripts } = deps;

  let requested;
  try {
    requested = JSON.parse(body || '{}');
  } catch (cause) {
    return { status: 400, payload: { error: `请求体不是合法 JSON: ${cause.message}` } };
  }

  const projectId = sanitizeProjectId(requested.projectId);
  if (!projectId) return { status: 400, payload: { error: 'projectId 参数非法' } };

  const selections = requested.figure_templates === undefined ? [] : requested.figure_templates;
  if (!Array.isArray(selections)) {
    return { status: 400, payload: { error: 'figure_templates 必须是数组' } };
  }
  if (requested.pipelineDag !== undefined && !Array.isArray(requested.pipelineDag)) {
    return { status: 400, payload: { error: 'pipelineDag 必须是数组' } };
  }

  let meta;
  try {
    const encoded = runRemote(buildReadProjectMetaCommand(projectId));
    if (encoded.trim()) {
      meta = parseProjectMeta(Buffer.from(encoded.trim(), 'base64').toString('utf8'));
    }
  } catch (cause) {
    return { status: 500, payload: { error: `读取项目元数据失败: ${cause.message}` } };
  }
  if (!meta) {
    return { status: 404, payload: { error: `项目 ${projectId} 不存在或缺少 project.json` } };
  }

  const lineId = String(requested.lineId || meta.line_id || lineFromPipeline(meta.pipeline_dag) || '');
  if (!LINES.includes(lineId)) {
    return { status: 400, payload: { error: `项目缺少合法分析线: ${lineId || '(空)'}` } };
  }

  const prepared = prepareFigureProjectTasks({
    projectId,
    lineId,
    selectedModIds: [],
    selections,
    projectMeta: meta,
    analysisModIds: [
      ...(Array.isArray(meta.pipeline_dag) ? meta.pipeline_dag : []),
      ...(Array.isArray(requested.pipelineDag) ? requested.pipelineDag : []),
    ].map((node) => (typeof node === 'string' ? node : node?.mod_id || node?.id)).filter(Boolean),
  });
  if (!prepared.ok) {
    return { status: 422, payload: { ok: false, errors: prepared.errors, schedule_violations: prepared.schedule_violations || [] } };
  }

  const mergedTasks = mergeFigureProjectTasks(meta.figure_tasks || [], prepared.tasks);
  const plan = buildProjectExecutionPlan({
    line_id: lineId,
    pipeline_dag: Array.isArray(requested.pipelineDag) ? requested.pipelineDag : (meta.pipeline_dag || []),
    figure_tasks: mergedTasks,
  });
  if (!plan.ok) return { status: 400, payload: { ok: false, errors: plan.errors } };

  const upload = await uploadPreparedFigureScripts(prepared);
  if (!upload.ok) return { status: 503, payload: { ok: false, error: upload.error } };

  const updated = { ...meta, line_id: lineId, figure_tasks: mergedTasks };
  const metaPath = `${PROJECTS_ROOT}/${projectId}/project.json`;
  const payload = Buffer.from(JSON.stringify(updated, null, 2)).toString('base64');
  // 原子写（2026-11-11 P1）：先落同目录临时文件再 mv 覆盖。截断写法在断连或
  // 磁盘满时会留下损坏的 project.json；mv 在同一文件系统上是原子的。
  const tmpPath = `${metaPath}.tmp.$$`;
  const write = runRemoteRaw(`echo ${payload} | base64 -d > ${shellQuote(tmpPath)} && mv ${shellQuote(tmpPath)} ${shellQuote(metaPath)}`);
  if (write.code !== 0) {
    return { status: 503, payload: { ok: false, error: `项目元数据写回失败: ${write.text}` } };
  }

  // 回读对账：长度必须与合并后一致。这一步不是冗余，它挡住「写回静默失败但返回 0」
  // 的情况；历史上出过一次写回成功但内容被截断的问题。
  let readBack = null;
  try {
    const encoded = runRemote(buildReadProjectMetaCommand(projectId));
    readBack = parseProjectMeta(Buffer.from(encoded.trim(), 'base64').toString('utf8'));
  } catch {
    readBack = null;
  }
  if (!readBack || !Array.isArray(readBack.figure_tasks)
    || readBack.figure_tasks.length !== mergedTasks.length) {
    return { status: 503, payload: { ok: false, error: '项目元数据回读对账失败' } };
  }

  return {
    status: 200,
    payload: {
      ok: true,
      projectId,
      lineId,
      added: prepared.tasks.length,
      total: mergedTasks.length,
      uploads: upload.uploads,
    },
  };
}
