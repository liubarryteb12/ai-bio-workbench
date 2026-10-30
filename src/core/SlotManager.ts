import { SLOT_IDS, type SlotId, type SlotContribution } from './types';

export { SLOT_IDS } from './types';
export type { SlotId, SlotContribution } from './types';

export interface RegisteredSlotContribution extends SlotContribution {
  readonly modId: string;
}

export interface SlotView {
  readonly slotId: SlotId;
  readonly contributions: readonly RegisteredSlotContribution[];
  readonly empty: boolean;
}

const SLOT_SET = new Set<string>(SLOT_IDS);

function assertSlotId(value: string): asserts value is SlotId {
  if (!SLOT_SET.has(value)) {
    throw new Error(`ERR_SLOT_ID_INVALID: ${value}`);
  }
}

export class SlotManager {
  private readonly registry = new Map<string, RegisteredSlotContribution[]>();

  register(modId: string, contributions: readonly SlotContribution[]): void {
    if (!modId.trim()) {
      throw new Error('ERR_SLOT_MOD_ID_MISSING');
    }
    if (!Array.isArray(contributions)) {
      throw new Error('ERR_SLOT_CONTRIBUTIONS_NOT_ARRAY');
    }
    const normalized = contributions.map((contribution) => {
      assertSlotId(contribution.slotId);
      if (!contribution.title.trim()) {
        throw new Error(`ERR_SLOT_TITLE_MISSING: ${modId}/${contribution.slotId}`);
      }
      if (!Number.isFinite(contribution.order)) {
        throw new Error(`ERR_SLOT_ORDER_INVALID: ${modId}/${contribution.slotId}`);
      }
      if (typeof contribution.renderAdapter !== 'function') {
        throw new Error(`ERR_SLOT_RENDER_ADAPTER_INVALID: ${modId}/${contribution.slotId}`);
      }
      return Object.freeze({
        ...contribution,
        modId,
      });
    });
    this.registry.set(modId, normalized);
  }

  unregister(modId: string): boolean {
    return this.registry.delete(modId);
  }

  has(modId: string): boolean {
    return this.registry.has(modId);
  }

  list(slotId: SlotId): readonly RegisteredSlotContribution[] {
    assertSlotId(slotId);
    const items: RegisteredSlotContribution[] = [];
    for (const contributions of this.registry.values()) {
      for (const contribution of contributions) {
        if (contribution.slotId === slotId) {
          items.push(contribution);
        }
      }
    }
    items.sort((a, b) => a.order - b.order || a.modId.localeCompare(b.modId));
    return Object.freeze(items);
  }

  renderPlan(): readonly SlotView[] {
    return Object.freeze(SLOT_IDS.map((slotId) => {
      const contributions = this.list(slotId);
      return Object.freeze({
        slotId,
        contributions,
        empty: contributions.length === 0,
      });
    }));
  }
}
