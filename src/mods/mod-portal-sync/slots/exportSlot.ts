import type { SlotContribution } from '../../../core/types';

export const exportSlot: SlotContribution = {
  slotId: 'topbar.action',
  order: 100,
  title: 'Export signed bundle',
  renderAdapter: () => ({
    kind: 'button',
    capability: 'portalSync.getLastBundleInfo',
    command: 'portal_sync.exportSignedDeliverable',
  }),
};
