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
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(HERE, '..', '..');

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
    return {
      allowed: false,
      status: 'ERROR',
      errors: [{ path: '', message: `未找到校验网关: ${gatewayPy}`, type: 'gateway_missing' }],
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
      childProcess.execFileSync('python', args, {
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
