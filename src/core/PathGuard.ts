import { posix as path } from 'path';

const TERMUX_HOME = '/data/data/com.termux/files/home';
const FORBIDDEN_PREFIXES = ['/sdcard', '/storage/emulated'];

export class PathGuard {
  readonly workspaceRoot: string;
  readonly agentRoot: string;

  constructor(home: string = process.env.HOME ?? TERMUX_HOME) {
    if (!home) {
      throw new Error('ERR_PATH_GUARD_HOME_MISSING');
    }
    this.workspaceRoot = path.join(home, 'workspace');
    this.agentRoot = path.join(home, '.pi', 'agent');
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
    if (candidate.includes('..')) {
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
    if (FORBIDDEN_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      throw new Error(`ERR_PATH_GUARD_FUSE_FORBIDDEN: ${candidate}`);
    }

    const roots = [this.workspaceRoot, this.agentRoot];
    const insideAllowedRoot = roots.some((root) => normalized === root || normalized.startsWith(root + '/'));
    if (!insideAllowedRoot) {
      throw new Error(`ERR_PATH_GUARD_OUTSIDE_ALLOWED_ROOTS: ${candidate}`);
    }
    return normalized;
  }
}
