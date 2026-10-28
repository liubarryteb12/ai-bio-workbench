import type { ModManifest } from '../mod-core-engines/manifest';

export const manifest: ModManifest = {
  id: 'mod-a2a-network-keepalive',
  name: 'A2A Network Keepalive',
  version: '1.0.0',
  stageOrder: 'supporting',
  plane: 'mobile-termux',
  enginesRequired: ['transport-keepalive-engine'],
  configPaths: [],
  verificationScripts: ['ops/pi_a2a_daemon.sh'],
  capabilitiesProvided: ['wake_lock', 'tmux_keepalive', 'network_keepalive'],
  capabilitiesConsumed: ['a2a_server'],
};

export default manifest;
