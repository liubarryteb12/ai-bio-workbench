import * as crypto from 'crypto';
import * as fs from 'fs';

import type { ExitCode } from '../../core/types';
import type {
  BridgeAdapter,
  BridgeCommand,
  BridgeEngine,
  BridgePayload,
} from './interface';

export const REQUIRED_PHANTOM_MAX = 2147483647;
export const DEFAULT_BRIDGE_TIMEOUT_MS = 5 * 60 * 1000;

const FORBIDDEN_COMMAND_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?:^|[;&|]\s*)find(?:\s|$)/m, 'ERR_BRIDGE_FIND_FORBIDDEN'],
  [/(?:^|[;&|]\s*)ps(?:\s|$)/m, 'ERR_BRIDGE_PS_FORBIDDEN'],
  [/grep\s+-[A-Za-z]*r[A-Za-z]*\b/m, 'ERR_BRIDGE_GREP_R_FORBIDDEN'],
  [/\bqemu(?:-system)?\b/i, 'ERR_BRIDGE_QEMU_FORBIDDEN'],
  [/\/(?:sdcard|storage\/emulated|storage\/self\/primary)(?:\/|$)/m, 'ERR_BRIDGE_FUSE_PATH_FORBIDDEN'],
];

export class BridgeTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`ERR_BRIDGE_TIMEOUT: ${timeoutMs}ms`);
    this.name = 'BridgeTimeoutError';
  }
}

export function assertSafeCommand(command: string): void {
  for (const [pattern, code] of FORBIDDEN_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`${code}: ${command.slice(0, 160)}`);
    }
  }
}

export function formatFloat17(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`ERR_BRIDGE_FLOAT_NOT_FINITE: ${value}`);
  }
  return value.toPrecision(17);
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function assertSameHash(sourcePath: string, binPath: string): void {
  const sourceHash = sha256File(sourcePath);
  const binHash = sha256File(binPath);
  if (sourceHash !== binHash) {
    throw new Error(
      `ERR_BRIDGE_HASH_MISMATCH: ${sourcePath}=${sourceHash} ${binPath}=${binHash}`
    );
  }
}

function normalizeExitCode(value: number): ExitCode {
  if (value === 0 || value === 2 || value === 3) return value;
  return 1;
}

export interface BridgeEngineOptions {
  readonly phantomMaxProcesses?: number;
  readonly defaultTimeoutMs?: number;
}

export class BridgeEngineImpl implements BridgeEngine {
  private readonly phantomMaxProcesses?: number;
  private readonly defaultTimeoutMs: number;

  constructor(
    private readonly adapter: BridgeAdapter,
    options: BridgeEngineOptions = {}
  ) {
    this.phantomMaxProcesses = options.phantomMaxProcesses;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_BRIDGE_TIMEOUT_MS;
  }

  async invokeRemote(command: BridgeCommand): Promise<BridgePayload> {
    const startedAt = Date.now();
    if (!command?.command?.trim()) {
      return this.payload(startedAt, 2, '', 'ERR_BRIDGE_COMMAND_MISSING');
    }
    if (this.phantomMaxProcesses === undefined) {
      return this.payload(startedAt, 2, '', 'ERR_BRIDGE_LIMIT_UNKNOWN');
    }
    if (this.phantomMaxProcesses !== REQUIRED_PHANTOM_MAX) {
      return this.payload(
        startedAt,
        2,
        '',
        `ERR_BRIDGE_PHANTOM_LIMIT: expected=${REQUIRED_PHANTOM_MAX} actual=${this.phantomMaxProcesses}`
      );
    }
    try {
      assertSafeCommand(command.command);
    } catch (cause) {
      return this.payload(
        startedAt,
        2,
        '',
        cause instanceof Error ? cause.message : String(cause)
      );
    }

    const timeoutMs = command.timeoutMs ?? this.defaultTimeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return this.payload(startedAt, 2, '', 'ERR_BRIDGE_TIMEOUT_INVALID');
    }
    try {
      const result = await this.adapter.invoke(command, timeoutMs);
      return this.payload(
        startedAt,
        normalizeExitCode(result.exitCode),
        result.stdout,
        result.stderr
      );
    } catch (cause) {
      if (cause instanceof BridgeTimeoutError) {
        return {
          ...this.payload(startedAt, 1, '', cause.message),
          timedOut: true,
        };
      }
      return this.payload(
        startedAt,
        1,
        '',
        cause instanceof Error ? cause.message : String(cause)
      );
    }
  }

  private payload(
    startedAt: number,
    exitCode: ExitCode,
    stdout: string,
    stderr: string,
    timedOut = false
  ): BridgePayload {
    return Object.freeze({
      exitCode,
      durationMs: Math.max(0, Date.now() - startedAt),
      timedOut,
      stdout,
      stderr,
    });
  }
}
