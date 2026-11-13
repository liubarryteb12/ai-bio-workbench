/**
 * AI 管理员租约与权限仲裁服务 (BioanalysDesktop/server/services/authority.service.js)
 *
 * 遵循 docs/AI_ORCHESTRATION_SPEC.md 规范：
 * 1. 全局单权威租约锁文件位于 .ops_state/orchestration_authority.json；
 * 2. 默认 TTL 为 120 秒，支持心跳续约；
 * 3. 人类管理员拥有最高优先级，随时可执行 forceTakeover() 强制接管，踢出 AI 租约。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const LEASE_FILE = path.resolve(REPO_ROOT, '.ops_state', 'orchestration_authority.json');
const DEFAULT_TTL_MS = 120 * 1000; // 120 秒

class AuthorityService {
  constructor() {
    this._ensureDir();
  }

  _ensureDir() {
    fs.mkdirSync(path.dirname(LEASE_FILE), { recursive: true });
  }

  getCurrentLease() {
    try {
      if (fs.existsSync(LEASE_FILE)) {
        const data = JSON.parse(fs.readFileSync(LEASE_FILE, 'utf8'));
        const now = Date.now();
        const expiresAt = new Date(data.expires_at).getTime();
        if (now < expiresAt) {
          return data;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  acquireLease(actor = 'ai', agentId = 'agent-001') {
    const current = this.getCurrentLease();
    if (current && current.actor === 'human') {
      return { ok: false, code: 'ERR_HUMAN_OVERRIDE_ACTIVE', message: '人类管理员已强制接管，AI 租约申请被拒绝' };
    }

    const leaseId = randomBytes(16).toString('hex');
    const now = Date.now();
    const expiresAt = new Date(now + DEFAULT_TTL_MS).toISOString();

    const record = {
      lease_id: leaseId,
      actor,
      agent_id: agentId,
      acquired_at: new Date(now).toISOString(),
      expires_at: expiresAt,
    };

    fs.writeFileSync(LEASE_FILE, JSON.stringify(record, null, 2), 'utf8');
    return { ok: true, lease: record };
  }

  renewLease(leaseId) {
    const current = this.getCurrentLease();
    if (!current || current.lease_id !== leaseId) {
      return { ok: false, code: 'ERR_LEASE_INVALID', message: '租约不存在或已过期' };
    }

    current.expires_at = new Date(Date.now() + DEFAULT_TTL_MS).toISOString();
    fs.writeFileSync(LEASE_FILE, JSON.stringify(current, null, 2), 'utf8');
    return { ok: true, lease: current };
  }

  forceHumanTakeover(operator = 'admin') {
    const record = {
      lease_id: 'HUMAN_AUTHORITY_LOCK',
      actor: 'human',
      operator,
      acquired_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400 * 1000).toISOString(), // 锁定 24 小时
    };
    fs.writeFileSync(LEASE_FILE, JSON.stringify(record, null, 2), 'utf8');
    return { ok: true, message: '人类管理员已成功强制接管控制权', lease: record };
  }

  releaseLease(leaseId) {
    const current = this.getCurrentLease();
    if (current && current.lease_id === leaseId) {
      fs.unlinkSync(LEASE_FILE);
      return { ok: true };
    }
    return { ok: false, message: '未匹配到有效租约' };
  }
}

export const authorityService = new AuthorityService();
