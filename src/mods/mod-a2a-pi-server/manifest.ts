import type { ModManifest } from '../mod-core-engines/manifest';

export const manifest: ModManifest = {
  id: 'mod-a2a-pi-server',
  name: 'Pi A2A Server',
  version: '1.0.0',
  stageOrder: 'foundation',
  plane: 'mobile-termux',
  enginesRequired: ['security-audit-engine'],
  configPaths: ['configs/a2a/pi-settings.example.json'],
  verificationScripts: ['ops/pi_a2a_daemon.sh'],
  capabilitiesProvided: ['a2a_server', 'peer_token_auth', 'child_transcripts'],
  capabilitiesConsumed: ['workspace_path_guard', 'settings_security_audit'],
};

export default manifest;
