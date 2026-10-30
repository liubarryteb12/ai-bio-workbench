import * as crypto from 'crypto';
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
    this.appendRecord(category, record);
  }

  appendRecord(category: LedgerCategory, record: Record<string, unknown>): void {
    if (!isLedgerCategory(category)) {
      throw new Error(`ERR_LEDGER_INVALID_CATEGORY: ${category}`);
    }
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      throw new Error('ERR_LEDGER_RECORD_NOT_OBJECT');
    }
    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.appendFileSync(this.ledgerPath(category), JSON.stringify(record) + '\n', 'utf8');
    this.syncIndex();
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

  readIndex(): Record<string, unknown> {
    const indexPath = path.join(this.rootDir, 'INDEX.json');
    if (!fs.existsSync(indexPath)) {
      this.syncIndex();
    }
    return JSON.parse(fs.readFileSync(indexPath, 'utf8')) as Record<string, unknown>;
  }

  private syncIndex(): void {
    fs.mkdirSync(this.rootDir, { recursive: true });
    const streams: Record<string, unknown> = {};
    for (const category of LEDGER_CATEGORIES) {
      const file = this.ledgerPath(category);
      const bytes = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
      streams[category] = {
        path: `${category}.jsonl`,
        lineCount: bytes.length === 0
          ? 0
          : bytes.toString('utf8').split('\n').filter((line) => line.length > 0).length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      };
    }
    const index = {
      updatedAt: new Date().toISOString(),
      streams,
    };
    const target = path.join(this.rootDir, 'INDEX.json');
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, target);
  }
}
