import { appendFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { record } from '@autofactorio/contracts';
import { GameClient, observeRequest } from '../../packages/factorio/src/client.js';
import { Lifecycle, barrier, captureCheckpoint, prepareManagedLoad, validateCheckpoint, verifyLoaded } from '../../packages/factorio/src/lifecycle.js';
import { FirstShiftControl, fingerprint, briefing } from '../../packages/factorio/src/first-shift.js';
import type { FirstShiftManifest } from '../../packages/factorio/src/first-shift.js';
import { VerificationControl } from '../../packages/factorio/src/verification.js';
import { configureProfile, createProfile, identifyObserver, ownedPath, readProfile, startObserver, startServer, stopProfile, waitFor, waitForServer } from './game-processes.js';
import type { GameProfile } from './game-processes.js';
import { SqliteJournal } from '../../packages/storage/src/journal.js';

export interface ScenarioRun {
  run: string; directory: string; profile: string; checkpoint: string; modHash: string;
  fixtureHash: string; manifest: FirstShiftManifest; roster: 'solo' | 'team';
  epoch: string; session: string; originTick: number; originWallMs: number; previous: string | null;
}
export async function currentModHash(directory = 'mods/autofactorio') {
  const entries = await readdir(directory);
  return fingerprint(Object.fromEntries(await Promise.all(entries.map(async f => [f, fingerprint((await readFile(path.join(directory, f))).toString('base64'))]))));
}
/** A reset validates the original disarmed cache before touching the previous run. */
export async function prepareFirstShift(roster: 'solo' | 'team', previousFile?: string) {
  const modHash = await currentModHash(); let previous: ScenarioRun | undefined;
  let profile: GameProfile;
  await mkdir('.runtime/scenarios/runs', { recursive: true });
  const directory = await mkdtemp(path.resolve('.runtime/scenarios/runs/run-'));
  if (previousFile) {
    previousFile = await ownedPath(previousFile);
    previous = JSON.parse(await readFile(previousFile, 'utf8')) as ScenarioRun;
    await ownedPath(previous.checkpoint); await ownedPath(previous.directory);
    if (previous.modHash !== modHash) throw new Error('Scenario mod fingerprint changed; generate a new fixture before reset');
    const checkpoint = await validateCheckpoint(previous.checkpoint, modHash);
    const old = await readProfile(previous.profile);
    if (await currentModHash(path.join(old.mods, 'autofactorio_0.1.0')) !== modHash) throw new Error('Cached profile mod bytes differ from the validated source');
    const priorJournal = new SqliteJournal(await ownedPath(path.join(previous.directory, 'runtime.sqlite')));
    try {
      const port = await waitForServer(old);
      try {
        const client = new GameClient(port, () => {}); const lifecycle = new Lifecycle(port, client, () => {});
        const state = await lifecycle.inspect();
        // Holding the previous journal lock prevents a controller from reopening
        // and re-arming the old world between this barrier and profile shutdown.
        barrier(state);
        await writeFile(path.join(previous.directory, 'reset-out.json'), JSON.stringify({ at: new Date().toISOString(), state, successor: directory }));
      } finally { port.close(); }
      await stopProfile(old.observerConfig); await stopProfile(old.config);
    } finally { priorJournal.close(); }
    const load = path.join(directory, 'load'); await prepareManagedLoad(previous.checkpoint, modHash, load);
    const gameDirectory = path.join(directory, 'game'); await mkdir(gameDirectory);
    profile = await configureProfile(gameDirectory, path.join(load, checkpoint.save), { port: old.port, gamePort: old.gamePort, source: old });
  } else profile = await createProfile(true, false);
  await writeFile(path.join(directory, 'profile.json'), JSON.stringify({ dir: profile.dir }));
  const sink = (e: unknown) => appendFileSync(path.join(directory, 'lifecycle.jsonl'), JSON.stringify(e) + '\n');
  try {
    await startServer(profile);
    const port = await waitForServer(profile); const game = new GameClient(port, sink); const life = new Lifecycle(port, game, sink); const scenario = new FirstShiftControl(port);
    try {
      await port.command('/silent-command rcon.print("First Shift")'); await port.command('/silent-command rcon.print("First Shift")');
      if (previous) {
        const checkpoint = await validateCheckpoint(previous.checkpoint, modHash);
        verifyLoaded(checkpoint, await life.inspect(), await game.request(observeRequest), true);
      }
      await startObserver(profile); await identifyObserver(profile);
      await waitFor('Visible scenario builder', async () => { const world = await game.request(observeRequest); return record(world.actors)['builder-1'] && record(record(world.actors)['builder-1']).connected === true ? true : undefined; });
      let held = previous ? await life.inspect() : await life.pause(await life.inspect()); barrier(held);
      const manifest = previous ? await scenario.inspect() : await scenario.setup();
      if (fingerprint(manifest.mods) !== fingerprint(held.mods)) throw new Error('Cached game/mod versions differ from the running engine');
      const fixtureHash = fingerprint({ manifest, modHash });
      if (previous && previous.fixtureHash !== fixtureHash) throw new Error('Restored fixture fingerprint mismatch');
      if (!previous) await new VerificationControl(port, sink).configure(held, fixtureHash, manifest.evaluator, manifest.settlingTicks);
      const cache = path.resolve('.runtime/scenarios/cache', fixtureHash);
      const checkpoint = previous?.checkpoint ?? await captureCheckpoint({ lifecycle: life, paused: held, saveDirectory: path.join(profile.dir, 'data/saves'), outputDirectory: cache, logFile: profile.log, eventCursor: () => 0, world: () => game.request(observeRequest), modHash });
      held = await life.reconcile(await life.inspect(), []);
      const run: ScenarioRun = { run: randomUUID(), directory, profile: profile.dir, checkpoint, modHash, fixtureHash, manifest, roster, epoch: held.epoch, session: held.session, originTick: held.tick, originWallMs: Date.now(), previous: previousFile ?? null };
      await writeFile(path.join(directory, 'run.json'), JSON.stringify(run, null, 2));
      await writeFile(path.join(directory, 'briefing.json'), JSON.stringify(briefing(manifest, roster), null, 2));
      return { run, profile, port, game, life, held };
    } catch (error) { port.close(); throw error; }
  } catch (error) {
    await writeFile(path.join(directory, 'failure.txt'), String(error));
    await stopProfile(profile.observerConfig); await stopProfile(profile.config); throw error;
  }
}
