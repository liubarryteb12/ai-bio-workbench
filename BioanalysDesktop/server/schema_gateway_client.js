/**
 * schema_gateway_client.js —— 进程外文件 IPC Schema 校验网关客户端（4 Argon 第 74 轮 Q1/Q6 终审裁定）
 *
 * 特性：
 * 1. 严格基于独立临时目录交换 req.json 与 res.json，杜绝 stdio 管道高频死锁；
 * 2. 映射三态退出码：0=ALLOW, 2=DENY, 1=ERROR (Fail-Closed)；
 * 3. 任何非 0 退出码一律默认阻断请求（除非显式开启旁路且非 CI 环境）。
 */
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ASSET_ROOT } from './paths.js';
import { validateWithFallback } from './schema_gateway_fallback.mjs';

const DEFAULT_REPO_ROOT = ASSET_ROOT;

let fallbackWarned = false;
let pythonProbe = null;

/**
 * 解析 Python 解释器。
 *
 * BIO_PYTHON_PATH 显式指定优先；其次在 PATH 里找 python.exe / python3.exe。
 * 找不到时返回空串，由调用方决定 Fail-Closed 或走 JS 回退。
 */
export function resolvePythonExec() {
  const explicit = process.env.BIO_PYTHON_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const names = process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python'];
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return '';
}

/**
 * 探测解释器能否真正 import pydantic。
 *
 * 干净 Windows 上可能存在 Microsoft Store 的 python 别名或没有装 pydantic 的
 * Python。此时直接调用网关只会 Fail-Closed，桌面运行面应改用同口径 JS 回退。
 */
function pythonCanRunGateway(pythonExec) {
  if (pythonProbe !== null) return pythonProbe;
  try {
    childProcess.execFileSync(pythonExec, ['-c', 'import pydantic'], {
      timeout: 8000,
      stdio: 'ignore',
      windowsHide: true,
    });
    pythonProbe = true;
  } catch {
    pythonProbe = false;
  }
  return pythonProbe;
}

function gatewayMissing(repoRoot) {
  return {
    allowed: false,
    status: 'ERROR',
    errors: [{ path: '', message: `未找到校验网关: ${path.join(repoRoot, 'schemas', 'schema_gateway.py')}`, type: 'gateway_missing' }],
    exitCode: 1,
  };
}

/**
 * 调用 schemas/schema_gateway.py 进行 Schema 强校验。
 *
 * @param {string} schemaName 注册的 Schema 名称 (project / requirement / run_task)
 * @param {object} payload 待校验的数据
 * @param {{ repoRoot?: string, allowBypassOnError?: boolean, shadowMode?: boolean }} options
 * @returns {{ allowed: boolean, status: 'ALLOW'|'DENY'|'ERROR', errors: Array<{path: string, message: string, type: string}>, exitCode: number }}
 */
export function validateWithSchemaGateway(schemaName, payload, options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const gatewayPy = path.join(repoRoot, 'schemas', 'schema_gateway.py');

  if (!fs.existsSync(gatewayPy)) {
    return gatewayMissing(repoRoot);
  }

  // 干净 Windows 默认没有 Python。桌面运行面显式开启回退时，用同口径 JS 实现
  // 保持核心流程可用；未开启时维持 Fail-Closed，不允许静默绕过。
  const pythonExec = resolvePythonExec();
  const pythonReady = Boolean(pythonExec) && pythonCanRunGateway(pythonExec);
  if (!pythonReady) {
    if (process.env.BIO_ALLOW_SCHEMA_GATEWAY_FALLBACK === '1') {
      if (!fallbackWarned) {
        fallbackWarned = true;
        console.warn('[schema_gateway] 未找到可用 Python/pydantic，使用内置 JS 回退校验（BIO_ALLOW_SCHEMA_GATEWAY_FALLBACK=1）。');
      }
      return { ...validateWithFallback(schemaName, payload), fallback: true };
    }
    return {
      allowed: false,
      status: 'ERROR',
      errors: [{ path: '', message: '未找到可用 Python 解释器或缺少 pydantic，Schema 网关无法执行（设置 BIO_PYTHON_PATH 或安装 Python + pydantic）', type: 'python_missing' }],
      exitCode: 1,
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `gateway-${process.pid}-${Math.random().toString(36).slice(2, 8)}-`));
  const reqFile = path.join(tmpDir, 'req.json');
  const resFile = path.join(tmpDir, 'res.json');

  try {
    fs.writeFileSync(reqFile, JSON.stringify(payload ?? {}), 'utf8');
    const args = ['schemas/schema_gateway.py', '--schema', schemaName, '--in', reqFile, '--out', resFile];
    if (options.allowBypassOnError) {
      args.push('--allow-bypass-on-error');
    }

    let exitCode = 0;
    let stderr = '';
    try {
      childProcess.execFileSync(pythonExec, args, {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 15000,
      });
    } catch (procErr) {
      exitCode = procErr.status ?? 1;
      stderr = procErr.stderr || '';
    }

    let resData = null;
    if (fs.existsSync(resFile)) {
      try {
        resData = JSON.parse(fs.readFileSync(resFile, 'utf8'));
      } catch {}
    }

    const status = resData?.status || (exitCode === 0 ? 'ALLOW' : (exitCode === 2 ? 'DENY' : 'ERROR'));
    const errors = resData?.errors || [];

    // 影子模式仅记录日志，不阻断；正式模式下仅 0 放行
    const allowed = exitCode === 0;

    return {
      allowed,
      status,
      errors,
      exitCode,
      stderr,
    };
  } catch (err) {
    return {
      allowed: false,
      status: 'ERROR',
      errors: [{ path: '', message: `网关调用异常: ${err.message}`, type: 'spawn_error' }],
      exitCode: 1,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {}
  }
}
