import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { listProjectProcesses, stopProfile, ownedPath } from './dev/game-processes.js';
try {
  const stop = process.argv.indexOf('--stop-profile'); const file = process.argv.indexOf('--stop-profile-file');
  if (stop >= 0 || file >= 0) {
    let config: string;
    if (file >= 0) { const record = JSON.parse(await readFile(await ownedPath(process.argv[file + 1]!), 'utf8')) as {config:string}; config = record.config; }
    else { config = process.argv[stop + 1]!; }
    console.log(JSON.stringify({ stopped: await stopProfile(path.resolve(config)) }));
  } else console.log(JSON.stringify(await listProjectProcesses(), null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : 'Process command failed'); process.exitCode = 1; }
