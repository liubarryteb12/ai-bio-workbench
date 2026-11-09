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
import { runSync, shellQuote } from '../proc.js';
import { assertFiguresPath } from '../figures.js';
import { pullLineOutputs, localFigurePath, LOCAL_OUTPUTS_ROOT } from '../pull.js';
import { loadWorkflows } from '../workflow_graph.js';
import {
  buildAdaptedFigureTasks, loadFigureTemplates, resolveFigure, validateRegistry as validateFigureRegistry,
} from '../figure_graph.js';
import { resolveProjectExample, validateProjectExamples } from '../figure_examples.js';
import { loadTemplateCatalog, validateTemplateCatalog } from '../figure_template_catalog.js';
import { deriveAdaptedFigure } from '../task.js';
import { readAdaptManifest, checkRemoteProjectDir } from '../report.js';
import { collectJsonBody, runJsonRoute, JSON_BODY_LIMIT } from '../http_body.js';

export async function handleFiguresRoutes(req, res, url, {
  json, runRemote, runRemoteRaw, resolveProjectParam, REPO_ROOT,
  listFiguresForLine, listRemoteProcessed, remoteTaskInput,
}) {
  if (url.pathname === '/api/figures/templates') {
    const registry = loadFigureTemplates();
    const check = validateFigureRegistry();
    const exampleErrors = validateProjectExamples();
    const catalogValidation = validateTemplateCatalog();
    const catalog = loadTemplateCatalog();
    const lineId = url.searchParams.get('line') || LINES[0];
    const templates = catalog.map((item) => ({
      id: item.id,
      name: item.name,
      english_name: item.english_name,
      level: item.level,
      level_label: item.level_label,
      category: item.category,
      category_label: item.category_label,
      language: item.language,
      language_label: item.language_label,
      deps_status: item.status,
      status_label: item.status_label,
      verified: item.verified,
      preview: item.preview,
      preview_state: item.preview_state,
      project_preview: item.latest_example?.path || null,
      example_source: item.example_source,
      source_sha256: item.source ? item.source_sha256 || null : null,
      linked_mods: item.linked_mods,
      adapt_vars: item.adapt_vars,
      block_reason: item.block_reason || '',
      purpose: item.purpose,
      introduction: item.introduction,
      dependencies: item.dependencies,
      input_tables: item.input_tables,
      input_artifact: item.input_artifact,
      produces: item.produces,
      lines: item.lines,
      line_labels: item.line_labels,
      analysis_step: item.analysis_step,
      producing_mod_id: item.producing_mod_id,
      required_mod_ids: item.required_mod_ids,
      preview_available: item.preview_available,
    }));
    json(res, 200, {
      ok: check.ok,
      registry_ok: check.ok,
      registry_errors: check.errors,
      example_ok: exampleErrors.length === 0,
      example_errors: exampleErrors,
      catalog_ok: catalogValidation.ok,
      catalog_errors: catalogValidation.errors,
      catalog_total: catalog.length,
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
    const example = resolveProjectExample(templateId, 'project') || resolveProjectExample(templateId, 'fixture');
    if (!item || item.deps_status !== 'ready' || !example) {
      json(res, 404, { error: `模板预览不可用: ${templateId}` });
      return true;
    }
    const file = path.resolve(REPO_ROOT, example.path);
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
    const check = validateTemplateCatalog();
    const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const language = String(url.searchParams.get('language') || '').trim().toLowerCase();
    const status = String(url.searchParams.get('status') || '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit') || 92)));
    const all = loadTemplateCatalog().map((item) => ({
      catalog_id: item.id,
      title: item.name,
      english_name: item.english_name,
      chart_type: item.category_label,
      family: item.category,
      lang: item.language_label,
      bio_level: item.level_label,
      status: item.status,
      status_label: item.status_label,
      pilot: item.status === 'ready',
      score: item.status === 'ready' ? 100 : item.status === 'pending' ? 60 : 20,
      width: item.latest_example?.width || null,
      height: item.latest_example?.height || null,
      code_path: item.source || '',
      deps: (item.dependencies || []).join('|'),
      bio_tags: [item.level_label, item.category_label, item.status_label, item.purpose].join('|'),
      page_url: '',
      preview_path: item.preview_available ? item.preview_source : null,
      preview_url: item.preview_url,
      purpose: item.purpose,
      introduction: item.introduction,
      suggested_template_id: item.id,
      lines: item.line_labels,
      analysis_step: item.analysis_step,
      input_tables: item.input_tables,
      produces: item.produces,
    }));
    const entries = all.filter((entry) => {
      if (language && entry.lang.toLowerCase() !== language) return false;
      if (status && entry.status !== status) return false;
      if (!query) return true;
      return [entry.title, entry.english_name, entry.chart_type, entry.purpose, entry.introduction, entry.bio_tags]
        .some((value) => String(value || '').toLowerCase().includes(query));
    }).slice(0, limit);
    const stats = {};
    for (const entry of all) stats[entry.status] = (stats[entry.status] || 0) + 1;
    json(res, 200, {
      ok: check.ok,
      catalog_ok: check.ok,
      catalog_errors: check.errors,
      stats,
      entries,
    });
    return true;
  }

  if (url.pathname === '/api/figures/catalog/preview') {
    const catalogId = url.searchParams.get('id') || '';
    const entry = loadTemplateCatalog().find((item) => item.id === catalogId);
    if (!entry || !entry.preview_available || !entry.preview_source) {
      json(res, 404, { error: `候选图预览不可用: ${catalogId}` });
      return true;
    }
    const file = path.resolve(REPO_ROOT, entry.preview_source);
    if (!file.startsWith(REPO_ROOT + path.sep) || !fs.statSync(file).isFile()) {
      json(res, 404, { error: `候选图预览不可用: ${catalogId}` });
      return true;
    }
    const stat = fs.statSync(file);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
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
    runJsonRoute(async () => {
      // T3-7：请求体上限闸门。超限时 collectJsonBody 已回出 413 并交回 null，
      // 这里必须短路：再写第二个响应会抛 ERR_HTTP_HEADERS_SENT 打死进程。
      const body = await collectJsonBody(req, res, json, { maxBytes: JSON_BODY_LIMIT });
      if (body === null) return;
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
      const mkdir = runRemoteRaw(`mkdir -p ${shellQuote(remoteDir)}`);
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

  if (url.pathname === '/api/figures/source_manifest') {
    const projectId = resolveProjectParam(url);
    if (!projectId) {
      json(res, 400, { error: 'project 参数非法（只允许字母数字 . _ -）' });
      return true;
    }
    const lineId = url.searchParams.get('line') || '';
    if (!LINES.includes(lineId)) {
      json(res, 400, { error: `line 参数非法，只允许 ${LINES.join(' / ')}` });
      return true;
    }

    // 只读固定的本地项目图件目录，project 与 line 都已通过白名单校验。
    const localRoot = path.resolve(REPO_ROOT, 'workspace/projects');
    const figureDir = path.resolve(localRoot, projectId, 'figures', lineId);
    if (!figureDir.startsWith(localRoot + path.sep)) {
      json(res, 400, { error: '图件来源路径越界' });
      return true;
    }
    const readSourceFile = (name) => {
      const file = path.resolve(figureDir, name);
      if (!file.startsWith(figureDir + path.sep)) return null;
      try {
        return fs.readFileSync(file, 'utf8');
      } catch {
        return null;
      }
    };
    const manifest = readSourceFile('FIGURE_SOURCE_MANIFEST.tsv');
    const readme = readSourceFile('README_FIGURE_SOURCES.md');
    if (manifest === null && readme === null) {
      json(res, 200, {
        ok: false,
        projectId,
        lineId,
        manifest: null,
        readme: null,
        reason: '本地图件来源清单不存在（FIGURE_SOURCE_MANIFEST.tsv / README_FIGURE_SOURCES.md）',
      });
      return true;
    }
    json(res, 200, { ok: true, projectId, lineId, manifest, readme });
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
    runJsonRoute(async () => {
      // T3-7：请求体上限闸门。超限时 collectJsonBody 已回出 413 并交回 null，
      // 这里必须短路：再写第二个响应会抛 ERR_HTTP_HEADERS_SENT 打死进程。
      const body = await collectJsonBody(req, res, json, { maxBytes: JSON_BODY_LIMIT });
      if (body === null) return;
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
    const encoded = localFile ? null : runRemote(`base64 -w0 ${shellQuote(`${guard.dir}/${name}`)} 2>/dev/null || true`);
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
