/**
 * 单权威租约引导（AI_ORCHESTRATION_SPEC 第三节）。
 *
 * 作业中心三处状态变更端点（create / run / from-package）服务端都要求
 * X-BIO-LEASE-ID 与当前有效租约一致。租约主体来自认证结果，前端不传身份，
 * 只负责「读现状 -> 缺失时 acquire -> 内存缓存」。
 */
import { fetchJson } from './fetchJson';

interface AuthorityReadPayload {
  ok?: boolean;
  authority?: { lease_id?: string } | null;
}

interface AuthorityAcquirePayload {
  ok?: boolean;
  lease_id?: string;
  authority?: { lease_id?: string } | null;
}

let cachedLeaseId = '';

export async function ensureAuthorityLeaseId(): Promise<string> {
  if (cachedLeaseId) return cachedLeaseId;
  const read = await fetchJson<AuthorityReadPayload>('/api/orchestration/authority');
  const existing = read?.authority?.lease_id || '';
  if (existing) {
    cachedLeaseId = existing;
    return cachedLeaseId;
  }
  const acquired = await fetchJson<AuthorityAcquirePayload>('/api/orchestration/authority/acquire', {
    method: 'POST',
  });
  cachedLeaseId = acquired?.lease_id || acquired?.authority?.lease_id || '';
  return cachedLeaseId;
}

/** 409（租约过期/换手）后清缓存，下次调用重新读现状。 */
export function invalidateAuthorityLeaseId(): void {
  cachedLeaseId = '';
}
