/**
 * BioanalysDesktop/server/services/delivery_packager.js
 * 阶段四纯净交付打包器：全目录深度商业脱敏扫描 + Ed25519 防篡改签名 + 原子归档至 deliverables/。
 *
 * 硬规则：
 *   1. 扫描整个待打包目录（HTML/MD 报告、receipt_v1.json、TSV/CSV/JSON 摘要表），
 *      剥离 base64 图片载荷后严查 Windows 盘符路径、Linux 容器路径、硬件与内网指纹；
 *      检出即抛出 REDACTION_LEAK_ABORT 并清理暂存目录；
 *   2. 剔除所有 01_work 过渡态缓存，仅归档报告、独立单图与结构化摘要；
 *   3. 复用 tools/reporting/ed25519_tools.mjs 生成 CHECKSUMS.sha256 与 CHECKSUMS.sig，
 *      并写入带 Ed25519 签名的 receipt_v1.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deliverablesPath, assetPath } from '../paths.js';
import { writeChecksums, signDelivery, writeDeliveryPublicKey } from '../../../tools/reporting/ed25519_tools.mjs';

const TEXT_SCAN_EXT = new Set(['.html', '.htm', '.md', '.json', '.tsv', '.csv', '.txt', '.log', '.yaml', '.yml']);

const FORBIDDEN_LITERAL_TOKENS = [
  'Redmi K40', 'K40', 'k40', 'alioth',
  'Termux', 'termux', 'proot', 'PRoot', 'aarch64', 'dropbear',
  '/mnt/ssd', '/mnt/', '/root/', '/data/data', '/workspace/runs',
  '真机', '服务器', 'ops/', 'adb_exec', 'adb', 'ssh', 'bio-py', 'nice -n',
  '10022', '127.0.0.1',
];

const FORBIDDEN_REGEX_PATTERNS = [
  { name: 'WINDOWS_ABS_PATH', re: /[A-Za-z]:\\[^\s"'<>]+/ },
  { name: 'LINUX_PRIVATE_PATH', re: /\/(?:home|Users|mnt|root|data\/data)\/[^\s"'<>]+/ },
];

export function stripBase64DataUris(text) {
  return String(text || '').replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/g, 'DATA_URI_STRIPPED');
}

export function scanTextForRedactionLeaks(rawText, relPath = 'unknown') {
  const text = stripBase64DataUris(rawText);
  const findings = [];

  for (const token of FORBIDDEN_LITERAL_TOKENS) {
    // 对短词做边界校验或精确匹配，避免正常英文单词误伤（如 'ssh' / 'adb' 单独出现）
    if (/^[a-zA-Z0-9]+$/.test(token)) {
      const wordRe = new RegExp(`(?<![A-Za-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`);
      const m = wordRe.exec(text);
      if (m) {
        findings.push(`${relPath}: 命中敏感词 '${token}'`);
      }
    } else if (text.includes(token)) {
      findings.push(`${relPath}: 命中敏感标识 '${token}'`);
    }
  }

  for (const { name, re } of FORBIDDEN_REGEX_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      findings.push(`${relPath}: 命中敏感路径模式 ${name} ('${m[0].slice(0, 60)}')`);
    }
  }

  return findings;
}

/**
 * 递归扫描整个待打包目录（跳过 01_work 或非文本二进制文件）。
 */
export function scanDirectoryForRedactionLeaks(dirPath) {
  const allFindings = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dirPath, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!TEXT_SCAN_EXT.has(ext)) continue;
        const content = fs.readFileSync(full, 'utf8');
        allFindings.push(...scanTextForRedactionLeaks(content, rel));
      }
    }
  };
  walk(dirPath);
  if (allFindings.length > 0) {
    const err = new Error(`REDACTION_LEAK_ABORT: 检测到商业敏感或设施信息泄露 -> ${allFindings.join('；')}`);
    err.code = 'REDACTION_LEAK_ABORT';
    err.findings = allFindings;
    throw err;
  }
  return { ok: true, findings: [] };
}

/**
 * 打包纯净交付产物至 data/workspace/deliverables/<job_id>/ 并签发 Ed25519 防篡改回执。
 */
export function packageDeliverables({
  jobId,
  reportHtml,
  reportMarkdown,
  summaryFiles = [],
  figureFiles = [],
  deliverablesRoot = deliverablesPath(),
  privateKeyPath = process.env.BIO_ED25519_PRIVATE_KEY_PATH
    || assetPath('tools', 'ops', 'secrets', 'ed25519_private.pem'),
  publicKeyPath = process.env.BIO_ED25519_PUBLIC_KEY_PATH
    || assetPath('tools', 'ops', 'secrets', 'ed25519_public.pem'),
  actor = 'system',
  deliveryGrade = 'STANDARD_VERIFIED',
  adaptationTrace = [],
} = {}) {
  if (!jobId) throw new Error('jobId is required');
  fs.mkdirSync(deliverablesRoot, { recursive: true });

  const stagingDir = path.join(deliverablesRoot, `.staging_${jobId}_${crypto.randomBytes(4).toString('hex')}`);
  const targetDir = path.join(deliverablesRoot, jobId);

  try {
    fs.mkdirSync(stagingDir, { recursive: true });

    // 1. 写入脱敏报告
    if (reportHtml) {
      fs.writeFileSync(path.join(stagingDir, 'report.html'), reportHtml, 'utf8');
    }
    if (reportMarkdown) {
      fs.writeFileSync(path.join(stagingDir, 'report.md'), reportMarkdown, 'utf8');
    }

    // 2. 仅搬运纯净摘要表与独立图件（严禁搬运 01_work 过渡态缓存）
    const tablesDir = path.join(stagingDir, 'tables');
    const figuresDir = path.join(stagingDir, 'figures');

    for (const src of summaryFiles) {
      if (!src || !fs.existsSync(src)) continue;
      if (src.replace(/\\/g, '/').includes('/01_work/')) continue;
      fs.mkdirSync(tablesDir, { recursive: true });
      fs.copyFileSync(src, path.join(tablesDir, path.basename(src)));
    }

    for (const src of figureFiles) {
      if (!src || !fs.existsSync(src)) continue;
      if (src.replace(/\\/g, '/').includes('/01_work/')) continue;
      fs.mkdirSync(figuresDir, { recursive: true });
      fs.copyFileSync(src, path.join(figuresDir, path.basename(src)));
    }

    // 3. 写入脱敏后的 receipt_v1.json（只记对客户有意义的交付统计与签发时间，不含机器名/绝对路径）
    const receiptPayload = {
      schema: 'receipt_v1',
      job_id: jobId,
      delivered_at: new Date().toISOString(),
      actor,
      status: 'DELIVERED',
      redaction_verified: true,
      // 签名范围必须覆盖交付等级与适配溯源：降级件与标准件不能只靠文件内容区分。
      delivery_grade: String(deliveryGrade),
      adaptation_trace: Array.isArray(adaptationTrace) ? adaptationTrace : [],
    };
    const receiptBytes = Buffer.from(JSON.stringify(receiptPayload, null, 2), 'utf8');
    const privPem = fs.readFileSync(privateKeyPath, 'utf8');
    const receiptSig = crypto.sign(null, receiptBytes, privPem).toString('base64');
    const signedReceipt = {
      ...receiptPayload,
      ed25519_signature: receiptSig,
    };
    fs.writeFileSync(path.join(stagingDir, 'receipt_v1.json'), JSON.stringify(signedReceipt, null, 2), 'utf8');

    // 4. 全目录深度商业脱敏扫描（包括报告、摘要表与 receipt_v1.json）
    scanDirectoryForRedactionLeaks(stagingDir);

    // 5. 生成 CHECKSUMS.sha256 + Ed25519 签名 CHECKSUMS.sig + 公开验签公钥
    writeChecksums(stagingDir);
    signDelivery(stagingDir, { privateKeyPath });
    if (fs.existsSync(publicKeyPath)) {
      writeDeliveryPublicKey(stagingDir, { publicKeyPath });
    }

    // 6. 原子落盘至 deliverables/<job_id>/
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.renameSync(stagingDir, targetDir);

    return {
      ok: true,
      jobId,
      deliverableDir: targetDir,
      receiptPath: path.join(targetDir, 'receipt_v1.json'),
      checksumsPath: path.join(targetDir, 'CHECKSUMS.sha256'),
      sigPath: path.join(targetDir, 'CHECKSUMS.sig'),
    };
  } catch (err) {
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw err;
  }
}
