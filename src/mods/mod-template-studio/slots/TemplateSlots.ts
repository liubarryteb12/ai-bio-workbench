import type { SlotContribution } from '../../../core/types';

export const workspaceSlot: SlotContribution = {
  slotId: 'workspace.main',
  order: 300,
  title: 'Template studio',
  renderAdapter: () => ({ kind: 'canvas', capability: 'templateStudio.listVerifiedOutputs' }),
};

export const inspectorSlot: SlotContribution = {
  slotId: 'inspector.panel',
  order: 300,
  title: 'Template inspector',
  renderAdapter: () => ({ kind: 'inspector', capability: 'templateStudio.listVerifiedOutputs' }),
};
