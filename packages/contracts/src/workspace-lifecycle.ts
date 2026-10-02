/** A presentation projection; retained evidence and control receipts remain authoritative. */
export interface WorkspaceLifecycle {
  schema: 1;
  execution: 'preparing' | 'active' | 'stopping' | 'recovery-required' | 'completed' | 'cancelled' | 'failed' | 'unknown';
  phase: string;
  evaluation: 'passed' | 'target-not-met' | 'invalid-evidence' | 'not-evaluated';
  result: 'best-valid' | 'no-valid-result' | 'unknown';
  partialEarlierSuccess: boolean;
  scenarioVerdict: 'passed' | 'failed' | 'invalid' | 'unknown' | null;
  reason: string | null;
}

export function projectWorkspaceLifecycle(input: {
  kind: 'workshop' | 'scenario';
  request?: { state: string; reason?: string | null } | null;
  session?: { stage?: string; stopReason?: string | null; finalOutcome?: 'best-valid' | 'no-valid-result' | null;
    iterations?: { evaluation?: { valid?: boolean; passed?: boolean } | null }[] } | null;
  scenario?: { control?: { status?: string } | null; verification?: { valid?: boolean; passed?: boolean } | null };
}): WorkspaceLifecycle {
  const { kind, request, session } = input;
  const state = request?.state;
  const execution: WorkspaceLifecycle['execution'] = state === 'held' ? 'recovery-required'
    : state === 'stopping' ? 'stopping'
    : state === 'completed' ? 'completed'
    : state === 'cancelled' ? 'cancelled'
    : state === 'failed' ? 'failed'
    : state === 'active' ? 'active'
    : state === 'preparing' ? 'preparing'
    : session?.stage === 'complete' ? 'completed'
    : session?.stage === 'held' ? 'recovery-required'
    : session?.stage === 'stopped' ? (session.stopReason?.includes('failed') ? 'failed' : 'cancelled')
    : session?.stage ? 'active' : 'unknown';
  const evaluations = session?.iterations?.map(value => value.evaluation).filter(value => value != null) ?? [];
  const passed = evaluations.some(value => value.passed === true && value.valid === true);
  const last = evaluations.at(-1);
  const evaluation: WorkspaceLifecycle['evaluation'] = passed ? 'passed' : !last ? 'not-evaluated'
    : last.valid === false ? 'invalid-evidence' : last.passed === false ? 'target-not-met' : 'not-evaluated';
  const verification = input.scenario?.verification;
  const scenarioVerdict: WorkspaceLifecycle['scenarioVerdict'] = kind === 'workshop' ? null
    : verification?.valid === false ? 'invalid'
    : verification?.valid === true && verification.passed === true ? 'passed'
    : verification?.valid === true && verification.passed === false ? 'failed' : 'unknown';
  return { schema: 1, execution, phase: session?.stage ?? input.scenario?.control?.status ?? state ?? 'unknown',
    evaluation: kind === 'workshop' ? evaluation : 'not-evaluated', result: session?.finalOutcome ?? 'unknown',
    partialEarlierSuccess: passed && execution !== 'completed', scenarioVerdict,
    reason: request?.reason ?? session?.stopReason ?? null };
}

export function summarizeWorkspaceGroup(values: WorkspaceLifecycle[]): {
  active: number; finished: number; targetAchieved: number; targetNotYetAchieved: number; unknown: number;
} {
  return values.reduce((summary, value) => {
    if (['preparing', 'active', 'stopping', 'recovery-required'].includes(value.execution)) summary.active++;
    else if (value.execution !== 'unknown') summary.finished++;
    if (value.evaluation === 'passed' || value.scenarioVerdict === 'passed') summary.targetAchieved++;
    else if (value.evaluation === 'target-not-met' || value.scenarioVerdict === 'failed') summary.targetNotYetAchieved++;
    else summary.unknown++;
    return summary;
  }, { active: 0, finished: 0, targetAchieved: 0, targetNotYetAchieved: 0, unknown: 0 });
}
