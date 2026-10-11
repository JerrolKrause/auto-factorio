import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dashboardFixture } from '../../scripts/dev/dashboard-fixture.js';
import { dashboard } from '../../apps/runtime/http.js';
import { WorkspaceCatalog } from '../../packages/storage/src/workspace-catalog.js';

test('history labels a retained failed design and keeps an in-progress scorer at scoring', async ({ page }) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'af-ui-attempt-status-'));
  const f = await dashboardFixture(path.join(root, 'runtime'), true);
  const catalog = new WorkspaceCatalog(root);
  const runId = 'workshop-attempt-status';
  const assignment = { id: runId, objective: 'Retained attempt status', comparisonSeries: `series-${runId}`, revision: 1 } as never;
  const identity = catalog.beginWorkshop(f.runtime.directory, f.runtime.run, assignment, null);
  f.runtime.record('workshop/status-fixture', [
    { entity: 'workspaceGroups', id: identity.group.id, value: identity.group },
    { entity: 'workspaceRuns', id: runId, value: identity.run },
  ]);
  catalog.journaled(runId);
  const failedId = `${runId}:3`, scoringId = `${runId}:4`;
  for (const [ordinal, id] of [[3, failedId], [4, scoringId]] as const) {
    catalog.recordAttempt({ schema: 1, id, runId, ordinal, sourceId: id, coverage: 'recorded' });
    f.runtime.record('workshop/status-attempt', [{ entity: 'workshopIterations', id, value: { id, sessionId: runId, ordinal } }]);
  }
  f.runtime.record('workshop/legacy-session-fixture', [{ entity: 'workshopSessions', id: runId, value: {
    id: runId, stage: 'scoring', activeIteration: 4, bestIteration: null,
    iterations: [
      { id: failedId, number: 3, stage: 'scoring', valid: false, artifact: null, evaluation: null, score: null, feedback: 'Designer returned no blueprint entities.' },
      { id: scoringId, number: 4, stage: 'scoring', valid: true, artifact: { iteration: 4 }, evaluation: { valid: true }, score: null, feedback: null },
    ],
    operationIntents: { [`${failedId}:design`]: { status: 'failed', failure: 'Designer returned no blueprint entities.' } },
  } }]);
  const server = dashboard(f.operator, path.resolve('apps/dashboard/dist'), { workspaceCatalog: catalog });
  const origin = await server.listen();
  try {
    await page.goto(`${origin}/history/${runId}`);
    const failed = page.getByRole('button', { name: `Attempt 3 · ${failedId} · Failed`, exact: true });
    const scoring = page.getByRole('button', { name: `Attempt 4 · ${scoringId} · scoring`, exact: true });
    await expect(failed).toBeVisible();
    await expect(scoring).toBeVisible();
    await expect(page.locator('.build-gallery')).toContainText('No build: attempt failed.');
    await failed.click();
    const details = page.locator('.workspace-page').locator('pre').filter({ hasText: 'Designer returned no blueprint entities.' });
    await expect(details).toBeVisible();
    await expect(details).not.toContainText('"stage": "scoring"');
    await expect(scoring).not.toContainText('Failed');
  } finally {
    await server.close(); catalog.close(); f.close(); rmSync(root, { recursive: true, force: true });
  }
});
