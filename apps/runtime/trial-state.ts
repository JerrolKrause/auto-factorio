import type { OperatorState } from './operator.js';
import type { BudgetState } from '../../packages/codex/src/budget.js';
import type { Command } from '../../packages/core/execution/durable.js';
import { IncludedAllowanceUnavailable } from '../../packages/codex/src/preflight.js';

export function trialFailure(error: unknown, inferenceStarted = true) {
  if (!inferenceStarted) return { reason: 'provider_preflight_failure', failure: String(error), providerStop: error instanceof IncludedAllowanceUnavailable ? String(error) : null };
  return error instanceof IncludedAllowanceUnavailable
    ? { reason: 'provider_allowance_stop', failure: null, providerStop: String(error) }
    : { reason: 'integration_failure', failure: String(error), providerStop: null };
}

/** Pausing keeps the host and wall clock alive; only an acknowledged resume reopens scheduling. */
export function trialControl(state: OperatorState): 'run' | 'wait' | 'stop' | 'disconnected' {
  if (state.status === 'disconnected') return 'disconnected';
  if (state.requested === 'stop' || state.status === 'stopped') return 'stop';
  return state.admission && state.status === 'running' ? 'run' : 'wait';
}
export interface ReplacementEvidence {
  previousSession: string; session: string; pendingAtBinding: string[]; budgetBefore: BudgetState;
  budgetAtBinding: BudgetState | null; observation: { tick: number; task: string; session: string } | null;
  at: string; tick: number | null;
}
export function replacementMatchesPending(e: ReplacementEvidence | null, taskId: string, task: { id: string; owner: string | null; revision: number } | undefined, commands: Command[]) {
  if (!e?.pendingAtBinding.length || !task || task.id !== taskId || task.owner !== 'engineer') return false;
  return e.pendingAtBinding.every(id => {
    const command = commands.find(candidate => candidate.batch.commandId === id);
    return command?.batch.task === taskId && command.batch.revision === task.revision;
  });
}
export function replacementStatus(e: ReplacementEvidence | null) {
  const gaps: string[] = [];
  if (!e) return { complete: false, gaps: ['No replacement prepared'] };
  if (e.previousSession === e.session) gaps.push('Old provider context reused');
  if (!e.pendingAtBinding.length) gaps.push('No pending construction at replacement binding');
  if (!e.observation || e.observation.session !== e.session) gaps.push('No successful fresh authorized replacement observation');
  if (!e.budgetAtBinding || e.budgetAtBinding.spentTurns !== e.budgetBefore.spentTurns + 1 || e.budgetAtBinding.reportedTokens < e.budgetBefore.reportedTokens || e.budgetAtBinding.attempts < e.budgetBefore.attempts || e.budgetAtBinding.elapsedMs < e.budgetBefore.elapsedMs) gaps.push('Continuous budget accounting unverified');
  return { complete: gaps.length === 0, gaps };
}

export interface TrialResourceCleanup { name: string; status: 'closed' | 'failed'; error?: string }
/** Resources register immediately after acquisition and close once in reverse order. */
export class TrialResources {
  private entries: { name: string; close: () => void | Promise<void> }[] = [];
  private result: TrialResourceCleanup[] | null = null;
  register(name: string, close: () => void | Promise<void>) {
    if (this.result) throw new Error('Cannot register a resource after cleanup');
    this.entries.push({ name, close });
  }
  async close(): Promise<TrialResourceCleanup[]> {
    if (this.result) return this.result;
    const result: TrialResourceCleanup[] = [];
    for (const entry of this.entries.reverse()) {
      try { await entry.close(); result.push({ name: entry.name, status: 'closed' }); }
      catch (error) { result.push({ name: entry.name, status: 'failed', error: String(error) }); }
    }
    this.result = result;
    return result;
  }
}

export interface SetupFailureActions {
  hold: () => Promise<unknown>;
  closeResources: () => Promise<TrialResourceCleanup[]>;
  stopObserver: () => Promise<number[]>;
  stopServer: () => Promise<number[]>;
  record: (result: SetupFailureCleanup) => Promise<void>;
}
export interface SetupFailureCleanup {
  held: unknown | null;
  resources: TrialResourceCleanup[];
  observer: number[];
  server: number[];
  errors: string[];
}
/** Setup failures happen outside the normal report loop but still own a live project profile. */
export async function cleanupSetupFailure(actions: SetupFailureActions): Promise<SetupFailureCleanup> {
  const result: SetupFailureCleanup = { held: null, resources: [], observer: [], server: [], errors: [] };
  try { result.held = await actions.hold(); } catch (error) { result.errors.push('hold: ' + String(error)); }
  try {
    result.resources = await actions.closeResources();
    result.errors.push(...result.resources.filter(entry => entry.status === 'failed').map(entry => `resource ${entry.name}: ${entry.error}`));
  } catch (error) { result.errors.push('resources: ' + String(error)); }
  try { result.observer = await actions.stopObserver(); } catch (error) { result.errors.push('observer: ' + String(error)); }
  try { result.server = await actions.stopServer(); } catch (error) { result.errors.push('server: ' + String(error)); }
  try { await actions.record(result); } catch (error) { result.errors.push('record: ' + String(error)); }
  return result;
}
