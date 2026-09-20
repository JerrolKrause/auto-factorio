import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { listProjectProcesses, stopProfile, ownedPath, readProfile } from './dev/game-processes.js';
try {
  const stop = process.argv.indexOf('--stop-profile'); const file = process.argv.indexOf('--stop-profile-file'); const observerFile=process.argv.indexOf('--stop-observer-profile-file');
  if (stop >= 0 || file >= 0 || observerFile >= 0) {
    let config: string;
    if(observerFile>=0){
      const descriptor=JSON.parse(await readFile(await ownedPath(process.argv[observerFile+1]!),'utf8')) as {dir?:string};
      if(!descriptor.dir)throw new Error('Project profile descriptor is missing its directory');
      const observer=await readProfile(descriptor.dir);
      console.log(JSON.stringify({stopped:await stopProfile(observer.observerConfig)}));
    } else if (file >= 0) {
      const descriptor = JSON.parse(await readFile(await ownedPath(process.argv[file + 1]!), 'utf8')) as {config:string;dir?:string}; config = descriptor.config;
      const observer=descriptor.dir?await readProfile(descriptor.dir):null;
      const stoppedObserver=observer?await stopProfile(observer.observerConfig):[];
      console.log(JSON.stringify({ stopped: [...stoppedObserver,...await stopProfile(path.resolve(config))] }));
    } else {
      config = process.argv[stop + 1]!;
      console.log(JSON.stringify({ stopped: await stopProfile(path.resolve(config)) }));
    }
  } else console.log(JSON.stringify(await listProjectProcesses(), null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : 'Process command failed'); process.exitCode = 1; }
