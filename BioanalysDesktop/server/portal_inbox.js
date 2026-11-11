import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDatasets, resolveLineFromDataType } from './domain.js';
const PORTAL_INBOX = fileURLToPath(new URL('../../portal/inbox/', import.meta.url));

// inbox/ 是 gitignore 的运行目录（.gitignore 的 inbox/ 规则），新克隆与便携包里
// 都不存在。消费方（含 portal/serve.mjs 与各测试）默认它可写；在模块加载处
 // recursive 建目录，缺目录不再让写入方各自踩 ENOENT。
fs.mkdirSync(PORTAL_INBOX, { recursive: true });

/**
 * 需求文件名校验：只允许两种形态，禁止任何穿越。
 *   - 旧格式：收件箱根目录的单个 `<时间戳>_需求_<项目名>.json`
 *   - 新格式：提交包 `PKG_<时间戳>_<项目名>/requirement.json`
 * 包名由 portal 生成（时间戳 + 中文项目名），故放行中文字符。
 */
function isSafeManifestName(name) {
  if (typeof name !== 'string' || !name) return false;
  if (name.includes('..') || name.includes('\\')) return false;
  if (/^[\w\u4e00-\u9fa5.-]+\.json$/.test(name)) return true;
  return /^PKG_[\w\u4e00-\u9fa5.-]+\/(requirement|package_manifest)\.json$/.test(name);
}

/** 读包清单（新格式才有）；解析失败返回 null，不让一个坏清单挡住整列表 */
function readPackageManifest(relFile) {
  const slash = relFile.indexOf('/');
  if (slash < 0) return null;
  const dir = relFile.slice(0, slash);
  try {
    return JSON.parse(fs.readFileSync(path.join(PORTAL_INBOX, dir, 'package_manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 列出收件箱需求（按 mtime 倒序）。同时兼容两种落盘形态：
 *   - 旧：根目录平铺 `<时间戳>_需求_<项目名>.json`
 *   - 新：`PKG_<时间戳>_<项目名>/requirement.json` + package_manifest.json
 * 目录不存在时返回 blocked，不假装"没有需求"；单个文件解析失败也如实列出 parseError。
 */
function listInboxManifests() {
  let entries;
  try {
    entries = fs.readdirSync(PORTAL_INBOX, { withFileTypes: true });
  } catch (cause) {
    return {
      blocked: true,
      reason: `收件箱目录不存在或不可读: ${PORTAL_INBOX}`,
      detail: cause instanceof Error ? cause.message : String(cause),
      items: [],
    };
  }

  const names = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      names.push(entry.name);
    } else if (entry.isDirectory() && entry.name.startsWith('PKG_')) {
      const req = path.join(PORTAL_INBOX, entry.name, 'requirement.json');
      if (fs.existsSync(req)) names.push(`${entry.name}/requirement.json`);
    }
  }

  const items = names.map((file) => {
    const full = path.join(PORTAL_INBOX, file);
    let size = 0;
    let mtime = '';
    try {
      const stat = fs.statSync(full);
      size = stat.size;
      mtime = stat.mtime.toISOString();
    } catch {
      // 文件刚被移走，跳过统计即可
    }
    let summary = null;
    let parseError = null;
    try {
      const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
      // 旧需求文件是扁平数组（trainGse/valGse/gpl），归一化后统一成配对表；
      // inferred=true 表示配对是按位置推断的，前端须提示用户核对
      const pairing = normalizeDatasets(raw?.dataSource);
      summary = {
        name: raw?.basicInfo?.name || '',
        disease: raw?.basicInfo?.disease || '',
        domain: raw?.basicInfo?.domain || '',
        species: raw?.basicInfo?.species || '',
        dataType: raw?.dataSource?.dataType || '',
        suggestedLine: resolveLineFromDataType(raw?.dataSource?.dataType),
        // 配对表每行带 dataType / sampleCount / tissue（行级未填时已由
        // normalizeDatasets 回落项目级），前端直接展示，不重算
        datasets: pairing.datasets,
        datasetsInferred: pairing.inferred,
        sampleCount: Number(raw?.dataSource?.sampleCount) || 0,
        tissue: raw?.dataSource?.tissue || '',
        refCount: Array.isArray(raw?.references) ? raw.references.length : 0,
        notes: typeof raw?.notes === 'string' ? raw.notes : '',
        submittedAt: raw?.submitted_at || '',
        modIds: Array.isArray(raw?.modIds)
          ? raw.modIds.map((item) => String(item || '').trim()).filter(Boolean)
          : [],
        stepCount: Array.isArray(raw?.pipelineDag) ? raw.pipelineDag.length : 0,
        groupCount: Array.isArray(raw?.groupingDesign?.groups) ? raw.groupingDesign.groups.length : 0,
      };
    } catch (cause) {
      parseError = cause instanceof Error ? cause.message : String(cause);
    }
    // 新格式带包清单：把附件计数一并给前端，列表页就能看出"这次提交带了几个文件"
    const pkg = readPackageManifest(file);
    return {
      file, size, mtime, summary, parseError,
      packageDir: pkg ? pkg.package_dir || file.split('/')[0] : null,
      attachments: pkg && pkg.counts ? pkg.counts : null,
    };
  });

  items.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return { blocked: false, dir: PORTAL_INBOX, items };
}

export { PORTAL_INBOX, isSafeManifestName, readPackageManifest, listInboxManifests };
