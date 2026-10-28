import * as fs from 'fs';
import * as path from 'path';

export type LedgerCategory = 'actions' | 'changes' | 'errors' | 'fixes' | 'pitfalls';

export const LEDGER_CATEGORIES: readonly LedgerCategory[] = [
  'actions',
  'changes',
  'errors',
  'fixes',
  'pitfalls',
];

export function isLedgerCategory(value: string): value is LedgerCategory {
  return (LEDGER_CATEGORIES as readonly string[]).includes(value);
}

export class LedgerStore {
  constructor(readonly rootDir: string) {}

  ledgerPath(category: LedgerCategory): string {
    return path.join(this.rootDir, `${category}.jsonl`);
  }

  append(category: LedgerCategory, record: Record<string, unknown>): void {
    if (!isLedgerCategory(category)) {
      throw new Error(`ERR_LEDGER_INVALID_CATEGORY: ${category}`);
    }
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      throw new Error('ERR_LEDGER_RECORD_NOT_OBJECT');
    }
    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.appendFileSync(this.ledgerPath(category), JSON.stringify(record) + '\n', 'utf8');
  }

  read(category: LedgerCategory): Array<Record<string, unknown>> {
    const file = this.ledgerPath(category);
    if (!fs.existsSync(file)) {
      return [];
    }
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  }
}
