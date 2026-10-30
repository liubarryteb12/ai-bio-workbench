import { provideCapability, type ModManifest } from '../../core/types';

export const manifest: ModManifest = {
  modId: 'mod-a2a-artifact-audit',
  displayName: 'A2A Artifact Audit',
  version: '1.0.0',
  state: 'ready',
  dbStores: [],
  stageOrder: 'feature',
  plane: 'cross-plane',
  enginesRequired: ['a2a-rpc-engine', 'artifact-sync-engine', 'security-audit-engine'],
  configPaths: [],
  verificationScripts: [
    'tests/test_a2a_artifact.py',
    'tests/test_a2a_e2e_artifact.py',
    'tests/test_e2e_a2a_pipeline.py',
  ],
  capabilitiesProvided: [
    provideCapability('artifact_validation'),
    provideCapability('dual_mode_task_polling'),
    provideCapability('task_audit'),
  ],
  capabilitiesConsumed: ['a2a_call_bridge', 'a2a_server', 'peer_token_auth'],
  slots: [],
  artifacts: [],
  initialize: async () => 0,
  teardown: async () => 0,
};

export default manifest;
