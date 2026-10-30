import type { ExitCode } from '../../core/types';

export interface AlphaLedgerEntry {
  readonly entryId: string;
  readonly logicalDate: string;
  readonly categoryCode: string;
  readonly memoText: string;
  readonly debitCents: number;
  readonly creditCents: number;
}

export interface AllocationBucketInput {
  readonly bucketId: string;
  readonly weightBps: number;
}

export interface ConsumptionSummaryReport {
  readonly batchId: string;
  readonly logicalDate: string;
  readonly totalVolumeCents: number;
  readonly allocations: Readonly<Record<string, number>>;
}

export interface AlphaReconcileResult {
  readonly exitCode: ExitCode;
  readonly report?: ConsumptionSummaryReport;
  readonly error?: string;
}
