// 交付路由：报告打包、本地交付件清单、交付件下载。
//
// 从 server/index.js 逐字搬来，处理体未做改写。json 与 runRemoteRaw 由 index.js 注入，
// 理由与 upload.routes.js 相同：这两个辅助在 index.js 的其它路由里仍在用，复制一份会造出
// 两个真源。
//
// 返回约定：命中本模块管辖的 pathname 就返回 true，未命中返回 false。
// 注意 /api/report/build 里的 await 全在 req.on('end', async () => ...) 回调内，
// 不在分支体顶层，所以本模块不需要声明为 async（与 diagnostics 不同）。
import fs from 'node:fs';
import path from 'node:path';

import { sanitizeProjectId } from '../domain.js';
import { runSync } from '../proc.js';
import {
  buildAdaptUploadPairs, readAdaptManifest, runReportBuild, pullDeliverables,
  checkRemoteProjectDir, isAllowedDeliverableName, localDeliverDir, localDeliverFilePath,
  runReportPreflight, writeSha256Sidecars,
} from '../report.js';

export function handleReportRoutes(req, res, url, { json, runRemoteRaw }) {
  if (url.pathname === '/api/report/build' && req.method === 'POST') {
    // 客户交付报告生成（A4/R3）：远端跑引擎 + 三大件回搬本地，一个请求内完成。
    // 失败（引擎退出码 1/2、scp 失败、交付件缺失）一律 500 且 error 带原文，不假成功。
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
      if (!projectId) {
        return json(res, 400, {
          error: `projectId 非法（只允许字母数字 . _ -，不以 . 开头，长度 <= 64）: ${requested.projectId}`,
        });
      }
      let remoteExists;
      try {
        remoteExists = await checkRemoteProjectDir(projectId);
      } catch (cause) {
        return json(res, 500, { ok: false, error: `远端链路检查失败: ${cause.message}` });
      }
      if (!remoteExists) {
        return json(res, 400, { ok: false, error: `远端项目目录不存在: /mnt/ssd/bio_data/projects/${projectId}` });
      }
      // 适配副本按既有 build_client_report 的 scripts/ 扫描口交付，不改动引擎。
      let adaptPairs = [];
      try {
        adaptPairs = buildAdaptUploadPairs(undefined, projectId);
      } catch (cause) {
        return json(res, 400, { ok: false, error: `适配清单无效: ${cause.message}` });
      }
      for (const pair of adaptPairs) {
        const remoteScriptDir = path.posix.dirname(pair.remote);
        const mkdir = runRemoteRaw(`mkdir -p '${remoteScriptDir}'`);
        if (mkdir.code !== 0) {
          return json(res, 503, { ok: false, error: `远端适配目录创建失败: ${mkdir.text}` });
        }
        const scp = runSync(['scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', pair.local, `k40-ubuntu:${pair.remote}`]);
        if (scp.code !== 0) {
          return json(res, 503, {
            ok: false,
            error: `适配副本上传失败: ${scp.stderr || scp.stdout || 'stderr 为空'}`,
            template_id: pair.template_id,
          });
        }
      }
      // 交付前置门禁（D4 / docs/delivery_package_spec.md 第三节 3/5/6 条）：
      // 打包前先查磁盘水位、运行中任务、失败台账，任一不过即 409 且原样回报，
      // 避免"打包成功但产物不可信"。force:true 仅放行失败台账，水位与运行中任务仍拦。
      let preflight;
      try {
        preflight = await runReportPreflight(projectId, { force: requested.force === true });
      } catch (cause) {
        return json(res, 500, { ok: false, error: `交付前置检查失败: ${cause.message}` });
      }
      if (!preflight.ok) {
        return json(res, 409, { ok: false, error: preflight.summary, preflight });
      }
      try {
        await runReportBuild(projectId);
        const pulled = await pullDeliverables(projectId);
        // 旁挂 sha256：包内 CHECKSUMS 尚未生成，先在本地交付目录落 .sha256 便于复核
        const sidecars = writeSha256Sidecars(projectId);
        return json(res, 200, {
          ok: true,
          projectId,
          files: pulled.files,
          report_md_bytes: pulled.report_md_bytes,
          report_html_bytes: pulled.report_html_bytes,
          adapted_code_count: adaptPairs.length,
          adapted_manifest: readAdaptManifest(undefined, projectId),
          preflight,
          sidecars,
        });
      } catch (cause) {
        return json(res, 500, {
          ok: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    });
    return true;
  }

  if (url.pathname === '/api/report/files') {
    // 本地已有交付文件清单：目录不存在或为空都是 200 + files:[]（不是 500）
    const projectId = sanitizeProjectId(url.searchParams.get('projectId') || url.searchParams.get('project') || '');
    if (!projectId) {
      json(res, 400, { error: 'projectId 参数非法' });
      return true;
    }
    let files = [];
    try {
      const dir = localDeliverDir(projectId);
      files = fs.readdirSync(dir)
        .filter((name) => isAllowedDeliverableName(name))
        .map((name) => ({ name, bytes: fs.statSync(path.join(dir, name)).size }));
    } catch {
      files = [];
    }
    json(res, 200, { ok: true, projectId, files });
    return true;
  }

  if (url.pathname === '/api/report/download') {
    // 交付文件下载：白名单在 report.js（三大件模式），越界/穿越/不在集合一律 400；
    // 永远只落 localDeliverDir 内，不回绝对路径。
    const projectId = sanitizeProjectId(url.searchParams.get('projectId') || url.searchParams.get('project') || '');
    if (!projectId) {
      json(res, 400, { error: 'projectId 参数非法' });
      return true;
    }
    const name = url.searchParams.get('file') || '';
    if (!isAllowedDeliverableName(name)) {
      json(res, 400, { error: `文件名非法或不在交付件允许集合内: ${name}` });
      return true;
    }
    const file = localDeliverFilePath(projectId, name);
    if (!file) {
      json(res, 404, { error: `交付文件不存在或尚未生成: ${name}（先 POST /api/report/build）` });
      return true;
    }
    const stat = fs.statSync(file);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
    return true;
  }

  return false;
}
