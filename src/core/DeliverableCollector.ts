import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { ArtifactQuadruple, ReadinessState } from './types';

export type ModState = ReadinessState;
export type { ArtifactQuadruple } from './types';

export interface DeliverableMod {
  readonly modId: string;
  readonly state: ModState;
  readonly artifacts: readonly ArtifactQuadruple[];
}

export interface VerifiedArtifact extends ArtifactQuadruple {
  readonly modId: string;
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly actualSha256: string;
}

export interface DeliverableCollectorOptions {
  readonly sourceRoot?: string;
}

const SHA256 = /^[0-9a-f]{64}$/;
const FORBIDDEN_PREFIXES = ['/sdcard', '/storage/emulated', '/storage/self/primary'];

function normalizeRelative(value: string, code: string): string {
  if (!value || value.startsWith('/') || value.startsWith('\\') || value.includes('\0')) {
    throw new Error(`${code}: ${value}`);
  }
  const normalized = value.split('\\').join('/');
  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error(`${code}: ${value}`);
  }
  return normalized;
}

function assertSha256(value: string, code: string): void {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`${code}: ${value}`);
  }
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

function resolveInsideRoot(root: string, relativePath: string, code: string): string {
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, relativePath);
  const prefix = absoluteRoot.endsWith(path.sep) ? absoluteRoot : absoluteRoot + path.sep;
  if (!candidate.startsWith(prefix)) {
    throw new Error(`${code}: ${relativePath}`);
  }
  const posix = candidate.split(path.sep).join('/');
  if (FORBIDDEN_PREFIXES.some((forbidden) => posix === forbidden || posix.startsWith(`${forbidden}/`))) {
    throw new Error(`${code}: ${relativePath}`);
  }
  return candidate;
}

export class DeliverableCollector {
  constructor(
    readonly dataRoot: string,
    readonly options: DeliverableCollectorOptions = {}
  ) {}

  collectVerified(mods: readonly DeliverableMod[]): readonly VerifiedArtifact[] {
    if (!Array.isArray(mods)) {
      throw new Error('ERR_DELIVERABLE_MODS_NOT_ARRAY');
    }
    const verified: VerifiedArtifact[] = [];
    for (const mod of mods) {
      if (!mod || mod.state !== 'ready') {
        continue;
      }
      if (!Array.isArray(mod.artifacts)) {
        throw new Error(`ERR_MOD_ARTIFACTS_NOT_ARRAY: ${mod.modId}`);
      }
      for (const artifact of mod.artifacts) {
        verified.push(this.verifyArtifact(mod.modId, artifact));
      }
    }
    return Object.freeze(verified);
  }

  private verifyArtifact(modId: string, artifact: ArtifactQuadruple): VerifiedArtifact {
    if (!artifact || !Array.isArray(artifact.lines) || artifact.lines.length === 0) {
      throw new Error(`ERR_ARTIFACT_LINES_MISSING: ${modId}`);
    }
    if (!artifact.analysis_step || !artifact.produces) {
      throw new Error(`ERR_ARTIFACT_STEP_OR_PRODUCES_MISSING: ${modId}`);
    }
    assertSha256(artifact.source_sha256, 'ERR_ARTIFACT_SOURCE_SHA256_MALFORMED');
    assertSha256(artifact.preview_sha256, 'ERR_ARTIFACT_PREVIEW_SHA256_MALFORMED');

    const relativeOutput = normalizeRelative(
      artifact.sample_project_output,
      'ERR_ARTIFACT_OUTPUT_PATH_UNSAFE'
    );
    const relativeGlob = normalizeRelative(
      artifact.output_glob,
      'ERR_ARTIFACT_GLOB_UNSAFE'
    );
    if (!globToRegExp(relativeGlob).test(relativeOutput)) {
      throw new Error(`ERR_ARTIFACT_GLOB_MISMATCH: ${relativeOutput} !~ ${relativeGlob}`);
    }

    const filePath = resolveInsideRoot(
      this.dataRoot,
      relativeOutput,
      'ERR_ARTIFACT_PATH_OUTSIDE_ROOT'
    );
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      throw new Error(`ERR_ARTIFACT_FILE_MISSING: ${relativeOutput}`);
    }
    if (!stat.isFile()) {
      throw new Error(`ERR_ARTIFACT_NOT_FILE: ${relativeOutput}`);
    }
    if (stat.size <= 0) {
      throw new Error(`ERR_ARTIFACT_FILE_EMPTY: ${relativeOutput}`);
    }

    const actualSha256 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(filePath))
      .digest('hex');
    if (actualSha256 !== artifact.preview_sha256) {
      throw new Error(
        `ERR_ARTIFACT_SHA256_MISMATCH: ${relativeOutput} expected=${artifact.preview_sha256} actual=${actualSha256}`
      );
    }
    if (this.options.sourceRoot) {
      const sourceRelative = artifact.lines[0].split(':')[0];
      const sourcePath = resolveInsideRoot(
        this.options.sourceRoot,
        normalizeRelative(sourceRelative, 'ERR_ARTIFACT_SOURCE_PATH_UNSAFE'),
        'ERR_ARTIFACT_SOURCE_PATH_OUTSIDE_ROOT'
      );
      let sourceStat: fs.Stats;
      try {
        sourceStat = fs.statSync(sourcePath);
      } catch {
        throw new Error(`ERR_ARTIFACT_SOURCE_MISSING: ${sourceRelative}`);
      }
      if (!sourceStat.isFile() || sourceStat.size <= 0) {
        throw new Error(`ERR_ARTIFACT_SOURCE_NOT_FILE: ${sourceRelative}`);
      }
      const actualSourceSha256 = crypto
        .createHash('sha256')
        .update(fs.readFileSync(sourcePath))
        .digest('hex');
      if (actualSourceSha256 !== artifact.source_sha256) {
        throw new Error(
          `ERR_ARTIFACT_SOURCE_SHA256_MISMATCH: ${sourceRelative} expected=${artifact.source_sha256} actual=${actualSourceSha256}`
        );
      }
    }

    return Object.freeze({
      ...artifact,
      modId,
      filePath,
      sizeBytes: stat.size,
      actualSha256,
    });
  }
}
