import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dashboardFixture } from '../../scripts/dev/dashboard-fixture.js';
import { dashboard } from '../../apps/runtime/http.js';
import { SqliteJournal } from '../../packages/storage/src/journal.js';
import { WorkspaceCatalog } from '../../packages/storage/src/workspace-catalog.js';
import { validateFreshGame } from '../../scripts/dev/fresh-game.js';
import type { ControlState } from '../../packages/factorio/src/lifecycle.js';
import type { ProjectProcess } from '../../scripts/dev/game-processes.js';

test('fresh-game attestation clears the historical owner banner and allows an HTTP launch', async ({ page }) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'af-ui-fresh-boundary-'));
  const oldDirectory = path.join(root, 'startup', 'dashboard-old'), currentDirectory = path.join(root, 'replacement');
  const profile = path.join(root, 'profiles', 'fresh');
  mkdirSync(oldDirectory, { recursive: true }); mkdirSync(currentDirectory, { recursive: true }); mkdirSync(profile, { recursive: true });
  const oldFile = path.join(oldDirectory, 'runtime.sqlite');
  const oldJournal = new SqliteJournal(oldFile);
  const catalog = new WorkspaceCatalog(root);
  const runtime = await dashboardFixture(currentDirectory, true);
  oldJournal.append({ run: 'historical-run', epoch: 'old-epoch', wallTime: new Date().toISOString(), gameTick: null, actor: 'operator', task: null,
    causation: null, correlation: null, visibility: { kind: 'operator' } }, 'workshop/configured', [{ entity: 'workshopSessions', id: 'historical-session', value: {
      id: 'historical-session', assignment: { id: 'historical-session', objective: 'Historical unknown workshop' }, stage: 'held',
      stopReason: 'provider outcome unknown', operationIntents: { 'historical-session:1:design': { status: 'unknown' } }, operationResults: {}, iterations: [] } }]);
  oldJournal.close();
  const journal = new SqliteJournal(oldFile); const original = journal.snapshot(); journal.close();
  catalog.importLegacy();
  const historicalOwner = catalog.owner();
  expect(historicalOwner).toMatchObject({ state: 'held' });
  const host = { async resolve() { throw new Error('deterministic HTTP admission fixture'); }, async cancel() { throw new Error('unused'); }, async close() {} } as never;
  const server = dashboard(runtime.operator, undefined, { workspaceCatalog: catalog,
    managedModels: [{ id: 'gpt-6-astra', displayName: 'Astra', efforts: ['low'] }], workshopHost: host });
  try {
    const origin = await server.listen(); await page.goto(origin + '/workshop');
    const banner = page.getByRole('region', { name: 'Active run' });
    await expect(banner).toContainText(historicalOwner!.id);

    const now = Date.now(), id = randomUUID();
    const receipt = { id, profile, createdAt: new Date(now).toISOString(), server: { pid: 45678, startedAt: '2026-10-02T12:00:00.000Z' } };
    const control: ControlState = { ok: true, epoch: 'new-epoch', session: 'new-session', revision: 0, generation: 1,
      armed: false, ready: false, paused: true, neutral: true, ticksToRun: 0, tick: 0, ticksPlayed: 0, experimentTick: 0,
      scenarioElapsed: 0, injections: 0, checkpoint: false, ledger: {}, intents: {}, production: {}, mods: {} };
    const process: ProjectProcess = { pid: receipt.server.pid, config: path.join(profile, 'config.ini'), startedAt: receipt.server.startedAt, kind: 'server' };
    const trusted = validateFreshGame(receipt, id, profile, control, [process], now);
    expect(catalog.retireLegacyForFreshGame(trusted.id, trusted.profile)).toBeGreaterThan(0);
    await expect(banner).toHaveCount(0);
    expect(catalog.owner()).toBeNull();

    const submitted = page.waitForResponse(response => response.url().endsWith('/api/workshop/launch') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Launch workshop' }).click();
    const response = await submitted;
    expect(response.status()).toBe(202);
    const accepted = await response.json() as { id: string };
    await expect.poll(() => catalog.request(accepted.id)?.state).toBe('failed');
    catalog.importLegacy();
    expect(catalog.owner()).toBeNull();
    const unchanged = new SqliteJournal(oldFile);
    expect(unchanged.snapshot()).toEqual(original);
    expect(unchanged.get('historical-run', 'workshopSessions', 'historical-session')).toMatchObject({ stage: 'held',
      operationIntents: { 'historical-session:1:design': { status: 'unknown' } } });
    unchanged.close();
  } finally { await server.close(); runtime.close(); catalog.close(); rmSync(root, { recursive: true, force: true }); }
});
