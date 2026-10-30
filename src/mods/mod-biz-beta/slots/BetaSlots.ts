import type { SlotContribution } from '../../../core/types';

export const sidebarSlot: SlotContribution = {
  slotId: 'sidebar.nav',
  order: 400,
  title: 'Transcriptomics',
  renderAdapter: () => ({ kind: 'nav', capability: 'bizBeta.getAnalysisDigest' }),
};

export const workspaceSlot: SlotContribution = {
  slotId: 'workspace.main',
  order: 400,
  title: 'Analysis workspace',
  renderAdapter: () => ({ kind: 'panel', capability: 'bizBeta.getAnalysisDigest' }),
};
