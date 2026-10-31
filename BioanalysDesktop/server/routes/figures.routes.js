// 图件与图形路由：模板、候选图、适配派生、图件浏览、回搬与单图读取。
//
// 从 server/index.js 逐字搬来，处理体未做改写。json、runRemote、runRemoteRaw、
// resolveProjectParam 以及 index.js 的前置层辅助由入口注入，理由与其它路由模块相同：
// 这些辅助在 index.js 的其它路由里仍在用，复制一份会造出两个真源。
//
// 返回约定：命中本模块管辖的 pathname 就返回 true（含"已注册异步回调、稍后才回响应"
// 的情形），未命中返回 false 让 index.js 继续往下派发。json() 返回 undefined，
// 所以绝不能拿它的返回值当命中信号，分支顶层必须显式 return true。
import fs from 'node:fs';
import path from 'node:path';

import { LINES, sanitizeProjectId, PROJECTS_ROOT } from '../domain.js';
import { runSync } from '../proc.js';
import { assertFiguresPath } from '../figures.js';
import { pullLineOutputs, localFigurePath, LOCAL_OUTPUTS_ROOT } from '../pull.js';
import { loadWorkflows } from '../workflow_graph.js';
import {
  buildAdaptedFigureTasks, loadFigureTemplates, resolveFigure, validateRegistry as validateFigureRegistry,
} from '../figure_graph.js';
import {
  resolveCatalogFigure, searchFigureCatalog, validateFigureCatalog,
} from '../figure_catalog.js';
import { deriveAdaptedFigure } from '../task.js';
import { readAdaptManifest, checkRemoteProjectDir } from '../report.js';

export function handleFiguresRoutes(req, res, url, {
  json, runRemote, runRemoteRaw, resolveProjectParam, REPO_ROOT,
  listFiguresForLine, listRemoteProcessed, remoteTaskInput,
}) {
  if (url.pathname === '/api/figures/templates') {
    const registry = loadFigureTemplates();
    const check = validateFigureRegistry();
    const lineId = url.searchParams.get('line') || LINES[0];
    const templates = registry.templates.map((item) => ({
      id: item.id,
      name: item.name,
      level: item.level,
      category: item.category,
      language: item.language,
      deps_status: item.deps_status,
      verified: item.verified,
      preview: item.preview,
      source_sha256: item.source_sha256,
      linked_mods: item.linked_mods,
      adapt_vars: item.adapt_vars,
      block_reason: item.block_reason || '',
    }));
    json(res, 200, {
      ok: check.ok,
      registry_ok: check.ok,
      registry_errors: check.errors,
      stats: check.stats,
      lineId,
      templates,
    });
    return true;
  }

  if (url.pathname === '/api/figures/templates/preview') {
    const templateId = url.searchParams.get('id') || '';
    const registry = loadFigureTemplates();
    const item = registry.templates.find((candidate) => candidate.id === templateId);
    if (!item || item.deps_status !== 'ready' || !item.preview) {
      json(res, 404, { error: `模板预览不可用: ${templateId}` });
      return true;
    }
    const file = path.resolve(REPO_ROOT, item.preview);
    if (!file.startsWith(REPO_ROOT + path.sep)) {
      json(res, 400, { error: '模板预览路径越界' });
      return true;
    }
    const lower = file.toLowerCase();
    const mime = lower.endsWith('.png') ? 'image/png'
      : lower.endsWith('.svg') ? 'image/svg+xml'
      : lower.endsWith('.gif') ? 'image/gif'
      : lower.endsWith('.webp') ? 'image/webp'
      : lower.endsWith('.pdf') ? 'application/pdf'
      : 'image/jpeg';
    const stat = fs.statSync(file);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
    return true;
  }

  if (url.pathname === '/api/figures/catalog') {
    const check = validateFigureCatalog();
    const entries = searchFigureCatalog({
      query: url.searchParams.get('q') || '',
      language: url.searchParams.get('language') || '',
      status: url.searchParams.get('status') || '',
      limit: url.searchParams.get('limit') || 50,
    }).map((item) => ({
      catalog_id: item.catalog_id,
      page_id: item.page_id,
      title: item.title,
      lang: item.lang,
      chart_type: item.chart_type,
      family: item.family,
      bio_level: item.bio_level,
      bio_tags: item.bio_tags,
      score: item.score,
      status: item.status,
      deps: item.deps,
      page_url: item.page_url,
      preview_path: item.preview_path,
      code_path: item.code_path,
      width: item.width,
      height: item.height,
      pilot: item.pilot,
      suggested_template_id: item.suggested_template_id,
    }));
    json(res, 200, {
      ok: check.ok,
      catalog_ok: check.ok,
      catalog_errors: check.errors,
      stats: check.stats,
      entries,
    });
    return true;
  }

  if (url.pathname === '/api/figures/catalog/preview') {
    const catalogId = url.searchParams.get('id') || '';
    const resolved = resolveCatalogFigure(catalogId);
    if (!resolved.ok || !resolved.preview_abs) {
      json(res, 404, {
        error: `候选图预览不可用: ${catalogId}`,
        errors: resolved.errors,
      });
      return true;
    }
    const stat = fs.statSync(resolved.preview_abs);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(resolved.preview_abs).pipe(res);
    return true;
  }

  if (url.pathname === '/api/figures/adapt') {
    const projectId = resolveProjectParam(url);
    if (!projectId) {
      json(res, 400, { error: 'project 参数非法' });
      return true;
    }
    try {
      const manifest = readAdaptManifest(undefined, projectId);
      json(res, 200, { ok: true, projectId, items: manifest });
      return true;
    } catch (cause) {
      json(res, 500, { error: `读取适配清单失败: ${cause instanceof Error ? cause.message : String(cause)}` });
      return true;
    }
  }

  if (url.pathname === '/api/figures/adapt/derive' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      let requested;
      try {
        requested = JSON.parse(body || '{}');
      } catch (cause) {
        return json(res, 400, { error: `请求体不是合法 JSON: ${cause.message}` });
      }
      const projectId = sanitizeProjectId(requested.projectId);
      const lineId = requested.lineId;
      const templateId = String(requested.templateId || '');
      if (!projectId) return json(res, 400, { error: 'projectId 参数非法' });
      if (!LINES.includes(lineId)) return json(res, 400, { error: `lineId 参数非法: ${lineId}` });
      const seed = Number(requested.seed);
      if (requested.seed === undefined || requested.seed === null || requested.seed === ''
        || !Number.isInteger(seed) || seed < 0) {
        return json(res, 400, { error: 'seed 必须显式提供为非负整数' });
      }

      const selectedModIds = Array.isArray(requested.selectedModIds)
        ? requested.selectedModIds.map(String) : [];
      const adaptVars = requested.adaptVars && typeof requested.adaptVars === 'object'
        ? requested.adaptVars : {};
      const resolved = resolveFigure(templateId, lineId, projectId, adaptVars, selectedModIds);
      if (!resolved.ok) {
        return json(res, 422, { ok: false, errors: resolved.errors, template_id: templateId });
      }

      let remoteExists;
      try {
        remoteExists = await checkRemoteProjectDir(projectId);
      } catch (cause) {
        return json(res, 503, { ok: false, error: `远端链路检查失败: ${cause instanceof Error ? cause.message : String(cause)}` });
      }
      if (!remoteExists) {
        return json(res, 400, { ok: false, error: `远端项目目录不存在: ${PROJECTS_ROOT}/${projectId}` });
      }

      const derivation = deriveAdaptedFigure({
        projectId,
        lineId,
        templateId,
        template: resolved.template,
        adaptVars,
      });
      if (!derivation.ok) {
        return json(res, 422, { ok: false, errors: derivation.errors, template_id: templateId });
      }
      const adapted = buildAdaptedFigureTasks({
        projectId,
        lineId,
        selectedFigures: [{ template_id: templateId, adapt_vars: adaptVars }],
        templatesRegistry: [resolved.template],
      });
      if (!adapted.ok || adapted.tasks.length !== 1) {
        return json(res, 422, { ok: false, errors: adapted.errors, template_id: templateId });
      }
      const adaptedTask = adapted.tasks[0];

      const remoteDir = path.posix.dirname(derivation.remote_path);
      const mkdir = runRemoteRaw(`mkdir -p '${remoteDir}'`);
      if (mkdir.code !== 0) {
        return json(res, 503, {
          ok: false,
          error: `远端适配目录创建失败: ${mkdir.text}`,
          local_path: derivation.local_path,
        });
      }
      const scp = runSync(['scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', derivation.local_path, `k40-ubuntu:${derivation.remote_path}`]);
      if (scp.code !== 0) {
        return json(res, 503, {
          ok: false,
          error: `适配副本上传失败: ${scp.stderr || scp.stdout || 'stderr 为空'}`,
          local_path: derivation.local_path,
        });
      }

      const taskPayload = {
        projectId,
        lineId,
        step: adaptedTask.step,
        inputs: [remoteTaskInput(adaptVars.input_data, projectId, lineId)],
        outputs: adaptedTask.outputs,
        seed,
        scriptPath: adaptedTask.script_path,
        language: adaptedTask.language,
        canonicalOutput: adaptedTask.canonical_output,
        customOutput: adaptedTask.custom_output,
        adapted: true,
        dependsOnStep: adaptedTask.depends_on_step,
      };
      return json(res, 200, {
        ok: true,
        projectId,
        lineId,
        template_id: templateId,
        selected_mods: resolved.selected_mods,
        local_path: derivation.local_path,
        remote_path: derivation.remote_path,
        master_sha256: derivation.master_sha256,
        derived_sha256: derivation.manifest_entry.derived_sha256,
        task: taskPayload,
      });
    });
    return true;
  }

  if (url.pathname === '/api/figures/list') {
    // 图件浏览：列出本项目该线 figures/ 下的 PNG，供可视化界面渲染
    const projectId = resolveProjectParam(url);
    if (!projectId) {
      json(res, 400, { error: `project 参数非法（只允许字母数字 . _ -）` });
      return true;
    }
    const lineId = url.searchParams.get('line') || LINES[0];
    const guard = assertFiguresPath(projectId, lineId);
    if (!guard.ok) {
      json(res, 400, { error: guard.reason });
      return true;
    }
    const result = listFiguresForLine(projectId, lineId);
    if (result.blocked) {
      json(res, 200, {
        blocked: true,
        projectId,
        lineId,
        reason: result.reason,
        hint: '该线还没出图（跑 *_figures 步骤）或项目未创建',
        figures: [],
      });
      return true;
    }
    json(res, 200, {
      blocked: false, projectId, lineId, dir: guard.dir,
      source: result.source, figures: result.figures,
    });
    return true;
  }

  // M4：按 mod 分组的产物预览。
  // 与 /api/figures/list 的区别：那个把 figures/ 全量倒出，这个按客户勾选的 mod 分组，
  // 没勾选的 mod 不出现（客户不该看到没买的分析），且能说清"该 mod 没跑"而非"文件丢失"。
  if (url.pathname === '/api/preview/mods') {
    const projectId = resolveProjectParam(url);
    if (!projectId) {
      json(res, 400, { error: 'project 参数非法（只允许字母数字 . _ -）' });
      return true;
    }
    const lineId = url.searchParams.get('line') || LINES[0];
    // modIds 由调用方给（一般是该项目 pipeline_dag 里勾选的）；不传则按该线全链
    const modIds = (url.searchParams.get('modIds') || '').split(',').map((s) => s.trim()).filter(Boolean);

    const series = loadWorkflows().series.find((s) => s.id === lineId);
    if (!series) {
      json(res, 404, { error: `未知分析系列: ${lineId}` });
      return true;
    }

    // 读取该线 processed/ 与 figures/ 的真实产物，用于判定每个 mod 跑没跑
    const listed = listFiguresForLine(projectId, lineId);
    const figureNames = new Set((listed.figures || []).map((f) => f.name));
    const processedNames = listRemoteProcessed(projectId, lineId);

    const allMods = series.stages.flatMap((st) => st.mods.map((m) => ({ ...m, stage: st })));
    const picked = modIds.length
      ? allMods.filter((m) => modIds.includes(m.id))
      : allMods;

    const groups = picked.map((m) => {
      const script = m.script || m.id;
      const products = (m.produces || []).map((name) => {
        // 产物可能落在 processed/ 或 figures/（outputs_dir=figures 的 mod）
        const present = figureNames.has(name) || processedNames.has(name);
        return { name, present };
      });
      const presentCount = products.filter((p) => p.present).length;
      return {
        mod_id: m.id,
        script,
        name: m.name,
        stage_id: m.stage.id,
        stage_name: m.stage.name,
        status: products.length === 0
          ? 'unknown'
          : (presentCount === products.length ? 'complete' : (presentCount > 0 ? 'partial' : 'missing')),
        present_count: presentCount,
        total_count: products.length,
        products,
      };
    });

    json(res, 200, {
      blocked: listed.blocked === true,
      projectId,
      lineId,
      reason: listed.reason || '',
      mod_count: groups.length,
      groups,
    });
    return true;
  }

  if (url.pathname === '/api/figures/pull' && req.method === 'POST') {
    // 图件回搬：把远端 figures/（以及 results/）拉到本地 outputs/，供视图 4 离线查看。
    // 本地只跑 scp，不触发任何计算（零算力红线）。
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch (cause) {
        return json(res, 400, { error: `请求体不是合法 JSON: ${cause.message}` });
      }
      const projectId = sanitizeProjectId(payload.project || payload.projectId || '');
      if (!projectId) {
        return json(res, 400, { error: 'project 参数非法（只允许字母数字 . _ -）' });
      }
      const requested = payload.line || payload.lineId;
      const lines = requested ? [requested] : LINES;
      const badLine = lines.find((line) => !LINES.includes(line));
      if (badLine) {
        return json(res, 400, { error: `line 非法: ${badLine}，只能是 ${LINES.join(' / ')}` });
      }
      try {
        const results = lines.map((line) => pullLineOutputs(projectId, line, {
          force: Boolean(payload.force),
        }));
        return json(res, 200, {
          ok: results.every((item) => item.failed === 0),
          localRoot: LOCAL_OUTPUTS_ROOT,
          results,
        });
      } catch (cause) {
        return json(res, 500, { error: `回搬失败: ${cause.message}` });
      }
    });
    return true;
  }

  if (url.pathname === '/api/figures/image') {
    // 取回单张图件字节（ssh + base64），直接以图片 MIME 返回给浏览器
    const projectId = resolveProjectParam(url);
    if (!projectId) {
      json(res, 400, { error: `project 参数非法（只允许字母数字 . _ -）` });
      return true;
    }
    const lineId = url.searchParams.get('line') || LINES[0];
    const name = url.searchParams.get('name') || '';
    const guard = assertFiguresPath(projectId, lineId, name);
    if (!guard.ok) {
      json(res, 400, { error: guard.reason });
      return true;
    }
    // 优先读本地回搬副本；本地没有才回落远端（ssh + base64）。
    // 本地副本是规范要求的离线可看形态，也避免每次翻图都走一次 ssh。
    const localFile = localFigurePath(projectId, lineId, name);
    const encoded = localFile ? null : runRemote(`base64 -w0 '${guard.dir}/${name}' 2>/dev/null || true`);
    if (!localFile && !encoded.trim()) {
      json(res, 404, { error: `图件不存在或读取失败: ${name}` });
      return true;
    }
    const buf = localFile ? fs.readFileSync(localFile) : Buffer.from(encoded.trim(), 'base64');
    const lower = name.toLowerCase();
    const mime = lower.endsWith('.png') ? 'image/png'
      : lower.endsWith('.svg') ? 'image/svg+xml'
      : lower.endsWith('.gif') ? 'image/gif'
      : lower.endsWith('.webp') ? 'image/webp'
      : 'image/jpeg';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
      'X-Figure-Source': localFile ? 'local' : 'remote',
    });
    res.end(buf);
    return true;
  }

  return false;
}
