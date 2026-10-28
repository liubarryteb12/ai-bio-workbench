import * as fs from 'fs';
import * as path from 'path';

export type StageOrder = 'foundation' | 'supporting' | 'feature';
export type ModulePlane = 'pc-codex' | 'mobile-termux' | 'cross-plane';

export interface ModManifest {
  id: string;
  name: string;
  version: string;
  stageOrder: StageOrder;
  plane: ModulePlane;
  enginesRequired: string[];
  configPaths: string[];
  verificationScripts: string[];
  capabilitiesProvided: string[];
  capabilitiesConsumed: string[];
}

export class ModLoader {
  constructor(readonly modRoots: string[]) {}

  loadAll(): ModManifest[] {
    const manifests: ModManifest[] = [];
    for (const root of this.modRoots) {
      if (!fs.existsSync(root)) {
        continue;
      }
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        const manifestPath = path.join(root, entry.name, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
          continue;
        }
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<ModManifest>;
        manifests.push(this.validateManifest(raw, manifestPath));
      }
    }
    return manifests;
  }

  private validateManifest(value: Partial<ModManifest>, source: string): ModManifest {
    const required = ['id', 'name', 'version', 'stageOrder', 'plane'] as const;
    for (const key of required) {
      if (!value[key]) {
        throw new Error(`ERR_MOD_MANIFEST_MISSING_${key.toUpperCase()}: ${source}`);
      }
    }
    for (const key of [
      'enginesRequired',
      'configPaths',
      'verificationScripts',
      'capabilitiesProvided',
      'capabilitiesConsumed',
    ] as const) {
      if (!Array.isArray(value[key])) {
        throw new Error(`ERR_MOD_MANIFEST_FIELD_NOT_ARRAY: ${key} in ${source}`);
      }
    }
    return value as ModManifest;
  }
}
