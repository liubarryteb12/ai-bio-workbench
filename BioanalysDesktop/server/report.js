/**
 * 客户交付报告工作台入口（架构评审 A4 / R3）。
 *
 * 补齐链路图 §3.1 的手工断点 2/3：以前要人工 ssh 上 K40 跑
 * tools/reporting/build_client_report.py、再手动把 deliverables/ 三大件拷回本地；
 * 这里把两步收敛成服务端 build + pull，前端一个按钮触发。
 *
 * 引擎（tools/reporting/build_client_report.py，另一会话域，只调用不修改）设计红线：
 *   不编造数字 / 不重写母版 / 交付包脱敏真实路径（{{DATA_ROOT}} 占位）。
 *   退出码 0=成功 1=参数或数据错误 2=环境错误 -  - 非 0 一律如实 reject，不吞。
 *
 * 执行接缝说明：远端命令一律走 proc.js 的 runStream 单接缝（2026-11-01 P3-03 迁入），
 * 本模块不再自带 childProcess 导入。两条理由：
 *   1. argv 数组而非整串命令交 shell：Windows 本地 shell 是 cmd.exe，单引号不是引用
 *      字符，远端命令里的 && 会被 cmd 当本地分隔符拆开（run.js 同款坑）。
 *   2. 白名单与 BIO_COMPUTE_ADAPTER=mock 短路都在接缝收口：交付门禁测试用 mock 计算面
 *      就能验 build+pull+验签全链路，既不真连 K40，也不会漏 scp 直连（scp 也在 mock 覆盖内）。
 * 底层 childProcess 是默认导入（ESM 具名导入是链接期快照，mock.method 拦不到，run.js 已实证）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, verify as cryptoVerify } from 'node:crypto';

import { HOSTS, SSD_ROOT, PROJECTS_ROOT, SYSTEM_LOGS, LINES, sanitizeProjectId } from './domain.js';
import { computeMode, runAsync, runStream, shellQuote } from './proc.js';
import { stripSshNoise } from './run.js';
import { readPublicKey } from '../../tools/reporting/ed25519_tools.mjs';
import {
  acceptDelivery, writeReceipt, verifyTarReceipt, loadReceipt, ACCEPTANCE_VERSION, RECEIPT_SUBDIR,
  auditPathFor, readAuditLedger,
} from '../../tools/reporting/delivery_acceptance_core.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * 本地交付缓存根：显式环境变量优先；默认收敛到本地项目根 workspace/projects/。
 * localDeliverDir 再按项目落到 <project>/deliverables，避免回搬结果散到仓库根。
 */
export const LOCAL_DELIVER_ROOT = process.env.BIO_LOCAL_DELIVERABLES
  ? path.resolve(process.env.BIO_LOCAL_DELIVERABLES)
  : process.env.BIO_LOCAL_PROJECTS
    ? path.resolve(process.env.BIO_LOCAL_PROJECTS)
    : path.join(REPO_ROOT, 'workspace/projects');

/**
 * 本项目在本地交付缓存里的目录。
 * @throws projectId 非法（防路径穿越，拒绝式与 project.js 一致）
 */
export function localDeliverDir(projectId) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  return path.join(LOCAL_DELIVER_ROOT, safe, 'deliverables');
}

/**
 * 远端完整交付命令（纯函数，不碰 ssh，可单测）。
 *
 * 目录用项目根而不是某条线的目录：引擎自己会扫三线产物。
 * 远端路径整体用单引号包住（2026-10-13 台账事故教训：裸路径会被
 * 文件名里的空格/特殊字符拆断）；projectId 已消毒，只含 [A-Za-z0-9._-]，
 * 单引号注入进不来。
 *
 * @param {string} projectId
 * @returns {{command: string, remoteProjectDir: string}}
 */
export function buildReportCommand(projectId) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  const remoteProjectDir = `${PROJECTS_ROOT}/${safe}`;
  const keyDir = `${SSD_ROOT}/ops/secrets`;
  const command = `cd ${SSD_ROOT}`
    + ` && BIO_ED25519_PRIVATE_KEY_PATH='${keyDir}/ed25519_private.pem'`
    + ` BIO_ED25519_PUBLIC_KEY_PATH='${keyDir}/ed25519_public.pem'`
    + ` python3 tools/reporting/build_client_report.py --project '${remoteProjectDir}'`;
  return { command, remoteProjectDir };
}

/**
 * 引擎交付件允许集合（下载白名单，与 build 拉取集合同一份）：
 *   完整性清单、Ed25519 签名、公钥、Analysis_Report.{md,html} 与交付 tar.gz。
 * 引擎理论上不改名，但 tar 前缀跟随项目 id，按后缀匹配更稳；
 * 纯文本文件名严格全等。任何路径分隔符与 .. 直接拒绝。
 */
const DELIVERABLE_NAME_PATTERNS = [
  /^CHECKSUMS\.sha256$/,
  /^CHECKSUMS\.sig$/,
  /^ED25519_PUBLIC_KEY\.pem$/,
  /^Analysis_Report\.md$/,
  /^Analysis_Report\.html$/,
  /^[A-Za-z0-9._-]+_Client_Delivery\.tar\.gz$/,
];

export function isAllowedDeliverableName(name) {
  const raw = String(name ?? '');
  if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('..')) return false;
  return DELIVERABLE_NAME_PATTERNS.some((pattern) => pattern.test(raw));
}

/** 交付 tar 包名字：只有它带包级基准哈希，文本件靠包内 CHECKSUMS.sha256 */
const TAR_DELIVERY_RE = /^[A-Za-z0-9._-]+_Client_Delivery\.tar\.gz$/;

function sha256OfFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * 远端基准 SHA256：只认 sha256sum 明确打出的 64 位 hex。
 * 拿不到（ssh 失败、远端没有 sha256sum、输出不可解析）返回 null，
 * 由调用方按「无基准即拒绝」处理，绝不拿本地重算值当基准。
 */
async function remoteFileSha256(remotePath) {
  try {
    const result = await runSsh(`sha256sum ${shellQuote(remotePath)} 2>/dev/null`);
    const match = /^([0-9a-f]{64})\s/m.exec(result.stdout || '');
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * 验签用的受信公钥：环境变量显式指定优先，否则用仓库内 tools/ops/secrets 的本地信任锚。
 * 两者都没有时返回 undefined，verifyDelivery 会按「公钥不可用」失败，保持 fail-closed。
 */
function trustedPublicKeyPath() {
  if (process.env.BIO_ED25519_PUBLIC_KEY_PATH) return process.env.BIO_ED25519_PUBLIC_KEY_PATH;
  const localAnchor = path.join(REPO_ROOT, 'tools', 'ops', 'secrets', 'ed25519_public.pem');
  return fs.existsSync(localAnchor) ? localAnchor : undefined;
}

/**
 * 校验「本地实际回搬的那一部分」而不是整包。
 *
 * 为什么必须这样：引擎的 CHECKSUMS.sha256 记的是包内嵌套相对路径
 * （03_Interpretation_Report/Analysis_Report.md、01_Adapted_Scripts/run.sh 等），
 * 而 pullDeliverables 按 basename 平铺、只拉允许集合。按整包逐行校验时，
 * 正常包必然因缺 01_Adapted_Scripts/run.sh 被判成坏包，交付链路整体不可用。
 *
 * 口径：签名必须过（证明清单本身没被改）；已回搬的每个文件必须在清单里且哈希一致。
 * 未回搬的包内文件由 tar 包整体哈希与远端基准比对兜底（见 pullDeliverables）。
 */
function verifyPulledSubset(dir, names) {
  const manifestFiles = new Set(['CHECKSUMS.sha256', 'CHECKSUMS.sig', 'ED25519_PUBLIC_KEY.pem']);
  try {
    const manifest = fs.readFileSync(path.join(dir, 'CHECKSUMS.sha256'));
    const signature = fs.readFileSync(path.join(dir, 'CHECKSUMS.sig'));
    const publicKey = readPublicKey({ publicKeyPath: trustedPublicKeyPath() });
    if (!cryptoVerify(null, manifest, publicKey, signature)) {
      return { ok: false, reason: 'signature_mismatch' };
    }
    const byBasename = new Map();
    for (const line of manifest.toString('utf8').split('\n').filter(Boolean)) {
      const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
      if (!match) return { ok: false, reason: `bad_manifest_line:${line.slice(0, 40)}` };
      byBasename.set(match[2].split('/').pop(), match[1]);
    }
    let checked = 0;
    for (const name of names) {
      // tar 在清单生成之后才打，本来就不在 CHECKSUMS 里，它靠远端基准哈希兜底
      if (!isAllowedDeliverableName(name) || manifestFiles.has(name) || TAR_DELIVERY_RE.test(name)) continue;
      const expected = byBasename.get(name);
      if (!expected) return { ok: false, reason: `not_in_manifest:${name}` };
      const actual = sha256OfFile(path.join(dir, name));
      if (actual !== expected) return { ok: false, reason: `hash_mismatch:${name}` };
      checked += 1;
    }
    return { ok: true, checked };
  } catch (cause) {
    return { ok: false, reason: `invalid_delivery:${cause.message}` };
  }
}

/** 读取项目派生副本清单；目录不存在是空清单，不是故障 */
export function readAdaptManifest(root, projectId) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  const base = path.resolve(String(root ?? REPO_ROOT), 'workspace/projects', safe);
  const file = path.join(base, 'figures', 'adapt', 'manifest.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 把本地 figures/adapt/ 清单映射成远端 per-line scripts 上传对。
 *
 * 这里不改 build_client_report.py：上传后它会按既有 scripts/ 扫描逻辑把适配副本
 * 收进 01_Adapted_Code/。所有路径都先钉在项目内 adapt/，再映射到本项目本线。
 */
export function buildAdaptUploadPairs(root, projectId) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  const adaptDir = path.resolve(String(root ?? REPO_ROOT), 'workspace/projects', safe, 'figures', 'adapt');
  const manifest = readAdaptManifest(root, safe);
  const errors = [];
  const pairs = [];
  for (const entry of manifest) {
    const lineId = String(entry.line_id || '');
    const extension = entry.local_path && /\.py$/i.test(entry.local_path) ? '.py' : '.R';
    const remoteName = path.posix.basename(String(entry.remote_path || ''));
    const filename = /^adapt_[A-Za-z0-9._-]+\.(R|py)$/.test(remoteName)
      ? remoteName
      : `adapt_${String(entry.template_id || '').replace(/\.(py|R)$/i, '')}${extension}`;
    if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
      errors.push(`template_id 非法: ${filename}`);
      continue;
    }
    if (!LINES.includes(lineId)) {
      errors.push(`line_id 非法: ${lineId}`);
      continue;
    }
    const local = path.resolve(String(entry.local_path || ''));
    if (!local.startsWith(adaptDir + path.sep)) {
      errors.push(`local_path 越界: ${entry.local_path}`);
      continue;
    }
    try {
      if (!fs.statSync(local).isFile()) errors.push(`local_path 不是文件: ${entry.local_path}`);
    } catch {
      errors.push(`local_path 不存在: ${entry.local_path}`);
    }
    pairs.push({
      template_id: entry.template_id,
      line_id: lineId,
      local,
      remote: `/mnt/ssd/bio_data/projects/${safe}/${lineId}/scripts/${filename}`,
      sha256: entry.derived_sha256 || null,
      master_sha256: entry.master_sha256 || null,
    });
  }
  if (errors.length > 0) {
    throw new Error(`适配清单非法（合法线 ${LINES.join(', ')}）: ${errors.join('; ')}`);
  }
  return pairs;
}

/**
 * 本地交付文件绝对路径；projectId 非法、文件名越界或文件不存在时返回 null。
 * 下载路由只认这里的返回值，保证永远落在 localDeliverDir 内。
 */
export function localDeliverFilePath(projectId, name) {
  const safe = sanitizeProjectId(projectId);
  if (!safe || !isAllowedDeliverableName(name)) return null;
  const file = path.join(localDeliverDir(safe), name);
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/**
 * 执行一条远端命令（ssh argv 数组，照 run.js 范式）。
 * 退出码 0 → resolve 去噪后的 {stdout, stderr}；非 0 → reject 且 error 带去噪后的
 * stderr 原文（引擎 1=数据错误 2=环境错误都要如实带回，不许吞成成功）。
 */
function runSsh(command, handlers = {}) {
  return streamRemote(
    ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOSTS.compute, command],
    handlers,
    'ssh'
  ).then(({ stdout, stderr, code }) => {
    const cleanOut = stripSshNoise(stdout);
    const cleanErr = stripSshNoise(stderr);
    if (code === 0) return { stdout: cleanOut, stderr: cleanErr };
    throw new Error(`exit ${code}: ${cleanErr.trim() || cleanOut.trim() || 'stderr 为空'}`);
  });
}

/**
 * 远端传输类命令（ssh / scp）的流式执行，走 proc.js 单接缝：白名单与
 * BIO_COMPUTE_ADAPTER 都在那一层收口，report 门禁在 mock 下不会真连 K40。
 * 启动失败与退出码非 0 分开报（前 08 号书复核要求"起不来"不能被吞成"跑失败"）。
 */
function streamRemote(argv, handlers, label) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    let settled = false;
    runStream(argv, {
      onStdout: (text) => {
        out += text;
        handlers.onStdout?.(text);
      },
      onStderr: (text) => {
        err += text;
        handlers.onStderr?.(text);
      },
      onExit: (code) => {
        settled = true;
        resolve({ stdout: out, stderr: err, code });
      },
      onError: () => {
        if (!settled) reject(new Error(`${label} 启动失败: ${err.trim() || 'unknown error'}`));
      },
    });
  });
}

/**
 * 远端项目目录是否存在（只读 test -d，建项入口校验用）。
 */
export async function checkRemoteProjectDir(projectId) {
  const { remoteProjectDir } = buildReportCommand(projectId);
  try {
    await runSsh(`test -d ${shellQuote(remoteProjectDir)}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * 跑完整交付构建（远端引擎），stdout/stderr 透给 handlers。
 * @returns {Promise<{ok: true, stdout: string}>}
 */
export async function runReportBuild(projectId, handlers = {}) {
  const { command } = buildReportCommand(projectId);
  const result = await runSsh(command, handlers);
  return { ok: true, stdout: result.stdout };
}

/** scp 拉单文件回本地（pull.js 范式的 argv 数组；buildFetchCommand 的整串形式
 * 在 Windows cmd 下同样受单引号/特殊字符限制，故统一走 argv） */
function scpFetch(remotePath, localPath) {
  // ADB 单通道下 scp 回拉走 adb_transfer.pullFile（远端 sha256 + base64 取回 + 本地落盘并核对哈希）。
  // 不能走 runStream：它只重写 ssh argv，scp 会直连已封存的 SSH 通道
  // （2026-11-12 真机实测 report_build 500，scp exit 255 banner exchange Connection refused）。
  // 测试用 BIO_TEST_PRESERVE_STREAM_ARGV=1 保留原 argv，让假 scp 垫片按老语义回放。
  if (computeMode() === 'adb' && process.env.BIO_TEST_PRESERVE_STREAM_ARGV !== '1') {
    // runAsync 的 scp pull 分支会重写成「远端 sha256 + base64 取回 + 本地落盘」，
    // 全程 spawn 异步，不占事件循环；maxBuffer 放宽以容纳交付 tar 的 base64 体积。
    return runAsync(
      ['scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', `${HOSTS.compute}:${remotePath}`, localPath],
      { maxBuffer: 768 * 1024 * 1024 },
    ).then(({ stderr, code }) => {
      if (code !== 0) {
        throw new Error(`scp 拉取失败 (exit ${code}): ${stripSshNoise(stderr).trim() || 'stderr 为空'}`);
      }
    });
  }
  return streamRemote(
    ['scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', `${HOSTS.compute}:${remotePath}`, localPath],
    {},
    'scp'
  ).then(({ stderr, code }) => {
    const cleanErr = stripSshNoise(stderr);
    if (code !== 0) {
      throw new Error(`scp 拉取失败 (exit ${code}): ${cleanErr.trim() || 'stderr 为空'}`);
    }
  });
}

/**
 * build 成功后把远端 <project>/deliverables/ 交付件拉回 localDeliverDir。
 *
 * 以远端 find 实际清单为准（引擎可能改名），不在允许集合的文件跳过不拉；
 * 三大类任一缺失或任一文件字节数为 0 都明确报错，不许假装成功。
 *
 * @returns {Promise<{ok: true, projectId: string, files: Array<{name: string, bytes: number, path: string}>,
 *   report_md_bytes: number, report_html_bytes: number}>}
 *   files[].path 只回相对 localDeliverDir 的文件名（不回绝对路径，安全红线）。
 */
export async function pullDeliverables(projectId) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  const remoteProjectDir = `${PROJECTS_ROOT}/${safe}`;
  const remoteDeliverDir = `${remoteProjectDir}/deliverables`;

  // 递归列远端 deliverables：实测引擎布局是 deliverables/<pid>_Client_Delivery/
  // 03_Interpretation_Report/Analysis_Report.{md,html} + 根下 <pid>_Client_Delivery.tar.gz，
  // 不假设平铺；%P 给出相对 start 点的路径，拉取按相对路径取、本地按 basename 落盘。
  const listing = await runSsh(
    `find '${remoteDeliverDir}' -type f -printf '%P|%s\\n' 2>/dev/null`
  );
  const remoteFiles = listing.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((row) => {
      const separator = row.lastIndexOf('|');
      const relPath = row.slice(0, separator);
      const size = Number(row.slice(separator + 1));
      return { relPath, name: relPath.split('/').pop(), size: Number.isFinite(size) ? size : 0 };
    })
    .filter((entry) => entry.name && !entry.name.includes('/') && !entry.name.includes('\\'));

  const hasMd = remoteFiles.some((f) => f.name === 'Analysis_Report.md');
  const hasHtml = remoteFiles.some((f) => f.name === 'Analysis_Report.html');
  const hasTar = remoteFiles.some((f) => /^[A-Za-z0-9._-]+_Client_Delivery\.tar\.gz$/.test(f.name));
  const missing = [
    hasMd ? null : 'Analysis_Report.md',
    hasHtml ? null : 'Analysis_Report.html',
    hasTar ? null : '<project>_Client_Delivery.tar.gz',
  ].filter(Boolean);
  if (missing.length > 0) {
    const names = remoteFiles.map((f) => f.name).join(', ') || '（空）';
    throw new Error(`远端交付件缺失: ${missing.join(', ')}；远端 deliverables 实际内容: ${names}`);
  }

  const localDir = localDeliverDir(safe);
  fs.mkdirSync(localDir, { recursive: true });

  const files = [];
  for (const file of remoteFiles) {
    if (!isAllowedDeliverableName(file.name)) continue;
    const localPath = path.join(localDir, file.name);
    await scpFetch(`${remoteDeliverDir}/${file.relPath}`, localPath);
    let bytes = 0;
    try {
      bytes = fs.statSync(localPath).size;
    } catch {
      bytes = 0;
    }
    if (bytes <= 0) {
      throw new Error(`交付文件拉取后为空或不存在: ${file.name}（远端 ${file.size} 字节）`);
    }
    // 08 号书第 6 项：tar 包回搬后先比对远端基准哈希，本地重算只用于比对，
    // 不匹配或无基准一律删本地坏包并阻断，严禁留着重算一个「合法」哈希洗白。
    if (TAR_DELIVERY_RE.test(file.name)) {
      const expected = await remoteFileSha256(`${remoteDeliverDir}/${file.relPath}`);
      if (!expected) {
        fs.rmSync(localPath, { force: true });
        throw new Error(
          `[REPORT_HASH_MISSING] 远端未给出 ${file.name} 的基准 SHA256，拒绝在无基准时落盘交付包`,
        );
      }
      const actual = sha256OfFile(localPath);
      if (actual !== expected) {
        fs.rmSync(localPath, { force: true });
        throw new Error(
          `[REPORT_HASH_MISMATCH] 回搬文件哈希与远端不一致 (expected=${expected}, actual=${actual})，已删除本地坏包`,
        );
      }
    }
    files.push({ name: file.name, bytes, path: file.name });
  }

  const md = files.find((f) => f.name === 'Analysis_Report.md');
  const html = files.find((f) => f.name === 'Analysis_Report.html');
  return {
    ok: true,
    projectId: safe,
    files,
    report_md_bytes: md ? md.bytes : 0,
    report_html_bytes: html ? html.bytes : 0,
  };
}

// ---------------------------------------------------------------
// 交付前置门禁（docs/delivery_package_spec.md 第三节第 3/5/6 条）
//
// 规范里这三道闸原本属于「尚未实现的 ops/09_package_delivery.ps1」，但打包能力
// 实际由 tools/reporting/build_client_report.py 承担、入口在 18787（server/report.js），
// 引擎本身不含水位/台账/校验和检查（已 grep 确认）。所以把三道闸补在调用侧：
// 引擎跑之前先问远端三件事，任一不过就不许生成交付包，避免「包出来了但项目里
// 还有失败步骤」这种最难解释的假交付。
//
// 口径（与 spec 一致）：
//   1. 存储水位：df -P 剩余 >= 20%（打包本身要写几十 MB 到数百 MB）
//   2. 无进行中任务：本项目台账不得有 status=running
//   3. 失败台账需确认：存在 status=failed 时必须 -Force（这里对应 force=true）
// 另加一条防御：远端输出必须带回 END 标记，缺标记按「输出被截断」判失败
// （本项目历史上吃过 argv 静默截断的亏，见 run.js buildLedgerWriteCommand 注释）。
// ---------------------------------------------------------------

/** 打包前要求的最小剩余空间百分比（spec §三.3：剩余 >= 20%） */
export const PREFLIGHT_MIN_FREE_PCT = 20;

/**
 * 远端门禁查询命令（纯函数，不碰 ssh，可单测）。
 *
 * 输出协议（一行一条，便于单测断言，不依赖 JSON 解析失败时的容错）：
 *   DF|<used_pct>%              挂载点已用百分比
 *   LEDGER|<basename>|<status>  本项目每一条台账的状态
 *   END|                        输出完整标记
 *
 * 台账是 JSON.stringify(entry, null, 2) 落的盘，status 是顶层字段（见 task.js
 * buildLedgerEntry 的字段顺序），所以 grep 首个 "status": 命中就是顶层状态，
 * 不会被 checkpoint_status 干扰（那个键名前面是 checkpoint_，不带引号，匹配不上）。
 */
export function buildPreflightCommand(projectId) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  const storage = `df -P '${SSD_ROOT}' | awk 'NR==2 {print "DF|" $5}'`;
  const ledgers = `grep -l '"project_id": "${safe}"' '${SYSTEM_LOGS}'/*.json 2>/dev/null`
    + ` | while IFS= read -r f; do`
    + ` s=$(grep -m1 -o '"status": "[a-z_]*"' "$f" | sed 's/.*: "//; s/"$//');`
    + ` echo "LEDGER|$(basename "$f")|$s";`
    + ` done`;
  return { command: `${storage}; ${ledgers}; echo 'END|'`, remoteProjectDir: `${PROJECTS_ROOT}/${safe}` };
}

/**
 * 解析门禁查询输出（纯函数）。
 * @returns {{usedPct: number|null, ledgers: Array<{file: string, status: string}>, sawEnd: boolean}}
 */
export function parsePreflightOutput(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let usedPct = null;
  const ledgers = [];
  let sawEnd = false;
  for (const line of lines) {
    if (line === 'END|') { sawEnd = true; continue; }
    const df = /^DF\|(\d+)%?$/.exec(line);
    if (df) { usedPct = Number(df[1]); continue; }
    const ledger = /^LEDGER\|([^|]+)\|([A-Za-z_]*)$/.exec(line);
    if (ledger) ledgers.push({ file: ledger[1], status: ledger[2] || 'unknown' });
  }
  return { usedPct, ledgers, sawEnd };
}

/**
 * 跑三道门禁。ok=false 时调用方必须拒绝打包（spec §三：任一不过即 exit 1）。
 *
 * @param {string} projectId
 * @param {{force?: boolean}} options force=true 对应 spec 的 -Force：已知有失败台账
 *        且人工确认过产物完整性时才允许继续
 * @returns {Promise<{ok: boolean, projectId: string, usedPct: number|null, freePct: number|null,
 *   force: boolean, checks: Array<{name: string, ok: boolean, detail: string}>,
 *   failedLedgers: Array<{file: string, status: string}>, summary: string}>}
 */
export async function runReportPreflight(projectId, { force = false } = {}) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  const { command } = buildPreflightCommand(safe);
  const { stdout } = await runSsh(command);
  const parsed = parsePreflightOutput(stdout);

  const checks = [];

  const freePct = parsed.usedPct === null ? null : 100 - parsed.usedPct;
  checks.push({
    name: 'storage',
    ok: freePct !== null && freePct >= PREFLIGHT_MIN_FREE_PCT,
    detail: freePct === null
      ? `存储水位未知（df 输出未解析到，远端输出: ${JSON.stringify(String(stdout).slice(-200))}）`
      : `剩余 ${freePct}%（要求 >= ${PREFLIGHT_MIN_FREE_PCT}%，已用 ${parsed.usedPct}%）`,
  });

  const running = parsed.ledgers.filter((item) => item.status === 'running');
  checks.push({
    name: 'running',
    ok: running.length === 0,
    detail: running.length === 0
      ? '无进行中任务'
      : `有 ${running.length} 条进行中台账：${running.map((item) => item.file).join(', ')}`,
  });

  const failed = parsed.ledgers.filter((item) => item.status === 'failed');
  checks.push({
    name: 'failed_ledger',
    ok: failed.length === 0 || force === true,
    detail: failed.length === 0
      ? '无失败台账'
      : `有 ${failed.length} 条失败台账（${failed.map((item) => item.file).join(', ')}）`
        + (force === true ? '，已按 force 继续' : '，需人工确认产物完整后加 force 重试'),
  });

  checks.push({
    name: 'remote_output',
    ok: parsed.sawEnd,
    detail: parsed.sawEnd ? '远端输出完整（收到 END 标记）' : '远端输出缺 END 标记（疑似命令被截断或未执行完）',
  });

  const ok = checks.every((check) => check.ok);
  const summary = ok
    ? `前置门禁全部通过（${checks.map((check) => check.detail).join('；')}）`
    : `前置门禁未通过：${checks.filter((check) => !check.ok).map((check) => `[${check.name}] ${check.detail}`).join('；')}`;

  return {
    ok,
    projectId: safe,
    usedPct: parsed.usedPct,
    freePct,
    force: force === true,
    checks,
    failedLedgers: failed,
    summary,
  };
}

/**
 * 给本地已回搬的交付件补 .sha256 旁挂文件（spec §一「生成校验清单，客户可自行核验」）。
 *
 * 包内完整性由 CHECKSUMS.sha256 负责，这里在本地缓存目录补一份
 * `<文件名>.sha256`，格式是 sha256sum 的 `<hex>  <name>`，客户侧可直接
 * `sha256sum -c <name>.sha256` 复核。
 *
 * @returns {Array<{name: string, sha256: string, sidecar: string}>}
 */
export function writeSha256Sidecars(projectId) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  const dir = localDeliverDir(safe);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  // Verify-before-sidecar（08 号书第 6 项）：交付件在场时必须先验签再补旁挂哈希。
  // 「缺清单或缺签名就跳过验签」等于给攻击者留一条删掉 CHECKSUMS.sig 就洗白的路，
  // 所以任何允许集合内的交付件在场而清单/签名不全时都按完整性失败处理；
  // 验签失败则删除污染包。只有空目录或仅剩历史 sidecar 时才允许返回空数组。
  const checksumsPath = path.join(dir, 'CHECKSUMS.sha256');
  const sigPath = path.join(dir, 'CHECKSUMS.sig');
  const hasManifest = fs.existsSync(checksumsPath) && fs.existsSync(sigPath);
  const deliverables = names.filter((name) => isAllowedDeliverableName(name));
  const tars = names.filter((name) => TAR_DELIVERY_RE.test(name));
  if (deliverables.length > 0 && !hasManifest) {
    throw new Error(
      '[REPORT_INTEGRITY_FAIL] 交付件缺少 CHECKSUMS.sha256 或 CHECKSUMS.sig，拒绝补旁挂哈希（删签名不能成为绕过验签的口子）',
    );
  }
  if (hasManifest) {
    const verdict = verifyPulledSubset(dir, names);
    if (!verdict.ok) {
      for (const tar of tars) fs.rmSync(path.join(dir, tar), { force: true });
      const cleaned = tars.length > 0 ? '；已删除污染包' : '';
      throw new Error(
        `[REPORT_INTEGRITY_FAIL] 回搬交付包验签失败: ${verdict.reason}${cleaned}；已拒绝生成 sidecar`,
      );
    }
  }
  // T3-6：两阶段提交。先算完全部摘要（纯读，不落盘），再一次性写 sidecar；
  // 写阶段任一步失败就把本轮已写的 sidecar 全部删掉，不留半包。
  // 原实现边算边写：第 3 个文件写失败时，前 2 个 .sha256 已经躺在盘上，
  // 而 CHECKSUMS 还没生成，读方会看到「有部分旁挂哈希但没有清单」的脏状态。
  const planned = [];
  for (const name of names.sort()) {
    if (!isAllowedDeliverableName(name)) continue;
    const file = path.join(dir, name);
    let bytes;
    try {
      bytes = fs.readFileSync(file);
    } catch {
      continue;
    }
    planned.push({ name, file, digest: createHash('sha256').update(bytes).digest('hex') });
  }

  const written = [];
  try {
    for (const item of planned) {
      const sidecar = `${item.file}.sha256`;
      // 先写临时文件再 rename：rename 在同一文件系统内原子，
      // 读方要么读到旧的完整文件，要么读到新的完整文件，读不到半截。
      const tmp = `${sidecar}.tmp`;
      fs.writeFileSync(tmp, `${item.digest}  ${item.name}\n`, 'utf8');
      fs.renameSync(tmp, sidecar);
      written.push({ name: item.name, sha256: item.digest, sidecar: `${item.name}.sha256` });
    }
  } catch (cause) {
    // 回滚：把本轮已写的 sidecar 与可能残留的 tmp 全部清掉，让盘上回到进入前的状态
    for (const item of written) {
      fs.rmSync(path.join(dir, `${item.name}.sha256`), { force: true });
    }
    for (const item of planned) {
      fs.rmSync(path.join(dir, `${item.name}.sha256.tmp`), { force: true });
    }
    throw new Error(
      `[REPORT_INTEGRITY_FAIL] 写 sidecar 中途失败，已回滚 ${written.length} 个文件: `
      + (cause instanceof Error ? cause.message : String(cause)),
    );
  }
  return written;
}

// ---------------------------------------------------------------
// 交付回执与打包末尾内联验收（2026-11-03，4 Argon 第二十轮 Q1 裁定）
//
// 形态：(a)+(b) 混合态。四关验收作为打包链路的最后一步后置条件内联执行
// （第十八轮实测打包+签名 4.5 秒、验收 <1 秒，没有理由靠人记得敲 npm run），
// 通过后落回执 tools/ops/delivery_acceptance/records/<project_id>.receipt.json；
// 下载路由放行前必须校验回执存在且 tar_sha256 与当前包实时哈希相等，
// 否则 409 ERR_DELIVERY_UNVERIFIED。回执严禁混入 docs/generated/SYSTEM_LEDGER.json
// ——那是架构模具台账，回执是业务运行时产物。
// ---------------------------------------------------------------

export const DELIVERY_UNVERIFIED_CODE = 'ERR_DELIVERY_UNVERIFIED';
export { ACCEPTANCE_VERSION };

/** 本地交付目录里的当前交付 tar 包（取最新一个）；没有返回 null */
export function findLocalTar(projectId) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  const dir = localDeliverDir(safe);
  try {
    const name = fs.readdirSync(dir).filter((n) => TAR_DELIVERY_RE.test(n)).sort().pop();
    return name ? path.join(dir, name) : null;
  } catch {
    return null;
  }
}

/**
 * 生产回执落点（Argon Q1）：「records 目录可放行最新演练回执入库，生产客户回执落项目目录」。
 * 所以服务端写 <localDeliverDir>/acceptance/<pid>.receipt.json（随 deliverables 一起 gitignore，
 * 业务运行时产物不进仓库）；BIO_DELIVERY_RECORDS_DIR 存在时覆盖（测试/抽检隔离）。
 */
function serverRecordsDir(safe) {
  if (process.env.BIO_DELIVERY_RECORDS_DIR) return process.env.BIO_DELIVERY_RECORDS_DIR;
  return path.join(localDeliverDir(safe), 'acceptance');
}

/**
 * 脱敏审计流落点（Argon 第二十一轮 Q2）：<deliverables>/acceptance_audit.jsonl。
 * deliverables/ 整目录在 .gitignore 里，所以生产打包不会把项目号与交付节奏写进仓库历史。
 * BIO_DELIVERY_AUDIT_PATH 存在时整体覆盖（抽检与测试隔离用这个）。
 */
function serverAuditPath(safe) {
  if (process.env.BIO_DELIVERY_AUDIT_PATH) return process.env.BIO_DELIVERY_AUDIT_PATH;
  return auditPathFor(localDeliverDir(safe));
}

/** 读回执的候选目录：服务端落点优先，仓库受控区兜底（演练包/CLI 手写回执走这条） */
function receiptCandidateDirs(safe) {
  const dirs = [serverRecordsDir(safe)];
  const repoRecords = path.join(REPO_ROOT, RECEIPT_SUBDIR);
  if (!dirs.includes(repoRecords)) dirs.push(repoRecords);
  return dirs;
}

/**
 * 打包末尾后置条件：对本地刚回搬的 tar 跑四关验收，全绿才写回执。
 * 红时不抛异常而是回结构化 verdict——调用方（路由）决定怎么报错，
 * 回执则绝不落盘（writeReceipt 内部也拒绝 !verdict.ok，双保险）。
 */
export function runInlineAcceptance(projectId, { recordsDir } = {}) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  const tar = findLocalTar(safe);
  if (!tar) {
    return {
      ok: false,
      gates: [],
      failures: ['本地交付目录没有 *_Client_Delivery.tar.gz（回搬未完成，无从验收）'],
      sentinel: 'ACCEPTANCE_FAILED 1 项',
      receipt: null,
    };
  }
  const publicKeyPath = trustedPublicKeyPath();
  const verdict = acceptDelivery({ tarPath: tar, publicKeyPath, skipExtract: false });
  let receipt = null;
  if (verdict.ok) {
    const targetDir = recordsDir || serverRecordsDir(safe);
    receipt = writeReceipt({
      projectId: safe, verdict, recordsDir: targetDir,
      // 审计流刻意落在 deliverables 根（而非 acceptance/ 子目录）：它是代理侧的交付总账，
      // 与「随包回执」分开，方便 clean:workspace 只清回执目录时保住审计历史。
      auditPath: recordsDir ? undefined : serverAuditPath(safe),
    });
  }
  return { ...verdict, tarPath: tar, receipt };
}

/**
 * 下载放行判据：回执存在 且 其 tar_sha256 == 当前包实时哈希。
 * 包被换/被改/回执被删都返回 { ok:false, code:'ERR_DELIVERY_UNVERIFIED' }。
 */
export function deliveryGateStatus(projectId, { recordsDir } = {}) {
  const safe = sanitizeProjectId(projectId);
  if (!safe) throw new Error(`projectId 非法: ${projectId}`);
  const tar = findLocalTar(safe);
  if (!tar) {
    return {
      ok: false,
      code: DELIVERY_UNVERIFIED_CODE,
      reason: '本地尚无交付 tar 包，先 POST /api/report/build（无包即无放行依据）',
    };
  }
  // 有回执的那个目录说了算（哈希不符是决定性否决，不许再往兜底目录找一份旧的）
  const dirs = recordsDir ? [recordsDir] : receiptCandidateDirs(safe);
  for (const dir of dirs) {
    if (loadReceipt(safe, dir)) {
      const verdict = verifyTarReceipt(safe, tar, dir);
      return { ...verdict, code: verdict.ok ? null : DELIVERY_UNVERIFIED_CODE, tarPath: tar };
    }
  }
  return {
    ok: false,
    code: DELIVERY_UNVERIFIED_CODE,
    reason: '无验收回执：交付包未经四关验收，禁止标记 DELIVERED 或开放下载',
    tarPath: tar,
  };
}

