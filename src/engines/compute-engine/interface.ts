import type { ExitCode } from '../../core/types';

export type ComputeMode = 'interactive' | 'batch';

export interface ComputeRequest {
  readonly taskId: string;
  readonly projectId?: string;
  readonly lineId: string;
  readonly step: string;
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly seed?: number;
  readonly mode?: ComputeMode;
  readonly workers?: number;
  readonly cleanupPaths?: readonly string[];
}

export interface ComputeAdapterResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ComputeOutcome extends ComputeAdapterResult {
  readonly exitCode: ExitCode;
  readonly taskId: string;
  readonly seed: number;
  readonly mode: ComputeMode;
  readonly workers: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export interface ComputeAdapter {
  run(request: ComputeRequest, timeoutMs: number): Promise<ComputeAdapterResult>;
}

export interface ComputeEngine {
  runTask(request: ComputeRequest): Promise<ComputeOutcome>;
}
