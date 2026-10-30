import { posix as path } from 'path';

import type { ExitCode } from './types';

const TERMUX_HOME = '/data/data/com.termux/files/home';
const CONTAINER_DATA_ROOT = '/mnt/ssd/bio_data';
const FORBIDDEN_PREFIXES = ['/sdcard', '/storage/emulated', '/storage/self/primary'];
const PROJECT_ID_PATTERN = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type AllowedRoot = 'ROOT' | 'MODS' | 'DATA' | 'CACHE';

export interface SafePathOutcome {
  readonly exitCode: ExitCode;
  readonly resolvedPath: string;
  readonly violationReason?: string;
}

function isWithinRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function isForbiddenPath(candidate: string): boolean {
  return FORBIDDEN_PREFIXES.some((prefix) => isWithinRoot(candidate, prefix));
}

export class PathGuard {
  readonly workspaceRoot: string;
  readonly agentRoot: string;
  readonly containerDataRoot: string;

  constructor(
    home: string = process.env.HOME ?? TERMUX_HOME,
    containerDataRoot: string = CONTAINER_DATA_ROOT,
  ) {
    if (!home) {
      throw new Error('ERR_PATH_GUARD_HOME_MISSING');
    }
    this.workspaceRoot = path.join(home, 'workspace');
    this.agentRoot = path.join(home, '.pi', 'agent');
    this.containerDataRoot = path.normalize(containerDataRoot);
  }

  resolveSafePath(scope: AllowedRoot, targetRelativePath: string): SafePathOutcome {
    const roots: Record<AllowedRoot, string> = {
      ROOT: this.workspaceRoot,
      MODS: path.join(this.workspaceRoot, 'src', 'mods'),
      DATA: path.join(this.workspaceRoot, 'data'),
      CACHE: path.join(this.workspaceRoot, 'cache'),
    };
    const root = roots[scope];
    if (!root) {
      return this.violation(`ERR_PATH_GUARD_SCOPE_INVALID: ${scope}`);
    }
    if (typeof targetRelativePath !== 'string') {
      return this.violation('ERR_PATH_GUARD_PATH_NOT_STRING');
    }
    if (targetRelativePath.includes('\0')) {
      return this.violation('ERR_PATH_GUARD_NUL_BYTE');
    }
    if (targetRelativePath.startsWith('/') || targetRelativePath.startsWith('\\')) {
      return this.violation(`ERR_PATH_GUARD_ABSOLUTE_PATH: ${targetRelativePath}`);
    }
    const normalizedRelative = targetRelativePath.split('\\').join('/');
    if (normalizedRelative.split('/').some((segment) => segment === '..')) {
      return this.violation(`ERR_PATH_GUARD_TRAVERSAL: ${targetRelativePath}`);
    }
    const resolvedPath = path.normalize(path.join(root, normalizedRelative));
    if (resolvedPath !== root && !resolvedPath.startsWith(`${root}/`)) {
      return this.violation(`ERR_PATH_GUARD_OUTSIDE_SCOPE: ${targetRelativePath}`);
    }
    if (isForbiddenPath(resolvedPath)) {
      return this.violation(`ERR_PATH_GUARD_FUSE_FORBIDDEN: ${targetRelativePath}`);
    }
    return Object.freeze({
      exitCode: 0,
      resolvedPath,
    });
  }

  isAllowed(candidate: string): boolean {
    try {
      this.assertAllowed(candidate);
      return true;
    } catch {
      return false;
    }
  }

  assertAllowed(candidate: string): string {
    if (typeof candidate !== 'string' || candidate.length === 0) {
      throw new Error('ERR_PATH_GUARD_EMPTY_PATH');
    }
    if (candidate.split(/[\\/]/).some((segment) => segment === '..')) {
      throw new Error(`ERR_PATH_GUARD_TRAVERSAL: ${candidate}`);
    }

    let absolutePath: string;
    if (candidate === '~' || candidate.startsWith('~/')) {
      absolutePath = path.join(this.workspaceRoot, '..', candidate.slice(2));
    } else if (candidate.startsWith('/')) {
      absolutePath = candidate;
    } else {
      absolutePath = path.join(this.workspaceRoot, candidate);
    }

    const normalized = path.normalize(absolutePath);
    if (isForbiddenPath(normalized)) {
      throw new Error(`ERR_PATH_GUARD_FUSE_FORBIDDEN: ${candidate}`);
    }

    const roots = [this.workspaceRoot, this.agentRoot, this.containerDataRoot];
    const insideAllowedRoot = roots.some((root) => isWithinRoot(normalized, root));
    if (!insideAllowedRoot) {
      throw new Error(`ERR_PATH_GUARD_OUTSIDE_ALLOWED_ROOTS: ${candidate}`);
    }
    return normalized;
  }

  assertWithinProjectRoot(targetPath: string, projectId: string): string {
    if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
      throw new Error(`ERR_PATH_GUARD_PROJECT_ID_INVALID: ${String(projectId)}`);
    }
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
      throw new Error('ERR_PATH_GUARD_PROJECT_PATH_INVALID');
    }
    if (targetPath.includes('\0')) {
      throw new Error('ERR_PATH_GUARD_NUL_BYTE');
    }
    if (!targetPath.startsWith('/')) {
      throw new Error(`ERR_PATH_GUARD_PROJECT_PATH_NOT_ABSOLUTE: ${targetPath}`);
    }
    if (targetPath.includes('\\')) {
      throw new Error(`ERR_PATH_GUARD_PROJECT_PATH_NOT_POSIX: ${targetPath}`);
    }
    if (targetPath.split('/').some((segment) => segment === '..')) {
      throw new Error(`ERR_PATH_GUARD_PROJECT_TRAVERSAL: ${targetPath}`);
    }

    const projectRoots = [
      path.join(this.workspaceRoot, 'projects', projectId),
      path.join(this.containerDataRoot, 'projects', projectId),
    ];
    const normalizedTarget = path.normalize(targetPath);
    if (isForbiddenPath(normalizedTarget)) {
      throw new Error(`ERR_PATH_GUARD_FUSE_FORBIDDEN: ${targetPath}`);
    }
    const insideProject = projectRoots.some((root) => isWithinRoot(normalizedTarget, root));
    if (!insideProject) {
      throw new Error(`ERR_PATH_GUARD_PROJECT_OUTSIDE_ROOT: ${targetPath}`);
    }
    return normalizedTarget;
  }

  private violation(reason: string): SafePathOutcome {
    return Object.freeze({
      exitCode: 2,
      resolvedPath: '',
      violationReason: reason,
    });
  }
}
