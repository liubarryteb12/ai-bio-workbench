/**
 * 用户需求提交入口 · 独立服务
 *
 * 与管理员工作台（BioanalysDesktop，8787）彻底解耦：
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
import { fileURLToPath } from 'node:url';
import {
  DATA_ROLES, DATA_EXT, MAX_DATA_BYTES, MAX_DATA_FILES_PER_ROLE,
  sanitizeFileName, validateDataFiles, buildPackagePlan,
} from './lib/archive.mjs';

const PORT = Number(process.env.PORTAL_PORT || 8080);
const HOST = process.env.PORTAL_HOST || '127.0.0.1';
/**
 * 可选访问令牌（B4）：默认空字符串 = 完全开放，行为与未启用鉴权的历史版本一致；
 * 运维显式设置 PORTAL_TOKEN 后，/api/* 写端点要求携带令牌（Bearer 头或 ?token=）。
 * 静态页与 /health 永不鉴权（页面要能打开、探活要能通）。
 */
const PORTAL_TOKEN = process.env.PORTAL_TOKEN || '';
/** 鉴权失败的统一响应文案（不回显 token 本身，避免把收到的令牌写进日志/响应） */
const AUTH_ERROR = '未授权：缺少或错误的 access token（设置 PORTAL_TOKEN 的服务需要令牌）';
const INDEX = fileURLToPath(new URL('./index.html', import.meta.url));
const INBOX = process.env.PORTAL_INBOX
  ? path.resolve(process.env.PORTAL_INBOX)
  : fileURLToPath(new URL('./inbox/', import.meta.url));
const SID_RE = /^[A-Za-z0-9_-]{6,64}$/;

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
    const filename = `${stamp()}_需求_${safeName(projectName)}.json`;
    const target = uniquePath(path.join(INBOX, filename));
    try {
      fs.mkdirSync(INBOX, { recursive: true });
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
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    let html;
    try {
      html = fs.readFileSync(INDEX);
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

  // 三个写端点在启用 PORTAL_TOKEN 时要求令牌；未启用时 checkToken 直接放行（历史行为）
  const PROTECTED_API = url.pathname === '/api/submit'
    || url.pathname === '/api/datafiles'
    || url.pathname === '/api/references';
  if (PROTECTED_API) {
    const verdict = checkToken(req, url);
    if (!verdict.ok) {
      // 只记方法与路径，绝不打印 token 本身
      console.warn(`[user-portal] 鉴权失败: ${req.method} ${url.pathname}`);
      return sendJson(res, 401, { ok: false, error: verdict.error });
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

  if (url.pathname === '/health') {
    // auth_required：客户端靠它决定是否显示 token 输入区（不删既有字段）
    return sendJson(res, 200, {
      ok: true, service: 'user-portal', port: PORT, inbox: INBOX,
      auth_required: Boolean(PORTAL_TOKEN),
    });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
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
