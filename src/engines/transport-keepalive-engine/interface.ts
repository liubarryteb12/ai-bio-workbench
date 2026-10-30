import type { ExitCode } from '../../core/types';

export interface TransportCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface TransportHttpProbeResult {
  readonly status: number;
  readonly rttMs: number;
}

export interface TransportCommandAdapter {
  runLocal(command: string, timeoutMs: number): Promise<TransportCommandResult>;
  runRemote(
    host: string,
    command: string,
    timeoutMs: number,
  ): Promise<TransportCommandResult>;
  probeHttp(url: string, timeoutMs: number): Promise<TransportHttpProbeResult>;
}

export interface TransportProbeRequest {
  readonly phoneHost: string;
  readonly sshHost: string;
  readonly ports?: readonly number[];
  readonly attempts?: number;
  readonly timeoutMs?: number;
  readonly noProxy?: string;
  readonly androidSerial?: string;
}

export interface TransportCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface TransportProbeOutcome {
  readonly ok: boolean;
  readonly exitCode: ExitCode;
  readonly checks: readonly TransportCheck[];
  readonly noProxy: string;
  readonly attempts: number;
  readonly averageRttMs: number | null;
  readonly stderr: string;
}

export interface TransportKeepaliveEngine {
  probe(request: TransportProbeRequest): Promise<TransportProbeOutcome>;
}
