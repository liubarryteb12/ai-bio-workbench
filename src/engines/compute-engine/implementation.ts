import * as fs from 'fs';

import { PathGuard } from '../../core/PathGuard';
import type { ExitCode } from '../../core/types';
import type {
  ComputeAdapter,
  ComputeEngine,
  ComputeMode,
  ComputeOutcome,
  ComputeRequest,
} from './interface';

export class ComputeTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`ERR_COMPUTE_TIMEOUT: ${timeoutMs}ms`);
    this.name = 'ComputeTimeoutError';
  }
}

export interface ComputeTimeouts {
  readonly interactiveMs: number;
  readonly batchMs: number;
}

const DEFAULT_TIMEOUTS: ComputeTimeouts = {
  interactiveMs: 5 * 60 * 1000,
  batchMs: 40 * 60 * 1000,
};

const DEFAULT_WORKERS = 3;

interface ProjectRootGuard {
  assertWithinProjectRoot(targetPath: string, projectId: string): string;
}

function normalizeExitCode(value: number): ExitCode {
  if (value === 0 || value === 2 || value === 3) return value;
  return 1;
}

function parsePositiveWorkers(raw: string): number | undefined {
  const value = raw.trim();
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const workers = Number(value);
  return Number.isSafeInteger(workers) ? workers : undefined;
}

function resolveWorkers(request: ComputeRequest): { workers: number; error?: string } {
  const requestEnv = request.env ?? {};
  const hasRequestOverride = Object.prototype.hasOwnProperty.call(requestEnv, 'BIO_MAX_THREADS');
  const rawOverride: unknown = hasRequestOverride
    ? requestEnv.BIO_MAX_THREADS
    : process.env.BIO_MAX_THREADS;
  const workers = rawOverride === undefined && !hasRequestOverride
    ? DEFAULT_WORKERS
    : typeof rawOverride === 'string'
      ? parsePositiveWorkers(rawOverride)
      : undefined;
  if (workers === undefined) {
    return { workers: DEFAULT_WORKERS, error: 'ERR_COMPUTE_BIO_MAX_THREADS_INVALID' };
  }
  if (request.workers !== undefined) {
    if (!Number.isSafeInteger(request.workers) || request.workers <= 0) {
      return { workers, error: 'ERR_COMPUTE_WORKERS_INVALID' };
    }
    if (request.workers !== workers) {
      return { workers, error: 'ERR_COMPUTE_WORKERS_MISMATCH' };
    }
  }
  return { workers };
}

function resolveCleanupPaths(
  request: ComputeRequest,
  pathGuard: ProjectRootGuard,
): string[] | string {
  const targets = request.cleanupPaths;
  if (targets !== undefined && !Array.isArray(targets)) {
    return 'ERR_COMPUTE_CLEANUP_PATH_UNSAFE';
  }
  if (!targets || targets.length === 0) return [];
  if (typeof request.projectId !== 'string' || !request.projectId.trim()) {
    return 'ERR_COMPUTE_PROJECT_ID_MISSING';
  }
  if (targets.some((target) => typeof target !== 'string' || target.length === 0)) {
    return 'ERR_COMPUTE_CLEANUP_PATH_UNSAFE';
  }
  try {
    return targets.map((target) => pathGuard.assertWithinProjectRoot(target, request.projectId!));
  } catch {
    return 'ERR_COMPUTE_CLEANUP_PATH_UNSAFE';
  }
}

function cleanupPartialOutputs(
  request: ComputeRequest,
  pathGuard: ProjectRootGuard,
  validatedPaths: readonly string[],
): void {
  for (const target of validatedPaths) {
    if (!target) continue;
    try {
      const guardedTarget = pathGuard.assertWithinProjectRoot(target, request.projectId!);
      fs.rmSync(guardedTarget, { force: true, recursive: false });
    } catch {
      // Cleanup is best effort and never masks the primary execution outcome.
    }
  }
}

function outcome(
  request: ComputeRequest,
  mode: ComputeMode,
  startedAt: number,
  exitCode: ExitCode,
  stdout: string,
  stderr: string,
  timedOut = false,
  workers = DEFAULT_WORKERS
): ComputeOutcome {
  return Object.freeze({
    taskId: request.taskId,
    seed: Number(request.seed),
    mode,
    workers,
    durationMs: Math.max(0, Date.now() - startedAt),
    timedOut,
    exitCode,
    stdout,
    stderr,
  });
}

export class ComputeEngineImpl implements ComputeEngine {
  private readonly timeouts: ComputeTimeouts;

  constructor(
    private readonly adapter: ComputeAdapter,
    timeouts: Partial<ComputeTimeouts> = {},
    private readonly pathGuard: ProjectRootGuard = new PathGuard(),
  ) {
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
  }

  async runTask(request: ComputeRequest): Promise<ComputeOutcome> {
    const mode = request.mode ?? 'interactive';
    const startedAt = Date.now();
    if (!request.taskId?.trim() || !request.lineId?.trim() || !request.step?.trim()) {
      return outcome(request, mode, startedAt, 2, '', 'ERR_COMPUTE_IDENTIFIER_MISSING');
    }
    if (!Array.isArray(request.argv) || request.argv.length === 0
      || request.argv.some((part) => typeof part !== 'string' || part.length === 0)) {
      return outcome(request, mode, startedAt, 2, '', 'ERR_COMPUTE_ARGV_INVALID');
    }
    const cleanupPaths = resolveCleanupPaths(request, this.pathGuard);
    if (typeof cleanupPaths === 'string') {
      return outcome(request, mode, startedAt, 2, '', cleanupPaths);
    }
    const workerResolution = resolveWorkers(request);
    if (workerResolution.error) {
      return outcome(
        request,
        mode,
        startedAt,
        2,
        '',
        workerResolution.error,
        false,
        workerResolution.workers
      );
    }
    const workers = workerResolution.workers;
    if (request.seed === undefined || request.seed === null) {
      return outcome(request, mode, startedAt, 3, '', 'ERR_COMPUTE_SEED_MISSING');
    }
    if (!Number.isInteger(request.seed) || request.seed <= 0) {
      return outcome(request, mode, startedAt, 2, '', 'ERR_COMPUTE_SEED_INVALID');
    }

    const timeoutMs = mode === 'batch' ? this.timeouts.batchMs : this.timeouts.interactiveMs;
    const normalizedRequest: ComputeRequest = Object.freeze({
      ...request,
      workers,
      cleanupPaths,
      env: Object.freeze({
        ...(request.env ?? {}),
        BIO_MAX_THREADS: String(workers),
        OMP_NUM_THREADS: String(workers),
        OPENBLAS_NUM_THREADS: String(workers),
        MKL_NUM_THREADS: String(workers),
        NUMEXPR_NUM_THREADS: String(workers),
      }),
    });
    try {
      const result = await this.adapter.run(normalizedRequest, timeoutMs);
      const exitCode = normalizeExitCode(result.exitCode);
      if (exitCode !== 0) {
        cleanupPartialOutputs(normalizedRequest, this.pathGuard, cleanupPaths);
      }
      return outcome(
        request,
        mode,
        startedAt,
        exitCode,
        result.stdout,
        result.stderr,
        false,
        workers
      );
    } catch (cause) {
      cleanupPartialOutputs(normalizedRequest, this.pathGuard, cleanupPaths);
      if (cause instanceof ComputeTimeoutError) {
        return outcome(request, mode, startedAt, 1, '', cause.message, true, workers);
      }
      return outcome(
        request,
        mode,
        startedAt,
        1,
        '',
        cause instanceof Error ? cause.message : String(cause),
        false,
        workers
      );
    }
  }
}
