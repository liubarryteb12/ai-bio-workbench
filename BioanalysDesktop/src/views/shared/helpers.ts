import type { ApiState, ProjectEntry } from './types';
import { DATA_TYPE_OPTIONS } from './constants';

/** 项目选择器显示名：v3 读 basic_info.name，旧项目读顶层 name，都没有才用 ID */
export const projectDisplayName = (item: ProjectEntry): string =>
  item.meta?.basic_info?.name || item.meta?.name || item.projectId;

export function readApiState<T extends object>(raw: T | { error: string } | null): ApiState<T> {
  if (raw === null) return { kind: 'loading' };
  if ('error' in raw) return { kind: 'failed', message: raw.error };
  return { kind: 'ok', data: raw as T };
}

export const lineFromDataType = (id: string): string =>
  DATA_TYPE_OPTIONS.find((d) => d.id === id)?.line || '';
