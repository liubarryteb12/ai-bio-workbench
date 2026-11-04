// 项目与建项路由。
//
// 项目与建项路由：处理体从 server/index.js 逐字搬来，函数体未做改写。
// 注入项的定义仍在 index.js（守卫与测试按 index.js 统计那些符号），此处不复制第二份。
// 返回约定：命中本模块管辖的 pathname 就返回 true。json() 与 uploadError() 返回
// undefined，不能当命中信号，所以分支顶层的 return 一律改成「先响应、再显式 return true」。
// 嵌套回调（req.on('end')、map、setImmediate）里的 return 是回调返回值，保持原样。
import {
  DEFAULT_PROJECT, LINES, PROJECTS_ROOT, normalizeDataSource, normalizeDatasets, resolveLineFromDataType, sanitizeProjectId,
} from '../domain.js';
import { buildProjectExecutionPlan, mergeFigureProjectTasks } from '../figure_execution_plan.js';
import { prepareFigureProjectTasks } from '../figure_project_plan.js';
import {
  LINE_STEPS, PIPELINE_STEP_META, buildCreateProjectCommand, buildPipelineDag, buildProjectMetaStrict, buildReadProjectMetaCommand, parseProjectMeta,
} from '../project.js';
import { BLACKLIST_HINT, checkTumorBlacklist } from '../tumor_blacklist.js';
import { shellQuote } from '../proc.js';
import { describeSeries, loadWorkflows, resolvePlan, validateRegistry } from '../workflow_graph.js';
import fs from 'node:fs';
import path from 'node:path';

export function handleProjectRoutes(req, res, url, {
  PORTAL_INBOX, deployDataFiles, isSafeManifestName, json,
  lineFromPipeline, listInboxManifests, listProjectsWithMeta, readPackageManifest,
  runRemote, runRemoteRaw, uploadPreparedFigureScripts,
}) {
  if (url.pathname === '/api/projects/list') {
    // 项目列表：数据面按项目分文件夹后，界面据此渲染项目选择器
    try {
      const projects = listProjectsWithMeta();
      json(res, 200, { defaultProject: DEFAULT_PROJECT, projects });
      return true;
    } catch (cause) {
      json(res, 500, {
        error: cause instanceof Error ? cause.message : String(cause),
        hint: '读项目列表失败；链路不通时先跑 /api/link/check',
      });
      return true;
    }
  }

  if (url.pathname === '/api/projects/create' && req.method === 'POST') {
    // 建项目：建三线数据子目录 + 写 project.json，已存在则拒绝（不覆盖）
    // v2 支持四段式 manifest：basicInfo / dataSource / pipelineDag / aclAndOutput
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let requested;
      try {
        requested = JSON.parse(body || '{}');
      } catch (cause) {
        return json(res, 400, { error: `请求体不是合法 JSON: ${cause.message}` });
      }
      const projectId = sanitizeProjectId(requested.projectId);
      if (!projectId) {
        return json(res, 400, {
          error: `projectId 非法（只允许字母数字 . _ -，不以 . 开头，长度 <= 64）: ${requested.projectId}`,
        });
      }
      const figureSelections = requested.figure_templates === undefined
        ? []
        : requested.figure_templates;
      if (!Array.isArray(figureSelections)) {
        return json(res, 400, { error: 'figure_templates 必须是数组' });
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
            return json(res, 400, { error: `图模板选择缺少合法分析线: ${figureLineId || '(空)'}` });
          }
          preparedFigures = prepareFigureProjectTasks({
            projectId,
            lineId: figureLineId,
            // 模板只需与本线 linked_mods 对齐；全量 modIds 会把未关联该图的正常步骤误判为跨图。
            selectedModIds: [],
            selections: figureSelections,
          });
          if (!preparedFigures.ok) {
            return json(res, 422, { ok: false, errors: preparedFigures.errors });
          }
          const sequence = buildProjectExecutionPlan({
            line_id: figureLineId,
            pipeline_dag: preliminaryDag || [],
            figure_tasks: preparedFigures.tasks,
          });
          if (!sequence.ok) {
            return json(res, 400, { ok: false, errors: sequence.errors });
          }
        }
      } catch (cause) {
        return json(res, 400, { error: cause instanceof Error ? cause.message : String(cause) });
      }
      let meta;
      try {
        // S24：建项入口走 strict 校验（R11 六条 + R12 联动 + line_id 枚举），
        // 校验失败抛错由下方 catch 统一转 400；line_id 取自建项请求（aims.txt:96 契约）
        meta = buildProjectMetaStrict({
          id: projectId,
          // v1 兼容
          name: requested.name,
          description: requested.description,
          // v2 四段式
          basicInfo: requested.basicInfo,
          dataSource: requested.dataSource,
          groupingDesign: requested.groupingDesign,
          pipelineDag: requested.pipelineDag,
          // mod 化客户端形态：只传 seriesId + modIds + koGene，不传 pipelineDag。
          // buildProjectMeta 里的 buildPipelineDag 会把它合成 pipeline_dag，
          // 这里必须透传，否则新客户端的步骤选择到服务台就丢了。
          seriesId: requested.seriesId,
          modIds: requested.modIds,
          koGene: requested.koGene,
          aclAndOutput: requested.aclAndOutput,
          // aims v3.0 intake 四块
          biologicalPriors: requested.biologicalPriors,
          analysisCutoffs: requested.analysisCutoffs,
          plotLayoutConfig: requested.plotLayoutConfig,
          experimentalDesign: requested.experimentalDesign,
          validationGroupMapping: requested.validationGroupMapping,
          dataFiles: requested.dataFiles,
          figureTasks: preparedFigures.tasks,
          // S24/R2：WGCNA 参数契约（表单选填；normalizeWgcnaConfig 逐键回落默认）
          wgcnaConfig: requested.wgcnaConfig,
          // mod 化客户端用 seriesId 表达同一件事（分析线），没有单独的 lineId 字段。
          // 两个名字都认，缺了就都空着让 strict 校验去拒。
          lineId: requested.lineId || requested.seriesId,
        });
      } catch (cause) {
        return json(res, 400, { error: cause.message });
      }
      const { command, remoteDir } = buildCreateProjectCommand(projectId, meta);
      let output;
      try {
        output = runRemote(command);
      } catch (cause) {
        return json(res, 500, { error: `建项目失败: ${cause instanceof Error ? cause.message : String(cause)}` });
      }
      if (output.includes('EXISTS')) {
        return json(res, 409, { error: `项目已存在: ${projectId}` });
      }
      if (!output.includes('CREATED')) {
        return json(res, 500, { error: `建项目失败（无 CREATED 回执）: ${output}` });
      }

      const figureUpload = uploadPreparedFigureScripts(preparedFigures);
      if (!figureUpload.ok) {
        return json(res, 503, {
          ok: false,
          projectId,
          error: figureUpload.error,
        });
      }

      // 数据文件部署：客户上传的矩阵/样本表要落到本项目本线的 raw_data/，
      // 否则 project.json 里写的相对路径在服务器上是空的
      const lineId = lineFromPipeline(meta.pipeline_dag)
        || resolveLineFromDataType(meta.data_source?.data_type || requested.dataSource?.dataType);
      const deploy = deployDataFiles(projectId, lineId, meta.data_files);
      const deployNote = deploy.results.length
        ? `；数据文件 ${deploy.results.filter((r) => r.ok).length}/${deploy.results.length} 已部署到 ${lineId || '（未识别分析线）'}/raw_data/`
        : '';
      return json(res, deploy.ok ? 200 : 207, {
        ok: deploy.ok,
        projectId,
        meta,
        dir: remoteDir,
        line: lineId || null,
        dataFiles: deploy.results,
        figureTasks: preparedFigures.tasks.length,
        figureUploads: figureUpload.uploads,
        message: (deploy.ok ? '建项完成' : '建项完成，但部分数据文件未部署成功') + deployNote,
      });
    });
    return true;
  }

  // 非肿瘤正则黑名单校验（前端实时调用，输入时红字拦截）
  if (url.pathname === '/api/blacklist/check' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch {
        return json(res, 400, { error: '请求体不是合法 JSON' });
      }
      const result = checkTumorBlacklist(payload.text || '');
      return json(res, 200, { hit: result.hit, matches: result.matches, hint: BLACKLIST_HINT });
    });
    return true;
  }

  // 三线可选步骤列表（前端级联勾选用）
  if (url.pathname === '/api/projects/steps') {
    json(res, 200, { steps: LINE_STEPS, meta: PIPELINE_STEP_META });
    return true;
  }

  // --- mod 注册表（单一事实源 src/workflows.json）---
  // 与 /api/projects/steps 的区别：那个是「母版名」兼容视图（旧前端在用），
  // 这三个是注册表本体，返回 mod id / 阶段 / 依赖 / 成本，供组合校验用。
  if (url.pathname === '/api/workflows') {
    const wf = loadWorkflows();
    const check = validateRegistry();
    json(res, 200, {
      // 客户端一次拿全：系列清单 + 每条线的阶段与 mod + 全局约束
      series: wf.series.map((s) => describeSeries(s.id)),
      constraints: wf.constraints,
      // 注册表自洽状态一并下发：坏了客户端能看到，而不是静默拿到半份图
      registry_ok: check.ok,
      registry_errors: check.errors,
    });
    return true;
  }

  // 组合合法性预检：客户端勾完步骤后先问一次，别等远端跑爆才发现
  if (url.pathname === '/api/workflows/resolve' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = {};
      try {
        parsed = body.trim() ? JSON.parse(body) : {};
      } catch (cause) {
        return json(res, 400, { error: `请求体不是合法 JSON: ${cause instanceof Error ? cause.message : String(cause)}` });
      }
      const seriesId = String(parsed.seriesId || parsed.series || '').trim();
      const modIds = Array.isArray(parsed.modIds) ? parsed.modIds.map((x) => String(x)) : [];
      const koGene = String(parsed.koGene || '').trim();
      if (!seriesId) return json(res, 400, { error: '缺少 seriesId' });
      if (modIds.length === 0) return json(res, 400, { error: 'modIds 不能为空' });
      const plan = resolvePlan(seriesId, modIds, { koGene });
      // 非法组合回 422：调用方传错了，不是服务端故障
      return json(res, plan.ok ? 200 : 422, plan);
    });
    return true;
  }

  // 单系列详情必须放在 resolve 之后：否则前缀匹配会把 /api/workflows/resolve
  // 吞成 seriesId=resolve，返回「未知分析系列」。
  if (url.pathname.startsWith('/api/workflows/')) {
    const seriesId = url.pathname.slice('/api/workflows/'.length).split('?')[0];
    // 只认注册表里真实存在的系列 id。不加这道闸，任何 /api/workflows/<任意串>
    // 都会走到这里，把拼错的路由名报成「未知分析系列」，排查时极易误判。
    const detail = describeSeries(seriesId);
    if (!detail) {
      json(res, 404, { error: `未知分析系列: ${seriesId}` });
      return true;
    }
    json(res, 200, detail);
    return true;
  }

  // 单个项目的关键元数据：Studio 用它显示"这批图按什么模板/阈值出的"
  if (url.pathname === '/api/projects/figures/apply' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let requested;
      try {
        requested = JSON.parse(body || '{}');
      } catch (cause) {
        return json(res, 400, { error: `请求体不是合法 JSON: ${cause.message}` });
      }
      const projectId = sanitizeProjectId(requested.projectId);
      if (!projectId) return json(res, 400, { error: 'projectId 参数非法' });
      const selections = requested.figure_templates === undefined ? [] : requested.figure_templates;
      if (!Array.isArray(selections)) {
        return json(res, 400, { error: 'figure_templates 必须是数组' });
      }
      if (requested.pipelineDag !== undefined && !Array.isArray(requested.pipelineDag)) {
        return json(res, 400, { error: 'pipelineDag 必须是数组' });
      }
      let meta;
      try {
        const encoded = runRemote(buildReadProjectMetaCommand(projectId));
        if (encoded.trim()) {
          meta = parseProjectMeta(Buffer.from(encoded.trim(), 'base64').toString('utf8'));
        }
      } catch (cause) {
        return json(res, 500, { error: `读取项目元数据失败: ${cause.message}` });
      }
      if (!meta) return json(res, 404, { error: `项目 ${projectId} 不存在或缺少 project.json` });
      const lineId = String(requested.lineId || meta.line_id || lineFromPipeline(meta.pipeline_dag) || '');
      if (!LINES.includes(lineId)) {
        return json(res, 400, { error: `项目缺少合法分析线: ${lineId || '(空)'}` });
      }
      const prepared = prepareFigureProjectTasks({
        projectId,
        lineId,
        selectedModIds: [],
        selections,
      });
      if (!prepared.ok) {
        return json(res, 422, { ok: false, errors: prepared.errors });
      }
      const mergedTasks = mergeFigureProjectTasks(meta.figure_tasks || [], prepared.tasks);
      const plan = buildProjectExecutionPlan({
        line_id: lineId,
        pipeline_dag: Array.isArray(requested.pipelineDag)
          ? requested.pipelineDag
          : (meta.pipeline_dag || []),
        figure_tasks: mergedTasks,
      });
      if (!plan.ok) return json(res, 400, { ok: false, errors: plan.errors });
      const upload = uploadPreparedFigureScripts(prepared);
      if (!upload.ok) return json(res, 503, { ok: false, error: upload.error });

      const updated = { ...meta, line_id: lineId, figure_tasks: mergedTasks };
      const metaPath = `${PROJECTS_ROOT}/${projectId}/project.json`;
      const payload = Buffer.from(JSON.stringify(updated, null, 2)).toString('base64');
      const write = runRemoteRaw(`echo ${payload} | base64 -d > ${shellQuote(metaPath)}`);
      if (write.code !== 0) {
        return json(res, 503, { ok: false, error: `项目元数据写回失败: ${write.text}` });
      }
      let readBack = null;
      try {
        const encoded = runRemote(buildReadProjectMetaCommand(projectId));
        readBack = parseProjectMeta(Buffer.from(encoded.trim(), 'base64').toString('utf8'));
      } catch {
        readBack = null;
      }
      if (!readBack || !Array.isArray(readBack.figure_tasks)
        || readBack.figure_tasks.length !== mergedTasks.length) {
        return json(res, 503, { ok: false, error: '项目元数据回读对账失败' });
      }
      return json(res, 200, {
        ok: true,
        projectId,
        lineId,
        added: prepared.tasks.length,
        total: mergedTasks.length,
        uploads: upload.uploads,
      });
    });
    return true;
  }

  if (url.pathname === '/api/projects/execution-plan' && req.method === 'GET') {
    const projectId = sanitizeProjectId(url.searchParams.get('project') || '');
    if (!projectId) {
      json(res, 400, { error: 'project 参数非法' });
      return true;
    }
    let meta = null;
    try {
      const encoded = runRemote(buildReadProjectMetaCommand(projectId));
      if (encoded.trim()) {
        meta = parseProjectMeta(Buffer.from(encoded.trim(), 'base64').toString('utf8'));
      }
    } catch (cause) {
      json(res, 500, {
        error: `读取项目执行计划失败: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
      return true;
    }
    if (!meta) {
      json(res, 404, { error: `项目 ${projectId} 不存在或缺少 project.json` });
      return true;
    }
    const plan = buildProjectExecutionPlan(meta);
    if (!plan.ok) {
      json(res, 422, { ok: false, projectId, errors: plan.errors });
      return true;
    }
    json(res, 200, {
      ok: true,
      projectId,
      lineId: meta.line_id || lineFromPipeline(meta.pipeline_dag) || null,
      tasks: plan.tasks,
    });
    return true;
  }

  if (url.pathname === '/api/projects/execution-plan' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let requested;
      try {
        requested = JSON.parse(body || '{}');
      } catch (cause) {
        return json(res, 400, { error: `请求体不是合法 JSON: ${cause.message}` });
      }
      const projectId = sanitizeProjectId(requested.projectId);
      if (!projectId) return json(res, 400, { error: 'projectId 参数非法' });
      if (requested.pipelineDag !== undefined && !Array.isArray(requested.pipelineDag)) {
        return json(res, 400, { error: 'pipelineDag 必须是数组' });
      }
      let meta = null;
      try {
        const encoded = runRemote(buildReadProjectMetaCommand(projectId));
        if (encoded.trim()) {
          meta = parseProjectMeta(Buffer.from(encoded.trim(), 'base64').toString('utf8'));
        }
      } catch (cause) {
        return json(res, 500, { error: `读取项目执行计划失败: ${cause.message}` });
      }
      if (!meta) return json(res, 404, { error: `项目 ${projectId} 不存在或缺少 project.json` });
      const plan = buildProjectExecutionPlan({
        ...meta,
        pipeline_dag: Array.isArray(requested.pipelineDag) ? requested.pipelineDag : meta.pipeline_dag,
      });
      if (!plan.ok) return json(res, 422, { ok: false, projectId, errors: plan.errors });
      return json(res, 200, {
        ok: true,
        projectId,
        lineId: meta.line_id || lineFromPipeline(meta.pipeline_dag) || null,
        tasks: plan.tasks,
      });
    });
    return true;
  }

  if (url.pathname === '/api/projects/meta') {
    const projectId = sanitizeProjectId(url.searchParams.get('project') || '');
    if (!projectId) {
      json(res, 400, { error: 'project 参数非法' });
      return true;
    }
    let meta = null;
    try {
      const encoded = runRemote(buildReadProjectMetaCommand(projectId));
      if (encoded.trim()) {
        meta = parseProjectMeta(Buffer.from(encoded.trim(), 'base64').toString('utf8'));
      }
    } catch (cause) {
      json(res, 500, {
        error: `读取 project.json 失败: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
      return true;
    }
    if (!meta) {
      json(res, 404, { error: `项目 ${projectId} 不存在或缺少 project.json` });
      return true;
    }
    json(res, 200, {
      projectId,
      // 只回出图相关与解读需要的字段，避免把整份 meta（含备注原文）透给只读视图
      plotLayoutConfig: meta.plot_layout_config || null,
      analysisCutoffs: meta.analysis_cutoffs || null,
      dataSourceMode: meta.data_source?.data_source_mode || 'PUBLIC_DB',
      focusGenes: meta.biological_priors?.focus_genes || [],
      targetKoGene: meta.biological_priors?.target_ko_gene || '',
      stepCount: Array.isArray(meta.pipeline_dag) ? meta.pipeline_dag.length : 0,
    });
    return true;
  }

  // 客户需求收件箱：列出 portal/inbox 下的需求文件（新建项目时导入用）
  if (url.pathname === '/api/portal/inbox') {
    json(res, 200, listInboxManifests());
    return true;
  }

  // 读取单份需求原文（文件名由前端从列表接口取得，服务端再校验一次）
  if (url.pathname === '/api/portal/inbox/item') {
    const name = url.searchParams.get('name') || '';
    if (!isSafeManifestName(name)) {
      json(res, 400, { error: `需求文件名非法: ${name}` });
      return true;
    }
    const full = path.join(PORTAL_INBOX, name);
    if (!path.resolve(full).startsWith(path.resolve(PORTAL_INBOX))) {
      json(res, 400, { error: '路径越界' });
      return true;
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (cause) {
      json(res, 404, {
        error: `读取或解析需求文件失败: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
      return true;
    }
    const pairing = normalizeDatasets(manifest?.dataSource);
    const packageManifest = readPackageManifest(name);
    let sourceMode = 'PUBLIC_DB';
    let accession = null;
    try {
      const normalized = normalizeDataSource(manifest?.dataSource, '');
      sourceMode = normalized.mode;
      accession = normalized.accession;
    } catch (cause) {
      // IN_HOUSE 模式但契约不全（例如用户手工改坏了需求文件）：据实返回错误，
      // 不静默降级成 PUBLIC_DB，否则会把残缺需求当公共数据跑
      json(res, 400, {
        error: `需求文件数据源契约不完整: ${cause instanceof Error ? cause.message : String(cause)}`,
        file: name,
      });
      return true;
    }
    json(res, 200, {
      file: name,
      manifest,
      // 新格式：包清单（文献与数据文件的原名、归档名、sha256），旧格式为 null
      packageDir: packageManifest ? packageManifest.package_dir : null,
      packageManifest,
      // 数据类型 → 分析线：服务端判定，前端不必自己实现映射；
      // 缺失/非法时为空串，由前端回退到 stepId 反查（向后兼容旧需求文件）
      dataType: manifest?.dataSource?.dataType || '',
      suggestedLine: resolveLineFromDataType(manifest?.dataSource?.dataType),
      // 数据集↔平台配对表（旧扁平格式已按位置归一化，inferred=true 须提示核对）
      datasets: pairing.datasets,
      datasetsInferred: pairing.inferred,
      // 数据源双模态：IN_HOUSE_UPLOAD 时 accession 为 accession_and_platform 契约
      dataSourceMode: sourceMode,
      accession,
    });
    return true;
  }

  return false;
}
