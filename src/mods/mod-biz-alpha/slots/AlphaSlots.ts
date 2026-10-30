import type { SlotContribution } from '../../../core/types';

export const workspaceSlot: SlotContribution = {
  slotId: 'workspace.main',
  order: 200,
  title: 'Daily ledger',
  renderAdapter: () => ({ kind: 'panel', capability: 'bizAlpha.getConsumptionSummary' }),
};

export const inspectorSlot: SlotContribution = {
  slotId: 'inspector.panel',
  order: 200,
  title: 'Consumption structure',
  renderAdapter: () => ({ kind: 'inspector', capability: 'bizAlpha.getConsumptionSummary' }),
};
