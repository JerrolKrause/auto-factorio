import { describe, expect, it } from 'vitest';
import { projectWorkspaceLifecycle, summarizeWorkspaceGroup } from '@autofactorio/contracts';

describe('workspace lifecycle projection', () => {
  it('separates execution, target evaluation and retained partial success', () => {
    const passed = { evaluation: { valid: true, passed: true } };
    const failed = projectWorkspaceLifecycle({ kind: 'workshop', request: { state: 'failed', reason: 'builder_failed' },
      session: { stage: 'stopped', iterations: [passed] } });
    expect(failed).toMatchObject({ execution: 'failed', evaluation: 'passed', partialEarlierSuccess: true, result: 'unknown' });
    const cancelled = projectWorkspaceLifecycle({ kind: 'workshop', request: { state: 'cancelled' },
      session: { stage: 'stopped', iterations: [passed] } });
    expect(cancelled).toMatchObject({ execution: 'cancelled', evaluation: 'passed', partialEarlierSuccess: true });
    const held = projectWorkspaceLifecycle({ kind: 'workshop', request: { state: 'held' },
      session: { stage: 'held', iterations: [{ evaluation: { valid: false, passed: false } }] } });
    expect(held).toMatchObject({ execution: 'recovery-required', evaluation: 'invalid-evidence' });
    const complete = projectWorkspaceLifecycle({ kind: 'workshop', request: { state: 'completed' },
      session: { stage: 'complete', finalOutcome: 'no-valid-result', iterations: [{ evaluation: { valid: true, passed: false } }] } });
    expect(complete).toMatchObject({ execution: 'completed', evaluation: 'target-not-met', result: 'no-valid-result' });
    expect(summarizeWorkspaceGroup([failed, cancelled, held, complete])).toEqual({ active: 1, finished: 3, targetAchieved: 2, targetNotYetAchieved: 1, unknown: 1 });
  });

  it('keeps scenario verdict independent of terminal control', () => {
    const invalid=projectWorkspaceLifecycle({ kind: 'scenario', request: { state: 'completed' },
      scenario: { control: { status: 'completed' }, verification: { valid: false, passed: false } } });
    expect(invalid).toMatchObject({ execution: 'completed', scenarioVerdict: 'invalid', evaluation: 'not-evaluated' });
    const measuredFailure=projectWorkspaceLifecycle({ kind:'scenario', request:{state:'completed'},scenario:{verification:{valid:true,passed:false}} });
    expect(measuredFailure.scenarioVerdict).toBe('failed');
    expect(summarizeWorkspaceGroup([invalid,measuredFailure])).toMatchObject({targetNotYetAchieved:1,unknown:1});
    expect(projectWorkspaceLifecycle({ kind: 'scenario', request: { state: 'active' } }))
      .toMatchObject({ execution: 'active', scenarioVerdict: 'unknown' });
  });
});
