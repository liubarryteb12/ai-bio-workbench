#!/usr/bin/env node
/**
 * 工具链定位器（本机环境差异的唯一收口点）。
 *
 * 存在的理由：本项目长期靠「调用者自己把 node / ssh / git 放进 PATH」来跑，
 * 于是同一份代码在不同机器、不同会话里时快时红：
 *   - System32 的 ssh.exe 在这台机器上恒 255（缺 Git 的密钥代理）；
 *   - node 装在 D:\node-v2.4，不在默认 PATH；
 *   - 忘了设 PATH 就跑，链路测试成片假红，看起来像代码坏了。
 * 这些都是**机器差异**，不是代码缺陷。把差异收进一个解析器，别散在每条命令里。
 *
 * 解析层级（靠前者优先，全部可查）：
 *   1. 环境变量 BIO_TOOL_<NAME>        显式指定，最高优先（CI / 临时调试）
 *   2. 本地覆盖表 ops/toolchain.json   每台机器自己的路径（gitignored，不入库）
 *   3. 自动探测候选                    常见安装位置（Node/nvm、Git for Windows、Android SDK）
 *   4. 系统 PATH                       最后兜底
 *
 * 设计取舍：机器特有绝对路径**不进 git**（否则换台机器就是错的真源）；
 * 进 git 的只有「探测规则」与一份 example 模板。
 *
 * 纯 node:fs 探测，不起子进程 —— 这样它自己不会被进程单接缝门禁判红。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');
export const LOCAL_OVERRIDE_PATH = path.join(HERE, 'toolchain.json');
/** 随仓库自带的工具目录：项目自包含的基础运行环境（Node + MSYS 工具与 DLL）。 */
export const VENDOR_TOOLS_DIR = path.join(REPO_ROOT, 'vendor', 'tools');

/** vendor 目录里是否有这个工具（自包含优先级的判据）。 */
export function vendorToolPath(name) {
  const candidate = path.join(VENDOR_TOOLS_DIR, name + '.exe');
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * 每个工具的探测规则。order 决定报告顺序（必需项在前）。
 * candidates 里的 {env} 在探测时替换成对应环境变量值。
 */
export const TOOL_SPECS = Object.freeze({
  node: {
    required: true, label: 'Node.js（>= 22）', exts: [''],
    candidates: [
      '{BIO_NODE_HOME}/node.exe', 'D:/node-v2.4/node.exe', 'C:/Program Files/nodejs/node.exe',
      '{LOCALAPPDATA}/nvm/current/node.exe', '{USERPROFILE}/scoop/apps/nodejs/current/node.exe',
    ],
  },
  ssh: {
    required: true, label: 'ssh 客户端', exts: [''],
    // Git for Windows 的 OpenSSH 优先：System32 版本在本机缺密钥代理，恒 255。
    candidates: [
      'D:/Git/usr/bin/ssh.exe', 'C:/Program Files/Git/usr/bin/ssh.exe',
      '{SystemRoot}/System32/OpenSSH/ssh.exe',
    ],
  },
  scp: {
    required: true, label: 'scp 客户端', exts: [''],
    candidates: ['D:/Git/usr/bin/scp.exe', 'C:/Program Files/Git/usr/bin/scp.exe'],
  },
  git: {
    required: false, label: 'git（台账与判据校验用）', exts: ['.exe'],
    // Git 的 cmd 版才带正确 PATH 包装；usr/bin/git 在子进程里常找不到 sh。
    candidates: ['D:/Git/cmd/git.exe', 'C:/Program Files/Git/cmd/git.exe'],
  },
  tar: {
    required: false, label: '系统 tar（可选，解包已由 Node 接管）', exts: [''],
    candidates: ['D:/Git/usr/bin/tar.exe', '{SystemRoot}/System32/tar.exe'],
  },
  sha256sum: {
    required: false, label: 'sha256sum（客户侧验签用，可选）', exts: [''],
    candidates: ['D:/Git/usr/bin/sha256sum.exe', 'D:/Git/mingw64/bin/sha256sum.exe'],
  },
  openssl: {
    required: false, label: 'openssl（客户侧验签用，可选）', exts: [''],
    candidates: ['D:/Git/usr/bin/openssl.exe', 'D:/Git/mingw64/bin/openssl.exe'],
  },
  adb: {
    required: false, label: 'adb（零 SSH 心跳与恢复通道）', exts: ['.exe'],
    candidates: [
      '{LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe',
      '{USERPROFILE}/AppData/Local/Android/Sdk/platform-tools/adb.exe',
      'C:/adb/platform-tools/adb.exe',
    ],
  },
  pwsh: {
    required: false, label: 'PowerShell（ps1 门禁与运维脚本用）', exts: ['.exe'],
    // 优先 pwsh 7；这台机器只有 Windows PowerShell 5.1，退回它（ps1 已按 5.1 兼容写）。
    candidates: [
      'C:/Program Files/PowerShell/7/pwsh.exe',
      '{ProgramFiles}/PowerShell/7/pwsh.exe',
      '{SystemRoot}/System32/WindowsPowerShell/v1.0/powershell.exe',
    ],
  },
  python: {
    required: false, label: 'Python 3（本地造包与自检）', exts: ['.exe', ''],
    candidates: [
      '{LOCALAPPDATA}/Python/bin/python.exe',
      '{LOCALAPPDATA}/Programs/Python/Python313/python.exe',
      '{LOCALAPPDATA}/Programs/Python/Python312/python.exe',
      'C:/Python313/python.exe',
    ],
  },
});

function expand(token, env) {
  return String(token).replace(/\{([A-Za-z_][\w]*)\}/g, (match, name) => {
    const value = env[name];
    return value === undefined || value === null ? '' : String(value);
  });
}

function isFile(target) {
  try { return fs.statSync(target).isFile(); } catch { return false; }
}

/** 读本地覆盖表；不存在或损坏都返回空对象（不能让配置错拖垮整条链路）。 */
export function readLocalOverride(file = LOCAL_OVERRIDE_PATH) {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 解析单个工具。返回 { name, found, path, source, tried }。
 * source 取值 env | local | candidate | path —— 让人一眼看出「它在哪一层找到的」。
 */
export function resolveTool(name, { env = process.env, override = readLocalOverride() } = {}) {
  const spec = TOOL_SPECS[name];
  if (!spec) throw new Error('未知工具：' + name);
  const tried = [];

  // 0) 随仓库自带的工具（自包含优先）：项目自己带的版本先于任何外部安装，
  //    这样「用什么版本」由仓库决定，而不是由这台机器装了什么决定。
  const vendored = vendorToolPath(name);
  if (vendored) {
    tried.push({ source: 'vendor', path: vendored, ok: true });
    // 环境变量仍可覆盖（CI 或临时替换），但默认走 vendor。
    const envOverride = env['BIO_TOOL_' + name.toUpperCase()];
    if (!envOverride) return { name, found: true, path: vendored, source: 'vendor', tried };
  }

  // 1) 环境变量显式指定
  const envKey = 'BIO_TOOL_' + name.toUpperCase();
  const fromEnv = env[envKey];
  if (fromEnv) {
    tried.push({ source: 'env', path: fromEnv, ok: isFile(fromEnv) });
    if (isFile(fromEnv)) return { name, found: true, path: fromEnv, source: 'env', tried };
  }

  // 2) 本地覆盖表（每台机器自己的路径）
  const localValue = Array.isArray(override[name]) ? override[name] : (override[name] ? [override[name]] : []);
  for (const candidate of localValue) {
    const full = expand(candidate, env);
    tried.push({ source: 'local', path: full, ok: isFile(full) });
    if (isFile(full)) return { name, found: true, path: full, source: 'local', tried };
  }

  // 3) 自动探测候选
  for (const candidate of spec.candidates || []) {
    const full = expand(candidate, env);
    if (!full) continue;
    tried.push({ source: 'candidate', path: full, ok: isFile(full) });
    if (isFile(full)) return { name, found: true, path: full, source: 'candidate', tried };
  }

  // 4) 系统 PATH 兜底
  const pathDirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const exts = Array.from(new Set(['', ...(spec.exts || [''])]));
  for (const dir of pathDirs) {
    for (const ext of exts) {
      const full = path.join(dir, name + ext);
      if (isFile(full)) {
        tried.push({ source: 'path', path: full, ok: true });
        return { name, found: true, path: full, source: 'path', tried };
      }
    }
  }
  return { name, found: false, path: null, source: null, tried };
}

/** 解析全部工具，返回 { ok, missingRequired, tools, pathDirs }。 */
export function resolveToolchain({ env = process.env, override = readLocalOverride() } = {}) {
  const tools = {};
  const dirs = new Set();
  for (const name of Object.keys(TOOL_SPECS)) {
    const result = resolveTool(name, { env, override });
    tools[name] = result;
    if (result.found) dirs.add(path.dirname(result.path));
  }
  const missingRequired = Object.keys(TOOL_SPECS)
    .filter((name) => TOOL_SPECS[name].required && !tools[name].found);
  return { ok: missingRequired.length === 0, tools, missingRequired, pathDirs: [...dirs] };
}

/**
 * 构建带工具链前缀的 env。所有离线脚本都应经由它拿环境，
 * 这样「怎么调用」只有一份答案。
 * PATH 顺序：工具链目录在前，客户自己的 PATH 保留在后（不破坏其它命令）。
 */
/**
 * 构建带工具链邀的 env。
 *
 * 关键取舍（实测教训）：**只把 node 的目录放到 PATH 首位**。
 * MSYS 版 ssh/scp 虽然能跑，但它不读 Windows 的 ~/.ssh/config、且把 ~ 展开成
 * POSIX 家目录（`/home/<user>` 而非 `C:/Users/<user>`），需要显式 -F/-i 才可用。
 * 在没准备好这些参数时把它顶到 PATH 首位，会让所有链路测试命中它而整片假红
 * （实测：52 条 not ok）。所以 ssh/scp 的目录排在后面，优先用系统安装的那份。
 */
export function toolchainEnv({ base = process.env, extra = {} } = {}) {
  const chain = resolveToolchain({ env: base });
  const basePath = String(base.PATH || base.Path || '');
  const nodeDir = (chain.tools.node && chain.tools.node.found)
    ? path.dirname(chain.tools.node.path) : null;
  const otherDirs = chain.pathDirs.filter((d) => d !== nodeDir);
  const allDirs = (nodeDir ? [nodeDir, ...otherDirs] : otherDirs);
  const prefix = allDirs.join(path.delimiter);
  const merged = prefix ? (basePath ? prefix + path.delimiter + basePath : prefix) : basePath;
  const systemRoot = base.SystemRoot || base.windir || 'C:\\Windows';
  return {
    ...base,
    ...extra,
    PATH: merged,
    Path: merged,
    SystemRoot: systemRoot,
    windir: base.windir || systemRoot,
  };
}

/**
 * SSH 身份（用户级外部状态，**不随仓库走**）。
 *
 * 为什么不能 vendor：`~/.ssh/config` 里的 k40 / k40-ubuntu 别名与 id_ed25519 私钥
 * 属于「这台机器这个人」的凭据，复制进仓库等于把访问权写进版本历史。
 * 工具链能自带二进制，但身份必须由环境提供——这条边界要在报告里说清楚，
 * 而不是让测试莫名其妙地红。
 */
export function resolveSshIdentity({ env = process.env } = {}) {
  const home = env.HOME || env.USERPROFILE || "";
  const sshDir = home ? path.join(home, ".ssh") : null;
  const configPath = sshDir ? path.join(sshDir, "config") : null;
  const configExists = !!configPath && fs.existsSync(configPath);
  let hasAliases = false;
  let aliases = [];
  if (configExists) {
    try {
      const text = fs.readFileSync(configPath, "utf8");
      aliases = text.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^Host\s+/i.test(line))
        .flatMap((line) => line.replace(/^Host\s+/i, "").split(/\s+/))
        .filter(Boolean);
      hasAliases = aliases.length > 0;
    } catch { /* 读不到就当缺失 */ }
  }
  return { home, sshDir, configPath, configExists, hasAliases, aliases };
}

/**
 * MSYS 版 ssh 的额外参数（本机实测的坑，见下面的推导）。
 *
 * 问题：vendor 来的 ssh.exe 是 MSYS2 编译版，它把配置里的 `~/.ssh/...` 展开成
 * **POSIX 家目录** `/home/<user>`，而 Windows 上真实位置是 `C:/Users/<user>`。
 * 于是 IdentityFile 指向一个不存在的路径，认证失败报 Permission denied。
 * 同时它也不读 Windows 用户目录下的 .ssh/config（去找 /etc/ssh/ssh_config）。
 *
 * 解法：显式给 -F（配置文件绝对 Windows 路径）与 -i（私钥绝对 Windows 路径）。
 * 这两个参数必须由工具链统一注入，不能让每个调用点各写一遍。
 *
 * 返回 { sshArgs, configPath, identityFile, isMsys } —— 调用方拼命令行时前置即可。
 */
export function resolveSshArgs({ env = process.env } = {}) {
  const identity = resolveSshIdentity({ env });
  const result = { sshArgs: [], configPath: null, identityFile: null, isMsys: false };
  if (!identity.configExists) return result;
  result.isMsys = true;
  // -F 用正斜杠路径：MSYS 认 Windows 盘符写法
  result.configPath = identity.configPath.split(path.sep).join("/");
  result.sshArgs.push("-F", result.configPath);
  // 从配置里取 IdentityFile，补成绝对路径（这一步是关键：绕开 ~ 展开错误）
  try {
    const text = fs.readFileSync(identity.configPath, "utf8");
    const match = /^\s*IdentityFile\s+(\S+)/im.exec(text);
    if (match) {
      const raw = match[1];
      const resolved = raw.startsWith("~/")
        ? path.join(identity.home, raw.slice(2))
        : (raw.startsWith("/") ? raw : path.join(identity.home, ".ssh", raw));
      if (fs.existsSync(resolved)) {
        result.identityFile = resolved.split(path.sep).join("/");
        result.sshArgs.push("-i", result.identityFile);
      }
    }
  } catch { /* 配置读不到就不加 -i，让 ssh 自己报 */ }
  return result;
}

export function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  const chain = resolveToolchain();
  if (argv.includes('--json')) {
    io.log(JSON.stringify({
      ok: chain.ok,
      missing_required: chain.missingRequired,
      tools: Object.fromEntries(Object.entries(chain.tools).map(([name, result]) => [name, {
        found: result.found, path: result.path, source: result.source,
        label: TOOL_SPECS[name].label, required: TOOL_SPECS[name].required,
      }])),
      path_prefix: chain.pathDirs,
    }, null, 2));
    return chain.ok ? 0 : 1;
  }
  io.log('工具链解析（层级：vendor 自带 > env > 本地覆盖表 > 自动探测 > PATH）');
  for (const name of Object.keys(TOOL_SPECS)) {
    const spec = TOOL_SPECS[name];
    const result = chain.tools[name];
    const mark = result.found ? '[ OK ]' : (spec.required ? '[MISS]' : '[WARN]');
    const where = result.found ? '(' + result.source + ') ' + result.path : '未找到';
    io.log(mark + ' ' + spec.label + ' :: ' + where);
  }
  if (!chain.ok) {
    io.error('TOOLCHAIN_FAILED 缺必需项：' + chain.missingRequired.join(', '));
    io.error('  修法：设 BIO_TOOL_<NAME> 环境变量，或在 ops/toolchain.json 写本地路径');
    io.error('  模板见 ops/toolchain.example.json');
    return 1;
  }
  const identity = resolveSshIdentity();
  io.log('');
  io.log('SSH 身份（用户级外部状态，不随仓库走）：');
  if (identity.configExists && identity.hasAliases) {
    io.log('[ OK ] ' + identity.configPath + ' :: 别名 ' + identity.aliases.join(', '));
  } else {
    io.log('[WARN] 未找到可用的 ~/.ssh/config（当前 HOME=' + (identity.home || '<空>') + '）');
    io.log('       → 依赖 k40 / k40-ubuntu 别名的用例会跳过或失败，这是预期：');
    io.log('         二进制随仓库走，身份必须由环境提供（凭据不进版本库）。');
  }
  io.log('TOOLCHAIN_OK ' + chain.pathDirs.length + ' 个目录已并入 PATH 前缀');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
