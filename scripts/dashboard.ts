import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { dashboard } from '../apps/runtime/http.js';
import { Operator } from '../apps/runtime/operator.js';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import { team } from '../packages/core/orchestration/roles.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { readProfile, waitFor, waitForServer } from './dev/game-processes.js';
import { dashboardFixture } from './dev/dashboard-fixture.js';
import { prepareLiveWorkshopHost } from '../apps/runtime/workshop-live-host.js';
const value = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
await mkdir('.runtime/dashboard', { recursive: true });
const directory = value('--directory') ? path.resolve(value('--directory')!) : await mkdtemp(path.resolve('.runtime/dashboard/run-'));
if (!directory.startsWith(path.resolve('.runtime') + path.sep)) throw new Error('Dashboard data must be project scoped');
let operator: Operator; let runtime: DurableRuntime; let closePort = () => {}; let workshopOptions:Parameters<typeof dashboard>[2]={};
if (process.argv.includes('--fixture')) {
  const fixture = await dashboardFixture(directory, true); operator = fixture.operator; runtime = fixture.runtime;
} else {
  const file = value('--profile-file'),codex=value('--codex'); if (!file||!codex||!path.isAbsolute(codex)) throw new Error('Use --profile-file <project profile> --codex <absolute managed Codex executable>, or --fixture for synthetic UI demonstration');
  let port: Awaited<ReturnType<typeof waitForServer>> | undefined;
  try {
    const profile = await readProfile((JSON.parse(await readFile(file, 'utf8')) as { dir: string }).dir);
    port = await waitForServer(profile); closePort = () => port?.close();
    const game = new GameClient(port, () => {}); const life = new Lifecycle(port, game, () => {});
    // RCON accepts connections before Factorio has finished loading the map and
    // registering the mod interface. Poll the actual operator RPC, not the socket.
    const control = await waitFor('Factorio operator RPC', async () => {
      try { return await life.inspect(); } catch { return undefined; }
    }, 180000, 500);
    runtime = new DurableRuntime(directory, path.basename(directory), control.epoch, game, life, [profile.password]);
    const c = new Coordinator(runtime, { ...PROBE_CAPS, runMs: 3600000 });
    if (!c.agents().length) team().forEach(a => c.register(a));
    operator = new Operator(c); await operator.control('pause');
    const prepared=await prepareLiveWorkshopHost({directory,codexExecutable:codex,port,game,lifecycle:life});workshopOptions={workshopHost:prepared.host,managedModels:prepared.catalog.models};
  } catch (error) {
    port?.close();
    throw new Error(`Factorio dashboard initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const server = dashboard(operator,undefined,workshopOptions); const origin = await server.listen(Number(value('--port') ?? 3000));
const result = { origin, url: origin, capability: server.capability, directory, synthetic: process.argv.includes('--fixture') };
await writeFile(path.join(directory, 'dashboard.json'), JSON.stringify(result, null, 2));
if (value('--result-file')) await writeFile(value('--result-file')!, JSON.stringify(result));
console.log(JSON.stringify({ origin, directory, launchFile: path.join(directory, 'dashboard.json'), synthetic: result.synthetic }));
const stop = operator.start();
let closing = false;
async function close() { if (closing) return; closing = true; await stop(); await operator.control('pause'); await server.close(); runtime.close(); closePort(); }
process.on('SIGINT', () => void close()); process.on('SIGTERM', () => void close());
