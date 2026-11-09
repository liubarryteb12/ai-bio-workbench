/**
 * 用户需求提交入口 · 独立服务
 *
 * 与管理员工作台（BioanalysDesktop，18787）彻底解耦：
 *   - 不挂工作台任何 API、不连数据面（projects/ 目录）
 *   - 独立端口（默认 127.0.0.1:8080），可单独内网穿透给客户
 *   - 客户点「提交给对接人」后，需求 JSON 落到本目录 inbox/（人工中转的收件箱）
 *   - 另附 /health 探活；其余路径一律 404
 *
 * 启动：
 *   node portal/serve.mjs                       # 默认 127.0.0.1:8080
 *   PORTAL_PORT=9000 node portal/serve.mjs      # 换端口
 *   PORTAL_HOST=0.0.0.0 node portal/serve.mjs   # 换监听地址（默认仅本机，穿透工具连本机即可）
 *   PORTAL_INBOX=/tmp/x node portal/serve.mjs    # 换收件箱（测试用，不污染真实收件箱）
 *
 * 提交分两种形态（工作台收件箱视图两种都认）：
 *   包形态（带数据文件）：POST /api/datafiles 逐个上传 → POST /api/submit 归档成
 *     inbox/PKG_<时间戳>_<项目名>/{requirement.json,package_manifest.json,raw_data/*,references/*}
 *   扁平形态（无数据文件的老客户端）：POST /api/submit 直接落一个平铺 JSON
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import stream from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  DATA_ROLES, DATA_EXT, MAX_DATA_BYTES, MAX_DATA_FILES_PER_ROLE,
  sanitizeFileName, validateDataFiles, buildPackagePlan,
} from './lib/archive.mjs';
// P5：共享契约的唯一权威（只读引用，本进程不改写这些值）
import {
  DATA_EXT as SHARED_DATA_EXT, MAX_DATA_BYTES as SHARED_MAX_DATA_BYTES,
} from '../shared/data_formats.mjs';
import { BLACKLIST_PATTERNS, validateProjectFields } from '../BioanalysDesktop/server/tumor_blacklist.js';
import { resolveFigure } from '../BioanalysDesktop/server/figure_graph.js';
import { validateProjectExamples, resolveProjectExample } from '../BioanalysDesktop/server/figure_examples.js';
import { loadTemplateCatalog, loadTemplateCatalogById, validateTemplateCatalog } from '../BioanalysDesktop/server/figure_template_catalog.js';
// 第二十九轮 ⑥：需求单结构的唯一真源。门户与服务端建项共用同一份规则，
// 这样客户在这里提交通过的东西，工作台那边一定认；反过来这边拦下的，工作台也不会收到半成品。
import { validateRequirement } from '../shared/requirement_schema.mjs';

const PORT = Number(process.env.PORTAL_PORT || 8080);
const HOST = process.env.PORTAL_HOST || '127.0.0.1';
// 仓库根：本文件在 <repo>/portal/ 下，上一级即仓库根。工作流注册表在那里。
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * 可选访问令牌（B4）：默认空字符串 = 完全开放，行为与未启用鉴权的历史版本一致；
 * 运维显式设置 PORTAL_TOKEN 后，/api/* 写端点要求携带令牌（Bearer 头或 ?token=）。
 * 静态页与 /health 永不鉴权（页面要能打开、探活要能通）。
 */
const PORTAL_TOKEN = process.env.PORTAL_TOKEN || '';
const SYNC_TOKEN = process.env.SYNC_TOKEN || '';
const PORTAL_CLIENT_TOKEN = process.env.PORTAL_CLIENT_TOKEN || '';
/** 鉴权失败的统一响应文案（不回显 token 本身，避免把收到的令牌写进日志/响应） */
const AUTH_ERROR = '未授权：缺少或错误的 access token（设置 PORTAL_TOKEN 的服务需要令牌）';
const SYNC_AUTH_ERROR = '未授权：缺少或错误的 SYNC_TOKEN';
const CLIENT_AUTH_ERROR = '未授权：缺少或错误的客户访问 token（设置 PORTAL_CLIENT_TOKEN 的服务需要令牌）';
const INDEX = fileURLToPath(new URL('./index.html', import.meta.url));
const INBOX = process.env.PORTAL_INBOX
  ? path.resolve(process.env.PORTAL_INBOX)
  : fileURLToPath(new URL('./inbox/', import.meta.url));
const SID_RE = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * 编译期注入锚点（P5）：index.html 在 <script> 之前留了这一行注释。
 * 本服务返回页面时把它替换成 window.__SHARED_CONTRACTS__，让前端用运行时校验
 * 同一份白名单/上限/黑名单；离线双击 html 时锚点仍是注释，前端回落到字面量副本。
 */
const INJECT_ANCHOR = '<!-- __INJECT_SHARED_CONTRACTS__ -->';

/** 把共享契约整理成可 JSON 序列化的载荷（正则转成 source + flags，顺序保持不变） */
export function sharedContractsPayload() {
  return {
    DATA_EXT: [...SHARED_DATA_EXT],
    MAX_DATA_BYTES: SHARED_MAX_DATA_BYTES,
    BL_PATTERNS: BLACKLIST_PATTERNS.map((re) => ({ source: re.source, flags: re.flags })),
  };
}

/**
 * 序列化成能安全放进 <script> 的 JSON：
 * 转义 < 防止 </script> 提前闭合，顺带转义 U+2028/U+2029（旧引擎的行终止符）。
 */
function scriptSafeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * 把注入锚点替换成 window.__SHARED_CONTRACTS__ 赋值脚本。
 * 没有锚点（例如被裁剪过的页面）时原样返回，不抛错、不改页面结构。
 */
export function injectSharedContracts(html) {
  if (!html.includes(INJECT_ANCHOR)) return html;
  const payload = scriptSafeJson(sharedContractsPayload());
  return html.replace(INJECT_ANCHOR, '<script>window.__SHARED_CONTRACTS__ = ' + payload + ';</script>');
}

/** 单份需求 JSON 上限，防止异常大包写满磁盘 */
const MAX_BODY = 1024 * 1024;

/**
 * 合法数据类型枚举（与工作台 server/domain.js、本端 index.html 同值）。
 *
 * 两端彻底解耦、不共享代码，所以这里独立持有同一份约定。
 * 数据类型决定走哪条分析线（microarray|bulk_rnaseq→line1，scrna→line2，spatial→line3），
 * 缺失就无法正确选线，因此在落盘前再兜一道。
 */
const DATA_TYPE_IDS = ['microarray', 'bulk_rnaseq', 'scrna', 'spatial'];

/**
 * 参考文献上传约定（与 index.html 同值副本，两端解耦）：
 * 最多 5 篇、单篇 ≤20MB、扩展名白名单；文件落在 inbox/refs/<sid>/ 下。
 */
const REF_MAX_FILES = 5;
const REF_MAX_BYTES = 20 * 1024 * 1024;
const REF_EXT = ['.pdf', '.doc', '.docx', '.txt', '.md', '.zip'];
const REF_SID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const REF_PATH_RE = /^refs\/[A-Za-z0-9_-]{6,64}\/[^/\\]{1,120}$/;
/** Sync 状态机与下载缓存：状态存 inbox JSON，tar.gz 存内部缓存目录。 */
const SYNC_STATUSES = ['pending', 'running', 'done', 'failed', 'blocked'];
const SYNC_CACHE = path.join(INBOX, '.sync_cache');
const TRIGGER_COOLDOWN_MS = 60_000;
const SYNC_RESULT_MAX_BODY = Number(process.env.PORTAL_SYNC_RESULT_MAX_BYTES || 32 * 1024 * 1024);
const TRIGGER_LIMITS = new Map();
const FIGURE_ROOT_PREFIX = 'references/05.可参考生信代码/可用代码预筛选/源码';

/** 文件名安全化：保留中英文、数字、下划线、连字符 */
function safeName(text) {
  return String(text || '')
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'requirement';
}

/** 参考文献文件名安全化：与 safeName 的区别是**保留扩展名**（扩展名要参与白名单校验） */
function safeRefName(name) {
  const raw = String(name || '').trim();
  const dot = raw.lastIndexOf('.');
  const ext = dot >= 0 ? raw.slice(dot).toLowerCase() : '';
  const stem = (dot >= 0 ? raw.slice(0, dot) : raw)
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'reference';
  return stem + ext;
}

/** 同目录内重名不覆盖：`a.pdf` 已存在则写 `a_2.pdf` */
function uniqueInDir(dir, filename) {
  const dot = filename.lastIndexOf('.');
  const stem = dot >= 0 ? filename.slice(0, dot) : filename;
  const ext = dot >= 0 ? filename.slice(dot) : '';
  let candidate = path.join(dir, filename);
  let i = 2;
  while (fs.existsSync(candidate)) { candidate = path.join(dir, `${stem}_${i}${ext}`); i += 1; }
  return candidate;
}

/** 本地时间戳 YYYY-MM-DD_HHMMSS（按用户工作地日期归档，不按 UTC） */
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 同名不覆盖：存在时追加 _2 / _3 … */
function uniquePath(base) {
  if (!fs.existsSync(base)) return base;
  let i = 2;
  for (;;) {
    const candidate = base.replace(/\.json$/, `_${i}.json`);
    if (!fs.existsSync(candidate)) return candidate;
    i += 1;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

/**
 * 模式 A 调研需求单校验与落盘。
 *
 * 与 /api/submit 的分工：那份收的是"已定课题要跑分析"的完整需求（要素卡级别），
 * 本端点只收"一个方向"，要素卡由调研过程自己填。两者不可互相替代。
 *
 * 字段口径来自 workspace/handoff/topic_survey/request_schema.json，两边同步修改。
 * 落盘形态沿用 inbox 的 JSON 约定，文件名带 ticket_id，结果页按它取。
 *
 * @returns {{ok: boolean, error?: string, ticketId?: string, file?: string}}
 */
function saveSurveyRequest(payload) {
  const disease = String(payload.disease || '').trim();
  if (!disease) return { ok: false, error: '疾病名称必填' };
  if (disease.length > 200) return { ok: false, error: '疾病名称过长（上限 200 字符）' };

  const ORG = ['any', 'Homo sapiens', 'Mus musculus'];
  const KINDS = ['bulk', 'array', 'scrna', 'spatial'];
  const organism = ORG.includes(payload.organism) ? payload.organism : 'any';
  const kinds = Array.isArray(payload.data_kinds)
    ? [...new Set(payload.data_kinds.filter((k) => KINDS.includes(k)))]
    : [];
  if (!kinds.length) return { ok: false, error: '至少选择一种数据类型' };

  const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const ticketId = 'TSV-' + new Date().toISOString().slice(0, 10).replace(/-/g, '')
    + '-' + crypto.randomBytes(4).toString('hex');

  const record = {
    ticket_id: ticketId,
    kind: 'topic_survey_request',
    schema_version: 1,
    created_at: new Date().toISOString(),
    request: {
      disease,
      interest: clip(payload.interest, 2000),
      organism,
      tissue: clip(payload.tissue, 200),
      data_kinds: kinds,
      clue: clip(payload.clue, 4000),
    },
    // 结果页据此判断进度。派发出去后由调研侧改成 dispatched，完成改 completed。
    status: 'pending',
  };

  const file = path.join(INBOX, `${ticketId}.json`);
  fs.mkdirSync(INBOX, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return { ok: true, ticketId, file };
}

/**
 * 组合合法性判定（portal 本地版）。
 *
 * 与工作台 BioanalysDesktop/server/workflow_graph.js 的 resolvePlan **同语义**：
 * 同一份注册表、同一套规则（必经 stage 的非 optional mod 必须全选、依赖闭合、
 * 跨线选中拒绝、ko_gene 必须给靶基因、峰值内存不超配额）、同样的拓扑排序。
 * 两边各写一份是为了保住 portal 的独立性；规则一致性由
 * BioanalysDesktop/tests/portal_resolve_parity.test.js 逐条对账钉住。
 *
 * @returns {{ok: boolean, errors: string[], ordered: string[], estMinutes: number, peakMemMb: number}}
 */
function resolveLocally(reg, seriesId, selectedIds, koGene) {
  const errors = [];
  const series = reg.series.find((s) => s.id === seriesId);
  if (!series) {
    return { ok: false, errors: [`未知系列 ${seriesId}`], ordered: [], estMinutes: 0, peakMemMb: 0 };
  }

  // 扁平索引：key 必须带 series 前缀（三条线有同名母版，裸 id 会互相覆盖）
  const index = new Map();
  const producers = new Map();
  for (const s of reg.series) {
    for (const st of s.stages) {
      for (const m of st.mods) {
        index.set(`${s.id}:${m.id}`, { mod: m, series: s, stage: st });
        for (const p of m.produces || []) {
          if (!producers.has(p)) producers.set(p, []);
          producers.get(p).push(`${s.id}:${m.id}`);
        }
      }
    }
  }

  const selected = new Set();
  for (const id of selectedIds) {
    const entry = index.get(`${seriesId}:${id}`);
    if (!entry) {
      // 全局再查一次，才能报清"属于哪条线"而不是含糊的"未知 mod"
      let other = null;
      for (const s of reg.series) {
        const hit = index.get(`${s.id}:${id}`);
        if (hit) { other = hit; break; }
      }
      errors.push(other
        ? `跨线选中：'${id}' 属于 ${other.series.id}，不是 ${seriesId}`
        : `未知 mod '${id}'`);
      continue;
    }
    selected.add(`${seriesId}:${id}`);
  }

  // 必经 stage 的非 optional mod 必须全选
  for (const st of series.stages) {
    if (!st.required) continue;
    for (const m of st.mods) {
      if (m.optional) continue;
      if (!selected.has(`${seriesId}:${m.id}`)) {
        errors.push(`必经阶段 ${st.id} 缺少 mod '${m.id}'`);
      }
    }
  }

  // 依赖闭合：requires（非原始输入）的生产者必须也被选中
  const rawInputs = new Set(['series_matrix', 'gpl', 'gpl_soft', 'gpl_soft_mouse',
    'gpl_soft_human', 'grouping.txt', 'raw_tar', 'processed', 'survival_data']);
  const bare = (key) => key.slice(seriesId.length + 1);
  for (const key of selected) {
    const entry = index.get(key);
    for (const req of entry.mod.requires || []) {
      if (rawInputs.has(req)) continue;
      const who = (producers.get(req) || []).filter((k) => k.startsWith(`${seriesId}:`));
      if (!who.some((k) => selected.has(k))) {
        errors.push(`${bare(key)} 依赖 '${req}'，但生产者 [${who.map(bare).join(',') || '无'}] 未选中`);
      }
    }
    for (const dep of entry.mod.after || []) {
      if (!selected.has(`${seriesId}:${dep}`)) {
        errors.push(`${bare(key)} 声明 after '${dep}' 但未选中`);
      }
    }
  }

  // 拓扑排序（stage order 优先，同 stage 内保持勾选顺序）
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();
  const visit = (key) => {
    if (visited.has(key)) return;
    if (visiting.has(key)) { errors.push(`依赖成环：${bare(key)}`); return; }
    visiting.add(key);
    const entry = index.get(key);
    for (const req of entry.mod.requires || []) {
      if (rawInputs.has(req)) continue;
      for (const p of producers.get(req) || []) {
        if (p.startsWith(`${seriesId}:`) && selected.has(p)) visit(p);
      }
    }
    for (const dep of entry.mod.after || []) {
      if (selected.has(`${seriesId}:${dep}`)) visit(`${seriesId}:${dep}`);
    }
    visiting.delete(key);
    visited.add(key);
    ordered.push(key);
  };
  for (const st of [...series.stages].sort((a, b) => a.order - b.order)) {
    for (const m of st.mods) {
      if (selected.has(`${seriesId}:${m.id}`)) visit(`${seriesId}:${m.id}`);
    }
  }

  let estMinutes = 0;
  let peakMemMb = 0;
  for (const key of ordered) {
    const m = index.get(key).mod;
    estMinutes += m.est_minutes || 0;
    peakMemMb = Math.max(peakMemMb, m.peak_mem_mb || 0);
  }
  const quota = reg.constraints?.mem_quota_mb;
  if (quota && peakMemMb > quota) {
    errors.push(`峰值内存 ${peakMemMb}MB 超出 K40 配额 ${quota}MB`);
  }

  // 敲除类 mod 必须给靶基因（母版会在参数解析处 exit 2，预先拦省一次远端执行）
  if (!koGene) {
    for (const key of selected) {
      if (index.get(key).mod.ko_gene) {
        errors.push(`${bare(key)} 需要靶基因（--ko-gene），但未提供`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    ordered: ordered.map(bare),
    estMinutes,
    peakMemMb,
  };
}

/** 定长比较防时序侧信道：长度不等直接拒（长度本身不保密，无需常量时间） */
function tokensEqual(provided, expected) {
  const a = Buffer.from(String(provided), 'utf8');
  const b = Buffer.from(String(expected), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * 可选 Token 鉴权（B4）· 纯函数导出便于单测（不起服务即可验证）。
 * 未启用（PORTAL_TOKEN 为空）：任何请求都放行，返回 { ok:true }；
 * 启用后：接受 Authorization: Bearer <token> 头或 ?token=<token> 查询参数，
 * 两者都不携带或值不匹配一律拒。绝不回显收到的 token。
 */
export function checkToken(req, url) {
  if (!PORTAL_TOKEN) return { ok: true };
  const header = String((req && req.headers && req.headers.authorization) || '').trim();
  const bearer = /^Bearer\s+(.+)$/i.exec(header);
  const query = url && url.searchParams ? String(url.searchParams.get('token') || '') : '';
  const provided = (bearer && bearer[1].trim()) || query;
  if (!provided) return { ok: false, error: AUTH_ERROR };
  if (!tokensEqual(provided, PORTAL_TOKEN)) return { ok: false, error: AUTH_ERROR };
  return { ok: true };
}

/**
 * T0-2 / T0-3：写端点的 CSRF 闸。
 *
 * 只读浏览器一定会带的两个头，不引入新配置：
 *   - Sec-Fetch-Site 为 cross-site / same-site 直接拒绝（兄弟域也是别人）。
 *   - Origin 存在且不等于本站源时拒绝（老浏览器可能没有 Sec-Fetch-Site，但有 Origin）。
 *   - 两个头都缺时放行：那是 curl / Node / 内部脚本，本来就不受 CSRF 影响。
 *
 * 返回 { ok:true } 或 { ok:false, error }，与 checkToken 同形态便于组合与单测。
 */
export function checkSameOrigin(req, host, port) {
  const site = String((req && req.headers && req.headers['sec-fetch-site']) || '').trim().toLowerCase();
  if (site === 'cross-site' || site === 'same-site') {
    return { ok: false, error: '跨站请求被拒绝（写操作只接受同源调用）' };
  }
  const origin = String((req && req.headers && req.headers.origin) || '').trim();
  if (origin) {
    const allowed = new Set([
      `http://${host}:${port}`,
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
    ]);
    if (!allowed.has(origin.toLowerCase().replace(/\/$/, ''))) {
      return { ok: false, error: '请求来源不在允许列表（写操作只接受同源调用）' };
    }
  }
  return { ok: true };
}

/** 与 checkToken 同形态，但让编排面 token 与客户 token 各自闭环，互不借用。 */
function checkEnvToken(req, url, expected, errorText) {
  if (!expected) return { ok: false, error: errorText };
  const header = String((req && req.headers && req.headers.authorization) || '').trim();
  const bearer = /^Bearer\s+(.+)$/i.exec(header);
  const query = url && url.searchParams ? String(url.searchParams.get('token') || '') : '';
  const provided = (bearer && bearer[1].trim()) || query;
  if (!provided || !tokensEqual(provided, expected)) return { ok: false, error: errorText };
  return { ok: true };
}

function checkSyncAuth(req, url) {
  return checkEnvToken(req, url, SYNC_TOKEN, SYNC_AUTH_ERROR);
}

function checkClientSyncAuth(req, url) {
  return checkEnvToken(req, url, PORTAL_CLIENT_TOKEN, CLIENT_AUTH_ERROR);
}

/**
 * 把 URL 里的 ticket 解析成 inbox 内的唯一事实文件。
 * 包形态用 package 目录，扁平形态用根级 JSON；路径穿越与隐藏目录一律拒。
 */
function resolveSyncTicket(ticket) {
  const value = String(ticket || '').trim();
  if (!value || value.length > 180 || value === '.' || value === '..'
    || value.startsWith('.') || value.includes('/') || value.includes('\\')) return null;
  const root = path.resolve(INBOX);
  const flat = path.resolve(root, `${value}.json`);
  if (flat.startsWith(root + path.sep)) {
    let flatStat = null;
    try { flatStat = fs.statSync(flat); } catch { flatStat = null; }
    if (flatStat && flatStat.isFile()) {
      return { ticket: value, isPackage: false, root, recordPath: flat };
    }
  }
  const packageDir = path.resolve(root, value);
  if (!packageDir.startsWith(root + path.sep)) return null;
  const recordPath = path.join(packageDir, 'requirement.json');
  let recordStat = null;
  try { recordStat = fs.statSync(recordPath); } catch { recordStat = null; }
  if (recordStat && recordStat.isFile()) {
    return { ticket: value, isPackage: true, root: packageDir, recordPath };
  }
  return null;
}

function isSyncStatus(value) {
  return SYNC_STATUSES.includes(value);
}

function isLegacySyncRecord(record) {
  return !record || !isSyncStatus(record.sync_status);
}

function readJsonSync(recordPath) {
  return JSON.parse(fs.readFileSync(recordPath, 'utf8'));
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function listPendingSyncTickets() {
  const found = [];
  let entries = [];
  try { entries = fs.readdirSync(INBOX, { withFileTypes: true }); }
  catch { entries = []; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'uploads' || entry.name === 'refs') continue;
    let record = null;
    let ticket = entry.name;
    if (entry.isDirectory()) {
      const recordPath = path.join(INBOX, entry.name, 'requirement.json');
      try { record = readJsonSync(recordPath); } catch { record = null; }
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      const recordPath = path.join(INBOX, entry.name);
      try { record = readJsonSync(recordPath); } catch { record = null; }
      ticket = entry.name.replace(/\.json$/, '');
    }
    if (record && record.sync_status === 'pending') {
      found.push({ ticket, urgent: Boolean(record.sync_urgent), updated_at: record.sync_updated_at || record.created_at || '' });
    }
  }
  found.sort((a, b) => (Number(b.urgent) - Number(a.urgent)) || a.ticket.localeCompare(b.ticket));
  return found;
}

/**
 * 采集包内文件做 tar.gz。隐藏文件、结果产物与符号链接不进待办包，
 * 避免把上一轮结果或外部指针对象回灌给编排面。
 */
function collectSyncFiles(root) {
  const rootStat = fs.statSync(root);
  if (rootStat.isFile()) {
    return [{ abs: root, rel: path.basename(root), stat: rootStat }];
  }
  const files = [];
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile()) files.push({ abs: childAbs, rel: childRel, stat: fs.statSync(childAbs) });
    }
  };
  walk(root, '');
  return files;
}

function octalTar(value, width) {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function tarHeader(name, size, typeFlag, mode) {
  let displayName = name.replace(/\\/g, '/');
  let prefix = '';
  if (Buffer.byteLength(displayName, 'utf8') > 100) {
    const slash = displayName.lastIndexOf('/');
    if (slash <= 0) throw new Error(`tar 路径过长：${name}`);
    prefix = displayName.slice(0, slash);
    displayName = displayName.slice(slash + 1);
    if (Buffer.byteLength(prefix, 'utf8') > 155 || Buffer.byteLength(displayName, 'utf8') > 100) {
      throw new Error(`tar 路径过长：${name}`);
    }
  }
  const header = Buffer.alloc(512, 0);
  header.write(displayName, 0, 100, 'utf8');
  header.write(prefix, 345, 155, 'utf8');
  header.write(octalTar(mode, 8), 100, 'utf8');
  header.write(octalTar(0, 8), 108, 'utf8');
  header.write(octalTar(0, 8), 116, 'utf8');
  header.write(octalTar(size, 12), 124, 'utf8');
  header.write(octalTar(0, 12), 136, 'utf8');
  header.write('        ', 148, 'utf8');
  header.write(typeFlag, 156, 'utf8');
  header.write('ustar\0', 257, 'utf8');
  header.write('00', 263, 'utf8');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(octalTar(checksum, 8), 148, 'utf8');
  header.write(typeFlag, 156, 'utf8');
  return header;
}

async function* tarFileData(root) {
  const files = collectSyncFiles(root);
  for (const file of files) {
    yield tarHeader(file.rel, file.stat.size, '0', 0o644);
    const source = fs.createReadStream(file.abs, { highWaterMark: 512 * 1024 });
    for await (const chunk of source) yield chunk;
    const tail = file.stat.size % 512;
    if (tail) yield Buffer.alloc(512 - tail, 0);
  }
  yield Buffer.alloc(1024, 0);
}

/** 打包器只做 tar.gz；sha256 在 gzip 后计算，daemon 下载后直接对账。 */
async function buildSyncPackage(root, ticket) {
  fs.mkdirSync(SYNC_CACHE, { recursive: true });
  const cacheName = `${crypto.createHash('sha256').update(ticket).digest('hex')}.tar.gz`;
  const archive = path.join(SYNC_CACHE, cacheName);
  const tmp = `${archive}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  const gzip = zlib.createGzip({ level: 6 });
  const out = fs.createWriteStream(tmp);
  const hash = crypto.createHash('sha256');
  const hashTap = new stream.Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(stream.Readable.from(tarFileData(root), { objectMode: false }), gzip, hashTap, out);
    await fs.promises.rename(tmp, archive);
    return { archive, sha256: hash.digest('hex') };
  } catch (cause) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* 写流失败时残留无关键数据 */ }
    throw cause;
  }
}

async function hashSyncArchive(archive) {
  const source = fs.createReadStream(archive, { highWaterMark: 512 * 1024 });
  const hash = crypto.createHash('sha256');
  const sink = new stream.Writable({
    write(chunk, encoding, callback) { callback(); },
  });
  await pipeline(source, hash, sink);
  return hash.digest('hex');
}

async function claimSyncTicket(ticket, recordPath, packageRoot) {
  const record = readJsonSync(recordPath);
  if (isLegacySyncRecord(record)) return { error: 'legacy 单子不参与同步', status: 409 };
  if (['done', 'failed', 'blocked'].includes(record.sync_status)) {
    return { error: `当前状态 ${record.sync_status}，不能再 claim`, status: 409 };
  }
  if (record.sync_status === 'pending') {
    record.sync_status = 'running';
  }
  let pack = null;
  const cachedArchive = path.join(SYNC_CACHE,
    `${crypto.createHash('sha256').update(ticket).digest('hex')}.tar.gz`);
  if (fs.existsSync(cachedArchive)) {
    pack = { archive: cachedArchive, sha256: record.sync_package_sha256
      || (await buildSyncPackage(packageRoot, ticket)).sha256 };
  } else {
    pack = await buildSyncPackage(packageRoot, ticket);
  }
  const now = new Date().toISOString();
  record.sync_status = 'running';
  record.sync_claimed_at = now;
  record.sync_updated_at = now;
  record.sync_package_sha256 = pack.sha256;
  record.sync_urgent = Boolean(record.sync_urgent);
  writeJsonAtomic(recordPath, record);
  return { record, pack };
}

function safeResultPath(root, rel) {
  const value = String(rel || '');
  if (!value || value.length > 240 || value.includes('\\') || value.startsWith('/')
    || /^[A-Za-z]:/.test(value) || value.split('/').includes('..')) return null;
  const full = path.resolve(root, value);
  if (!full.startsWith(path.resolve(root) + path.sep)) return null;
  return full;
}

function syncStatusPayload(ticket, record) {
  const result = record.sync_result || {};
  return {
    ok: true,
    ticket,
    sync_status: record.sync_status,
    sync_urgent: Boolean(record.sync_urgent),
    updated_at: record.sync_updated_at || '',
    manifest: result.manifest || null,
    files: result.files || [],
    result_at: result.received_at || '',
  };
}

/**
 * 图模板视图（WP-3.2）：只下发门户展示与表单需要的数据。
 * preview 状态在服务端重新落哈希，前端不信任注册表自身说的 ok。
 */
function figurePreviewState(item) {
  if (item.deps_status !== 'ready' || !item.verified) return 'not_verified';
  const relative = String(item.preview || '');
  if (!relative.startsWith(FIGURE_ROOT_PREFIX + '/')) return 'missing';
  const target = path.resolve(REPO_ROOT, relative);
  if (!target.startsWith(path.resolve(REPO_ROOT) + path.sep)) return 'missing';
  try {
    if (!fs.statSync(target).isFile()) return 'missing';
    const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    return actual === item.preview_sha256 ? 'ok' : 'hash_mismatch';
  } catch {
    return 'missing';
  }
}

function figureTemplatesPayload() {
  const registryPath = path.resolve(REPO_ROOT, 'tools', 'bio', 'figure_templates.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const exampleErrors = validateProjectExamples();
  if (exampleErrors.length > 0) throw new Error('图实例清单失同步: ' + exampleErrors[0]);
  const catalogValidation = validateTemplateCatalog();
  if (!catalogValidation.ok) throw new Error('全量模板目录失同步: ' + catalogValidation.errors[0]);
  const profiles = loadTemplateCatalogById();
  const templates = (Array.isArray(registry.templates) ? registry.templates : []).map((item) => {
    const state = figurePreviewState(item);
    const latestExample = resolveProjectExample(item.id, 'project');
    const profile = profiles.get(item.id) || {};
    return {
      id: item.id,
      name: item.name,
      level: item.level,
      category: item.category,
      language: item.language,
      deps_status: item.deps_status,
      deps: Array.isArray(item.deps) ? item.deps : [],
      block_reason: item.block_reason || (item.deps_status === 'ready' ? '' : '依赖未完成验证'),
      verified: Boolean(item.verified),
      preview_state: state,
      preview_url: state === 'ok' && latestExample ? `/api/figure-templates/preview?id=${encodeURIComponent(item.id)}` : '',
      project_preview_url: state === 'ok' && latestExample
        ? `/api/figure-templates/project-preview?id=${encodeURIComponent(item.id)}`
        : '',
      preview_source: latestExample ? latestExample.path : item.preview,
      lines: Array.isArray(item.lines) ? item.lines : [],
      analysis_step: item.analysis_step || null,
      input_tables: Array.isArray(item.input_tables) ? item.input_tables : [],
      produces: Array.isArray(item.produces) ? item.produces : [],
      output_glob: item.output_glob || null,
      canonical_output: item.canonical_output || null,
      sample_project_output: item.sample_project_output || null,
      adapt_vars: item.adapt_vars || {},
      linked_mods: Array.isArray(item.linked_mods) ? item.linked_mods : [],
      deprecated: Boolean(item.deprecated),
      status: item.status || (item.deps_status === 'ready' && item.verified ? 'ready' : 'draft'),
      producing_mod_id: item.producing_mod_id || item.analysis_step || null,
      required_mod_ids: Array.isArray(item.required_mod_ids) ? item.required_mod_ids : [],
      academic_tier: item.academic_tier || null,
      portal_binding: item.portal_binding || null,
      english_name: profile.english_name || null,
      tier: profile.tier || null,
      level_label: profile.level_label || null,
      category_label: profile.category_label || null,
      language_label: profile.language_label || null,
      status_label: profile.status_label || null,
      purpose: profile.purpose || '',
      introduction: profile.introduction || '',
      dependencies: Array.isArray(profile.dependencies) ? profile.dependencies : [],
      input_artifact: profile.input_artifact || null,
      input_format: profile.input_format || null,
      line_labels: Array.isArray(profile.line_labels) ? profile.line_labels : [],
      library_status: profile.library_status || null,
      source_location: profile.source_location || null,
    };
  });
  return {
    templates,
    catalog: {
      total: catalogValidation.total,
      profiles: profiles.size,
      ok: catalogValidation.ok,
      source: 'tools/bio/figure_template_profiles.json',
    },
  };
}

/**
 * 质检图真实示例：从 workspace/projects 里挑最近一个包含目标文件的目录。
 * 只服务 L1 当前定义的五个质检图，路径与文件名都走白名单，避免把任意项目文件
 * 暴露成静态资源。没有真实项目时回 404，由前端隐藏缩略图。
 */
const NATIVE_QC_EXAMPLE_FILES = Object.freeze({
  line1_bulk: new Set([
    'l1_01_correlation.png',
    'l1_02_pca.png',
    'l1_02_pca_step3.png',
    'l1_04_topvar_heatmap.png',
    'l1_05a_genes_detected.png',
    'l1_05b_within_group_cor.png',
  ]),
  line2_scrna: new Set([
    'L2_qc_nfeature_by_sample.png',
    'L2_qc_mito_by_sample.png',
  ]),
  line3_spatial: new Set([
    'L3_qc_genes_by_spot.png',
    'L3_qc_counts_by_spot.png',
  ]),
});

/**
 * 在所有本地项目里找同名真实产物，取目录 mtime 最新的那份。
 * 用途：模板的“真实项目实例”优先展示最近一次实际运行，而不是固定样例。
 * 只接受调用方给出的 lineId / basename，且最终路径必须落在 workspace/projects 下。
 */
function findLatestProjectFigure(lineId, name) {
  const projectsRoot = path.resolve(REPO_ROOT, 'workspace', 'projects');
  if (!/^[A-Za-z0-9._-]+$/.test(lineId) || !/^[A-Za-z0-9._-]+\.(png|jpg|jpeg|svg|webp)$/i.test(name)) {
    return null;
  }
  try {
    const candidates = fs.readdirSync(projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[A-Za-z0-9._-]+$/.test(entry.name))
      .map((entry) => {
        const dir = path.join(projectsRoot, entry.name);
        const file = path.join(dir, 'figures', lineId, name);
        let mtime = 0;
        try { mtime = fs.statSync(file).mtimeMs; } catch { /* 文件不在这个项目 */ }
        return mtime > 0 ? { file, mtime } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    return candidates[0] ? path.resolve(candidates[0].file) : null;
  } catch {
    return null;
  }
}

function findLatestProjectImage(name) {
  const projectsRoot = path.resolve(REPO_ROOT, 'workspace', 'projects');
  if (!/^[A-Za-z0-9._-]+\.(png|jpg|jpeg|svg|webp)$/i.test(name)) return null;
  const candidates = [];
  let projects = [];
  try {
    projects = fs.readdirSync(projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[A-Za-z0-9._-]+$/.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return null;
  }
  for (const project of projects) {
    for (const lineId of Object.keys(NATIVE_QC_EXAMPLE_FILES)) {
      const candidate = path.join(projectsRoot, project, 'report', 'figures', name);
      const lineCandidate = path.join(projectsRoot, project, 'figures', lineId, name);
      for (const file of [candidate, lineCandidate]) {
        try {
          if (fs.statSync(file).isFile()) {
            candidates.push({ file: path.resolve(file), mtime: fs.statSync(file).mtimeMs });
          }
        } catch { /* 文件不在该落点 */ }
      }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0] ? candidates[0].file : null;
}

function handleNativeQcPreview(req, res, url) {
  const lineId = String(url.searchParams.get('line') || '');
  const name = String(url.searchParams.get('name') || '');
  const allowed = NATIVE_QC_EXAMPLE_FILES[lineId];
  if (!allowed || !allowed.has(name)) {
    return sendJson(res, 400, { ok: false, error: '质检图参数非法' });
  }
  const best = findLatestProjectImage(name);
  if (!best) return sendJson(res, 404, { ok: false, error: '暂无真实质检图示例' });
  const projectsRoot = path.resolve(REPO_ROOT, 'workspace', 'projects');
  const target = best;
  if (!target.startsWith(projectsRoot + path.sep)) {
    return sendJson(res, 400, { ok: false, error: '质检图路径越界' });
  }
  let bytes;
  try { bytes = fs.readFileSync(target); }
  catch { return sendJson(res, 404, { ok: false, error: '质检图文件不可读' }); }
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': String(bytes.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.end(bytes);
}

function handleFigureTemplatePreview(req, res, url) {
  const id = url.searchParams.get('id') || '';
  let template;
  try {
    const registry = JSON.parse(fs.readFileSync(
      path.resolve(REPO_ROOT, 'tools', 'bio', 'figure_templates.json'), 'utf8'));
    template = (registry.templates || []).find((item) => item.id === id);
  } catch {
    return sendJson(res, 500, { ok: false, error: '读取图模板注册表失败' });
  }
  if (!template || template.deps_status !== 'ready' || !template.verified) {
    return sendJson(res, 404, { ok: false, error: '模板不可用或尚未验证' });
  }
  const state = figurePreviewState(template);
  if (state === 'hash_mismatch') {
    return sendJson(res, 409, { ok: false, error: '预览图与模板不同步' });
  }
  if (state !== 'ok') {
    return sendJson(res, 404, { ok: false, error: '预览图缺失' });
  }
  const example = resolveProjectExample(id, 'project') || resolveProjectExample(id, 'fixture');
  if (!example) return sendJson(res, 404, { ok: false, error: '图实例清单缺最新测试数据图' });
  const target = path.resolve(REPO_ROOT, example.path);
  if (!target.startsWith(path.resolve(REPO_ROOT) + path.sep)) {
    return sendJson(res, 400, { ok: false, error: '预览图路径越界' });
  }
  let bytes;
  try { bytes = fs.readFileSync(target); }
  catch {
    return sendJson(res, 404, { ok: false, error: '预览图缺失' });
  }
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': String(bytes.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Figure-Example-Source': 'latest-dcm-project',
  });
  return res.end(bytes);
}

function handleFigureProjectPreview(req, res, url) {
  const id = url.searchParams.get('id') || '';
  let template;
  try {
    const registry = JSON.parse(fs.readFileSync(
      path.resolve(REPO_ROOT, 'tools', 'bio', 'figure_templates.json'), 'utf8'));
    template = (registry.templates || []).find((item) => item.id === id);
  } catch {
    return sendJson(res, 500, { ok: false, error: '读取图模板注册表失败' });
  }
  if (!template || template.deps_status !== 'ready' || !template.verified || !template.sample_project_output) {
    return sendJson(res, 404, { ok: false, error: '真实项目产出示例不可用' });
  }
  const example = resolveProjectExample(id, 'project');
  if (!example) return sendJson(res, 404, { ok: false, error: '最新测试项目图实例不可用' });
  const relative = example.path;
  const ext = path.extname(relative).toLowerCase();
  const root = path.resolve(REPO_ROOT);
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) {
    return sendJson(res, 400, { ok: false, error: '真实项目产出示例路径越界' });
  }
  let bytes;
  try {
    if (!fs.statSync(target).isFile()) throw new Error('not a file');
    bytes = fs.readFileSync(target);
  } catch {
    return sendJson(res, 404, { ok: false, error: '真实项目产出示例缺失' });
  }
  const imageTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };
  res.writeHead(200, {
    'Content-Type': imageTypes[ext],
    'Content-Length': String(bytes.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Figure-Example-Source': 'latest-dcm-project',
    'X-Figure-Example-Sha256': example.sha256,
  });
  return res.end(bytes);
}

/** 提交前用同一个权威校验器裁决选中的图模板，越界或缺失 adapt_vars 不落盘。 */
function validateFigureTemplateSelections(payload) {
  const selections = Array.isArray(payload.figure_templates) ? payload.figure_templates : [];
  if (!selections.length) return { ok: true };
  const projectId = String(payload.basicInfo?.name || '').trim();
  const errors = [];
  for (const [index, selection] of selections.entries()) {
    const templateId = String(selection?.template_id || '');
    const adaptVars = selection?.adapt_vars && typeof selection.adapt_vars === 'object'
      && !Array.isArray(selection.adapt_vars) ? selection.adapt_vars : null;
    if (!templateId || !adaptVars) {
      errors.push(`figure_templates[${index}] 缺少 template_id 或 adapt_vars`);
      continue;
    }
    const result = resolveFigure(templateId, String(payload.seriesId || ''), projectId, adaptVars, payload.modIds || []);
    if (!result.ok) errors.push(...result.errors);
  }
  return { ok: errors.length === 0, errors };
}

function handleJsonBody(req, res, maxBytes, handler) {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > maxBytes) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', async () => {
    let payload;
    try {
      payload = Buffer.concat(chunks).length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    } catch (cause) {
      return sendJson(res, 400, { ok: false, error: `请求体不是合法 JSON: ${cause.message}` });
    }
    try {
      await handler(payload);
    } catch (cause) {
      if (!res.headersSent) {
        return sendJson(res, 500, {
          ok: false,
          error: `sync 请求处理失败: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
      }
    }
  });
  req.on('error', () => {
    if (!res.headersSent) sendJson(res, 400, { ok: false, error: '读取 sync 请求失败' });
  });
}

async function handleSyncClaim(req, res) {
  handleJsonBody(req, res, 64 * 1024, async (payload) => {
    const resolved = resolveSyncTicket(payload.ticket);
    if (!resolved) return sendJson(res, 400, { ok: false, error: 'ticket 非法或不存在' });
    let claimed;
    const packageRoot = resolved.isPackage ? resolved.root : resolved.recordPath;
    try { claimed = await claimSyncTicket(resolved.ticket, resolved.recordPath, packageRoot); }
    catch (cause) {
      return sendJson(res, 500, {
        ok: false,
        error: `claim 失败: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
    if (claimed.error) return sendJson(res, claimed.status, { ok: false, error: claimed.error });
    const downloadUrl = new URL(
      `/api/sync/package?ticket=${encodeURIComponent(resolved.ticket)}`,
      `http://${HOST}:${PORT}`,
    ).href;
    return sendJson(res, 200, {
      ok: true,
      ticket: resolved.ticket,
      status: 'running',
      download_url: downloadUrl,
      sha256: claimed.pack.sha256,
      claimed_at: claimed.record.sync_claimed_at,
    });
  });
}

async function handleSyncPackage(req, res, url) {
  const resolved = resolveSyncTicket(url.searchParams.get('ticket'));
  if (!resolved) return sendJson(res, 400, { ok: false, error: 'ticket 非法或不存在' });
  let record;
  try { record = readJsonSync(resolved.recordPath); }
  catch { return sendJson(res, 500, { ok: false, error: '读取同步状态失败' }); }
  if (isLegacySyncRecord(record)) return sendJson(res, 409, { ok: false, error: 'legacy 单子不参与同步' });
  if (record.sync_status !== 'running') {
    return sendJson(res, 409, { ok: false, error: `当前状态 ${record.sync_status}，先 claim 再下载` });
  }
  const archive = path.join(SYNC_CACHE,
    `${crypto.createHash('sha256').update(resolved.ticket).digest('hex')}.tar.gz`);
  let stat;
  try { stat = fs.statSync(archive); }
  catch { return sendJson(res, 409, { ok: false, error: '下载包缺失，请重新 claim' }); }
  if (record.sync_package_sha256) {
    const actual = await hashSyncArchive(archive);
    if (actual !== record.sync_package_sha256) {
      return sendJson(res, 409, { ok: false, error: '下载包哈希不一致，请重新 claim' });
    }
  }
  res.writeHead(200, {
    'Content-Type': 'application/gzip',
    'Content-Length': String(stat.size),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  try {
    await pipeline(fs.createReadStream(archive, { highWaterMark: 512 * 1024 }), res);
  } catch { res.destroy(); }
}

async function handleSyncResult(req, res) {
  handleJsonBody(req, res, SYNC_RESULT_MAX_BODY, async (payload) => {
    const resolved = resolveSyncTicket(payload.ticket);
    if (!resolved) return sendJson(res, 400, { ok: false, error: 'ticket 非法或不存在' });
    if (!['done', 'failed', 'blocked'].includes(payload.status)) {
      return sendJson(res, 400, { ok: false, error: 'status 必须是 done / failed / blocked' });
    }
    if (!payload.manifest || typeof payload.manifest !== 'object') {
      return sendJson(res, 400, { ok: false, error: 'manifest 缺失或不是对象' });
    }
    let record;
    try { record = readJsonSync(resolved.recordPath); }
    catch { return sendJson(res, 500, { ok: false, error: '读取同步状态失败' }); }
    if (isLegacySyncRecord(record)) return sendJson(res, 409, { ok: false, error: 'legacy 单子不参与同步' });
    if (record.sync_status !== 'running') {
      return sendJson(res, 409, { ok: false, error: `当前状态 ${record.sync_status}，result 只结算 running 单子` });
    }

    const files = Array.isArray(payload.files) ? payload.files : [];
    const resultRoot = resolved.isPackage
      ? path.join(resolved.root, 'sync_results')
      : path.join(INBOX, 'sync_results', resolved.ticket);
    fs.mkdirSync(resultRoot, { recursive: true });
    const written = [];
    try {
      for (const item of files) {
        const rel = item && typeof item.path === 'string' ? safeResultPath(resultRoot, item.path) : null;
        if (!rel) throw new Error(`结果文件路径非法: ${String(item && item.path)}`);
        const bytes = Buffer.from(String(item.content_base64 || ''), 'base64');
        if (item.content_base64 && !bytes.length) throw new Error(`结果文件内容为空: ${item.path}`);
        fs.mkdirSync(path.dirname(rel), { recursive: true });
        fs.writeFileSync(rel, bytes);
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        if (item.sha256 && !tokensEqual(item.sha256, sha256)) {
          throw new Error(`结果文件 sha256 不一致: ${item.path}`);
        }
        written.push({
          path: item.path,
          size: bytes.length,
          sha256,
          content_included: Boolean(item.content_base64),
        });
      }
    } catch (cause) {
      return sendJson(res, 400, {
        ok: false,
        error: `结果文件校验失败: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }

    const receivedAt = new Date().toISOString();
    const syncResult = {
      ticket: resolved.ticket,
      status: payload.status,
      manifest: payload.manifest,
      files: written,
      received_at: receivedAt,
    };
    writeJsonAtomic(path.join(resultRoot, 'sync_result.json'), syncResult);
    record.sync_status = payload.status;
    record.sync_urgent = false;
    record.sync_result = syncResult;
    record.sync_updated_at = receivedAt;
    writeJsonAtomic(resolved.recordPath, record);
    return sendJson(res, 200, { ok: true, ticket: resolved.ticket, status: payload.status });
  });
}

function handleSyncTrigger(req, res) {
  handleJsonBody(req, res, 16 * 1024, async (payload) => {
    const resolved = resolveSyncTicket(payload.ticket);
    if (!resolved) return sendJson(res, 400, { ok: false, error: 'ticket 非法或不存在' });
    const now = Date.now();
    const last = TRIGGER_LIMITS.get(resolved.ticket) || 0;
    if (now - last < TRIGGER_COOLDOWN_MS) {
      const retryAfter = Math.max(1, Math.ceil((TRIGGER_COOLDOWN_MS - (now - last)) / 1000));
      return sendJson(res, 429, { ok: false, retry_after: retryAfter, error: '稍后重试' });
    }
    let record;
    try { record = readJsonSync(resolved.recordPath); }
    catch { return sendJson(res, 500, { ok: false, error: '读取同步状态失败' }); }
    if (isLegacySyncRecord(record)) return sendJson(res, 409, { ok: false, error: 'legacy 单子不参与同步' });
    TRIGGER_LIMITS.set(resolved.ticket, now);
    record.sync_urgent = true;
    record.sync_updated_at = new Date().toISOString();
    writeJsonAtomic(resolved.recordPath, record);
    return sendJson(res, 200, { ok: true, ticket: resolved.ticket, urgent: true });
  });
}

function handleSyncStatus(req, res, url) {
  const resolved = resolveSyncTicket(url.searchParams.get('ticket'));
  if (!resolved) return sendJson(res, 400, { ok: false, error: 'ticket 非法或不存在' });
  let record;
  try { record = readJsonSync(resolved.recordPath); }
  catch { return sendJson(res, 500, { ok: false, error: '读取同步状态失败' }); }
  if (isLegacySyncRecord(record)) {
    return sendJson(res, 200, {
      ok: true, ticket: resolved.ticket, sync_status: 'legacy',
      sync_urgent: false, manifest: null, files: [], result_at: '',
    });
  }
  return sendJson(res, 200, syncStatusPayload(resolved.ticket, record));
}

function handleSyncResultFile(req, res, url) {
  const resolved = resolveSyncTicket(url.searchParams.get('ticket'));
  if (!resolved) return sendJson(res, 400, { ok: false, error: 'ticket 非法或不存在' });
  const rel = url.searchParams.get('path') || '';
  // 包形态的结果在包内 sync_results；扁平单子的结果在全局
  // sync_results/<ticket>/，不能把 ticket 段漏掉。
  const root = resolved.isPackage
    ? path.join(resolved.root, 'sync_results')
    : path.join(INBOX, 'sync_results', resolved.ticket);
  const target = safeResultPath(root, rel);
  const ext = path.extname(String(rel || '')).toLowerCase();
  const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.svg']);
  if (!target || !IMAGE_EXT.has(ext)) {
    return sendJson(res, 400, { ok: false, error: '结果文件路径非法或不是图像' });
  }
  let stat;
  try { stat = fs.statSync(target); }
  catch { return sendJson(res, 404, { ok: false, error: '结果文件缺失' }); }
  if (!stat.isFile()) return sendJson(res, 400, { ok: false, error: '结果文件不是普通文件' });
  const type = ext === '.png' ? 'image/png'
    : ext === '.svg' ? 'image/svg+xml'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  const bytes = fs.readFileSync(target);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': String(bytes.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.end(bytes);
}

/** 人类可读的字节数：按 KiB/MiB/GiB 取整显示（5GiB 不显示成莫名的 5120MB） */
function humanBytes(bytes) {
  const units = [['GiB', 1024 ** 3], ['MiB', 1024 ** 2], ['KiB', 1024]];
  for (const [unit, scale] of units) {
    if (bytes >= scale) {
      const value = bytes / scale;
      return `${Number.isInteger(value) ? value : value.toFixed(2)}${unit}`;
    }
  }
  return `${bytes}字节`;
}

/**
 * 数据文件上传：POST /api/datafiles?sid=<上传会话>&role=<角色>&bind=<绑定编号>&name=<原文件名>
 * 请求体为文件原始二进制（非 multipart），零依赖、可流式读取。
 * 落点 inbox/uploads/<sid>/<安全化文件名>，同名追加 _2 / _3。
 * 返回 path 为相对 inbox 的路径，提交时由 /api/submit 归档进包。
 *
 * 流式写盘（2026-10-20 上限调到 5 GiB，整文件攒内存会把 OOM 风险同比放大）：
 * 边收边写、背压暂停；超限/断传/写出错三条路径都删半成品；等写流 finish 后才回 200，
 * 保证客户端拿到的 path 对应文件已写全。
 */
function handleDataFileUpload(req, res, url) {
  const sid = url.searchParams.get('sid') || '';
  const role = url.searchParams.get('role') || '';
  const bind = url.searchParams.get('bind') || '';
  const rawName = url.searchParams.get('name') || '';
  if (!SID_RE.test(sid)) {
    return sendJson(res, 400, { ok: false, error: '上传会话 id 非法' });
  }
  if (!DATA_ROLES.includes(role)) {
    return sendJson(res, 400, { ok: false, error: `角色非法: ${role || '(空)'}（允许 ${DATA_ROLES.join(' / ')}）` });
  }
  const name = sanitizeFileName(rawName);
  if (!rawName || name === 'file') {
    return sendJson(res, 400, { ok: false, error: '文件名缺失或不可用' });
  }
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (name.lastIndexOf('.') < 0 || !DATA_EXT.includes(ext)) {
    return sendJson(res, 400, { ok: false, error: `不支持的数据文件格式: ${rawName}（允许 ${DATA_EXT.join(' / ')}）` });
  }

  const dir = path.join(INBOX, 'uploads', sid);
  let size = 0;
  let tooLarge = false;
  let ended = false;
  let responded = false;
  let finished = false;
  let target = null;
  let stream = null;

  /** 每个上传只发一次响应：超限 400 之后，断传/写流出错回调不得再抢话 */
  function reply(status, error) {
    if (responded) return;
    responded = true;
    sendJson(res, status, { ok: false, error });
  }

  /** 销毁写流并删掉半成品，别让垃圾占盘（Windows 下 libuv 带 SHARE_DELETE 开文件，可直接 unlink） */
  function dropPartial() {
    if (stream) {
      try { stream.destroy(); } catch { /* 已销毁时重复调用无副作用 */ }
    }
    if (target) {
      try { fs.rmSync(target, { force: true }); } catch { /* 文件从未落成时无需清理 */ }
    }
  }

  req.on('data', (chunk) => {
    if (responded || tooLarge) return; // 超限后继续到达的数据直接丢弃：喝完才能把 400 送达客户端
    size += chunk.length;
    if (size > MAX_DATA_BYTES) {
      tooLarge = true;
      dropPartial();
      reply(400, `单文件超过上限 ${humanBytes(MAX_DATA_BYTES)}`);
      return;
    }
    if (!stream) {
      // 首个数据块才建目录、定落点、开写流：0 字节上传不落任何文件（与旧行为一致）
      try {
        fs.mkdirSync(dir, { recursive: true });
        // 同 sid 下同角色只留一个：重复上传先删旧的，避免包里有多个 train_matrix
        try {
          const existing = fs.readdirSync(dir).filter((n) => n.startsWith(`${role}__`));
          for (const old of existing) fs.rmSync(path.join(dir, old), { force: true });
        } catch { /* 目录不存在即首次上传，正常 */ }
        target = uniqueInDir(dir, name);
        stream = fs.createWriteStream(target);
      } catch (cause) {
        dropPartial();
        reply(500, `写入数据文件失败: ${cause instanceof Error ? cause.message : String(cause)}`);
        return;
      }
      stream.on('error', (cause) => {
        dropPartial();
        reply(500, `写入数据文件失败: ${cause instanceof Error ? cause.message : String(cause)}`);
      });
      stream.on('finish', () => { finished = true; });
    }
    if (stream.write(chunk) === false) {
      // 背压：写盘跟不上就暂停读取，排空再继续，防止数据堆在内存缓冲里
      req.pause();
      stream.once('drain', () => req.resume());
    }
  });

  req.on('end', () => {
    ended = true;
    if (tooLarge) {
      // 超限分支：剩余 body 已在 data 里读完丢弃，此时回收连接（客户端已收到 400）
      req.destroy();
      return;
    }
    if (!size) return reply(400, '上传内容为空');
    if (!stream) return reply(500, '写入数据文件失败: 上传流未建立'); // size>0 必有写流，防御性分支
    const respondOk = () => {
      if (responded) return;
      responded = true;
      const savedName = path.basename(target);
      const relPath = `uploads/${sid}/${savedName}`;
      console.log(`[user-portal] 收到数据文件: ${relPath} (${size} bytes)`);
      sendJson(res, 200, { ok: true, name: savedName, path: relPath, size });
    };
    if (finished) return respondOk();
    // 必须等写流 finish 才回 200：否则响应先于文件落全，客户端会拿到不完整的 path
    stream.once('finish', respondOk);
    stream.end();
  });

  // 客户端中途断传（end 之前触发 close/aborted）：删半成品，且不再写响应（连接已断，写只会报错）
  const onAbort = () => {
    if (ended || responded) return;
    responded = true;
    dropPartial();
  };
  req.on('aborted', onAbort);
  req.on('close', onAbort);

  req.on('error', () => {
    dropPartial();
    reply(400, '读取上传内容失败');
  });
}

/** 把 inbox 内的相对路径解析成绝对路径，越界（穿越到 inbox 外）一律拒 */
function resolveInInbox(rel) {
  const full = path.resolve(INBOX, String(rel || ''));
  const root = path.resolve(INBOX);
  if (!full.startsWith(root + path.sep)) return null;
  return full;
}

/**
 * 收件：客户提交的需求落盘到 inbox/。
 * 带数据文件（uploadSid / dataFiles 非空）→ 归档成 PKG_ 包目录；
 * 否则按老客户端形态落一个平铺 JSON（工作台收件箱视图两种都认）。
 */
function handleSubmit(req, res) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) { tooLarge = true; req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch (cause) {
      return sendJson(res, 400, { ok: false, error: `请求体不是合法 JSON: ${cause.message}` });
    }
    // 数据类型必填且必须在枚举内：它是选分析线的依据，缺了后面必错
    const dataType = payload && payload.dataSource && payload.dataSource.dataType;
    if (!DATA_TYPE_IDS.includes(dataType)) {
      return sendJson(res, 400, {
        ok: false,
        error: `数据类型缺失或非法: ${JSON.stringify(dataType ?? null)}（应为本端 index.html 提供的四种之一）`,
      });
    }
    const figureCheck = validateFigureTemplateSelections(payload);
    if (!figureCheck.ok) {
      return sendJson(res, 400, {
        ok: false,
        error: `图模板校验未通过: ${figureCheck.errors.join('；')}`,
      });
    }
    // 数据集↔平台配对：至少一组，且每组必须填 GSE（GPL 决定线内预处理分支，测序数据可留空）。
    // 多组数据必须逐行标明对应关系，否则下游分不清哪个平台属于哪个数据集，预处理会跑偏。
    const datasets = payload.dataSource.datasets;
    if (!Array.isArray(datasets) || !datasets.length) {
      return sendJson(res, 400, {
        ok: false,
        error: '数据集缺失：dataSource.datasets 至少需要一组（每行一个 GSE↔GPL 配对）',
      });
    }
    const badIndex = datasets.findIndex((item) => !item || typeof item.gse !== 'string' || !item.gse.trim());
    if (badIndex !== -1) {
      return sendJson(res, 400, {
        ok: false,
        error: `第 ${badIndex + 1} 组数据集缺少 GSE 编号`,
      });
    }
    // 参考文献元数据：最多 5 条，每条 name/path 必须是本端 /api/references 落下的真实文件，
    // 防止客户端伪造路径把任意文件塞进清单
    const refs = payload.references;
    if (refs !== undefined && !Array.isArray(refs)) {
      return sendJson(res, 400, { ok: false, error: 'references 必须是数组' });
    }
    if (Array.isArray(refs)) {
      if (refs.length > REF_MAX_FILES) {
        return sendJson(res, 400, { ok: false, error: `参考文献最多 ${REF_MAX_FILES} 篇，当前 ${refs.length} 篇` });
      }
      for (let i = 0; i < refs.length; i += 1) {
        const item = refs[i];
        if (!item || typeof item.path !== 'string' || !REF_PATH_RE.test(item.path)) {
          return sendJson(res, 400, { ok: false, error: `第 ${i + 1} 篇参考文献路径非法（应为 refs/<sid>/<文件名>）` });
        }
        const full = path.resolve(INBOX, item.path);
        let stat = null;
        try { stat = fs.statSync(full); } catch { stat = null; }
        if (!full.startsWith(path.resolve(INBOX) + path.sep) || !stat || !stat.isFile()) {
          return sendJson(res, 400, { ok: false, error: `第 ${i + 1} 篇参考文献文件不存在或越界: ${item.path}` });
        }
      }
    }
    // 备注：自由文本，限长即可（内容合规交由工作台侧的非肿瘤黑名单兜底）
    const notes = payload.notes;
    if (notes !== undefined && typeof notes !== 'string') {
      return sendJson(res, 400, { ok: false, error: 'notes 必须是字符串' });
    }
    if (typeof notes === 'string' && notes.length > 4000) {
      return sendJson(res, 400, { ok: false, error: `备注过长（${notes.length} 字，上限 4000）` });
    }
    // 需求单结构总闸（第二十九轮 ⑥）：行级样本数/组织来源、分组角色与对比对、阈值锁死项
    // 全在这里一次校验。放在落盘之前，客户拿到的是能直接建项的东西，而不是一条只能人工返工的半成品。
    const reqCheck = validateRequirement(payload);
    if (!reqCheck.ok) {
      return sendJson(res, 400, {
        ok: false,
        error: `需求单校验未通过: ${reqCheck.errors.join('；')}`,
        errors: reqCheck.errors,
      });
    }
    const projectName = (payload && payload.basicInfo && payload.basicInfo.name) || 'requirement';

    // 包形态：带上传会话或数据文件清单时，校验并归档成 PKG_ 目录
    const dataFiles = Array.isArray(payload.dataFiles) ? payload.dataFiles : [];
    if (payload.uploadSid || dataFiles.length > 0) {
      const check = validateDataFiles(dataFiles, payload);
      if (!check.ok) {
        return sendJson(res, 400, { ok: false, error: `数据文件校验未通过: ${check.errors.join('；')}` });
      }
      const plan = buildPackagePlan({
        payload,
        sid: String(payload.uploadSid || ''),
        timestamp: stamp(),
        projectName,
        references: Array.isArray(payload.references) ? payload.references : [],
        dataFiles,
      });
      const pkgDir = path.join(INBOX, plan.packageDir);
      try {
        fs.mkdirSync(pkgDir, { recursive: true });
        payload.sync_status = 'pending';
        payload.sync_urgent = false;
        payload.sync_created_at = new Date().toISOString();
        // 需求与包清单
        fs.writeFileSync(path.join(INBOX, plan.requirementPath),
          JSON.stringify(payload, null, 2), 'utf8');
        const manifest = {
          package_dir: plan.packageDir,
          created_at: new Date().toISOString(),
          requirement: plan.requirementPath,
          counts: { data_files: plan.dataFiles.length, references: plan.references.length },
          data_files: plan.dataFiles,
          references: plan.references,
        };
        fs.writeFileSync(path.join(INBOX, plan.manifestPath),
          JSON.stringify(manifest, null, 2), 'utf8');
        // 数据文件与参考文献归位（inbox 内移动，失败即整体失败，不留半包）
        for (const file of plan.dataFiles) {
          const src = resolveInInbox(file.from);
          const dest = resolveInInbox(file.to);
          if (!src || !dest || !fs.existsSync(src) || !fs.statSync(src).isFile()) {
            throw new Error(`数据文件缺失或越界: ${file.original_name}（${file.from}）`);
          }
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.renameSync(src, dest);
        }
        for (const ref of plan.references) {
          const src = resolveInInbox(ref.from);
          const dest = resolveInInbox(ref.to);
          if (!src || !dest || !fs.existsSync(src) || !fs.statSync(src).isFile()) {
            throw new Error(`参考文献缺失或越界: ${ref.originalName}（${ref.from}）`);
          }
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.renameSync(src, dest);
        }
        // 上传会话目录已搬空则清掉，避免 inbox/uploads 无限堆积
        const sidDir = path.join(INBOX, 'uploads', String(payload.uploadSid || '_'));
        try {
          if (fs.statSync(sidDir).isDirectory() && fs.readdirSync(sidDir).length === 0) fs.rmdirSync(sidDir);
        } catch { /* 目录不存在或非空都不管 */ }
      } catch (cause) {
        return sendJson(res, 500, {
          ok: false,
          error: `归档成包失败: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
      }
      console.log(`[user-portal] 收到需求并归档成包: ${plan.packageDir}`
        + `（数据文件 ${plan.dataFiles.length} / 参考文献 ${plan.references.length}）`);
      return sendJson(res, 200, {
        ok: true,
        savedAs: plan.packageDir,
        requirement: plan.requirementPath,
        manifest: plan.manifestPath,
        counts: { data_files: plan.dataFiles.length, references: plan.references.length },
      });
    }

    // 扁平形态（老客户端，无数据文件）
    // 同步归档与 Linux 解析链只吃 ASCII 文件名；原始中文项目名仍完整保存在 JSON 正文。
    const asciiProjectName = safeName(projectName).replace(/[^\w-]+/g, '_') || 'requirement';
    const filename = `${stamp()}_requirement_${asciiProjectName}.json`;
    const target = uniquePath(path.join(INBOX, filename));
    try {
      fs.mkdirSync(INBOX, { recursive: true });
      payload.sync_status = 'pending';
      payload.sync_urgent = false;
      payload.sync_created_at = new Date().toISOString();
      fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
    } catch (cause) {
      return sendJson(res, 500, { ok: false, error: `写入收件箱失败: ${cause instanceof Error ? cause.message : String(cause)}` });
    }
    console.log(`[user-portal] 收到需求: ${path.basename(target)}`);
    return sendJson(res, 200, { ok: true, savedAs: path.basename(target) });
  });
  req.on('error', () => {
    if (!res.headersSent) sendJson(res, 400, { ok: false, error: tooLarge ? '需求文件过大（>1MB）' : '读取请求失败' });
  });
}

/**
 * 参考文献上传：POST /api/references?sid=<上传会话>&name=<原文件名>
 * 请求体为文件原始二进制（非 multipart），零依赖、可流式读取。
 * 落点 inbox/refs/<sid>/<安全化文件名>，同名追加 _2 / _3。
 */
function handleReferenceUpload(req, res, url) {
  const sid = url.searchParams.get('sid') || '';
  const rawName = url.searchParams.get('name') || '';
  if (!REF_SID_RE.test(sid)) {
    return sendJson(res, 400, { ok: false, error: '上传会话 id 非法' });
  }
  const name = safeRefName(rawName);
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (name.lastIndexOf('.') < 0 || !REF_EXT.includes(ext)) {
    return sendJson(res, 400, { ok: false, error: `不支持的参考文献格式: ${rawName || '(未命名)'}（允许 ${REF_EXT.join(' / ')}）` });
  }
  const dir = path.join(INBOX, 'refs', sid);
  let existing = [];
  try { existing = fs.readdirSync(dir).filter((n) => !n.endsWith('.part')); } catch { existing = []; }
  if (existing.length >= REF_MAX_FILES) {
    return sendJson(res, 400, { ok: false, error: `参考文献最多 ${REF_MAX_FILES} 篇，该批次已满` });
  }

  const chunks = [];
  let size = 0;
  let tooLarge = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > REF_MAX_BYTES) { tooLarge = true; req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (!size) return sendJson(res, 400, { ok: false, error: '上传内容为空' });
    const target = uniqueInDir(dir, name);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, Buffer.concat(chunks));
    } catch (cause) {
      return sendJson(res, 500, { ok: false, error: `写入参考文献失败: ${cause instanceof Error ? cause.message : String(cause)}` });
    }
    const savedName = path.basename(target);
    const relPath = `refs/${sid}/${savedName}`;
    console.log(`[user-portal] 收到参考文献: ${relPath} (${size} bytes)`);
    return sendJson(res, 200, { ok: true, name: savedName, path: relPath, size });
  });
  req.on('error', () => {
    if (!res.headersSent) {
      sendJson(res, 400, { ok: false, error: tooLarge ? `单篇参考文献过大（>${Math.round(REF_MAX_BYTES / 1024 / 1024)}MB）` : '读取上传内容失败' });
    }
  });
}

const server = http.createServer((req, res) => {
  // T0-1：请求目标由客户端任意构造，new URL 会因非法 IPv6 字面量等直接抛。
  // 未捕获异常会打死整个门户进程，把所有在线客户一起拖下线，所以这里必须兜住。
  let url;
  try {
    url = new URL(req.url, `http://${HOST}:${PORT}`);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    let html;
    try {
      html = injectSharedContracts(fs.readFileSync(INDEX, 'utf8'));
    } catch (cause) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`读取 index.html 失败: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(html);
  }

  // 模式 A 两个静态页：需求填写与结果选择。文件名写死在白名单里，不做目录穿越。
  const SURVEY_PAGES = {
    '/survey_request.html': 'survey_request.html',
    '/survey_result.html': 'survey_result.html',
  };
  if (SURVEY_PAGES[url.pathname]) {
    const file = fileURLToPath(new URL(`./${SURVEY_PAGES[url.pathname]}`, import.meta.url));
    try {
      const html = fs.readFileSync(file, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(html);
    } catch (cause) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`读取 ${SURVEY_PAGES[url.pathname]} 失败: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  const CATALOG_ASSETS = {
    '/figure-catalog': ['figure_catalog.html', 'text/html; charset=utf-8'],
    '/figure-catalog.html': ['figure_catalog.html', 'text/html; charset=utf-8'],
    '/figure_catalog.css': ['figure_catalog.css', 'text/css; charset=utf-8'],
    '/figure_catalog.js': ['figure_catalog.js', 'text/javascript; charset=utf-8'],
  };
  if (CATALOG_ASSETS[url.pathname]) {
    const [name, contentType] = CATALOG_ASSETS[url.pathname];
    const file = fileURLToPath(new URL(`./${name}`, import.meta.url));
    try {
      const body = fs.readFileSync(file);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(body);
    } catch (cause) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`读取 ${name} 失败: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  // 所有写端点在启用 PORTAL_TOKEN 时要求令牌；未启用时 checkToken 直接放行（历史行为）。
  // T0-2：/api/survey/* 原先漏在名单外，token 启用时也能被匿名覆盖调研单，现已纳入。
  const PROTECTED_API = url.pathname === '/api/submit'
    || url.pathname === '/api/datafiles'
    || url.pathname === '/api/references'
    || url.pathname === '/api/survey/request'
    || url.pathname === '/api/survey/select';
  if (PROTECTED_API) {
    const verdict = checkToken(req, url);
    if (!verdict.ok) {
      // 只记方法与路径，绝不打印 token 本身
      console.warn(`[user-portal] 鉴权失败: ${req.method} ${url.pathname}`);
      return sendJson(res, 401, { ok: false, error: verdict.error });
    }

    // T0-3：写端点一律过 CSRF 闸。放在鉴权之后，避免未授权请求先被 CSRF 拦下而掩盖鉴权结论。
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const originVerdict = checkSameOrigin(req, HOST, PORT);
      if (!originVerdict.ok) {
        console.warn(`[user-portal] 跨站写请求被拒: ${req.method} ${url.pathname}`);
        return sendJson(res, 403, { ok: false, error: originVerdict.error });
      }
    }
  }

  if (url.pathname === '/api/submit' && req.method === 'POST') {
    return handleSubmit(req, res);
  }

  if (url.pathname === '/api/datafiles' && req.method === 'POST') {
    return handleDataFileUpload(req, res, url);
  }

  if (url.pathname === '/api/references' && req.method === 'POST') {
    return handleReferenceUpload(req, res, url);
  }

  // Sync 编排面接口：只接受独立 SYNC_TOKEN，客户登录 token 不得触发下载或结算。
  const SYNC_ORCHESTRATION = url.pathname === '/api/sync/pending'
    || url.pathname === '/api/sync/claim'
    || url.pathname === '/api/sync/package'
    || url.pathname === '/api/sync/result';
  if (SYNC_ORCHESTRATION) {
    const verdict = checkSyncAuth(req, url);
    if (!verdict.ok) {
      console.warn(`[user-portal] sync 鉴权失败: ${req.method} ${url.pathname}`);
      return sendJson(res, 401, { ok: false, error: verdict.error });
    }
  }
  if (url.pathname === '/api/sync/pending' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, tickets: listPendingSyncTickets() });
  }
  if (url.pathname === '/api/sync/claim' && req.method === 'POST') {
    return handleSyncClaim(req, res);
  }
  if (url.pathname === '/api/sync/package' && req.method === 'GET') {
    return handleSyncPackage(req, res, url);
  }
  if (url.pathname === '/api/sync/result' && req.method === 'POST') {
    return handleSyncResult(req, res);
  }

  // 客户侧 sync 接口：客户登录 token 与编排面 token 各自独立。
  if (url.pathname === '/api/sync/trigger' || url.pathname === '/api/sync/status'
    || url.pathname === '/api/sync/results/file') {
    const verdict = checkClientSyncAuth(req, url);
    if (!verdict.ok) {
      console.warn(`[user-portal] 客户 sync 鉴权失败: ${req.method} ${url.pathname}`);
      return sendJson(res, 401, { ok: false, error: verdict.error });
    }
  }
  if (url.pathname === '/api/sync/trigger' && req.method === 'POST') {
    return handleSyncTrigger(req, res);
  }
  if (url.pathname === '/api/sync/status' && req.method === 'GET') {
    return handleSyncStatus(req, res, url);
  }

  if (url.pathname === '/api/sync/results/file' && req.method === 'GET') {
    return handleSyncResultFile(req, res, url);
  }

  if (url.pathname === '/api/figure-templates' && req.method === 'GET') {
    try { return sendJson(res, 200, figureTemplatesPayload()); }
    catch (cause) {
      return sendJson(res, 500, {
        ok: false,
        error: `读取图模板注册表失败: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
  }

  if (url.pathname === '/api/figure-templates/preview' && req.method === 'GET') {
    return handleFigureTemplatePreview(req, res, url);
  }

  if (url.pathname === '/api/native-qc/preview' && req.method === 'GET') {
    return handleNativeQcPreview(req, res, url);
  }

  if (url.pathname === '/api/figure-templates/project-preview' && req.method === 'GET') {
    return handleFigureProjectPreview(req, res, url);
  }

  if (url.pathname === '/api/figures/catalog' && req.method === 'GET') {
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
    return sendJson(res, 200, {
      ok: check.ok,
      catalog_ok: check.ok,
      catalog_errors: check.errors,
      stats,
      entries,
    });
  }

  if (url.pathname === '/api/figures/catalog/preview' && req.method === 'GET') {
    const catalogId = url.searchParams.get('id') || '';
    const entry = loadTemplateCatalog().find((item) => item.id === catalogId);
    if (!entry || !entry.preview_available || !entry.preview_source) {
      return sendJson(res, 404, { ok: false, error: `候选图预览不可用: ${catalogId}` });
    }
    const file = path.resolve(REPO_ROOT, entry.preview_source);
    if (!file.startsWith(REPO_ROOT + path.sep) || !fs.statSync(file).isFile()) {
      return sendJson(res, 404, { ok: false, error: `候选图预览不可用: ${catalogId}` });
    }
    const stat = fs.statSync(file);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
    return;
  }

  if (url.pathname === '/health') {
    // auth_required：客户端靠它决定是否显示 token 输入区（不删既有字段）
    return sendJson(res, 200, {
      ok: true, service: 'user-portal', port: PORT, inbox: INBOX,
      auth_required: Boolean(PORTAL_TOKEN),
    });
  }

  // 模式 A：调研需求单接收。只收方向，不收要素卡（要素卡由调研过程自己填）。
  if (url.pathname === '/api/survey/request' && req.method === 'POST') {
    let raw = '';
    let tooBig = false;
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 64 * 1024) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return sendJson(res, 413, { error: '需求单过大' });
      let payload;
      try { payload = JSON.parse(raw || '{}'); }
      catch { return sendJson(res, 400, { error: '请求体不是合法 JSON' }); }

      // 肿瘤/免疫词面快筛（准入第一道闸）：与建项共用同一份权威实现，
      // 不在本服务另写一份正则。语义级准入（筛子 L0）是第二道，由调研侧执行。
      const bl = validateProjectFields({
        disease: payload.disease, interest: payload.interest,
        tissue: payload.tissue, clue: payload.clue,
      });
      if (bl.hit) {
        return sendJson(res, 422, {
          error: '需求内容命中平台排除范围（非肿瘤、非免疫专精）',
          field: bl.field, matched: bl.matches,
        });
      }

      const r = saveSurveyRequest(payload);
      if (!r.ok) return sendJson(res, 422, { error: r.error });
      return sendJson(res, 200, { ok: true, ticket_id: r.ticketId, status: r.status });
    });
    return undefined;
  }

  // 模式 A：结果页登记客户选中的课题。只回写 selection，不改调研结论。
  if (url.pathname === '/api/survey/select' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 16 * 1024) req.destroy(); });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(raw || '{}'); }
      catch { return sendJson(res, 400, { error: '请求体不是合法 JSON' }); }

      const tid = String(payload.ticket_id || '');
      if (!/^TSV-\d{8}-[0-9a-f]{8}$/.test(tid)) {
        return sendJson(res, 400, { error: 'ticket 格式不正确' });
      }
      const ids = Array.isArray(payload.topic_ids)
        ? [...new Set(payload.topic_ids.map((x) => String(x)).filter((x) => /^T[1-9]$/.test(x)))]
        : [];
      if (!ids.length) return sendJson(res, 422, { error: '至少选择一个课题（T1 到 T9）' });

      const file = path.join(INBOX, `${tid}.json`);
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: '找不到该调研单' });
      let rec;
      try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch { return sendJson(res, 500, { error: '调研单读取失败' }); }

      rec.selection = { topic_ids: ids, selected_at: new Date().toISOString() };
      if (rec.status === 'pending') rec.status = 'selected';
      try {
        fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, 'utf8');
      } catch (cause) {
        return sendJson(res, 500, { error: `回写失败: ${cause instanceof Error ? cause.message : String(cause)}` });
      }
      return sendJson(res, 200, { ok: true, ticket_id: tid, selected: ids, status: rec.status });
    });
    return undefined;
  }

  // 模式 A：结果页按 ticket 读调研进度与结论。
  if (url.pathname === '/api/survey/result' && req.method === 'GET') {
    const tid = String(url.searchParams.get('ticket') || '');
    if (!/^TSV-\d{8}-[0-9a-f]{8}$/.test(tid)) {
      return sendJson(res, 400, { error: 'ticket 格式不正确' });
    }
    const file = path.join(INBOX, `${tid}.json`);
    if (!fs.existsSync(file)) return sendJson(res, 404, { error: '找不到该调研单' });
    try {
      const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
      return sendJson(res, 200, rec);
    } catch {
      return sendJson(res, 500, { error: '调研单读取失败' });
    }
  }

  // 工作流定义（只读）：让客户端的步骤勾选有唯一数据源。
  // 为什么 portal 自己读文件而不转发工作台：本服务与工作台彻底解耦是既有设计
  // （见文件头），不挂工作台任何 API。注册表 tools/bio/workflows.json 是静态文件，
  // 直读既不破坏解耦，也避免"工作台没起客户端就点不了步骤"。
  // 只暴露展示必需字段，不透出依赖图内部结构。
  if (url.pathname === '/api/workflows') {
    try {
      const regPath = path.resolve(REPO_ROOT, 'tools', 'bio', 'workflows.json');
      const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
      const series = reg.series.map((s) => ({
        id: s.id,
        name: s.name,
        data_form: s.data_form,
        language_profile: s.language_profile,
        stages: [...s.stages]
          .sort((a, b) => a.order - b.order)
          .map((st) => ({
            id: st.id,
            name: st.name,
            order: st.order,
            required: !!st.required,
            notes: st.notes || '',
            mods: st.mods.map((m) => ({
              id: m.id,
              name: m.name,
              desc: m.desc || m.name,
              tool: m.tool || '',
              language: m.language,
              est_minutes: m.est_minutes,
              // 前端 renderWorkflowSummary 已支持峰值内存预估，缺这个字段就只显示时长
              peak_mem_mb: m.peak_mem_mb,
              optional: !!m.optional,
              ko_gene: !!m.ko_gene,
              risk: m.risk || '',
            })),
          })),
      }));
      return sendJson(res, 200, { series, constraints: reg.constraints });
    } catch (cause) {
      return sendJson(res, 500, {
        error: `读取工作流注册表失败: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
  }

  // 组合预检（与工作台 /api/workflows/resolve 同语义，本地实现）。
  // 为什么不在 portal 转发到工作台：本服务与工作台彻底解耦是既有设计，
  // 且工作台可能没起——预检是增强项，不该因为工作台不在就废掉客户勾选。
  // 合法性判定与工作台共用同一份注册表，结论不会分叉。
  if (url.pathname === '/api/workflows/resolve' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = {};
      try {
        parsed = body.trim() ? JSON.parse(body) : {};
      } catch (cause) {
        return sendJson(res, 400, { error: `请求体不是合法 JSON: ${cause.message}` });
      }
      const seriesId = String(parsed.seriesId || '').trim();
      const modIds = Array.isArray(parsed.modIds) ? parsed.modIds.map(String) : [];
      const koGene = String(parsed.koGene || '').trim();
      if (!seriesId) return sendJson(res, 400, { error: '缺少 seriesId' });
      if (!modIds.length) return sendJson(res, 400, { error: 'modIds 不能为空' });

      try {
        const regPath = path.resolve(REPO_ROOT, 'tools', 'bio', 'workflows.json');
        const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
        const result = resolveLocally(reg, seriesId, modIds, koGene);
        // 非法组合回 422：调用方传错了，不是服务端故障（与工作台一致）
        return sendJson(res, result.ok ? 200 : 422, result);
      } catch (cause) {
        return sendJson(res, 500, {
          error: `组合预检失败: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

// T0-1 纵深防御三层：
// 1) clientError：Node 解析不出 HTTP 报文时默认静默 destroy，这里回 400 让客户端拿到明确失败；
// 2) unhandledRejection / uncaughtException：任何漏网的请求级异常只记日志，不让进程退出；
// 3) listen 的 error 事件：端口被占等启动期错误必须打出来，而不是变成未捕获异常。
server.on('clientError', (err, socket) => {
  if (!socket.writable || socket.destroyed) {
    socket.destroy();
    return;
  }
  socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
});

process.on('unhandledRejection', (reason) => {
  console.error('[user-portal] 未处理的 Promise 拒绝（已拦截，进程继续）:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[user-portal] 未捕获异常（已拦截，进程继续）:', err && err.stack ? err.stack : err);
});

server.on('error', (err) => {
  console.error('[user-portal] 服务监听失败: ' + (err && err.message ? err.message : String(err)));
  if (err && err.code === 'EADDRINUSE') process.exit(2);
});

server.listen(PORT, HOST, () => {
  console.log(`[user-portal] listening on http://${HOST}:${PORT}`);
  console.log(`[user-portal] 需求收件箱: ${INBOX}`);
  console.log('[user-portal] 不连接工作台；收到的需求文件由人工中转交给负责人');
  if (PORTAL_TOKEN) {
    console.log('[user-portal] 访问令牌已启用（PORTAL_TOKEN）：/api/* 需要 Bearer 头或 ?token= 查询参数');
  }
});

export { server };
