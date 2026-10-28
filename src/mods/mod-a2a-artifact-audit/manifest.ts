import type { ModManifest } from '../mod-core-engines/manifest';

export const manifest: ModManifest = {
  id: 'mod-a2a-artifact-audit',
  name: 'A2A Artifact Audit',
  version: '1.0.0',
  stageOrder: 'feature',
  plane: 'cross-plane',
  enginesRequired: ['a2a-rpc-engine', 'artifact-sync-engine', 'security-audit-engine'],
  configPaths: [],
  verificationScripts: ['ops/pi_a2a_daemon.sh'],
  capabilitiesProvided: ['artifact_validation', 'dual_mode_task_polling', 'task_audit'],
  capabilitiesConsumed: ['a2a_call_bridge', 'a2a_server', 'peer_token_auth'],
};

export default manifest;
