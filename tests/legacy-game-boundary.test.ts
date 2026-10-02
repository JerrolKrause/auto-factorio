import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dashboard } from '../apps/runtime/http.js';
import { dashboardFixture } from '../scripts/dev/dashboard-fixture.js';
import type { ControlState } from '../packages/factorio/src/lifecycle.js';
import { SqliteJournal } from '../packages/storage/src/journal.js';
import { WorkspaceCatalog } from '../packages/storage/src/workspace-catalog.js';
import { validateFreshGame, type FreshGameReceipt } from '../scripts/dev/fresh-game.js';
import type { ProjectProcess } from '../scripts/dev/game-processes.js';

const context = (run: string) => ({ run, epoch: 'epoch', wallTime: '2026-10-01T12:00:00Z', gameTick: null,
  actor: null, task: null, causation: null, correlation: null, visibility: { kind: 'operator' as const } });
const initialControl = (): ControlState => ({ ok: true, epoch: 'epoch', session: 'session', revision: 0, generation: 1,
  armed: false, ready: false, paused: true, neutral: true, ticksToRun: 0, tick: 0, ticksPlayed: 0, experimentTick: 0,
  scenarioElapsed: 0, injections: 0, checkpoint: false, ledger: {}, intents: {}, production: {}, mods: {} });

describe('fresh game legacy boundary', () => {
  it('retires all imported historical owners while preserving journals and budget, then admits a successor', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-fresh-boundary-'));
    let catalog: WorkspaceCatalog | undefined;
    const journals: SqliteJournal[] = [];
    try {
      const owners = ['owner-a', 'owner-b', 'scenario-retired'];
      const original = new Map<string, Buffer>();
      owners.forEach((id, index) => {
        const directory = path.join(root, 'startup', `dashboard-${index}`); mkdirSync(directory, { recursive: true });
        const journal = new SqliteJournal(path.join(directory, 'runtime.sqlite')); journals.push(journal);
        if (id === 'scenario-retired') {
          journal.append(context(id), 'run/created', [{ entity: 'runs', id: 'scenario', value: { objective: 'Retired scenario', scenario: '01-first-shift' } }]);
          journal.append(context(id), 'run/control', [{ entity: 'runs', id: 'operator-control', value: { status: 'paused' } }]);
        } else {
          journal.append(context(id), 'workshop/configured', [{ entity: 'workshopSessions', id, value: { id,
            stage: 'held', stopReason: 'provider outcome unknown', assignment: { id, objective: 'Historical workshop' },
            operationIntents: { design: { status: 'unknown' } } } }]);
        }
      });
      const files = journals.map((_, index) => path.join(root, 'startup', `dashboard-${index}`, 'runtime.sqlite'));
      files.forEach((file, index) => { journals[index]!.close(); original.set(file, readFileSync(file)); });
      journals.length = 0;
      const budgetFile = path.join(root, 'startup', 'dashboard-0', 'workshop-live', 'owner-a', 'provider-budget.json');
      mkdirSync(path.dirname(budgetFile), { recursive: true });
      const budget = '{"turns":1,"tools":8,"unknown":true}'; writeFileSync(budgetFile, budget);
      catalog = new WorkspaceCatalog(root);
      let activeCatalog = catalog;
      activeCatalog.importLegacy();
      const priorCandidates = activeCatalog.listGroups().flatMap(group => activeCatalog.listRuns(group.id)).map(run => run.identity.id);
      expect(priorCandidates).toHaveLength(3);
      const freshId = randomUUID(); const profile = path.join(root, 'profiles', 'fresh'); mkdirSync(profile, { recursive: true });
      expect(activeCatalog.retireLegacyForFreshGame(freshId, profile)).toBe(3);
      expect(activeCatalog.owner()).toBeNull();
      expect(readFileSync(budgetFile, 'utf8')).toBe(budget);
      for (const [file, bytes] of original) expect(readFileSync(file)).toEqual(bytes);
      for (const id of priorCandidates) expect(activeCatalog.request(id)?.reason).toBe(`historical_game_replaced:${freshId}`);
      activeCatalog.close(); catalog = activeCatalog = new WorkspaceCatalog(root);
      expect(activeCatalog.importLegacy().registered).toBe(0);
      expect(activeCatalog.owner()).toBeNull();
      const next = activeCatalog.admit('successor', 'workshop', { objective: 'New workshop' });
      expect(next.newlyAdmitted).toBe(true);
      expect(activeCatalog.owner()?.id).toBe('successor');
    } finally { catalog?.close(); journals.forEach(journal => journal.close()); rmSync(root, { recursive: true, force: true }); }
  });

  it('does not relabel terminal legacy requests, retire without attestation, or retire native unknown owners', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-fresh-boundary-native-'));
    let catalog: WorkspaceCatalog | undefined;
    try {
      const profile = path.join(root, 'profiles', 'fresh'); mkdirSync(profile, { recursive: true });
      catalog = new WorkspaceCatalog(root);
      const activeCatalog = catalog;
      for (const [directoryName, id, stage] of [['complete', 'legacy-complete', 'complete'], ['stopped', 'legacy-stopped', 'stopped']] as const) {
        const directory = path.join(root, 'startup', `dashboard-${directoryName}`); mkdirSync(directory, { recursive: true });
        const journal = new SqliteJournal(path.join(directory, 'runtime.sqlite'));
        journal.append(context(id), `workshop/${stage}`, [{ entity: 'workshopSessions', id, value: { id, stage,
          assignment: { id, objective: id }, iterations: [] } }]);
        journal.close();
      }
      activeCatalog.importLegacy();
      const terminalRuns = activeCatalog.listGroups().flatMap(group => activeCatalog.listRuns(group.id)).map(run => run.identity.id);
      expect(terminalRuns).toHaveLength(2);
      expect(terminalRuns.every(id => activeCatalog.request(id) === null)).toBe(true);
      expect(activeCatalog.retireLegacyForFreshGame(randomUUID(), profile)).toBe(0);
      expect(terminalRuns.every(id => activeCatalog.request(id) === null)).toBe(true);
      activeCatalog.admit('native-unknown', 'workshop', { objective: 'native' });
      activeCatalog.transitionRequest('native-unknown', 'active'); activeCatalog.transitionRequest('native-unknown', 'held', 'unknown effect');
      expect(activeCatalog.owner()?.id).toBe('native-unknown');
      expect(activeCatalog.request('native-unknown')).toMatchObject({ state: 'held', reason: 'unknown effect' });
      expect(activeCatalog.retireLegacyForFreshGame(randomUUID(), profile)).toBe(0);
      expect(activeCatalog.owner()?.id).toBe('native-unknown');
      expect(() => activeCatalog.admit('blocked-successor', 'scenario', { scenario: 'S1' })).toThrow('owned by native-unknown');
    } finally { catalog?.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it('makes an identical boundary replay a no-op and rejects profile and UUID collisions', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-fresh-boundary-replay-'));
    const catalog = new WorkspaceCatalog(root);
    try {
      const profile = path.join(root, 'profiles', 'one'); mkdirSync(profile, { recursive: true });
      const id = randomUUID();
      expect(catalog.retireLegacyForFreshGame(id, profile)).toBe(0);
      expect(catalog.retireLegacyForFreshGame(id, profile)).toBe(0);
      expect(() => catalog.retireLegacyForFreshGame(id, path.join(root, 'missing'))).toThrow();
      expect(() => catalog.retireLegacyForFreshGame(randomUUID(), root)).toThrow('outside project runtime');
      expect(() => catalog.retireLegacyForFreshGame('not-a-uuid', profile)).toThrow('Invalid fresh game boundary');
    } finally { catalog.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it('serves an empty owner and admits an HTTP workshop after trusted legacy retirement', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-fresh-boundary-http-'));
    const oldDirectory = path.join(root, 'startup', 'dashboard-old'); mkdirSync(oldDirectory, { recursive: true });
    const oldJournal = new SqliteJournal(path.join(oldDirectory, 'runtime.sqlite'));
    const catalog = new WorkspaceCatalog(root);
    const currentDirectory = path.join(root, 'startup', 'dashboard-current'); mkdirSync(currentDirectory, { recursive: true });
    const fixture = await dashboardFixture(currentDirectory);
    let server: ReturnType<typeof dashboard> | undefined;
    let releaseResolver: (() => void) | undefined;
    try {
      oldJournal.append(context('historical-run'), 'workshop/configured', [{ entity: 'workshopSessions', id: 'historical-owner',
        value: { id: 'historical-owner', stage: 'held', stopReason: 'provider outcome unknown', assignment: { id: 'historical-owner', objective: 'Historical' },
          operationIntents: { design: { status: 'unknown' } } } }]);
      oldJournal.close();
      catalog.importLegacy();
      expect(catalog.owner()).toMatchObject({ id: expect.stringContaining('legacy-workshop-'), state: 'held' });
      const profile = path.join(root, 'profiles', 'fresh'); mkdirSync(profile, { recursive: true });
      catalog.retireLegacyForFreshGame(randomUUID(), profile);
      let resolveCalls = 0;
      const heldResolver = new Promise<void>(resolve => { releaseResolver = resolve; });
      const host = { async resolve() { resolveCalls++; await heldResolver; throw new Error('fixture admission complete'); } } as never;
      server = dashboard(fixture.operator, undefined, { workspaceCatalog: catalog, workshopHost: host });
      const origin = await server.listen();
      const headers = { host: new URL(origin).host, origin, authorization: `Bearer ${server.capability}` };
      const owner = await server.app.inject({ method: 'GET', url: '/api/workspace/owner', headers });
      expect(owner.statusCode).toBe(200); expect(owner.json()).toEqual({ owner: null });
      const post = await server.app.inject({ method: 'POST', url: '/api/workshop/launch', headers, payload: { assignment: { id: 'successor-http', objective: 'Produce circuits' } } });
      expect(post.statusCode).toBe(202); expect(post.json()).toMatchObject({ id: 'successor-http', state: 'preparing' });
      expect(resolveCalls).toBe(1);
      expect(catalog.owner()?.id).toBe('successor-http');
      releaseResolver?.(); await new Promise(resolve => setTimeout(resolve, 10));
      expect(catalog.request('successor-http')?.state).toBe('failed');
    } finally { releaseResolver?.(); if (server) await server.close(); fixture.close(); catalog.close(); oldJournal.close(); rmSync(root, { recursive: true, force: true }); }
  }, 20000);

  it('accepts only a recent receipt for the exact fresh profile, process, and untouched control state', () => {
    const directory = path.resolve('test-fresh-profile'); const now = Date.now(); const id = randomUUID();
    const receipt: FreshGameReceipt = { id, profile: directory, createdAt: new Date(now).toISOString(), server: { pid: 1234, startedAt: '2026-10-02T12:00:00.000Z' } };
    const server: ProjectProcess = { pid: 1234, config: path.join(directory, 'config.ini'), startedAt: receipt.server.startedAt, kind: 'server' };
    expect(validateFreshGame(receipt, id, directory, initialControl(), [server], now)).toEqual(receipt);
    const invalidControl = (patch: Partial<ControlState>) => ({ ...initialControl(), ...patch });
    const invalidCases: Array<[string, FreshGameReceipt, string, string, ControlState, ProjectProcess[], number]> = [
      ['stale', { ...receipt, createdAt: new Date(now - 180_001).toISOString() }, id, directory, initialControl(), [server], now],
      ['future', { ...receipt, createdAt: new Date(now + 1).toISOString() }, id, directory, initialControl(), [server], now],
      ['invalid UUID', receipt, 'bad-id', directory, initialControl(), [server], now],
      ['receipt identity', { ...receipt, id: randomUUID() }, id, directory, initialControl(), [server], now],
      ['profile mismatch', receipt, id, `${directory}-other`, initialControl(), [server], now],
      ['PID reuse', receipt, id, directory, initialControl(), [{ ...server, pid: 1235 }], now],
      ['process start mismatch', receipt, id, directory, initialControl(), [{ ...server, startedAt: '2026-10-02T12:00:01.000Z' }], now],
      ['revision changed', receipt, id, directory, invalidControl({ revision: 1 }), [server], now],
      ['armed', receipt, id, directory, invalidControl({ armed: true }), [server], now],
      ['ledger populated', receipt, id, directory, invalidControl({ ledger: { command: {} as never } }), [server], now],
      ['intent populated', receipt, id, directory, invalidControl({ intents: { command: {} } }), [server], now],
    ];
    for (const [name, badReceipt, badId, badDirectory, control, processes, timestamp] of invalidCases) {
      expect(() => validateFreshGame(badReceipt, badId, badDirectory, control, processes, timestamp), name)
        .toThrow('Fresh game boundary unconfirmed');
    }
  });
});
