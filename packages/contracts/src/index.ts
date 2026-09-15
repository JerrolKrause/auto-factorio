/** Phase 01 evidence only; no dependency on a provider, engine or storage driver. */
export type CheckStatus = 'supported' | 'unsupported' | 'unverified';

export interface CompatibilityCheck {
  id: string;
  status: CheckStatus;
  detail: string;
  command?: string[];
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}

export interface CompatibilityReport {
  schemaVersion: 1;
  observedAt: string;
  platform: string;
  architecture: string;
  paths: { project: string; data: string; evidence: string; factorio: string };
  checks: CompatibilityCheck[];
  foundationPassed: boolean;
}

export * from './game.js';
