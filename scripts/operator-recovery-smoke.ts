import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import type { WorkshopAssignment } from '@autofactorio/contracts';
import { dashboard } from '../apps/runtime/http.js';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { Operator } from '../apps/runtime/operator.js';
import { reconcileWorkspaceStartup } from '../apps/runtime/workspace-startup.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { SerialPort } from '../packages/factorio/src/serial-port.js';
import { SqliteJournal } from '../packages/storage/src/journal.js';
import { WorkspaceCatalog } from '../packages/storage/src/workspace-catalog.js';
import { createProfile, listProjectProcesses, startServer, stopProfile, waitFor, waitForServer } from './dev/game-processes.js';
import { readFreshGame, recordFreshGame } from './dev/fresh-game.js';
import { cleanupAll } from './dev/cleanup.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
await mkdir('.runtime/operator-recovery', { recursive: true });
const evidence = await mkdtemp(path.resolve('.runtime/operator-recovery/smoke-'));
const results: unknown[] = [];
// A running unrelated server makes fresh-world attestation ambiguous; never stop it for a test.
if ((await listProjectProcesses()).some(item => item.kind === 'server')) throw new Error('Stop or save the existing project server through its supported owner before operator recovery smoke');
for (const kind of ['native', 'imported'] as const) {
  const root = path.join(evidence, kind); await mkdir(root);
  process.env.AF_GAME_PROFILE_ROOT = path.join(root, 'profiles');
  const profile = await createProfile(false, true);
  let port: SerialPort | undefined, runtime: DurableRuntime | undefined, catalog: WorkspaceCatalog | undefined;
  let server: ReturnType<typeof dashboard> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let failure: string | null = null, cleanup = false, resolverCalls = 0;
  const checks: string[] = [], preserved: Record<string, string> = {};
  try {
    await startServer(profile);
    const boundary = await recordFreshGame(profile);
    port = new SerialPort(await waitForServer(profile));
    const game = new GameClient(port, () => {}), life = new Lifecycle(port, game, () => {});
    const control = await waitFor('operator RPC', async () => { try { return await life.inspect(); } catch { return undefined; } });
    const trusted = await readFreshGame(profile, boundary, control);
    const oldDirectory = path.join(root, 'startup/dashboard-old'), current = path.join(root, 'startup/dashboard-current');
    await mkdir(oldDirectory, { recursive: true }); await mkdir(current, { recursive: true });
    catalog = new WorkspaceCatalog(root);
    const historical = new SqliteJournal(path.join(oldDirectory, 'runtime.sqlite'));
    const id = 'unknown-build', run = 'historical-runtime';
    const assignment = { id, objective: 'Produce circuits', comparisonSeries: 'recovery-smoke' } as WorkshopAssignment;
    const context = { run, epoch: 'old', wallTime: new Date().toISOString(), gameTick: null, actor: 'operator', task: null, causation: null, correlation: null, visibility: { kind: 'operator' as const } };
    if (kind === 'native') {
      catalog.admit(id, 'workshop', assignment, oldDirectory);
      const registered = catalog.beginWorkshop(oldDirectory, run, assignment);
      historical.append(context, 'workspace/registered', [
        { entity: 'workspaceGroups', id: registered.group.id, value: registered.group },
        { entity: 'workspaceRuns', id: registered.run.id, value: registered.run },
      ]);
      catalog.journaled(id); catalog.transitionRequest(id, 'active'); catalog.transitionRequest(id, 'held', 'unresolved_effect_receipt');
    }
    historical.append(context, 'workshop/configured', [{ entity: 'workshopSessions', id, value: {
      id, assignment, stage: 'held', iterations: [], operationIntents: { [`${id}:1:build`]: { status: 'unknown' } }, operationResults: {},
    } }]);
    historical.close();
    const budgetFile = path.join(oldDirectory, 'workshop-live', id, 'provider-budget.json');
    await mkdir(path.dirname(budgetFile), { recursive: true }); await writeFile(budgetFile, '{"invocations":{},"unknown":true}');
    // Keep the original map and all historical bytes; this probe creates only its own data.
    for (const file of [profile.save, path.join(oldDirectory, 'runtime.sqlite'), `${path.join(oldDirectory, 'runtime.sqlite')}-wal`, budgetFile]) {
      try { preserved[file] = hash(await readFile(file)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    runtime = new DurableRuntime(current, 'smoke-current', control.epoch, game, life, [profile.password]);
    const operator = new Operator(new Coordinator(runtime, PROBE_CAPS));
    reconcileWorkspaceStartup(catalog, runtime);
    const heldOwner = catalog.owner(); assert(heldOwner); assert.equal(heldOwner.state, 'held');
    const host = { async resolve() { resolverCalls++; throw new Error('No-inference smoke: successor admission observed'); }, async cancel() {}, async close() {} } as never;
    server = dashboard(operator, undefined, { workspaceCatalog: catalog, workshopHost: host,
      managedModels: [{ id: 'gpt-6-astra', displayName: 'Astra', efforts: ['low'] }] });
    const origin = await server.listen(); browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage(); await page.goto(`${origin}/workshop`);
    const banner = page.getByRole('region', { name: 'Active run' }); await expect(banner).toContainText(heldOwner.id);
    const headers = { origin, authorization: `Bearer ${server.capability}` };
    const denied = await fetch(`${origin}/api/workshop/launch`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ assignment: { id: 'same-world-successor', objective: 'Produce circuits' } }) });
    assert.equal(denied.status, 409); assert.equal(resolverCalls, 0); checks.push('same-world unknown effect remains held; HTTP 409 without dispatch');
    await page.screenshot({ path: path.join(root, 'held.png') });
    const recovery = reconcileWorkspaceStartup(catalog, runtime, trusted); assert.equal(recovery.retired, 1);
    assert.equal(reconcileWorkspaceStartup(catalog, runtime, trusted).retired, 0);
    await expect(banner).toHaveCount(0); await expect(page.getByRole('button', { name: 'Launch workshop' })).toBeEnabled();
    const response = page.waitForResponse(value => value.url().endsWith('/api/workshop/launch') && value.request().method() === 'POST');
    await page.getByRole('button', { name: 'Launch workshop' }).click(); assert.equal((await response).status(), 202);
    await expect.poll(() => catalog!.owner()).toBeNull(); assert.equal(resolverCalls, 1);
    await page.screenshot({ path: path.join(root, 'recovered.png') }); checks.push('attested fresh game removes banner and admits browser successor without inference; boundary replay no-op');
    await server.close(); server = undefined; catalog.close(); catalog = new WorkspaceCatalog(root);
    reconcileWorkspaceStartup(catalog, runtime); assert.equal(catalog.owner(), null); checks.push('reopen and reimport preserve retirement');
    for (const [file, expected] of Object.entries(preserved)) assert.equal(hash(await readFile(file)), expected);
    checks.push('historical journal, retained WAL, budget and original save hashes unchanged');
  } catch (error) { failure = String(error); }
  finally {
    const cleanupReceipts = await cleanupAll([
      { id: 'browser', run: () => browser?.close() }, { id: 'dashboard', run: () => server?.close() },
      { id: 'runtime', run: () => runtime?.close() }, { id: 'catalog', run: () => catalog?.close() },
      { id: 'port', run: () => port?.close() }, { id: 'game', run: () => stopProfile(profile.config) },
      { id: 'game-absence', run: async () => assert(!(await listProjectProcesses()).some(item => item.config.toLowerCase() === profile.config.toLowerCase())) },
    ]);
    cleanup = cleanupReceipts.every(receipt => receipt.completed);
    failure ??= cleanup ? null : 'Owned cleanup incomplete; inspect cleanupReceipts';
    const result = { kind, passed: !failure && cleanup, failure, cleanup, cleanupReceipts, checks, preserved, modelInference: false, resolverCalls };
    results.push(result); await writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ kind, passed: result.passed, checks: checks.length, cleanup, failure }));
    if (!result.passed) { process.exitCode = 1; break; }
  }
}
await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: results.length === 2 && !process.exitCode, results, modelInference: false }, null, 2));
console.log(JSON.stringify({ evidence }));
