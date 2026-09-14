import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CompatibilityCheck } from '@autofactorio/contracts';

export function commandCheck(id: string, command: string[], cwd: string, accepts: (text: string) => boolean = () => true): CompatibilityCheck {
  const [executable, ...args] = command;
  if (!executable) throw new Error('Empty diagnostic command');
  // Windows .cmd shims need a command interpreter. Quote every argument as a
  // PowerShell literal, including user-supplied paths; never use shell:true.
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const useShim = process.platform === 'win32' && !executable.endsWith('.exe');
  const result = useShim
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `& ${command.map(quote).join(' ')}; exit $LASTEXITCODE`], { cwd, encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 })
    : spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 });
  const stdout = result.stdout?.trim() ?? '';
  const stderr = result.stderr?.trim() ?? '';
  const status = !result.error && result.status === 0 && accepts(stdout) ? 'supported' : 'unsupported';
  return { id, status, command, exitCode: result.status, stdout, stderr, detail: result.error?.message ?? (status === 'supported' ? 'Command and version check passed.' : 'Command failed or returned an unsupported version; prerequisites remain user-managed.') };
}

export async function modCheck(factorio: string, name: string): Promise<CompatibilityCheck> {
  const file = path.join(factorio, 'data', name, 'info.json');
  try {
    const stdout = await readFile(file, 'utf8');
    const value: unknown = JSON.parse(stdout);
    const valid = typeof value === 'object' && value !== null && 'name' in value && value.name === name && 'version' in value && typeof value.version === 'string' && /^2\.0\.\d+$/.test(value.version);
    return { id: `mod:${name}`, status: valid ? 'supported' : 'unsupported', detail: `${file}; installed metadata only, not proof this mod is active in a running game.`, stdout };
  } catch (error) {
    return { id: `mod:${name}`, status: 'unsupported', detail: `${file}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const pendingLiveChecks: CompatibilityCheck[] = [
  { id: 'provider-access', status: 'unverified', detail: 'Phase 02: ChatGPT authentication, Astra availability, subscription allowance, two-role tool restrictions, live activity, budgets, cancellation and resumption. No inference or authentication check performed.' },
  { id: 'game-actions', status: 'unverified', detail: 'Phase 03: hosted Space Age mod profile, running-game prototype facts, legal movement/reach, inventory, placement, partial failure and cancellation.' },
  { id: 'pause-restore', status: 'unverified', detail: 'Phase 04: hosted pause under polling and disarmed save/load/reconcile/re-arm with pending work. Required before phase 05.' },
  { id: 'mod:autofactorio', status: 'unverified', detail: 'Not implemented in phase 01; no AutoFactorio mod or dedicated game save has been provisioned.' },
];
