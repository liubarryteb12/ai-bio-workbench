import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { json } from './http_response.js';
const DIST_DIR = new URL('../dist/', import.meta.url);

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  // 防目录穿越
  if (rel.includes('..')) {
    return json(res, 400, { error: '非法路径' });
  }
  const lastSlash = rel.lastIndexOf('/');
  const lastDot = rel.lastIndexOf('.');
  const hasExt = lastDot > lastSlash;
  const ext = hasExt ? rel.slice(lastDot).toLowerCase() : '';
  // 有扩展名：只找该文件；无扩展名：先找同名文件再回退 index.html
  const candidates = hasExt ? [rel] : [rel, `${rel}/index.html`, 'index.html'];

  for (const candidate of candidates) {
    try {
      const filePath = fileURLToPath(new URL(candidate, DIST_DIR));
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.writeHead(200, {
          'Content-Type': STATIC_MIME[ext] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    } catch {
      // 继续尝试下一个候选
    }
  }

  // dist 尚未构建时的友好提示
  if (!fs.existsSync(fileURLToPath(DIST_DIR))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(
      '<!doctype html><meta charset="utf-8"><title>工作台未构建</title>' +
      '<body style="font-family:sans-serif;max-width:640px;margin:80px auto;padding:0 20px;color:#0f172a">' +
      '<h1 style="color:#0d9488">工作台前端尚未构建</h1>' +
      '<p>请在 <code>BioanalysDesktop/</code> 目录执行 <code>npm run build</code> 生成 <code>dist/</code> 后刷新本页。</p>' +
      '<p>开发模式可改用 <code>npm run dev</code>（Vite 监听 5173，API 代理到 18787）。</p>' +
      '</body>'
    );
  }
  return json(res, 404, { error: `静态资源未找到: ${pathname}` });
}
