import { spawn } from 'child_process';

import type { BridgeEngine } from '../bridge-engine/interface';
import type {
  ComputeAdapter,
  ComputeAdapterResult,
  ComputeRequest,
} from './interface';
import { ComputeTimeoutError } from './implementation';

export interface MockComputeOptions {
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly delayMs?: number;
}

export class MockComputeAdapter implements ComputeAdapter {
  constructor(private readonly options: MockComputeOptions = {}) {}

  async run(_request: ComputeRequest, timeoutMs: number): Promise<ComputeAdapterResult> {
    const delayMs = Math.max(0, this.options.delayMs ?? 0);
    if (delayMs >= timeoutMs) {
      throw new ComputeTimeoutError(timeoutMs);
    }
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return {
      exitCode: this.options.exitCode ?? 0,
      stdout: this.options.stdout ?? 'MOCK_OK\n',
      stderr: this.options.stderr ?? '',
    };
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildDetachedK40Command(request: ComputeRequest): string {
  const environment = Object.entries(request.env ?? {})
    .filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    .map(([name, value]) => `${name}=${shellQuote(String(value))}`)
    .join(' ');
  const argv = request.argv.map(shellQuote).join(' ');
  const cwd = request.cwd ? `cd ${shellQuote(request.cwd)} && ` : '';
  const commandLine = `${cwd}${environment ? `${environment} ` : ''}${argv}`;
  return [
    'umask 077',
    'out_file=$(mktemp)',
    'err_file=$(mktemp)',
    `setsid nohup bash -lc ${shellQuote(commandLine)} >"$out_file" 2>"$err_file" </dev/null &`,
    'child_pid=$!',
    'wait "$child_pid"',
    'exit_code=$?',
    'cat "$out_file"',
    'cat "$err_file" >&2',
    'rm -f "$out_file" "$err_file"',
    'exit "$exit_code"',
  ].join('\n');
}

export class BridgeComputeAdapter implements ComputeAdapter {
  constructor(private readonly bridgeEngine: BridgeEngine) {}

  async run(request: ComputeRequest, timeoutMs: number): Promise<ComputeAdapterResult> {
    const result = await this.bridgeEngine.invokeRemote({
      command: buildDetachedK40Command(request),
      timeoutMs,
      env: request.env,
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

export class ChildProcessComputeAdapter implements ComputeAdapter {
  run(request: ComputeRequest, timeoutMs: number): Promise<ComputeAdapterResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(request.argv[0], request.argv.slice(1), {
        cwd: request.cwd,
        env: { ...process.env, ...(request.env ?? {}) },
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          if (child.pid && process.platform !== 'win32') {
            process.kill(-child.pid, 'SIGTERM');
          } else {
            child.kill('SIGTERM');
          }
        } catch {
          child.kill('SIGTERM');
        }
        reject(new ComputeTimeoutError(timeoutMs));
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (cause) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(cause);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
        });
      });
    });
  }
}
