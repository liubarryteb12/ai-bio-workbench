import type { ModManifest } from '../mod-core-engines/manifest';

export const manifest: ModManifest = {
  id: 'mod-a2a-codex-client',
  name: 'Codex A2A Client',
  version: '1.0.0',
  stageOrder: 'supporting',
  plane: 'pc-codex',
  enginesRequired: ['a2a-rpc-engine', 'transport-keepalive-engine', 'security-audit-engine'],
  configPaths: ['.env.a2a.example'],
  verificationScripts: ['ops/codex_a2a_launcher.sh'],
  capabilitiesProvided: ['a2a_call_bridge', 'codex_a2a_serve'],
  capabilitiesConsumed: ['a2a_server', 'peer_token_auth', 'transport_keepalive'],
};

export default manifest;
