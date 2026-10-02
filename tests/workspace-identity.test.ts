import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { createWorkspaceRunIdentity, selectBriefGroup } from '@autofactorio/contracts';
import type { WorkshopAssignment, WorkspaceGroupIdentity } from '@autofactorio/contracts';
import { WorkshopOrchestrator } from '../packages/core/workshop/orchestrator.js';
import { SqliteJournal } from '../packages/storage/src/journal.js';

const assignment = (id: string, objective: string, comparisonSeries: string, modelId = 'astra'): WorkshopAssignment => ({
  id, objective, comparisonSeries, models: { sessionDefault: { provider: 'openai', modelId, reasoningEffort: 'low' }, overrides: {} },
  iterations: { attempts: 2, mode: 'exact', earlyStop: false, plateauRounds: 1 },
} as WorkshopAssignment);

describe('workspace history identity', () => {
  it('keeps unchanged-brief reruns together, but links an edited objective without merging settings or comparison series', () => {
    const group = selectBriefGroup('brief-1', '  Make circuits  ');
    expect(selectBriefGroup('ignored', 'Make circuits', group)).toBe(group);
    const edited = selectBriefGroup('brief-2', 'Make green circuits', group);
    expect(edited).toMatchObject({ id: 'brief-2', parentGroupId: 'brief-1', objective: 'Make green circuits' });
    const first = createWorkspaceRunIdentity({ id: 'run-1', groupId: group.id, runtimeRun: 'container-1', kind: 'workshop',
      assignment: assignment('run-1', group.objective!, 'comparison-a'), comparisonSeries: 'comparison-a', createdAt: '2026-09-22T12:00:00Z' });
    const rerun = createWorkspaceRunIdentity({ id: 'run-2', groupId: group.id, runtimeRun: 'container-2', kind: 'workshop',
      assignment: assignment('run-2', group.objective!, 'comparison-b', 'sol'), comparisonSeries: 'comparison-b', createdAt: '2026-09-22T12:01:00Z' });
    expect(first.groupId).toBe(rerun.groupId);
    expect(first.assignmentHash).not.toBe(rerun.assignmentHash);
    expect(first.comparisonSeries).not.toBe(rerun.comparisonSeries);
    expect(first.groupId).not.toBe(edited.id);
  });

  it('records immutable group/run/attempt links in the workshop journal and retains explicit legacy unknowns', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-workspace-identity-'));
    const journal = new SqliteJournal(path.join(root, 'runtime.sqlite'));
    try {
      const context = () => ({ run: 'container', epoch: 'epoch', wallTime: '2026-09-22T12:00:00Z', gameTick: null,
        actor: null, task: null, causation: null, correlation: null, visibility: { kind: 'operator' as const } });
      const group = selectBriefGroup('brief-1', 'Make circuits');
      const input = assignment('run-1', 'Make circuits', 'comparison-a');
      const run = createWorkspaceRunIdentity({ id: input.id, groupId: group.id, runtimeRun: 'container', kind: 'workshop',
        assignment: input, comparisonSeries: input.comparisonSeries, createdAt: '2026-09-22T12:00:00Z' });
      const orchestrator = new WorkshopOrchestrator(journal, context);
      orchestrator.configure(input.id, input, 'bundle', { group, run });
      orchestrator.preflight(input.id, [{ provider: 'openai', modelId: 'astra', reasoningEffort: 'low' }]);
      orchestrator.beginIteration(input.id);
      expect(journal.get('container', 'workspaceGroups', group.id)).toEqual(group);
      expect(journal.get('container', 'workspaceRuns', run.id)).toEqual(run);
      expect(journal.get('container', 'workspaceAttempts', 'run-1:1')).toMatchObject({ runId: run.id, ordinal: 1, sourceId: 'run-1:1' });
      expect(() => orchestrator.configure(input.id, assignment('run-1', 'Make circuits', 'comparison-changed'), 'bundle', { group, run })).toThrow();
      const legacy: WorkspaceGroupIdentity = { schema: 1, id: 'legacy-1', kind: 'legacy', title: 'Legacy run', objective: null,
        scenario: null, parentGroupId: null, coverage: 'legacy-unknown' };
      expect(legacy.coverage).toBe('legacy-unknown');
      expect(legacy.objective).toBeNull();
    } finally { journal.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
