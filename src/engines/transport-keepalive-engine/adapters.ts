import { spawn } from 'child_process';

import type {
  TransportCommandAdapter,
  TransportCommandResult,
  TransportHttpProbeResult,
} from './interface';

export interface MockTransportOptions {
  readonly local?: (
    command: string,
    timeoutMs: number,
  ) => Promise<TransportCommandResult> | TransportCommandResult;
  readonly remote?: (
    host: string,
    command: string,
    timeoutMs: number,
  ) => Promise<TransportCommandResult> | TransportCommandResult;
  readonly http?: (
    url: string,
    timeoutMs: number,
  ) => Promise<TransportHttpProbeResult> | TransportHttpProbeResult;
}

export class MockTransportCommandAdapter implements TransportCommandAdapter {
  constructor(private readonly options: MockTransportOptions = {}) {}

  async runLocal(command: string, timeoutMs: number): Promise<TransportCommandResult> {
    return this.options.local?.(command, timeoutMs)
      ?? { exitCode: 0, stdout: '', stderr: '' };
  }

  async runRemote(
    host: string,
    command: string,
    timeoutMs: number,
  ): Promise<TransportCommandResult> {
    return this.options.remote?.(host, command, timeoutMs)
      ?? { exitCode: 0, stdout: '', stderr: '' };
  }

  async probeHttp(url: string, timeoutMs: number): Promise<TransportHttpProbeResult> {
    return this.options.http?.(url, timeoutMs) ?? { status: 200, rttMs: 0 };
  }
}

function runProcess(
  command: string,
  args: readonly string[],
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TransportCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`ERR_TRANSPORT_TIMEOUT: ${timeoutMs}ms`));
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
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export interface ChildProcessTransportOptions {
  readonly sshCommand?: string;
  readonly bashCommand?: string;
  readonly powershellCommand?: string;
  readonly connectTimeoutSec?: number;
}

export interface LocalInvocation {
  readonly command: string;
  readonly args: readonly string[];
}

function localCommandForPlatform(command: string, platform: NodeJS.Platform): string {
  if (platform === 'win32' && command === 'tailscale --version') {
    return "$cmd = Get-Command tailscale -ErrorAction SilentlyContinue; "
      + "if ($null -eq $cmd) { exit 1 }; & $cmd.Source --version";
  }
  return command;
}

export function buildLocalInvocation(
  command: string,
  platform: NodeJS.Platform = process.platform,
  options: Pick<ChildProcessTransportOptions, 'bashCommand' | 'powershellCommand'> = {},
): LocalInvocation {
  if (platform === 'win32') {
    return {
      command: options.powershellCommand ?? 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        localCommandForPlatform(command, platform),
      ],
    };
  }
  return {
    command: options.bashCommand ?? 'bash',
    args: ['-lc', command],
  };
}

export class ChildProcessTransportCommandAdapter implements TransportCommandAdapter {
  private readonly sshCommand: string;
  private readonly bashCommand: string;
  private readonly powershellCommand: string;
  private readonly connectTimeoutSec: number;

  constructor(options: ChildProcessTransportOptions = {}) {
    this.sshCommand = options.sshCommand ?? 'ssh';
    this.bashCommand = options.bashCommand ?? 'bash';
    this.powershellCommand = options.powershellCommand ?? 'powershell.exe';
    this.connectTimeoutSec = options.connectTimeoutSec ?? 15;
  }

  runLocal(command: string, timeoutMs: number): Promise<TransportCommandResult> {
    const invocation = buildLocalInvocation(command, process.platform, {
      bashCommand: this.bashCommand,
      powershellCommand: this.powershellCommand,
    });
    return runProcess(invocation.command, invocation.args, timeoutMs, {
      ...process.env,
      NO_PROXY: process.env.NO_PROXY || '127.0.0.1,localhost,100.64.0.0/10',
      no_proxy: process.env.no_proxy || '127.0.0.1,localhost,100.64.0.0/10',
    });
  }

  runRemote(
    host: string,
    command: string,
    timeoutMs: number,
  ): Promise<TransportCommandResult> {
    return runProcess(
      this.sshCommand,
      [
        '-o', 'BatchMode=yes',
        '-o', `ConnectTimeout=${this.connectTimeoutSec}`,
        host,
        command,
      ],
      timeoutMs,
      {
        ...process.env,
        NO_PROXY: process.env.NO_PROXY || '127.0.0.1,localhost,100.64.0.0/10',
        no_proxy: process.env.no_proxy || '127.0.0.1,localhost,100.64.0.0/10',
      },
    );
  }

  async probeHttp(url: string, timeoutMs: number): Promise<TransportHttpProbeResult> {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      });
      await response.body?.cancel();
      return {
        status: response.status,
        rttMs: Math.round((performance.now() - startedAt) * 10) / 10,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`ERR_TRANSPORT_HTTP: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
