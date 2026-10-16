import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lstat, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';

// Compile first and stop on failure: old dist output must never launch a trial.
// Local pinned dependencies only; this does not install or upgrade prerequisites.
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), cases = ['sulfur-direct', 'sulfur-character', 'refining-cracking', 'sulfur-gameplay', 'refining-controls', 'sulfur-recovery'];
if (args.length !== 2 || args[0] !== '--case' || !cases.includes(args[1])) {
  console.error(`Usage: pnpm game:production-chain-probe --case ${cases.join('|')}; dedicated new game only`);
  process.exitCode = 1;
} else {
  const build = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-b', '--pretty', 'false'], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (build.status !== 0) process.exitCode = build.status ?? 1;
  else {
    const { ownedPath, stopOwnedRoot } = await import('../dist/scripts/dev/game-processes.js');
    const workspace = await realpath(root), runtime = path.join(workspace, '.runtime');
    await mkdir(runtime, { recursive: true });
    if ((await lstat(runtime)).isSymbolicLink() || await realpath(runtime) !== runtime) throw new Error('Runtime root must be a real project directory');
    const base = path.join(runtime, 'production-chain-probe');
    await mkdir(base, { recursive: true });
    if ((await lstat(base)).isSymbolicLink()) throw new Error('Probe output must not be a link');
    await ownedPath(base);
    const owned = await mkdtemp(path.join(base, 'check-'));
    let exit = 1, cleanup = false;
    try {
      const script = args[1] === 'sulfur-recovery' ? 'game-production-chain-recovery-probe.js'
        : args[1] === 'sulfur-gameplay' ? 'game-production-chain-gameplay-probe.js' : 'game-production-chain-probe.js';
      // Oil controls score three isolated trials, each with a 10-minute host budget.
      // Keep startup/cleanup bounded without interrupting a valid later trial.
      const timeoutMs = args[1] === 'refining-controls' ? 3 * 600000 + 300000 : 900000;
      const run = spawnSync(process.execPath, [path.join(root, 'dist/scripts', script), ...args], {
        cwd: root, stdio: 'inherit', windowsHide: true, timeout: timeoutMs,
        env: { ...process.env, AF_GAME_PROFILE_ROOT: owned },
      });
      exit = run.status ?? 1;
    } finally {
      // Includes timeout/failed child paths; only this invocation's fresh root.
      await stopOwnedRoot(owned); cleanup = true;
      await writeFile(path.join(owned, 'launcher-result.json'), JSON.stringify({ exit, cleanup }, null, 2), { flag: 'wx' });
    }
    process.exitCode = cleanup ? exit : 1;
  }
}
