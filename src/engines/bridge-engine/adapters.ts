import { spawn } from 'child_process';

import type {
  BridgeAdapter,
  BridgeAdapterResult,
  BridgeCommand,
} from './interface';
import { BridgeTimeoutError } from './implementation';

export interface MockBridgeOptions {
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly delayMs?: number;
}

export class MockBridgeAdapter implements BridgeAdapter {
  constructor(private readonly options: MockBridgeOptions = {}) {}

  async invoke(_command: BridgeCommand, timeoutMs: number): Promise<BridgeAdapterResult> {
    const delayMs = Math.max(0, this.options.delayMs ?? 0);
    if (delayMs >= timeoutMs) {
      throw new BridgeTimeoutError(timeoutMs);
    }
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return {
      exitCode: this.options.exitCode ?? 0,
      stdout: this.options.stdout ?? 'BRIDGE_MOCK_OK\n',
      stderr: this.options.stderr ?? '',
    };
  }
}

export interface K40SshBridgeOptions {
  readonly host?: string;
  readonly sshCommand?: string;
  readonly connectTimeoutSec?: number;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export class K40SshBridgeAdapter implements BridgeAdapter {
  private readonly host: string;
  private readonly sshCommand: string;
  private readonly connectTimeoutSec: number;

  constructor(options: K40SshBridgeOptions = {}) {
    this.host = options.host ?? 'k40';
    this.sshCommand = options.sshCommand ?? 'ssh';
    this.connectTimeoutSec = options.connectTimeoutSec ?? 15;
  }

  invoke(command: BridgeCommand, timeoutMs: number): Promise<BridgeAdapterResult> {
    const environment = {
      ...(command.env ?? {}),
      NO_PROXY: 'localhost,127.0.0.1,k40,k40.local',
      no_proxy: 'localhost,127.0.0.1,k40,k40.local',
    };
    const envPrefix = Object.entries(environment)
      .filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
      .map(([name, value]) => `${name}=${shellQuote(String(value))}`)
      .join(' ');
    const cwdPrefix = command.cwd ? `cd ${shellQuote(command.cwd)} && ` : '';
    const remoteCommand = `${cwdPrefix}${envPrefix ? `${envPrefix} ` : ''}bash -lc ${shellQuote(command.command)}`;
    const args = [
      '-o', 'BatchMode=yes',
      '-o', `ConnectTimeout=${this.connectTimeoutSec}`,
      '-o', 'ServerAliveInterval=15',
      this.host,
      remoteCommand,
    ];
    return new Promise((resolve, reject) => {
      const child = spawn(this.sshCommand, args, {
        env: {
          ...process.env,
          NO_PROXY: 'localhost,127.0.0.1,k40,k40.local',
          no_proxy: 'localhost,127.0.0.1,k40,k40.local',
        },
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(new BridgeTimeoutError(timeoutMs));
      }, timeoutMs);
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
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
}

export class ChildProcessBridgeAdapter implements BridgeAdapter {
  invoke(command: BridgeCommand, timeoutMs: number): Promise<BridgeAdapterResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command.command, {
        cwd: command.cwd,
        env: { ...process.env, ...(command.env ?? {}) },
        shell: true,
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
        reject(new BridgeTimeoutError(timeoutMs));
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
}
