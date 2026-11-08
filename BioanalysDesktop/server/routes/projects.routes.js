// 项目与建项路由。
//
// 项目与建项路由：处理体从 server/index.js 逐字搬来，函数体未做改写。
// 注入项的定义仍在 index.js（守卫与测试按 index.js 统计那些符号），此处不复制第二份。
// 返回约定：命中本模块管辖的 pathname 就返回 true。json() 与 uploadError() 返回
// undefined，不能当命中信号，所以分支顶层的 return 一律改成「先响应、再显式 return true」。
// 嵌套回调（runJsonRoute 的回调、map、setImmediate）里的 return 是回调返回值，保持原样。
// Q2 收口后，建项/图件/执行计划/黑名单等处理体已移入 services/，
// 本模块只保留仍在使用的小工具与 domain 归一函数。
import { normalizeDataSource, normalizeDatasets, resolveLineFromDataType } from '../domain.js';
import { collectJsonBody, runJsonRoute, JSON_BODY_LIMIT } from '../http_body.js';
// Q2：声明式路由表 + service 层。先迁移 4 个无副作用端点验证模式，
// 其余 8 个（含建项/图件/执行计划等重逻辑）在后续提交里逐步迁移。
import { dispatchRoutes } from '../route_dispatcher.js';
import * as projectService from '../services/project.service.js';
import { listLocalProjectsWithMeta } from '../query_views.js';
import { validateWithSchemaGateway } from '../schema_gateway_client.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * 读本地项目元数据（local_projects/<id>/project.json）。
 *
 * 为什么需要它（T3-5）：meta 接口历史上只读远端 K40 的 project.json，
 * 而默认项目 default 在本机 local_projects/default/project.json 是有内容的。
 * 远端没有该文件时接口直接 404，前端因此永远拿不到出图配置。
 * 回落只读本地这一个确定位置，不猜路径、不越界。
 */
function readLocalProjectMeta(repoRoot, projectId) {
  if (!repoRoot) return null;
  const file = path.join(repoRoot, 'local_projects', projectId, 'project.json');
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function handleProjectRoutes(req, res, url, deps) {
  const {
    PORTAL_INBOX, deployDataFiles, isSafeManifestName, json,
    lineFromPipeline, listInboxManifests, listProjectsWithMeta, readPackageManifest,
    runRemote, runRemoteRaw, uploadPreparedFigureScripts,
    REPO_ROOT = DEFAULT_REPO_ROOT,
  } = deps;

  // Q2：声明式路由表。每个描述符自带 method/path/querySchema/handler，
  // 前置管道（鉴权/参数校验/请求体采集）由 route_dispatcher 统一执行，
  // handler 只写业务。表里每一条都能被测试静态遍历审视。
  const ROUTES = [
    {
      method: 'GET',
      path: '/api/projects/list',
      handler: async ({ json: reply }) => {
        const r = projectService.listProjects({
          listProjectsWithMeta,
          listLocalProjectsWithMeta: () => listLocalProjectsWithMeta({ repoRoot: REPO_ROOT }),
        });
        reply(res, r.status, r.payload);
      },
    },
    {
      method: 'GET',
      path: '/api/projects/steps',
      handler: async ({ json: reply }) => {
        const r = projectService.getProjectSteps();
        reply(res, r.status, r.payload);
      },
    },
    {
      method: 'GET',
      path: '/api/workflows',
      handler: async ({ json: reply }) => {
        const r = projectService.getWorkflows();
        reply(res, r.status, r.payload);
      },
    },
    {
      method: 'GET',
      path: '/api/projects/meta',
      // projectId 的 sanitize 由分发器按 querySchema 执行；非法值 400 且不进 service
      querySchema: { project: 'projectId' },
      handler: async ({ query, json: reply }) => {
        const r = projectService.getProjectMeta(query.project, { runRemote, repoRoot: REPO_ROOT });
        reply(res, r.status, r.payload);
      },
    },
  ];

  if (await dispatchRoutes({ req, res, url, json, runJsonRoute }, ROUTES)) return true;

  if (url.pathname === '/api/projects/create' && req.method === 'POST') {
    // 建项目：建三线数据子目录 + 写 project.json，已存在则拒绝（不覆盖）
    // v2 支持四段式 manifest：basicInfo / dataSource / pipelineDag / aclAndOutput
    // 处理体已抽到 services/create.service.js（Q2 收口），这里只做请求体采集与响应写出。
    runJsonRoute(async () => {
      // T3-7：请求体上限闸门。超限时 collectJsonBody 已回出 413 并交回 null，
      // 这里必须短路：再写第二个响应会抛 ERR_HTTP_HEADERS_SENT 打死进程。
      const body = await collectJsonBody(req, res, json, { maxBytes: JSON_BODY_LIMIT });
      if (body === null) return;
      try {
        const projectId = body.projectId || body.project_id;
        const pipeline = body.pipeline || (lineFromPipeline ? lineFromPipeline(body.dataType) : undefined);
        if (projectId) {
          const gw = validateWithSchemaGateway('project', {
            project_id: projectId,
            project_name: body.projectName || body.project_name || projectId,
            pipeline: pipeline || undefined,
          }, { repoRoot: REPO_ROOT });
          if (!gw.allowed) {
            return json(res, 400, {
              error: `Schema 校验拒绝: ${gw.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
              gateway_errors: gw.errors,
            });
          }
        }
        const result = await projectService.createProject({ body }, {
          deployDataFiles, lineFromPipeline, runRemote, uploadPreparedFigureScripts,
        });
        return json(res, result.status, result.payload);
      } catch (cause) {
        return json(res, 500, { error: `建项处理失败: ${(cause && cause.message) || cause}` });
      }
    });
    return true;
  }

  // 非肿瘤正则黑名单校验（前端实时调用，输入时红字拦截）
  if (url.pathname === '/api/blacklist/check' && req.method === 'POST') {
    runJsonRoute(async () => {
      // T3-7：请求体上限闸门。超限时 collectJsonBody 已回出 413 并交回 null，
      // 这里必须短路：再写第二个响应会抛 ERR_HTTP_HEADERS_SENT 打死进程。
      const body = await collectJsonBody(req, res, json, { maxBytes: JSON_BODY_LIMIT });
      if (body === null) return;
      const r = projectService.checkBlacklist({ body });
      return json(res, r.status, r.payload);
    });
    return true;
  }

  // 组合合法性预检：客户端勾完步骤后先问一次，别等远端跑爆才发现
  if (url.pathname === '/api/workflows/resolve' && req.method === 'POST') {
    runJsonRoute(async () => {
      // T3-7：请求体上限闸门。超限时 collectJsonBody 已回出 413 并交回 null，
      // 这里必须短路：再写第二个响应会抛 ERR_HTTP_HEADERS_SENT 打死进程。
      const body = await collectJsonBody(req, res, json, { maxBytes: JSON_BODY_LIMIT });
      if (body === null) return;
      // T1.5：抛错统一收敛成 500，避免请求悬挂。
      try {
        const r = projectService.resolveWorkflow({ body });
        return json(res, r.status, r.payload);
      } catch (cause) {
        return json(res, 500, { error: `处理失败: ${(cause && cause.message) || cause}` });
      }
    });
    return true;
  }

  // 单系列详情必须放在 resolve 之后：否则前缀匹配会把 /api/workflows/resolve
  // 吞成 seriesId=resolve，返回「未知分析系列」。
  if (url.pathname.startsWith('/api/workflows/')) {
    const seriesId = url.pathname.slice('/api/workflows/'.length).split('?')[0];
    const r = projectService.workflowDetail({ seriesId });
    json(res, r.status, r.payload);
    return true;
  }

  // 单个项目的关键元数据：Studio 用它显示"这批图按什么模板/阈值出的"
  if (url.pathname === '/api/projects/figures/apply' && req.method === 'POST') {
    // 处理体已抽到 services/figures_apply.service.js（Q2 收口）。
    runJsonRoute(async () => {
      // T3-7：请求体上限闸门。超限时 collectJsonBody 已回出 413 并交回 null，
      // 这里必须短路：再写第二个响应会抛 ERR_HTTP_HEADERS_SENT 打死进程。
      const body = await collectJsonBody(req, res, json, { maxBytes: JSON_BODY_LIMIT });
      if (body === null) return;
      try {
        const r = await projectService.applyFigures({ body }, {
          lineFromPipeline, runRemote, runRemoteRaw, uploadPreparedFigureScripts,
        });
        return json(res, r.status, r.payload);
      } catch (cause) {
        return json(res, 500, { error: `图件应用失败: ${(cause && cause.message) || cause}` });
      }
    });
    return true;
  }

  if (url.pathname === '/api/projects/execution-plan' && req.method === 'GET') {
    const r = projectService.getExecutionPlan({
      project: url.searchParams.get('project'),
      runRemote, lineFromPipeline,
    });
    json(res, r.status, r.payload);
    return true;
  }

  if (url.pathname === '/api/projects/execution-plan' && req.method === 'POST') {
    runJsonRoute(async () => {
      // T3-7：请求体上限闸门。超限时 collectJsonBody 已回出 413 并交回 null，
      // 这里必须短路：再写第二个响应会抛 ERR_HTTP_HEADERS_SENT 打死进程。
      const body = await collectJsonBody(req, res, json, { maxBytes: JSON_BODY_LIMIT });
      if (body === null) return;
      const r = projectService.postExecutionPlan({ body, runRemote, lineFromPipeline });
      return json(res, r.status, r.payload);
    });
    return true;
  }

  // 客户需求收件箱：列出 portal/inbox 下的需求文件（新建项目时导入用）
  if (url.pathname === '/api/portal/inbox') {
    const r = projectService.listInbox({ listInboxManifests });
    json(res, r.status, r.payload);
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
