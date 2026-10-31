function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 渲染后端自带的出图预览页（服务端 HTML，不依赖前端构建产物）。
 * @param {Array<{lineId: string, blocked: boolean, reason?: string, figures: Array}>} sections
 * @param {string} projectId 当前项目
 */
function renderFiguresPreview(sections, projectId) {
  const lineLabels = {
    line1_bulk: '线1 / GEO bulk',
    line2_scrna: '线2 / 单细胞转录组',
    line3_spatial: '线3 / 空间转录组',
  };
  const total = sections.reduce((sum, s) => sum + (s.figures ? s.figures.length : 0), 0);
  const body = sections.map((section) => {
    const label = lineLabels[section.lineId] || section.lineId;
    if (section.blocked || !section.figures || section.figures.length === 0) {
      const reason = section.blocked ? section.reason : '该线 figures/ 暂无图件';
      return `<h2>${escapeHtml(label)}</h2><p class="empty">${escapeHtml(reason)}</p>`;
    }
    const cards = section.figures.map((fig) => {
      const url = `/api/figures/image?project=${encodeURIComponent(projectId)}&line=${encodeURIComponent(section.lineId)}&name=${encodeURIComponent(fig.name)}`;
      const cap = fig.caption ? `<div class="cap">${escapeHtml(fig.caption)}</div>` : '';
      return `<figure class="card">
  <a href="${url}" target="_blank"><img src="${url}" alt="${escapeHtml(fig.name)}" loading="lazy"></a>
  <figcaption><span class="fn">${escapeHtml(fig.name)}</span>${cap}<span class="sz">${escapeHtml(fig.sizeLabel || '')}</span></figcaption>
</figure>`;
    }).join('\n');
    const sourceLabel = section.source === 'local' ? ' · 本地副本'
      : section.source === 'remote' ? ' · 远端实时（尚未回搬）' : '';
    return `<h2>${escapeHtml(label)}（${section.figures.length} 张${sourceLabel}）</h2>
<div class="grid">
${cards}
</div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BioanalysDesktop · 出图预览</title>
<style>
  body{font-family:system-ui,"Microsoft YaHei",sans-serif;margin:0;background:#f5f6f8;color:#1a1a1a}
  header{background:#1f2937;color:#fff;padding:18px 28px}
  header h1{margin:0;font-size:20px}
  header p{margin:6px 0 0;font-size:13px;opacity:.85}
  main{padding:18px 28px}
  h2{font-size:16px;border-left:4px solid #2563eb;padding-left:10px;margin:24px 0 12px}
  .empty{color:#7b8794;font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
  .card{margin:0;background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden}
  .card img{width:100%;display:block;background:#fff}
  figcaption{padding:8px 10px;font-size:12px;color:#374151;border-top:1px solid #eee;display:flex;flex-direction:column;gap:3px}
  .fn{color:#0b5fff;font-family:Consolas,monospace;font-size:11px}
  .cap{color:#52606d}
  .sz{color:#9aa5b1;font-size:11px}
</style></head>
<body>
<header>
  <h1>出图预览（后端渲染）</h1>
  <p>项目 ${escapeHtml(projectId)} · 共 ${total} 张 · 三条分析线 · 点击图片新窗口看原图 · 图件目录 projects/&lt;项目&gt;/&lt;线&gt;/figures/</p>
</header>
<main>
${body}
</main>
</body></html>`;
}

export { escapeHtml, renderFiguresPreview };
