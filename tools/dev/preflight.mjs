#!/usr/bin/env node
/**
 * 陌生宿主机依赖预检（Ticket 3，4 Argon 第二十一轮 Q5 第一批【立即做】）。
 *
 * 存在的理由：交付验证与打包链路在「我们的机器」上永远绿的，第一次换到客户/同事机器
 * 才暴露缺 node、缺 adb、缺 ssh 客户端。那些失败逐条出现、每条都像另一个 bug。
 * 这份预检把它们收成一次「开工前自检」：列出必需项、各自现状、缺了怎么装。
 *
 * 判据分两级，刻意不做成同一档：
 *   REQUIRED  缺失即 exit 1（没有它根本无法跑验收/打包）
 *   OPTIONAL  缺失只 warn（少了它功能退化，但核心链路仍可走）
 *
 * 关于 tar：解包已由 tools/reporting/delivery_acceptance_core.mjs 用 Node 内置 zlib 接管，
 * 但打包引擎（build_client_report.py）仍用 Python 标准库 tarfile，不需要系统 tar。
 * 所以系统 tar 归 OPTIONAL，写清「谁在用它」比笼统要求更有用。
 *
 * 用法：
 *   node tools/dev/preflight.mjs                  # 人读
 *   node tools/dev/preflight.mjs --json           # 机器读
 *   node tools/dev/preflight.mjs --path <dir>     # 注入假 PATH 测红路径（测试与演练用）
 * 退出码：必需项齐备 0，否则 1；--json 时 code/report 都在 stdout。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpQuota } from './clean_workspace.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

/** 节点最低版本：交付链路用到 Array.fromAsync 与 fs.cpSync，22 是稳妥下限。 */
export const MIN_NODE_MAJOR = 22;

/** 待检项清单。probe 返回 { found, detail }，install 是给人看的补齐指引。 */
export const CHECKS = Object.freeze([
  {
    id: 'node',
    required: true,
    label: 'Node.js >= ' + MIN_NODE_MAJOR,
    install: 'https://nodejs.org/ 或 nvm install 22',
  },
  {
    id: 'ssh',
    required: true,
    label: 'ssh 客户端（连 K40 用）',
    install: 'Windows: 安装 Git for Windows 后把 D:\\Git\\usr\\bin 加进 PATH；Linux/macOS 自带 openssh-client',
  },
  {
    id: 'scp',
    required: true,
    label: 'scp 客户端（回搬交付件用）',
    install: '与 ssh 同源（Git for Windows / openssh-client）；缺 scp 时交付件无法回搬',
  },
  {
    id: 'adb',
    required: false,
    label: 'adb（零 SSH 心跳与恢复通道用）',
    install: 'Android SDK platform-tools；缺失时仅影响 adb 旁路，不影响 ssh 主路径',
  },
  {
    id: 'tar',
    required: false,
    label: '系统 tar（可选；解包已由 Node 内置 zlib 接管）',
    install: 'Windows 10+ 自带 bsdtar；缺失不影响验收，打包用 Python tarfile',
  },
  {
    id: 'python',
    required: false,
    label: 'Python 3（本地造包/自检用；K40 侧另有容器解释器）',
    install: 'https://www.python.org/downloads/ ；缺失时 build_client_report.py 的自检跳过',
  },
]);

/** 从 PATH 目录里找可执行文件（不 spawn，避免把「没装」和「装了但跑不动」混成一团）。 */
export function findExecutable(name, { pathValue, pathext } = {}) {
  const exts = (pathext || process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean);
  // 显式传入的 pathValue 优先（哪怕是空串：空 PATH 是要能测出来的真实故障形态）
  const dirs = String(pathValue !== undefined ? pathValue : (process.env.PATH || ''))
    .split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of ['', ...exts]) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* 继续找下一个 */ }
    }
  }
  return null;
}

export function nodeVersionOk(versionText = process.versions.node) {
  const major = Number(String(versionText).split('.')[0]);
  return { ok: major >= MIN_NODE_MAJOR, major, required: MIN_NODE_MAJOR };
}

/**
 * 跑一次预检。注入 pathValue/pathext/versionText 便于测试红路径（不改造真实机器）。
 * 返回 { ok, checks:[{id,label,required,found,detail}], missingRequired, warnings }。
 */
export function runPreflight({ pathValue, pathext, versionText } = {}) {
  const checks = [];
  const nodeInfo = nodeVersionOk(versionText);
  checks.push({
    id: 'node', required: true, label: CHECKS[0].label,
    found: nodeInfo.ok,
    detail: 'detected v' + nodeInfo.major + '（要求 >= ' + nodeInfo.required + '）',
    install: CHECKS[0].install,
  });
  for (const spec of CHECKS.slice(1)) {
    const found = findExecutable(spec.id, { pathValue, pathext });
    checks.push({
      id: spec.id, required: spec.required, label: spec.label,
      found: found !== null,
      detail: found || '未在 PATH 找到',
      install: spec.install,
    });
  }
  const missingRequired = checks.filter((c) => c.required && !c.found).map((c) => c.id);
  const warnings = checks.filter((c) => !c.required && !c.found).map((c) => c.id);
  return { ok: missingRequired.length === 0, checks, missingRequired, warnings };
}

function renderHuman(report) {
  const lines = [];
  lines.push('宿主机依赖预检（Node ' + process.versions.node + '，仓库 ' + path.basename(REPO_ROOT) + '）');
  for (const check of report.checks) {
    const tag = check.found ? '[ OK ]' : (check.required ? '[MISS]' : '[WARN]');
    lines.push(tag + ' ' + check.label + ' :: ' + check.detail);
    if (!check.found) lines.push('       → ' + check.install);
  }
  // Q4 配额提示：附在预检报告末尾，超限时给出可执行的清理命令。
  // 刻意不算进 report.ok：.tmp 文件多不是「依赖缺失」，而是维护提示，
  // 判红会让每次开发都因缓存未清而卡住门禁，与预检的职责不符。
  const quota = tmpQuota({ root: REPO_ROOT });
  if (quota.over) {
    lines.push('[WARN] .tmp/ 有 ' + quota.count + ' 个文件，超过配额 ' + quota.quota
      + '（陈年夹具会拖慢全仓扫描）。清理：node tools/dev/clean_workspace.mjs --execute');
  } else {
    lines.push('[ OK ] .tmp/ 文件数 ' + quota.count + ' <= 配额 ' + quota.quota);
  }
  if (report.ok) {
    lines.push('PREFLIGHT_OK 必需项齐备' + (report.warnings.length ? '（可选缺失：' + report.warnings.join(', ') + '）' : ''));
  } else {
    lines.push('PREFLIGHT_FAILED 缺必需项：' + report.missingRequired.join(', '));
  }
  return lines.join('\n');
}

export function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const report = runPreflight({ pathValue: value('--path') });
  if (argv.includes('--json')) {
    io.log(JSON.stringify({ ok: report.ok, missingRequired: report.missingRequired, warnings: report.warnings, checks: report.checks, tmpQuota: tmpQuota({ root: REPO_ROOT }) }, null, 2));
  } else {
    io.log(renderHuman(report));
  }
  return report.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
