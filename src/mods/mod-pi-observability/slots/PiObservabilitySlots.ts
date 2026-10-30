import type { SlotContribution } from '../../../core/types';

export const selfcheckSlot: SlotContribution = {
  slotId: 'workbench.selfcheck-cards',
  order: 500,
  title: 'Pi Agent status',
  renderAdapter: () => ({ kind: 'panel', capability: 'piObservability.overview' }),
};

export const previewSlot: SlotContribution = {
  slotId: 'workbench.studio-preview',
  order: 500,
  title: 'Pi Agent monitor',
  renderAdapter: () => ({ kind: 'panel', capability: 'piObservability.overview' }),
};
