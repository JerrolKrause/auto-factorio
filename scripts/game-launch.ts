import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createProfile, startServer, startObserver, identifyObserver, writeLaunchScripts, stopProfile } from './dev/game-processes.js';
const headless = process.argv.includes('--headless'); const phase04 = process.argv.includes('--phase04'); const prepareOnly = process.argv.includes('--prepare-only');
const resultFlag = process.argv.indexOf('--result-file');
const profile = await createProfile(phase04, headless); await writeLaunchScripts(profile);
const result = { dir: profile.dir, config: profile.config, port: profile.port, gamePort: profile.gamePort };
if (resultFlag >= 0) await writeFile(path.resolve(process.argv[resultFlag + 1]!), JSON.stringify(result));
try {
  const pid = prepareOnly ? undefined : await startServer(profile);
  let observerLauncherPid: number | undefined; let observerPid: number | undefined;
  if (!headless && !prepareOnly) { observerLauncherPid = await startObserver(profile); observerPid = await identifyObserver(profile); }
  await writeFile(path.join(path.dirname(profile.dir), headless ? 'headless.json' : 'current.json'), JSON.stringify({ dir: profile.dir }));
  console.log(JSON.stringify({ ...result, pid, observerPid, observerLauncherPid, visible: !headless && !prepareOnly, readiness: prepareOnly ? 'prepared' : 'RCON ready; player join is checked by probe' }));
} catch (error) { await stopProfile(profile.config); console.error(error instanceof Error ? error.message : 'Launch failed'); process.exitCode = 1; }
