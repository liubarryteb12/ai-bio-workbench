import * as path from 'path';

import type { DeliverableMod } from '../../core/DeliverableCollector';
import { DeliverableCollector } from '../../core/DeliverableCollector';
import type { SignedPacklet, SyncEngine } from '../../engines/sync-engine/interface';
import type { PortalSyncArtifact, PortalSyncManifestV1 } from './schema';

export interface PortalSyncExportRequest {
  readonly id: string;
  readonly mods: readonly DeliverableMod[];
  readonly privateKeyPem: string;
  readonly now?: Date;
}

export interface PortalSyncExportResult {
  readonly id: string;
  readonly manifest: PortalSyncManifestV1;
  readonly packlet: SignedPacklet;
}

const SHA256 = /^[0-9a-f]{64}$/;
export const DEFAULT_MAX_BUNDLE_AGE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface PortalSyncImportOptions {
  readonly now?: Date;
  readonly maxAgeMs?: number;
}

export interface PortalSyncSeam {
  exportSignedDeliverable(request: PortalSyncExportRequest): Promise<PortalSyncExportResult>;
  importVerifiedBundle(
    packlet: SignedPacklet,
    publicKeyPem: string,
    options?: PortalSyncImportOptions
  ): Promise<PortalSyncManifestV1>;
}

function relativeArtifact(root: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(absolutePath))
    .split(path.sep)
    .join('/');
  if (!relative || relative.startsWith('../') || relative.includes('/../')) {
    throw new Error(`ERR_PORTAL_SYNC_ARTIFACT_OUTSIDE_ROOT: ${absolutePath}`);
  }
  return relative;
}

function validateManifest(manifest: PortalSyncManifestV1): void {
  if (!manifest || manifest.schema_version !== '1.0' || !Array.isArray(manifest.artifacts)) {
    throw new Error('ERR_PORTAL_SYNC_MANIFEST_INVALID');
  }
  if (typeof manifest.generated_at !== 'string' || !manifest.generated_at) {
    throw new Error('ERR_PORTAL_SYNC_GENERATED_AT_INVALID');
  }
  for (const [index, artifact] of manifest.artifacts.entries()) {
    if (!artifact || !artifact.modId || !artifact.produces || !artifact.analysisStep) {
      throw new Error(`ERR_PORTAL_SYNC_ARTIFACT_METADATA_INVALID: ${index}`);
    }
    if (!artifact.relativePath || artifact.relativePath.startsWith('/')
      || artifact.relativePath.includes('..')) {
      throw new Error(`ERR_PORTAL_SYNC_ARTIFACT_PATH_INVALID: ${index}`);
    }
    if (!SHA256.test(artifact.sha256)) {
      throw new Error(`ERR_PORTAL_SYNC_ARTIFACT_SHA256_INVALID: ${index}`);
    }
    if (!Number.isInteger(artifact.sizeBytes) || artifact.sizeBytes < 0) {
      throw new Error(`ERR_PORTAL_SYNC_ARTIFACT_SIZE_INVALID: ${index}`);
    }
  }
}

function validateManifestFreshness(
  manifest: PortalSyncManifestV1,
  options: PortalSyncImportOptions
): void {
  const nowMs = (options.now ?? new Date()).getTime();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_BUNDLE_AGE_MS;
  if (!Number.isFinite(nowMs)) {
    throw new Error('ERR_PORTAL_SYNC_IMPORT_NOW_INVALID');
  }
  if (!Number.isInteger(maxAgeMs) || maxAgeMs <= 0) {
    throw new Error('ERR_PORTAL_SYNC_MAX_AGE_INVALID');
  }
  const generatedAtMs = Date.parse(manifest.generated_at);
  if (!Number.isFinite(generatedAtMs)) {
    throw new Error('ERR_PORTAL_SYNC_GENERATED_AT_INVALID');
  }
  if (generatedAtMs - nowMs > DEFAULT_MAX_CLOCK_SKEW_MS) {
    throw new Error('ERR_PORTAL_SYNC_BUNDLE_FROM_FUTURE');
  }
  if (nowMs - generatedAtMs > maxAgeMs) {
    throw new Error('ERR_PORTAL_SYNC_BUNDLE_STALE');
  }
}

export class PortalSyncAdapter implements PortalSyncSeam {
  constructor(
    private readonly collector: DeliverableCollector,
    private readonly syncEngine: SyncEngine
  ) {}

  async exportSignedDeliverable(request: PortalSyncExportRequest): Promise<PortalSyncExportResult> {
    if (!request.id?.trim()) {
      throw new Error('ERR_PORTAL_SYNC_ID_MISSING');
    }
    const verified = this.collector.collectVerified(request.mods);
    const artifacts: PortalSyncArtifact[] = verified.map((artifact) => ({
      modId: artifact.modId,
      relativePath: relativeArtifact(this.collector.dataRoot, artifact.filePath),
      sha256: artifact.actualSha256,
      sizeBytes: artifact.sizeBytes,
      produces: artifact.produces,
      analysisStep: artifact.analysis_step,
    }));
    const manifest: PortalSyncManifestV1 = {
      schema_version: '1.0',
      generated_at: (request.now ?? new Date()).toISOString(),
      artifacts,
    };
    validateManifest(manifest);
    const packlet = await this.syncEngine.packSigned(
      Buffer.from(JSON.stringify(manifest), 'utf8'),
      request.privateKeyPem
    );
    return Object.freeze({ id: request.id, manifest, packlet });
  }

  async importVerifiedBundle(
    packlet: SignedPacklet,
    publicKeyPem: string,
    options: PortalSyncImportOptions = {}
  ): Promise<PortalSyncManifestV1> {
    const data = await this.syncEngine.unpackVerified(packlet, publicKeyPem);
    let manifest: PortalSyncManifestV1;
    try {
      manifest = JSON.parse(data.toString('utf8')) as PortalSyncManifestV1;
    } catch {
      throw new Error('ERR_PORTAL_SYNC_MANIFEST_JSON_INVALID');
    }
    validateManifest(manifest);
    validateManifestFreshness(manifest, options);
    return Object.freeze({
      ...manifest,
      artifacts: Object.freeze(manifest.artifacts.map((artifact) => Object.freeze({ ...artifact }))),
    });
  }
}
