import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { LedgerStore } from './LedgerStore';
import { provideCapability, type ModManifest } from './types';

export type { ModManifest } from './types';

export interface ModLoaderOptions {
  readonly dataRoot?: string;
  readonly sourceRoot?: string;
  readonly ledgerRoot?: string;
}

export class ModLoader {
  constructor(
    readonly modRoots: string[],
    readonly options: ModLoaderOptions = {}
  ) {}

  /**
   * Validate manifests that have already been imported from manifest.ts.
   *
   * The runtime bootstrap uses this seam because Node cannot execute a directory
   * scan against TypeScript manifests without first importing the module. JSON
   * manifests remain supported by loadAll() for legacy modules and tests.
   */
  loadManifestObjects(manifests: readonly Partial<ModManifest>[]): ModManifest[] {
    if (!Array.isArray(manifests)) {
      throw new Error('ERR_MOD_MANIFEST_LIST_NOT_ARRAY');
    }
    return manifests.map((manifest, index) => {
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error(`ERR_MOD_MANIFEST_NOT_OBJECT: index=${index}`);
      }
      const source = `manifest.ts:${String(manifest.modId ?? index)}`;
      return this.verifyArtifacts(this.validateManifest(manifest, source));
    });
  }

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
        const manifest = this.validateManifest(raw, manifestPath);
        manifests.push(this.verifyArtifacts(manifest));
      }
    }
    return manifests;
  }

  private validateManifest(value: Partial<ModManifest>, source: string): ModManifest {
    const legacy = value as Partial<ModManifest> & {
      readonly id?: string;
      readonly name?: string;
    };
    const normalized = {
      ...value,
      modId: legacy.modId ?? legacy.id,
      displayName: legacy.displayName ?? legacy.name,
      state: legacy.state ?? 'ready',
      dbStores: legacy.dbStores ?? [],
      slots: legacy.slots ?? [],
      artifacts: legacy.artifacts ?? [],
      capabilitiesProvided: (legacy.capabilitiesProvided ?? []).map((capability) =>
        typeof capability === 'string' ? provideCapability(capability) : capability
      ),
      initialize: legacy.initialize ?? (async () => 0),
      teardown: legacy.teardown ?? (async () => 0),
    } as Partial<ModManifest>;
    const required = [
      'modId',
      'displayName',
      'version',
      'state',
      'stageOrder',
      'plane',
    ] as const;
    for (const key of required) {
      if (!normalized[key]) {
        throw new Error(`ERR_MOD_MANIFEST_MISSING_${key.toUpperCase()}: ${source}`);
      }
    }
    for (const key of [
      'dbStores',
      'enginesRequired',
      'configPaths',
      'verificationScripts',
      'capabilitiesProvided',
      'capabilitiesConsumed',
      'slots',
      'artifacts',
    ] as const) {
      if (!Array.isArray(normalized[key])) {
        throw new Error(`ERR_MOD_MANIFEST_FIELD_NOT_ARRAY: ${key} in ${source}`);
      }
    }
    if (typeof normalized.initialize !== 'function' || typeof normalized.teardown !== 'function') {
      throw new Error(`ERR_MOD_MANIFEST_LIFECYCLE_MISSING: ${source}`);
    }
    return normalized as ModManifest;
  }

  private verifyArtifacts(manifest: ModManifest): ModManifest {
    if (!this.options.dataRoot || !Array.isArray(manifest.artifacts)) {
      return manifest;
    }
    const dataRoot = path.resolve(this.options.dataRoot);
    const prefix = dataRoot.endsWith(path.sep) ? dataRoot : dataRoot + path.sep;
    const sourceRoot = this.options.sourceRoot
      ? path.resolve(this.options.sourceRoot)
      : undefined;
    const sourcePrefix = sourceRoot
      ? (sourceRoot.endsWith(path.sep) ? sourceRoot : sourceRoot + path.sep)
      : undefined;
    const valid = manifest.artifacts.every((artifact) => {
      const relative = artifact?.sample_project_output;
      if (!relative || relative.startsWith('/') || relative.includes('\0')) {
        return false;
      }
      const normalized = relative.split('\\').join('/');
      if (normalized.split('/').some((part: string) => part === '..')) {
        return false;
      }
      const candidate = path.resolve(dataRoot, relative);
      if (!candidate.startsWith(prefix)) {
        return false;
      }
      try {
        const stat = fs.statSync(candidate);
        if (!stat.isFile() || stat.size <= 0) {
          return false;
        }
        const actualSha256 = crypto
          .createHash('sha256')
          .update(fs.readFileSync(candidate))
          .digest('hex');
        if (actualSha256 !== artifact.preview_sha256) {
          return false;
        }
        if (!sourceRoot || !sourcePrefix) {
          return true;
        }
        const sourceRelative = artifact.lines?.[0]?.split(':')[0];
        if (!sourceRelative || sourceRelative.startsWith('/')
          || sourceRelative.includes('\0')) {
          return false;
        }
        const normalizedSource = sourceRelative.split('\\').join('/');
        if (normalizedSource.split('/').some((part: string) => part === '..')) {
          return false;
        }
        const sourcePath = path.resolve(sourceRoot, sourceRelative);
        if (!sourcePath.startsWith(sourcePrefix)) {
          return false;
        }
        const sourceStat = fs.statSync(sourcePath);
        if (!sourceStat.isFile() || sourceStat.size <= 0) {
          return false;
        }
        const sourceSha256 = crypto
          .createHash('sha256')
          .update(fs.readFileSync(sourcePath))
          .digest('hex');
        return sourceSha256 === artifact.source_sha256;
      } catch {
        return false;
      }
    });
    if (valid) {
      return manifest;
    }
    if (this.options.ledgerRoot) {
      new LedgerStore(this.options.ledgerRoot).appendRecord('errors', {
        timestamp: new Date().toISOString(),
        modId: manifest.modId,
        state: 'degraded',
        reason: 'ERR_MOD_ARTIFACT_DEGRADED',
      });
    }
    return Object.freeze({
      ...manifest,
      state: 'degraded',
    });
  }
}
