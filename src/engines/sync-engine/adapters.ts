import * as fs from 'fs';
import * as path from 'path';

import type { PackletStore, SignedPacklet } from './interface';

function assertStoreId(id: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id.includes('..') || id.startsWith('.')) {
    throw new Error(`ERR_SYNC_STORE_ID_INVALID: ${id}`);
  }
}

export class MemoryPackletStore implements PackletStore {
  private readonly store = new Map<string, SignedPacklet>();

  async write(id: string, packlet: SignedPacklet): Promise<void> {
    assertStoreId(id);
    this.store.set(id, Object.freeze(structuredClone(packlet)));
  }

  async read(id: string): Promise<SignedPacklet> {
    assertStoreId(id);
    const value = this.store.get(id);
    if (!value) throw new Error(`ERR_SYNC_PACKLET_NOT_FOUND: ${id}`);
    return structuredClone(value);
  }
}

export class FilePackletStore implements PackletStore {
  constructor(readonly rootDir: string) {}

  async write(id: string, packlet: SignedPacklet): Promise<void> {
    assertStoreId(id);
    fs.mkdirSync(this.rootDir, { recursive: true });
    const target = path.join(this.rootDir, `${id}.packlet.json`);
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(packlet)}\n`, 'utf8');
    fs.renameSync(temporary, target);
  }

  async read(id: string): Promise<SignedPacklet> {
    assertStoreId(id);
    const target = path.join(this.rootDir, `${id}.packlet.json`);
    if (!fs.existsSync(target)) {
      throw new Error(`ERR_SYNC_PACKLET_NOT_FOUND: ${id}`);
    }
    return JSON.parse(fs.readFileSync(target, 'utf8')) as SignedPacklet;
  }
}
