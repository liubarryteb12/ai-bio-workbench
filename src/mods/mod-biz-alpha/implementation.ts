import * as fs from 'fs';
import * as path from 'path';

import type {
  AllocationBucketInput,
  AlphaLedgerEntry,
  AlphaReconcileResult,
  ConsumptionSummaryReport,
} from './schema';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BATCH_ID = /^[A-Za-z0-9._-]+$/;

function validCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function invalid(message: string): AlphaReconcileResult {
  return { exitCode: 2, error: message };
}

export class BizAlphaAdapter {
  private readonly summaries = new Map<string, ConsumptionSummaryReport>();

  constructor(private readonly outputRoot?: string) {}

  async reconcileAndAllocate(
    batchId: string,
    logicalDate: string,
    entries: readonly AlphaLedgerEntry[],
    buckets: readonly AllocationBucketInput[]
  ): Promise<AlphaReconcileResult> {
    if (!batchId || !BATCH_ID.test(batchId) || batchId.includes('..')) {
      return invalid('ERR_ALPHA_BATCH_ID_INVALID');
    }
    if (!DATE.test(logicalDate) || Number.isNaN(Date.parse(`${logicalDate}T00:00:00Z`))) {
      return invalid('ERR_ALPHA_DATE_INVALID');
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return invalid('ERR_ALPHA_ENTRIES_EMPTY');
    }
    if (!Array.isArray(buckets) || buckets.length === 0) {
      return invalid('ERR_ALPHA_BUCKETS_EMPTY');
    }

    const bucketIds = new Set<string>();
    let weightSum = 0;
    for (const bucket of buckets) {
      if (!bucket?.bucketId || bucketIds.has(bucket.bucketId)) {
        return invalid('ERR_ALPHA_BUCKET_ID_INVALID');
      }
      if (!Number.isSafeInteger(bucket.weightBps) || bucket.weightBps < 0 || bucket.weightBps > 10000) {
        return invalid('ERR_ALPHA_WEIGHT_INVALID');
      }
      bucketIds.add(bucket.bucketId);
      weightSum += bucket.weightBps;
    }
    if (weightSum !== 10000) {
      return invalid('ERR_ALPHA_WEIGHT_SUM_NOT_10000');
    }

    let debit = 0n;
    let credit = 0n;
    const entryIds = new Set<string>();
    for (const entry of entries) {
      if (!entry?.entryId || entryIds.has(entry.entryId)) {
        return invalid('ERR_ALPHA_ENTRY_ID_INVALID');
      }
      if (!entry.categoryCode || !entry.memoText) {
        return invalid('ERR_ALPHA_ENTRY_METADATA_INVALID');
      }
      if (!DATE.test(entry.logicalDate) || Number.isNaN(Date.parse(`${entry.logicalDate}T00:00:00Z`))) {
        return invalid('ERR_ALPHA_ENTRY_DATE_INVALID');
      }
      if (!validCents(entry.debitCents) || !validCents(entry.creditCents)) {
        return invalid('ERR_ALPHA_CENTS_INVALID');
      }
      entryIds.add(entry.entryId);
      debit += BigInt(entry.debitCents);
      credit += BigInt(entry.creditCents);
    }
    if (debit > BigInt(Number.MAX_SAFE_INTEGER) || credit > BigInt(Number.MAX_SAFE_INTEGER)) {
      return invalid('ERR_ALPHA_TOTAL_UNSAFE_INTEGER');
    }
    if (debit !== credit) {
      return { exitCode: 1, error: 'ERR_ALPHA_DEBIT_CREDIT_IMBALANCE' };
    }

    const totalCents = Number(debit);
    const parts = buckets.map((bucket, index) => {
      const numerator = BigInt(totalCents) * BigInt(bucket.weightBps);
      return {
        bucketId: bucket.bucketId,
        index,
        allocation: Number(numerator / 10000n),
        remainder: Number(numerator % 10000n),
      };
    });
    const allocated = parts.reduce((sum, part) => sum + part.allocation, 0);
    const delta = totalCents - allocated;
    if (delta < 0 || delta >= parts.length) {
      return { exitCode: 1, error: 'ERR_ALPHA_ALLOCATION_DELTA_INVALID' };
    }
    const ranked = [...parts].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let index = 0; index < delta; index += 1) {
      ranked[index].allocation += 1;
    }
    const allocations: Record<string, number> = {};
    for (const part of parts) {
      allocations[part.bucketId] = part.allocation;
    }
    const allocationSum = Object.values(allocations).reduce((sum, value) => sum + value, 0);
    if (allocationSum !== totalCents) {
      return { exitCode: 1, error: 'ERR_ALPHA_ALLOCATION_SUM_MISMATCH' };
    }

    const report: ConsumptionSummaryReport = Object.freeze({
      batchId,
      logicalDate,
      totalVolumeCents: totalCents,
      allocations: Object.freeze({ ...allocations }),
    });
    this.summaries.set(batchId, report);
    this.writeReport(report);
    return Object.freeze({ exitCode: 0, report });
  }

  getConsumptionSummary(batchId: string): ConsumptionSummaryReport {
    const report = this.summaries.get(batchId);
    if (!report) throw new Error(`ERR_ALPHA_SUMMARY_NOT_FOUND: ${batchId}`);
    return report;
  }

  private writeReport(report: ConsumptionSummaryReport): void {
    if (!this.outputRoot) return;
    const directory = path.join(this.outputRoot, 'alpha-reports');
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, `reconciled-${report.batchId}.json`);
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, target);
  }
}
