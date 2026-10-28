export interface ModManifest {
  id: `mod-${string}`;
  name: string;
  version: string;
  stageOrder: 'foundation' | 'supporting' | 'feature';
  plane: 'pc-codex' | 'mobile-termux' | 'cross-plane';
  enginesRequired: Array<
    'a2a-rpc-engine' | 'transport-keepalive-engine' | 'artifact-sync-engine' | 'security-audit-engine'
  >;
  configPaths: string[];
  verificationScripts: string[];
  capabilitiesProvided: string[];
  capabilitiesConsumed: string[];
}

export const manifest: ModManifest = {
  id: 'mod-core-engines',
  name: 'Core Engines Foundation',
  version: '1.0.0',
  stageOrder: 'foundation',
  plane: 'cross-plane',
  enginesRequired: ['security-audit-engine'],
  configPaths: ['configs/a2a/pi-settings.example.json'],
  verificationScripts: ['ops/pi_termux_bootstrap.sh'],
  capabilitiesProvided: ['workspace_path_guard', 'settings_security_audit', 'bootstrap_validation'],
  capabilitiesConsumed: [],
};

export default manifest;
