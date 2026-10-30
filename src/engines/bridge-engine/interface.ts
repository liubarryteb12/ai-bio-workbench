import type { ExitCode } from '../../core/types';

export interface BridgeCommand {
  readonly command: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface BridgeAdapterResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface BridgePayload extends BridgeAdapterResult {
  readonly exitCode: ExitCode;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export interface BridgeAdapter {
  invoke(command: BridgeCommand, timeoutMs: number): Promise<BridgeAdapterResult>;
}

export interface BridgeEngine {
  invokeRemote(command: BridgeCommand): Promise<BridgePayload>;
}
