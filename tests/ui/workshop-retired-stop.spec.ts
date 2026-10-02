import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dashboardFixture } from '../../scripts/dev/dashboard-fixture.js';
import { dashboard } from '../../apps/runtime/http.js';
import { SqliteJournal } from '../../packages/storage/src/journal.js';
import { WorkspaceCatalog } from '../../packages/storage/src/workspace-catalog.js';

test('retired workshop ownership guidance appears once, Stop releases it, and launch is accepted', async ({ page }) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'af-ui-retired-stop-'));
  const oldDirectory = path.join(root, 'old', 'retired'), currentDirectory = path.join(root, 'replacement');
  mkdirSync(oldDirectory, { recursive: true }); mkdirSync(currentDirectory, { recursive: true });
  const oldJournal = new SqliteJournal(path.join(oldDirectory, 'runtime.sqlite'));
  const catalog = new WorkspaceCatalog(root), id = 'retired-ui';
  const runtime = await dashboardFixture(currentDirectory, true);
  const session = { id, assignment: { id, objective: 'Build green circuits' }, stage: 'designing', stopReason: null,
    operationIntents: {}, operationResults: {}, iterations: [{ id: `${id}:1`, number: 1, artifact: null, evaluation: null }],
    activeIteration: 1, validIterations: [], bestIteration: null, checkpoint: null, checkpointDecisions: {}, pinnedBundleHash: 'bundle', stopRequested: false };
  oldJournal.append({ run: 'old-run', epoch: 'old-epoch', wallTime: new Date().toISOString(), gameTick: null, actor: 'operator', task: null,
    causation: null, correlation: null, visibility: { kind: 'operator' } }, 'workshop/configured', [{ entity: 'workshopSessions', id, value: session }]);
  oldJournal.close();
  catalog.admit(id, 'workshop', session.assignment, oldDirectory); catalog.transitionRequest(id, 'active');
  const host = { async resolve() { throw new Error('deterministic launch admission fixture'); }, async cancel() { throw new Error('retired stop must not use current host'); }, async close() {} } as never;
  const server = dashboard(runtime.operator, undefined, { workspaceCatalog: catalog, managedModels: [{ id: 'gpt-6-astra', displayName: 'Astra', efforts: ['low'] }], workshopHost: host });
  try {
    const origin = await server.listen(); await page.goto(origin + '/workshop');
    const banner = page.getByRole('region', { name: 'Active run' });
    await expect(banner).toContainText(id);
    await expect(page.getByRole('button', { name: 'Launch workshop' })).toBeEnabled();
    await page.getByRole('button', { name: 'Launch workshop' }).click();
    await expect(page.getByText(/Another run owns the managed game/i)).toHaveCount(1);
    await expect(page.locator('[data-launch-field="ownership"]')).toBeFocused();
    await banner.getByRole('button', { name: 'Stop run' }).click();
    await expect(banner).toHaveCount(0);
    await expect.poll(() => catalog.owner()).toBeNull();

    const submitted = page.waitForResponse(response => response.url().endsWith('/api/workshop/launch') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Launch workshop' }).click();
    const response = await submitted;
    expect(response.status()).toBe(202);
    const accepted = await response.json() as { id: string };
    expect(accepted.id).not.toBe(id);
    expect(catalog.request(accepted.id)).not.toBeNull();
  } finally {
    await server.close(); runtime.close(); catalog.close(); rmSync(root, { recursive: true, force: true });
  }
});
