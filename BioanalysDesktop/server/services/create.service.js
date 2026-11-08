// 建项 service（Q2 收口）：把 /api/projects/create 的处理体从路由模块抽出。
//
// 为什么抽：原处理体 157 行嵌在 if 分支里，与 res/json 深度耦合，无法单独测试，
// 也让 projects.routes.js 长期超长。这里改成「入参 -> {status, payload}」的纯函数形态：
// 不碰 req/res，所有提前返回变成 status 码，路由层只负责把结果写出。
//
// 行为契约（与抽出前逐字等价，改动必须同步更新 t_create_service_parity 测试）：
//   400 请求体非法 / projectId 非法 / figure_templates 非数组 / 图模板缺合法线 / 执行计划失败 / strict 元数据校验失败
//   409 项目已存在
//   500 建项目失败 / 无 CREATED 回执 / 建项处理失败
//   503 出图脚本上传失败
//   200 全部成功
//   207 建项成功但部分数据文件未部署

import { LINES, resolveLineFromDataType, sanitizeProjectId } from '../domain.js';
import { buildProjectExecutionPlan } from '../figure_execution_plan.js';
import { prepareFigureProjectTasks } from '../figure_project_plan.js';
import { validateModSchedule } from '../mod_schedule.js';
import { loadWorkflows } from '../workflow_graph.js';
import { loadFigureTemplates } from '../figure_graph.js';
import {
  buildCreateProjectCommand, buildPipelineDag, buildProjectMetaStrict,
} from '../project.js';

/**
 * 建项。
 *
 * @param {object} params
 * @param {string} params.body 已读出的请求体原文
 * @param {object} deps 注入依赖（runRemote / uploadPreparedFigureScripts / deployDataFiles / lineFromPipeline）
 * @returns {Promise<{status:number,payload:object}>}
 */
export async function createProject({ body }, deps) {
  const { deployDataFiles, lineFromPipeline, runRemote, uploadPreparedFigureScripts } = deps;

  let requested;
  try {
    requested = JSON.parse(body || '{}');
  } catch (cause) {
    return { status: 400, payload: { error: `请求体不是合法 JSON: ${cause.message}` } };
  }

  const projectId = sanitizeProjectId(requested.projectId);
  if (!projectId) {
    return {
      status: 400,
      payload: {
        error: `projectId 非法（只允许字母数字 . _ -，不以 . 开头，长度 <= 64）: ${requested.projectId}`,
      },
    };
  }

  const figureSelections = requested.figure_templates === undefined ? [] : requested.figure_templates;
  if (!Array.isArray(figureSelections)) {
    return { status: 400, payload: { error: 'figure_templates 必须是数组' } };
  }

  let preparedFigures = { tasks: [], local_scripts: [], manifest_entries: [] };
  try {
    const preliminaryDag = buildPipelineDag({
      pipelineDag: requested.pipelineDag,
      seriesId: requested.seriesId,
      modIds: requested.modIds,
      koGene: requested.koGene,
    });
    let figureLineId = String(requested.lineId || requested.seriesId || '');
    if (!figureLineId) {
      figureLineId = lineFromPipeline(preliminaryDag)
        || resolveLineFromDataType(requested.dataSource?.dataType)
        || '';
    }
    if (figureSelections.length > 0) {
      if (!LINES.includes(figureLineId)) {
        return { status: 400, payload: { error: `图模板选择缺少合法分析线: ${figureLineId || '(空)'}` } };
      }
      // Argon 第 76 轮定律 2：分析步骤依赖闭包硬阻断（漏选上游 -> 422 UNSCHEDULABLE_MOD_DAG）。
      const submittedMods = Array.isArray(preliminaryDag)
        ? preliminaryDag.map((node) => (typeof node === 'string' ? node : node?.mod_id)).filter(Boolean)
        : (Array.isArray(requested.modIds) ? requested.modIds : []);
      if (submittedMods.length > 0) {
        const registry = loadFigureTemplates().templates;
        const figureRequiredMods = figureSelections.flatMap((sel) => {
          const tpl = registry.find((item) => item.id === sel.template_id);
          return Array.isArray(tpl?.required_mod_ids) ? tpl.required_mod_ids : [];
        });
        const modCheck = validateModSchedule(submittedMods, figureRequiredMods, loadWorkflows());
        if (!modCheck.ok) {
          return { status: 422, payload: { ok: false, code: modCheck.code, missing_upstream_mods: modCheck.missing_upstream_mods, expected_closure: modCheck.expected_closure } };
        }
      }
      preparedFigures = prepareFigureProjectTasks({
        projectId,
        lineId: figureLineId,
        // 模板只需与本线 linked_mods 对齐；全量 modIds 会把未关联该图的正常步骤误判为跨图。
        selectedModIds: [],
        selections: figureSelections,
        projectMeta: requested,
        analysisModIds: Array.isArray(preliminaryDag)
          ? preliminaryDag.map((node) => (typeof node === 'string' ? node : node?.mod_id || node?.id)).filter(Boolean)
          : [],
      });
      if (!preparedFigures.ok) {
        return { status: 422, payload: { ok: false, errors: preparedFigures.errors, schedule_violations: preparedFigures.schedule_violations || [] } };
      }
      const sequence = buildProjectExecutionPlan({
        line_id: figureLineId,
        pipeline_dag: preliminaryDag || [],
        figure_tasks: preparedFigures.tasks,
      });
      if (!sequence.ok) {
        return { status: 400, payload: { ok: false, errors: sequence.errors } };
      }
    }
  } catch (cause) {
    return { status: 400, payload: { error: cause instanceof Error ? cause.message : String(cause) } };
  }

  let meta;
  try {
    // S24：建项入口走 strict 校验（R11 六条 + R12 联动 + line_id 枚举）
    meta = buildProjectMetaStrict({
      id: projectId,
      name: requested.name,
      description: requested.description,
      basicInfo: requested.basicInfo,
      dataSource: requested.dataSource,
      groupingDesign: requested.groupingDesign,
      pipelineDag: requested.pipelineDag,
      seriesId: requested.seriesId,
      modIds: requested.modIds,
      koGene: requested.koGene,
      aclAndOutput: requested.aclAndOutput,
      biologicalPriors: requested.biologicalPriors,
      analysisCutoffs: requested.analysisCutoffs,
      plotLayoutConfig: requested.plotLayoutConfig,
      experimentalDesign: requested.experimentalDesign,
      validationGroupMapping: requested.validationGroupMapping,
      dataFiles: requested.dataFiles,
      figureTasks: preparedFigures.tasks,
      wgcnaConfig: requested.wgcnaConfig,
      lineId: requested.lineId || requested.seriesId,
    });
  } catch (cause) {
    return { status: 400, payload: { error: cause.message } };
  }

  const { command, remoteDir } = buildCreateProjectCommand(projectId, meta);
  let output;
  try {
    output = runRemote(command);
  } catch (cause) {
    return {
      status: 500,
      payload: { error: `建项目失败: ${cause instanceof Error ? cause.message : String(cause)}` },
    };
  }
  if (output.includes('EXISTS')) {
    return { status: 409, payload: { error: `项目已存在: ${projectId}` } };
  }
  if (!output.includes('CREATED')) {
    return { status: 500, payload: { error: `建项目失败（无 CREATED 回执）: ${output}` } };
  }

  const figureUpload = await uploadPreparedFigureScripts(preparedFigures);
  if (!figureUpload.ok) {
    return { status: 503, payload: { ok: false, projectId, error: figureUpload.error } };
  }

  // 数据文件部署：客户上传的矩阵/样本表要落到本项目本线的 raw_data/，
  // 否则 project.json 里写的相对路径在服务器上是空的
  const lineId = lineFromPipeline(meta.pipeline_dag)
    || resolveLineFromDataType(meta.data_source?.data_type || requested.dataSource?.dataType);
  const deploy = await deployDataFiles(projectId, lineId, meta.data_files);
  const deployNote = deploy.results.length
    ? `；数据文件 ${deploy.results.filter((r) => r.ok).length}/${deploy.results.length} 已部署到 ${lineId || '（未识别分析线）'}/raw_data/`
    : '';
  return {
    status: deploy.ok ? 200 : 207,
    payload: {
      ok: deploy.ok,
      projectId,
      meta,
      dir: remoteDir,
      line: lineId || null,
      dataFiles: deploy.results,
      figureTasks: preparedFigures.tasks.length,
      figureUploads: figureUpload.uploads,
      message: (deploy.ok ? '建项完成' : '建项完成，但部分数据文件未部署成功') + deployNote,
    },
  };
}
