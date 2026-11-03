/**
 * host key 指纹台账与比对（Argon 第十九轮 Q3 裁定）
 *
 * 为什么要有这个模块：
 *   hostkey 守卫（ops/k40/sv/<svc>/run 段3）在密钥丢失时会重新生成，等价于轮换 host key。
 *   轮换本身不报错，客户端 known_hosts 不更新则要么静默接受新身份（StrictHostKeyChecking=no），
 *   要么下次连不上（strict）。两条路都是「无提示的状态漂移」，必须显式可见。
 *
 * 为什么指纹台账不写进 docs/generated/SYSTEM_LEDGER.json：
 *   那份是 ledger_gen.mjs 的纯离线确定性产物，CI 在无真机环境跑 git diff 校验。
 *   硬件运行态（指纹、mtime、进程号）进它会污染 CI 判据。
 *   指纹属算力面环境锁家族，与 r_packages.csv、pip_freeze.txt 同级，落
 *   ops/k40/env_lock/hostkey_fingerprints.json。
 *
 * 判据口径：指纹失配不等于链路不可用（连接可能照常成功），所以只产出结构化诊断码，
 * 由调用方决定是告警还是阻断；link.js 把它降级为 warn 并原样带出 code。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSync } from './proc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 指纹台账路径（仓库内，随代码一起版本化） */
export const FINGERPRINT_LEDGER_PATH = path.resolve(
  HERE, '..', '..', 'ops', 'k40', 'env_lock', 'hostkey_fingerprints.json'
);

export const FINGERPRINT_SCHEMA = 'k40_hostkey_fingerprints/v1';

/** 结构化诊断码 */
export const ERR_HOSTKEY_ROTATED = 'ERR_HOSTKEY_ROTATED';
export const ERR_HOSTKEY_LEDGER_MISSING = 'ERR_HOSTKEY_LEDGER_MISSING';
export const ERR_HOSTKEY_LEDGER_INVALID = 'ERR_HOSTKEY_LEDGER_INVALID';
export const ERR_HOSTKEY_PROBE_UNREADABLE = 'ERR_HOSTKEY_PROBE_UNREADABLE';

/** ssh 公共选项：与 link.js 的四段探测同口径 */
export const SSH_BASE_ARGS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];

/** SHA256 指纹形态：base64 编码 32 字节，定长 43 字符（可能带一个 '=' 补齐） */
const FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]{43}=?$/;

/**
 * 从 ssh-keygen -lf 输出里取指纹。
 * 形态：256 SHA256:mKwIdn... u0_a283@localhost (ED25519)
 * 允许前后有噪声行（grep/PATH 告警），只认第一行匹配。
 * @returns {{bits: number|null, fingerprint: string, algorithm: string|null, comment: string}|null}
 */
export function parseFingerprintLine(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^(\d+)\s+(SHA256:[A-Za-z0-9+/=]+)\s*(.*)$/);
    if (!match) continue;
    const rest = match[3].trim();
    const algMatch = rest.match(/\(([A-Za-z0-9]+)\)$/);
    const bits = Number(match[1]);
    return {
      bits: Number.isFinite(bits) ? bits : null,
      fingerprint: match[2],
      algorithm: algMatch ? algMatch[1] : null,
      comment: rest.replace(/\s*\([A-Za-z0-9]+\)$/, '').trim(),
    };
  }
  return null;
}

/**
 * 解析台账 JSON（字符串或已 parse 的对象），做结构与字段校验。
 * 校验存在的理由：台账是环境锁的真源，一条空 fingerprint 会让所有比对都「失配」，
 * 一条缺 probe 的条目会让探测命令变成空串，两种错都该在启动时就判红而不是静默。
 * @returns {{ok: boolean, code: string|null, detail: string, entries: Array<object>}}
 */
export function parseFingerprintLedger(input) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (error) {
      return { ok: false, code: ERR_HOSTKEY_LEDGER_INVALID, detail: '台账不是合法 JSON: ' + error.message, entries: [] };
    }
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, code: ERR_HOSTKEY_LEDGER_INVALID, detail: '台账不是对象', entries: [] };
  }
  if (data.schema !== FINGERPRINT_SCHEMA) {
    return {
      ok: false, code: ERR_HOSTKEY_LEDGER_INVALID,
      detail: 'schema 应为 ' + FINGERPRINT_SCHEMA + '，实际 ' + JSON.stringify(data.schema ?? null),
      entries: [],
    };
  }
  if (!Array.isArray(data.hosts) || data.hosts.length === 0) {
    return { ok: false, code: ERR_HOSTKEY_LEDGER_INVALID, detail: 'hosts 必须是非空数组', entries: [] };
  }
  const entries = [];
  for (const raw of data.hosts) {
    const host = raw && typeof raw.host === 'string' ? raw.host.trim() : '';
    if (!host) {
      return { ok: false, code: ERR_HOSTKEY_LEDGER_INVALID, detail: 'hosts 里有条目缺 host', entries: [] };
    }
    const fingerprint = raw.fingerprint == null ? '' : String(raw.fingerprint).trim();
    if (!FINGERPRINT_RE.test(fingerprint)) {
      return {
        ok: false, code: ERR_HOSTKEY_LEDGER_INVALID,
        detail: host + ' 的 fingerprint 不是 SHA256 形态: ' + JSON.stringify(raw.fingerprint ?? null),
        entries: [],
      };
    }
    const probe = typeof raw.probe === 'string' ? raw.probe.trim() : '';
    if (!probe) {
      return { ok: false, code: ERR_HOSTKEY_LEDGER_INVALID, detail: host + ' 缺 probe 命令', entries: [] };
    }
    entries.push({
      host,
      role: typeof raw.role === 'string' ? raw.role : '',
      port: Number.isFinite(Number(raw.port)) ? Number(raw.port) : null,
      algorithm: raw.algorithm ? String(raw.algorithm) : null,
      bits: Number.isFinite(Number(raw.bits)) ? Number(raw.bits) : null,
      keyPath: raw.key_path ? String(raw.key_path) : '',
      probe,
      fingerprint,
    });
  }
  return { ok: true, code: null, detail: '', entries };
}

/** 读台账文件并解析；文件缺失是独立诊断码（首次部署、路径搬移都会命中） */
export function loadFingerprintLedger(ledgerPath = FINGERPRINT_LEDGER_PATH) {
  let text;
  try {
    text = fs.readFileSync(ledgerPath, 'utf8');
  } catch (error) {
    return {
      ok: false, code: ERR_HOSTKEY_LEDGER_MISSING,
      detail: '读不到指纹台账 ' + ledgerPath + ': ' + error.message, entries: [],
    };
  }
  return parseFingerprintLedger(text);
}

/**
 * 比对期望与实际指纹。
 * 不平滑任何差异：大小写、空白都先规范化，但 base64 主体逐字符比，避免「看起来一样」。
 * @returns {{ok: boolean, code: string|null, detail: string}}
 */
export function compareFingerprint(expected, observed) {
  const want = String(expected ?? '').trim();
  const got = String(observed ?? '').trim();
  if (!got) {
    return { ok: false, code: ERR_HOSTKEY_PROBE_UNREADABLE, detail: '探测没有取到指纹' };
  }
  if (want === got) return { ok: true, code: null, detail: '' };
  return {
    ok: false,
    code: ERR_HOSTKEY_ROTATED,
    detail: '期望 ' + want + '，实际 ' + got +
      '；host key 已轮换（多为 hostkey 守卫重新生成），需同步客户端 known_hosts 与 ops/k40/env_lock/hostkey_fingerprints.json',
  };
}

/**
 * 逐台探针取指纹并与台账比对。
 * run 可注入：真机上跑 ssh，测试里换成立即返回的桩，不需要设备在线。
 * @param {{run?: Function, ledger?: {ok: boolean, code: string|null, detail: string, entries: Array<object>}}} options
 * @returns {{pass: boolean, code: string|null, detail: string, entries: Array<object>}}
 */
export function checkHostKeys(options = {}) {
  const run = options.run ?? runSync;
  const ledger = options.ledger ?? loadFingerprintLedger();
  if (!ledger.ok) {
    return { pass: false, code: ledger.code, detail: ledger.detail, entries: [] };
  }

  const entries = ledger.entries.map((entry) => {
    let output = '';
    try {
      const result = run(['ssh', ...SSH_BASE_ARGS, entry.host, entry.probe], { timeoutMs: 30000 });
      output = String(result.stdout ?? '') + '\n' + String(result.stderr ?? '');
    } catch (error) {
      return {
        host: entry.host, port: entry.port, expected: entry.fingerprint, observed: null,
        ok: false, code: ERR_HOSTKEY_PROBE_UNREADABLE, detail: '探测命令执行失败: ' + error.message,
      };
    }
    const parsed = parseFingerprintLine(output);
    if (!parsed) {
      return {
        host: entry.host, port: entry.port, expected: entry.fingerprint, observed: null,
        ok: false, code: ERR_HOSTKEY_PROBE_UNREADABLE, detail: '输出里没有 SHA256 指纹',
      };
    }
    const compared = compareFingerprint(entry.fingerprint, parsed.fingerprint);
    return {
      host: entry.host, port: entry.port, expected: entry.fingerprint, observed: parsed.fingerprint,
      algorithm: parsed.algorithm, ok: compared.ok, code: compared.code, detail: compared.detail,
    };
  });

  // 优先级：轮换 > 探测不可读（轮换是根因候选，探测失败多半是它的后果）
  const rotated = entries.filter((entry) => entry.code === ERR_HOSTKEY_ROTATED);
  const unreadable = entries.filter((entry) => entry.code === ERR_HOSTKEY_PROBE_UNREADABLE);
  if (rotated.length > 0) {
    return { pass: false, code: ERR_HOSTKEY_ROTATED, detail: rotated.map((e) => e.host + ': ' + e.detail).join(' ; '), entries };
  }
  if (unreadable.length > 0) {
    return { pass: false, code: ERR_HOSTKEY_PROBE_UNREADABLE, detail: unreadable.map((e) => e.host + ': ' + e.detail).join(' ; '), entries };
  }
  return { pass: true, code: null, detail: '', entries };
}
