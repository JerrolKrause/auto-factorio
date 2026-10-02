import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dashboard } from '../apps/runtime/http.js';
import { dashboardFixture } from '../scripts/dev/dashboard-fixture.js';
import { SqliteJournal } from '../packages/storage/src/journal.js';
import { WorkspaceCatalog } from '../packages/storage/src/workspace-catalog.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function retiredFixture(overrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'af-retired-stop-')); roots.push(root);
  const oldDirectory = path.join(root, 'old', 'session'), replacementDirectory = path.join(root, 'replacement');
  mkdirSync(oldDirectory, { recursive: true }); mkdirSync(replacementDirectory, { recursive: true });
  const oldJournal = new SqliteJournal(path.join(oldDirectory, 'runtime.sqlite'));
  const currentJournal = new SqliteJournal(path.join(replacementDirectory, 'runtime.sqlite'));
  const catalog = new WorkspaceCatalog(root);
  const id = 'retired-workshop';
  catalog.admit(id, 'workshop', { id, objective: 'Build green circuits' }, oldDirectory);
  catalog.transitionRequest(id, 'active');
  const session = {
    id, assignment: { id, objective: 'Build green circuits' }, stage: 'designing', stopReason: null,
    operationIntents: {}, operationResults: {}, iterations: [{ id: `${id}:1`, number: 1, artifact: null, evaluation: null }],
    activeIteration: 1, validIterations: [], bestIteration: null, checkpoint: null, checkpointDecisions: {},
    pinnedBundleHash: 'bundle', stopRequested: false, ...overrides,
  };
  oldJournal.append({ run: 'old-run', epoch: 'old-epoch', wallTime: new Date().toISOString(), gameTick: null, actor: 'operator', task: null,
    causation: null, correlation: null, visibility: { kind: 'operator' } }, 'workshop/configured', [{ entity: 'workshopSessions', id, value: session }]);
  let oldClosed = false, currentClosed = false;
  return { root, oldDirectory, replacementDirectory, oldJournal, currentJournal, catalog, id, session,
    closeOld() { if (!oldClosed) { oldJournal.close(); oldClosed = true; } },
    closeCurrent() { if (!currentClosed) { currentJournal.close(); currentClosed = true; } },
    close() { catalog.close(); if (!currentClosed) currentJournal.close(); if (!oldClosed) oldJournal.close(); } };
}

describe('retired workshop Stop', () => {
  it('settles the original no-effects designing run, writes a durable tombstone, releases ownership, and is idempotent', () => {
    const f = retiredFixture();
    try {
      const oldCursor = f.oldJournal.cursor(); f.closeOld();
      expect(f.catalog.reconcileStartup(f.replacementDirectory, 'new-run', f.currentJournal)).toMatchObject({ state: 'held', reason: 'runtime_replacement_requires_reconciliation' });
      const result = f.catalog.stopRetiredWorkshop(f.id, 'operator_stop', f.replacementDirectory, 'new-run', f.currentJournal);
      expect(result).toMatchObject({ id: f.id, state: 'cancelled', reason: 'operator_stop' });
      expect(f.catalog.owner()).toBeNull();
      expect(f.catalog.stopRequested(f.id)).toBe(true);
      expect(f.catalog.stopRetiredWorkshop(f.id, 'operator_stop', f.replacementDirectory, 'new-run', f.currentJournal)).toEqual(result);
      const reopened = new SqliteJournal(path.join(f.oldDirectory, 'runtime.sqlite'));
      expect(reopened.get('old-run', 'workshopSessions', f.id)).toEqual(f.session);
      expect(reopened.cursor()).toBe(oldCursor); reopened.close();
      expect(f.catalog.admit('successor', 'workshop', { id: 'successor' }, f.replacementDirectory).request.state).toBe('preparing');
    } finally { f.close(); }
  });

  it.each([
    ['unknown dispatched effect', { operationIntents: { 'retired-workshop:1:design': { stage: 'designing', status: 'unknown', at: '2026-10-02T00:00:00Z' } } }],
    ['dispatched effect', { operationIntents: { 'retired-workshop:1:design': { stage: 'designing', status: 'dispatched', at: '2026-10-02T00:00:00Z' } } }],
    ['incomplete provider budget', { operationIntents: { 'retired-workshop:1:design': { stage: 'designing', status: 'acknowledged', at: '2026-10-02T00:00:00Z' } } }],
  ])('keeps ownership and journal evidence for %s', (_label, overrides) => {
    const f = retiredFixture(overrides);
    const before = f.oldJournal.snapshot();
    let providerBefore: Buffer | null = null;
    try {
      if (_label === 'incomplete provider budget') {
        const usage = path.join(f.oldDirectory, 'workshop-live', f.id); mkdirSync(usage, { recursive: true });
        writeFileSync(path.join(usage, 'provider-budget.json'), JSON.stringify({ invocations: { one: { status: 'unknown' } } }));
        providerBefore = readFileSync(path.join(usage, 'provider-budget.json'));
      }
      f.closeOld();
      const result = f.catalog.stopRetiredWorkshop(f.id, 'operator_stop', f.replacementDirectory, 'new-run', f.currentJournal);
      expect(result).toMatchObject({ state: 'held', reason: 'unresolved_effect_receipt' });
      expect(f.catalog.owner()).toMatchObject({ id: f.id, state: 'held' });
      const unchanged = new SqliteJournal(path.join(f.oldDirectory, 'runtime.sqlite'));
      expect(unchanged.snapshot()).toEqual(before); unchanged.close();
      if (providerBefore) expect(readFileSync(path.join(f.oldDirectory, 'workshop-live', f.id, 'provider-budget.json'))).toEqual(providerBefore);
    } finally { f.close(); }
  });

  it('holds missing and ambiguous historical evidence without settling ownership', () => {
    const f = retiredFixture();
    try {
      f.closeOld();
      rmSync(path.join(f.oldDirectory, 'runtime.sqlite'));
      expect(f.catalog.stopRetiredWorkshop(f.id, 'operator_stop', f.replacementDirectory, 'new-run', f.currentJournal)).toMatchObject({ state: 'held', reason: 'workspace_journal_missing' });
      expect(f.catalog.owner()).toMatchObject({ id: f.id, state: 'held' });
    } finally { f.close(); }
  });

  it('holds when the catalog runtime identity does not match the only historical journal run', () => {
    const f = retiredFixture();
    try {
      f.catalog.beginWorkshop(f.oldDirectory, 'catalog-runtime', { id: f.id, objective: 'Build green circuits', comparisonSeries: 'series' } as never);
      f.closeOld();
      expect(f.catalog.stopRetiredWorkshop(f.id, 'operator_stop', f.replacementDirectory, 'new-run', f.currentJournal)).toMatchObject({ state: 'held', reason: 'workspace_session_identity_unconfirmed' });
      expect(f.catalog.owner()).toMatchObject({ id: f.id, state: 'held' });
    } finally { f.close(); }
  });

  it('holds when historical rows share the session ID across runs and no catalog identity disambiguates them', () => {
    const f = retiredFixture();
    try {
      f.oldJournal.append({ run: 'other-run', epoch: 'other-epoch', wallTime: new Date().toISOString(), gameTick: null, actor: 'operator', task: null,
        causation: null, correlation: null, visibility: { kind: 'operator' } }, 'workshop/configured', [{ entity: 'workshopSessions', id: f.id, value: { ...f.session, stage: 'complete' } }]);
      f.closeOld();
      expect(f.catalog.stopRetiredWorkshop(f.id, 'operator_stop', f.replacementDirectory, 'new-run', f.currentJournal)).toMatchObject({ state: 'held', reason: 'workspace_session_identity_unconfirmed' });
      expect(f.catalog.owner()).toMatchObject({ id: f.id, state: 'held' });
    } finally { f.close(); }
  });

  it('reads the registered historical run when a replacement reuses the same directory under a new runtime identity', () => {
    const f = retiredFixture({ operationIntents: { 'retired-workshop:1:design': { stage: 'designing', status: 'unknown', at: '2026-10-02T00:00:00Z' } } });
    const assignment = { id: f.id, objective: 'Build green circuits', comparisonSeries: 'series' };
    try {
      f.catalog.beginWorkshop(f.oldDirectory, 'old-run', assignment as never);
      f.closeOld(); f.currentJournal.close();
      const reusedDirectoryJournal = new SqliteJournal(path.join(f.oldDirectory, 'runtime.sqlite'));
      try {
        expect(f.catalog.stopRetiredWorkshop(f.id, 'operator_stop', f.oldDirectory, 'replacement-run', reusedDirectoryJournal)).toMatchObject({ state: 'held', reason: 'unresolved_effect_receipt' });
        expect(f.catalog.owner()).toMatchObject({ id: f.id, state: 'held' });
      } finally { reusedDirectoryJournal.close(); }
    } finally { f.close(); }
  });

  it('holds unknown effects when the reused current directory has no projection under the registered source runtime', () => {
    const f = retiredFixture({ operationIntents: { 'retired-workshop:1:design': { stage: 'designing', status: 'unknown', at: '2026-10-02T00:00:00Z' } } });
    const assignment = { id: f.id, objective: 'Build green circuits', comparisonSeries: 'series' };
    try {
      f.catalog.beginWorkshop(f.oldDirectory, 'catalog-runtime', assignment as never);
      f.closeOld(); f.closeCurrent();
      const reusedDirectoryJournal = new SqliteJournal(path.join(f.oldDirectory, 'runtime.sqlite'));
      try {
        expect(f.catalog.stopRetiredWorkshop(f.id, 'operator_stop', f.oldDirectory, 'replacement-runtime', reusedDirectoryJournal))
          .toMatchObject({ state: 'held', reason: 'workspace_session_identity_unconfirmed' });
        expect(f.catalog.owner()).toMatchObject({ id: f.id, state: 'held' });
      } finally { reusedDirectoryJournal.close(); }
    } finally { f.close(); }
  });

  it('holds a journaled registered session missing from its current source runtime', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-journaled-missing-')); roots.push(root);
    const directory = path.join(root, 'current'), journal = new SqliteJournal(path.join(directory, 'runtime.sqlite'));
    const catalog = new WorkspaceCatalog(root), id = 'journaled-missing';
    try {
      catalog.admit(id, 'workshop', { id, objective: 'Build green circuits' }, directory);
      catalog.beginWorkshop(directory, 'old-run', { id, objective: 'Build green circuits', comparisonSeries: 'series' } as never);
      catalog.journaled(id);
      expect(catalog.stopRetiredWorkshop(id, 'operator_stop', directory, 'old-run', journal)).toMatchObject({ state: 'held', reason: 'workspace_session_identity_unconfirmed' });
      expect(catalog.owner()).toMatchObject({ id, state: 'held' });
    } finally { catalog.close(); journal.close(); }
  });

  it('holds a historical journal that is still locked by its old writer', () => {
    const f = retiredFixture();
    try {
      expect(f.catalog.stopRetiredWorkshop(f.id, 'operator_stop', f.replacementDirectory, 'new-run', f.currentJournal)).toMatchObject({ state: 'held', reason: 'workspace_journal_unreadable' });
      expect(f.catalog.owner()).toMatchObject({ id: f.id, state: 'held' });
    } finally { f.close(); }
  }, 12000);

  it('refuses Stop for a scenario owner', () => {
    const f = retiredFixture();
    try {
      f.catalog.transitionRequest(f.id, 'cancelled');
      f.catalog.admit('scenario-owner', 'scenario', { id: 'scenario-owner' }, f.oldDirectory);
      expect(() => f.catalog.stopRetiredWorkshop('scenario-owner', 'operator_stop', f.replacementDirectory, 'new-run', f.currentJournal)).toThrow('Workshop Stop cannot stop a scenario');
    } finally { f.close(); }
  });

  it.each([false, true])('HTTP Stop settles a retired owner with workshop host present=%s without calling the replacement controller', async (withHost) => {
    const f = retiredFixture();
    f.closeOld();
    f.closeCurrent();
    const fixture = await dashboardFixture(f.replacementDirectory, true);
    const calls = { resolve: vi.fn(async (input: unknown) => input), cancel: vi.fn(async () => { throw new Error('replacement host must not be called for retired owner'); }), reconcile: vi.fn(async () => ({ resolved: false })) };
    const host = withHost ? { ...calls, async close() {} } as never : undefined;
    const server = dashboard(fixture.operator, undefined, { workspaceCatalog: f.catalog, ...(host ? { workshopHost: host } : {}) });
    try {
      const origin = await server.listen();
      const headers = { host: new URL(origin).host, origin, authorization: `Bearer ${server.capability}` };
      const post = () => server.app.inject({ method: 'POST', url: '/api/workshop/stop', headers, payload: { sessionId: f.id, reason: 'operator_stop' } });
      expect((await post()).json()).toMatchObject({ state: 'cancelled', id: f.id });
      expect((await post()).json()).toMatchObject({ state: 'cancelled', id: f.id });
      expect(calls.resolve).not.toHaveBeenCalled();
      expect(calls.cancel).not.toHaveBeenCalled();
      expect(calls.reconcile).not.toHaveBeenCalled();
      expect(f.catalog.owner()).toBeNull();
      expect(f.catalog.stopRequested(f.id)).toBe(true);
    } finally { await server.close(); fixture.close(); f.close(); }
  });
});
