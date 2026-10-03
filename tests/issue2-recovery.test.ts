import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorkshopAssignment } from '@autofactorio/contracts';
import type { ControlState } from '../packages/factorio/src/lifecycle.js';
import { SqliteJournal } from '../packages/storage/src/journal.js';
import { WorkspaceCatalog } from '../packages/storage/src/workspace-catalog.js';
import { safeProcess, type ProjectProcess } from '../scripts/dev/game-processes.js';
import { validateFreshGame, type FreshGameReceipt } from '../scripts/dev/fresh-game.js';
import { reconcileWorkspaceStartup } from '../apps/runtime/workspace-startup.js';

const context = (run: string) => ({ run, epoch: 'epoch', wallTime: '2026-10-02T12:00:00.000Z', gameTick: null,
  actor: 'operator', task: null, causation: null, correlation: null, visibility: { kind: 'operator' as const } });
const initialControl = (): ControlState => ({ ok: true, epoch: 'epoch', session: 'session', revision: 0, generation: 1,
  armed: false, ready: false, paused: true, neutral: true, ticksToRun: 0, tick: 0, ticksPlayed: 0, experimentTick: 0,
  scenarioElapsed: 0, injections: 0, checkpoint: false, ledger: {}, intents: {}, production: {}, mods: {} });

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'af-issue2-startup-'));
  const currentDirectory = path.join(root, 'startup', 'dashboard-current');
  const profile = path.join(root, 'profiles', 'fresh');
  mkdirSync(currentDirectory, { recursive: true }); mkdirSync(profile, { recursive: true });
  const currentJournal = new SqliteJournal(path.join(currentDirectory, 'runtime.sqlite'));
  const catalog = new WorkspaceCatalog(root);
  const runtime = { directory: currentDirectory, run: 'dashboard-current', journal: currentJournal };
  let catalogClosed = false;
  return {
    root, currentDirectory, profile, currentJournal, catalog, runtime,
    reconcile(freshGame?: { id: string; profile: string }) { return reconcileWorkspaceStartup(catalog, runtime, freshGame); },
    closeCatalog() { if (!catalogClosed) { catalog.close(); catalogClosed = true; } },
    close() { currentJournal.close(); if (!catalogClosed) catalog.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

function appendSession(journal: SqliteJournal, run: string, id: string, stage: string, status: string) {
  const assignment = { id, objective: `Objective ${id}`, comparisonSeries: `series-${id}` };
  journal.append(context(run), 'workshop/configured', [{ entity: 'workshopSessions', id, value: {
    id, assignment, stage, iterations: [], operationIntents: { [`${id}:1:build`]: { status } }, operationResults: {},
  } }]);
  return assignment as WorkshopAssignment;
}

function createNativeOwner(f: ReturnType<typeof fixture>, options: {
  id: string; sourceDirectory?: string; requestDirectory?: string; runtimeRun?: string; stage?: string; status?: string; journaled?: boolean;
}) {
  const sourceDirectory = options.sourceDirectory ?? path.join(f.root, 'startup', 'dashboard-old');
  const requestDirectory = options.requestDirectory ?? sourceDirectory;
  const runtimeRun = options.runtimeRun ?? 'dashboard-old';
  mkdirSync(sourceDirectory, { recursive: true }); mkdirSync(requestDirectory, { recursive: true });
  const assignment = { id: options.id, objective: `Objective ${options.id}`, comparisonSeries: `series-${options.id}` } as WorkshopAssignment;
  f.catalog.admit(options.id, 'workshop', assignment, requestDirectory);
  const registered = f.catalog.beginWorkshop(sourceDirectory, runtimeRun, assignment);
  if (options.journaled !== false) {
    const journal = new SqliteJournal(path.join(sourceDirectory, 'runtime.sqlite'));
    try {
      journal.append(context(runtimeRun), 'workspace/registered', [
        { entity: 'workspaceGroups', id: registered.group.id, value: registered.group },
        { entity: 'workspaceRuns', id: registered.run.id, value: registered.run },
      ]);
      appendSession(journal, runtimeRun, options.id, options.stage ?? 'held', options.status ?? 'unknown');
      f.catalog.journaled(options.id);
    } finally { journal.close(); }
  }
  f.catalog.transitionRequest(options.id, 'active');
  f.catalog.transitionRequest(options.id, 'held', 'unresolved_effect_receipt');
  return sourceDirectory;
}

function freshBoundary(f: ReturnType<typeof fixture>) { return { id: randomUUID(), profile: f.profile }; }

describe('issue 2 workspace startup recovery', () => {
  it('keeps an imported unknown effect held on the existing world and blocks a successor', () => {
    const f = fixture();
    try {
      const old = path.join(f.root, 'startup', 'dashboard-imported'); mkdirSync(old, { recursive: true });
      const journal = new SqliteJournal(path.join(old, 'runtime.sqlite'));
      let ownerId = '';
      try {
        appendSession(journal, 'imported-run', 'imported-owner', 'held', 'unknown');
      } finally { journal.close(); }
      const result = f.reconcile();
      const owner = f.catalog.owner(); expect(owner).toBeTruthy(); ownerId = owner!.id;
      expect(owner).toMatchObject({ state: 'held', reason: 'legacy_ownership_requires_exact_reconciliation' });
      expect(result.retired).toBe(0);
      expect(() => f.catalog.admit('same-world-successor', 'workshop', { objective: 'successor' })).toThrow(`owned by ${ownerId}`);
    } finally { f.close(); }
  });

  it('retires an imported unknown effect only at a fresh boundary and preserves journal and provider-budget bytes through replay and reopen', () => {
    const f = fixture();
    try {
      const old = path.join(f.root, 'startup', 'dashboard-imported'); mkdirSync(old, { recursive: true });
      const journal = new SqliteJournal(path.join(old, 'runtime.sqlite'));
      try { appendSession(journal, 'imported-run', 'imported-owner', 'held', 'unknown'); } finally { journal.close(); }
      const journalFile = path.join(old, 'runtime.sqlite');
      const budgetFile = path.join(old, 'workshop-live', 'imported-owner', 'provider-budget.json');
      mkdirSync(path.dirname(budgetFile), { recursive: true });
      const budget = Buffer.from('{"invocations":{"design":{"status":"unknown"}},"remaining":0}'); writeFileSync(budgetFile, budget);
      const journalBytes = readFileSync(journalFile); const boundary = freshBoundary(f);

      expect(f.reconcile(boundary).retired).toBe(1);
      const retired = f.catalog.listGroups().flatMap(group => f.catalog.listRuns(group.id)).find(run => run.identity.id.startsWith('legacy-workshop-'))!;
      expect(f.catalog.request(retired.identity.id)).toMatchObject({ state: 'failed', reason: `historical_game_replaced:${boundary.id}` });
      expect(f.catalog.owner()).toBeNull();
      expect(f.reconcile(boundary).retired).toBe(0);
      expect(readFileSync(journalFile)).toEqual(journalBytes);
      expect(readFileSync(budgetFile)).toEqual(budget);

      f.closeCatalog();
      const reopened = new WorkspaceCatalog(f.root);
      try {
        expect(reconcileWorkspaceStartup(reopened, f.runtime).owner).toBeNull();
        expect(reopened.importLegacy().registered).toBe(0);
        expect(reopened.owner()).toBeNull();
        expect(reopened.admit('fresh-world-successor', 'workshop', { objective: 'successor' }).newlyAdmitted).toBe(true);
      } finally { reopened.close(); }
      expect(readFileSync(journalFile)).toEqual(journalBytes);
      expect(readFileSync(budgetFile)).toEqual(budget);
    } finally { f.close(); }
  }, 15000);

  it.each([false, true])('does not create imported ownership for an acknowledged terminal session (fresh boundary: %s)', fresh => {
    const f = fixture();
    try {
      const old = path.join(f.root, 'startup', 'dashboard-imported-terminal'); mkdirSync(old, { recursive: true });
      const journal = new SqliteJournal(path.join(old, 'runtime.sqlite'));
      try { appendSession(journal, 'imported-terminal-run', 'imported-terminal', 'complete', 'acknowledged'); } finally { journal.close(); }
      const result = f.reconcile(fresh ? freshBoundary(f) : undefined);
      expect(result.retired).toBe(0);
      expect(f.catalog.owner()).toBeNull();
      expect(f.catalog.admit(`terminal-successor-${fresh}`, 'workshop', { objective: 'next' }).newlyAdmitted).toBe(true);
    } finally { f.close(); }
  });

  it('settles a current native run only when the exact terminal effect receipt is acknowledged', () => {
    const f = fixture();
    try {
      const assignment = { id: 'current-acknowledged', objective: 'acknowledged', comparisonSeries: 'series' } as WorkshopAssignment;
      f.catalog.admit(assignment.id, 'workshop', assignment, f.currentDirectory);
      const registered = f.catalog.beginWorkshop(f.currentDirectory, f.runtime.run, assignment);
      f.currentJournal.append(context(f.runtime.run), 'workspace/registered', [
        { entity: 'workspaceGroups', id: registered.group.id, value: registered.group },
        { entity: 'workspaceRuns', id: registered.run.id, value: registered.run },
      ]);
      f.currentJournal.append(context(f.runtime.run), 'workshop/configured', [{ entity: 'workshopSessions', id: assignment.id, value: {
        id: assignment.id, assignment, stage: 'complete', operationIntents: { [`${assignment.id}:1:build`]: { status: 'acknowledged' } },
      } }]);
      f.catalog.journaled(assignment.id); f.catalog.transitionRequest(assignment.id, 'active');

      expect(f.reconcile().owner).toMatchObject({ state: 'completed' });
      expect(f.catalog.owner()).toBeNull();
      expect(f.catalog.admit('acknowledged-successor', 'workshop', { objective: 'next' }).newlyAdmitted).toBe(true);
    } finally { f.close(); }
  });

  it('holds native unknown effects on an existing world and retires an exact old-source owner at a fresh boundary', () => {
    const f = fixture();
    try {
      const source = createNativeOwner(f, { id: 'native-unknown' });
      const originalJournal = readFileSync(path.join(source, 'runtime.sqlite'));
      const budgetFile = path.join(source, 'workshop-live', 'native-unknown', 'provider-budget.json');
      mkdirSync(path.dirname(budgetFile), { recursive: true });
      const budget = Buffer.from('{"turns":3,"tools":4}'); writeFileSync(budgetFile, budget);
      expect(f.reconcile().owner).toMatchObject({ id: 'native-unknown', state: 'held', reason: 'unresolved_effect_receipt' });
      expect(() => f.catalog.admit('blocked-native-successor', 'workshop', { objective: 'next' })).toThrow();
      const boundary = freshBoundary(f);
      expect(f.reconcile(boundary).retired).toBe(1);
      expect(f.catalog.owner()).toBeNull();
      expect(f.catalog.request('native-unknown')).toMatchObject({ state: 'failed', reason: `historical_game_replaced:${boundary.id}` });
      expect(readFileSync(path.join(source, 'runtime.sqlite'))).toEqual(originalJournal);
      expect(readFileSync(budgetFile)).toEqual(budget);
      expect(f.catalog.admit('native-successor', 'workshop', { objective: 'next' }).newlyAdmitted).toBe(true);
    } finally { f.close(); }
  });

  it.each([
    { name: 'pending registration', source: 'pending', request: 'pending', journaled: false, removeSource: false },
    { name: 'missing request source identity', source: 'missing-source', request: 'missing-source', journaled: true, removeSource: true },
    { name: 'mismatched request and registered source identities', source: 'registered-source', request: 'request-source', journaled: true, removeSource: false },
  ])('does not use a fresh boundary to retire an untrusted native owner: $name', ({ source, request, journaled, removeSource }) => {
    const f = fixture();
    try {
      const sourceDirectory = path.join(f.root, 'startup', `dashboard-${source}`);
      const requestDirectory = path.join(f.root, 'startup', `dashboard-${request}`);
      const requestSource = createNativeOwner(f, { id: `native-${source}`, sourceDirectory, requestDirectory, journaled });
      if (removeSource) rmSync(requestSource, { recursive: true, force: true });
      const result = f.reconcile(freshBoundary(f));
      expect(result.retired).toBe(0);
      expect(f.catalog.owner()).toMatchObject({ id: `native-${source}`, state: 'held' });
      expect(() => f.catalog.admit(`blocked-${source}`, 'workshop', { objective: 'next' })).toThrow();
    } finally { f.close(); }
  });

  it('replays the same boundary without retiring a later owner', () => {
    const f = fixture();
    try {
      const boundary = freshBoundary(f);
      expect(f.reconcile(boundary).retired).toBe(0);
      createNativeOwner(f, { id: 'later-native-owner' });
      expect(f.reconcile(boundary).retired).toBe(0);
      expect(f.catalog.owner()).toMatchObject({ id: 'later-native-owner', state: 'held' });
    } finally { f.close(); }
  });
});

describe('process identity timestamp precision', () => {
  it('preserves seven fractional digits and requires exact process start-time equality', () => {
    const startedAt = '2026-10-02T12:00:00.1234567Z';
    const process = safeProcess(JSON.parse(JSON.stringify({ pid: 321, config: 'C:/repo/.runtime/profile/config.ini', startedAt, kind: 'server' })));
    expect(process.startedAt).toBe(startedAt);
    expect(JSON.parse(JSON.stringify(process)).startedAt).toBe(startedAt);

    const directory = path.resolve('test-fresh-profile-precision');
    const id = randomUUID(); const now = Date.now();
    const receipt: FreshGameReceipt = { id, profile: directory, createdAt: new Date(now).toISOString(), server: { pid: process.pid, startedAt } };
    const exactServer: ProjectProcess = { ...process, config: path.join(directory, 'config.ini') };
    expect(validateFreshGame(receipt, id, directory, initialControl(), [exactServer], now)).toEqual(receipt);
    expect(() => validateFreshGame(receipt, id, directory, initialControl(), [
      { ...exactServer, startedAt: '2026-10-02T12:00:00.1234560Z' },
    ], now)).toThrow('Fresh game boundary unconfirmed');
  });
});
