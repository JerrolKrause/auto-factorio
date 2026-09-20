import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.join(root, '.runtime', 'startup');
const port = 3000;
const url = `http://localhost:${port}`;
const packageManager = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
const childProcesses = new Set();

class StartupError extends Error {
  constructor(stage, message, cause) {
    super(message, { cause });
    this.stage = stage;
  }
}

function usage() {
  console.log(`AutoFactorio startup

Usage:
  npm start              Prepare dependencies, build, start the app, and open ${url}
  npm start -- --fixture Start the local demonstration dashboard without Factorio/Codex
  npm start -- --real    Require a real Factorio + managed Codex session

Optional environment variables:
  AUTOFACTORIO_CODEX                Absolute path to the supported codex executable
  AUTOFACTORIO_PROFILE_FILE         Existing project profile JSON for a running Factorio server
  AUTOFACTORIO_FACTORIO_DIR         Factorio installation directory
  AUTOFACTORIO_START_MODE           auto (default), fixture, or real
`);
}

function options() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  const explicit = args.includes('--fixture') ? 'fixture' : args.includes('--real') ? 'real' : null;
  const mode = explicit ?? process.env.AUTOFACTORIO_START_MODE ?? 'auto';
  if (!['auto', 'fixture', 'real'].includes(mode)) throw new StartupError('startup options', `Unknown startup mode “${mode}”. Use auto, fixture, or real.`);
  return { help: false, mode };
}

function text(error) {
  if (error instanceof StartupError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function commandInvocation(command, args, extra = {}) {
  if (process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')) {
    return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', 'call', command, ...args], options: extra };
  }
  return { command, args, options: extra };
}

function run(command, args, { label, env = process.env, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const invocation = commandInvocation(command, args, { cwd: root, env, windowsHide: true, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    const child = spawn(invocation.command, invocation.args, invocation.options);
    childProcesses.add(child);
    let stdout = '';
    let stderr = '';
    if (quiet) {
      child.stdout.on('data', chunk => { stdout += chunk.toString(); });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    }
    child.once('error', error => { childProcesses.delete(child); reject(new StartupError(label ?? 'command', `Could not start ${label ?? command}: ${error.message}`, error)); });
    child.once('exit', code => {
      childProcesses.delete(child);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new StartupError(label ?? 'command', `${label ?? command} failed with exit code ${code ?? 'unknown'}.${stderr.trim() ? `\n${stderr.trim()}` : ''}`));
    });
  });
}

function executableVersion(candidate) {
  try {
    const invocation = commandInvocation(candidate, ['--version'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    const result = spawnSync(invocation.command, invocation.args, invocation.options);
    return result.status === 0 ? `${result.stdout ?? ''}`.trim() : '';
  } catch {
    return '';
  }
}

function which(name) {
  const result = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.split(/\r?\n/).map(value => value.trim()).find(Boolean) : undefined;
}

function findCodex() {
  const candidates = [];
  if (process.env.AUTOFACTORIO_CODEX) candidates.push(process.env.AUTOFACTORIO_CODEX);
  for (const name of process.platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex'] : ['codex']) candidates.push(which(name));
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'codex.cmd'));
  for (const candidate of candidates.filter(Boolean)) {
    const version = executableVersion(candidate);
    if (version === 'codex-cli 0.155.1') return candidate;
  }
  return undefined;
}

function factorioDirectory() {
  if (process.env.AUTOFACTORIO_FACTORIO_DIR) return process.env.AUTOFACTORIO_FACTORIO_DIR;
  if (process.env.AUTOFACTORIO_FACTORIO_EXECUTABLE) return path.resolve(process.env.AUTOFACTORIO_FACTORIO_EXECUTABLE, '..', '..', '..');
  const defaultDirectory = process.platform === 'win32' ? 'C:/Program Files (x86)/Steam/steamapps/common/Factorio' : '';
  return defaultDirectory || undefined;
}

function factorioAvailable() {
  const directory = factorioDirectory();
  return directory && existsSync(path.join(directory, 'bin', 'x64', process.platform === 'win32' ? 'factorio.exe' : 'factorio')) ? directory : undefined;
}

function probePort() {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function healthCheck() {
  return new Promise(resolve => {
    const request = http.get(`${url}/health`, { timeout: 1500 }, response => {
      response.resume();
      resolve(response.statusCode === 200 && response.headers['x-autofactorio-service'] === 'dashboard');
    });
    request.once('error', () => resolve(false));
    request.once('timeout', () => { request.destroy(); resolve(false); });
  });
}

async function waitForHealth(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await healthCheck()) return;
    if (child.exitCode !== null) throw new StartupError('dashboard launch', 'The dashboard stopped before it became ready. Read the error above and correct that prerequisite before retrying.');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new StartupError('dashboard launch', `The dashboard did not become ready at ${url} within 30 seconds.`);
}

function openBrowser() {
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', url], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    } else {
      const child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
    }
    return true;
  } catch {
    return false;
  }
}

function printPrerequisiteHelp() {
  console.error('\nStartup stopped before launching the app.');
  console.error('Install Node.js 24 LTS, then run npm start again. Git is not required to run an installed copy.');
}

async function prepareDependencies() {
  if (process.versions.node.split('.')[0] !== '24') throw new StartupError('Node.js check', `This project requires Node.js 24 LTS. You are running ${process.version}. Install Node.js 24 LTS and run npm start again.`);
  const invocation = commandInvocation(packageManager, ['pnpm', '--version'], { cwd: root, encoding: 'utf8', windowsHide: true });
  const manager = spawnSync(invocation.command, invocation.args, invocation.options);
  if (manager.status !== 0) throw new StartupError('package manager check', `Corepack could not start pnpm${manager.error ? `: ${manager.error.message}` : manager.stderr ? `: ${manager.stderr.trim()}` : ` (exit ${manager.status ?? 'unknown'})`}. Install or enable the Corepack bundled with Node.js 24 LTS, then run npm start again.`);
  console.log(`Using Node.js ${process.version} and pnpm ${manager.stdout.trim()}.`);
  await run(packageManager, ['pnpm', 'install', '--frozen-lockfile'], { label: 'dependency installation' });
  await run(packageManager, ['pnpm', 'build'], { label: 'application build' });
}

async function launchDashboard(mode, codex, profileFile) {
  const directory = await mkdtemp(path.join(runtimeRoot, 'dashboard-'));
  const args = ['dist/scripts/dashboard.js', '--port', String(port), '--directory', directory];
  if (mode === 'fixture') args.push('--fixture');
  else args.push('--profile-file', profileFile, '--codex', codex);
  const child = spawn(process.execPath, args, { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  childProcesses.add(child);
  child.stdout.on('data', chunk => process.stdout.write(`[dashboard] ${chunk}`));
  child.stderr.on('data', chunk => process.stderr.write(`[dashboard] ${chunk}`));
  child.once('exit', () => childProcesses.delete(child));
  await waitForHealth(child);
  return { child, directory };
}

async function stopGame(profileFile) {
  if (!profileFile || !existsSync(profileFile)) return;
  try { await run(process.execPath, ['dist/scripts/game-processes.js', '--stop-profile-file', profileFile], { label: 'Factorio cleanup' }); }
  catch (error) { console.error(`\nWARNING: ${text(error)} The project-owned Factorio process may still be running. Run npm run game:processes to inspect it.`); }
}

async function main() {
  const selected = options();
  if (selected.help) { usage(); return; }
  await mkdir(runtimeRoot, { recursive: true });
  if (await probePort()) {
    if (await healthCheck()) {
      console.log(`AutoFactorio is already running at ${url}. Opening the existing session instead of starting a duplicate.`);
      if (!openBrowser()) console.log(`Open ${url} in a browser.`);
      return;
    }
    throw new StartupError('port check', `Port ${port} is already used by another application. Close that application or free localhost:${port}; AutoFactorio intentionally uses a fixed port so bookmarks remain stable.`);
  }
  await prepareDependencies();
  const codex = findCodex();
  const factorio = factorioAvailable();
  const requestedProfile = process.env.AUTOFACTORIO_PROFILE_FILE;
  const realRequested = selected.mode === 'real' || Boolean(requestedProfile);
  let mode = selected.mode === 'fixture' ? 'fixture' : 'real';
  let profileFile = requestedProfile ? path.resolve(requestedProfile) : undefined;
  if (mode === 'real' && !codex) {
    const reason = 'Supported managed Codex 0.155.1 was not found. Set AUTOFACTORIO_CODEX to its absolute executable path.';
    if (realRequested) throw new StartupError('managed Codex check', reason);
    console.warn(`\nNOTICE: ${reason}`);
    console.warn('Starting the local demonstration dashboard. It has no Factorio connection and performs no model inference.');
    mode = 'fixture';
  }
  if (mode === 'real' && !profileFile && !factorio) {
    const reason = 'A Factorio installation was not found. Set AUTOFACTORIO_FACTORIO_DIR or AUTOFACTORIO_PROFILE_FILE to a project-owned server profile.';
    if (realRequested) throw new StartupError('Factorio check', reason);
    console.warn(`\nNOTICE: ${reason}`);
    console.warn('Starting the local demonstration dashboard. It has no Factorio connection and performs no model inference.');
    mode = 'fixture';
  }
  if (mode === 'real' && !profileFile) {
    profileFile = path.join(runtimeRoot, 'factorio-profile.json');
    const environment = { ...process.env, AUTOFACTORIO_FACTORIO_DIR: factorio };
    console.log('Preparing a project-owned Factorio server. This may take a few minutes the first time.');
    ownedGame = true;
    await run(process.execPath, ['dist/scripts/game-launch.js', '--headless', '--result-file', profileFile], { label: 'Factorio launch', env: environment });
  }
  if (mode === 'real' && (!profileFile || !existsSync(profileFile))) throw new StartupError('Factorio profile check', 'The requested Factorio profile file does not exist. Provide a valid project-owned profile with AUTOFACTORIO_PROFILE_FILE.');
  const launched = await launchDashboard(mode, codex, profileFile);
  await writeFile(path.join(runtimeRoot, 'session.json'), JSON.stringify({ url, mode, profileFile: profileFile ?? null, directory: launched.directory, startedAt: new Date().toISOString() }, null, 2));
  console.log(`\nAutoFactorio is ready at ${url}`);
  console.log(mode === 'fixture' ? 'Mode: local demonstration (no game or model inference).' : 'Mode: connected Factorio session (starts paused; model inference remains user-controlled).');
  if (!openBrowser()) console.log(`Open ${url} in a browser.`);
  const stopped = await new Promise(resolve => launched.child.once('exit', (code, signal) => resolve({ code, signal })));
  if (!stopping) throw new StartupError('dashboard runtime', `The dashboard stopped unexpectedly (${stopped.code ?? stopped.signal ?? 'unknown outcome'}).`);
  await stopGame(ownedGame ? profileFile : undefined);
}

let stopping = false;
let ownedGame = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of childProcesses) child.kill('SIGINT');
}
process.on('SIGINT', () => { process.exitCode = 0; void shutdown(); });
process.on('SIGTERM', () => { process.exitCode = 0; void shutdown(); });

try {
  await main();
} catch (error) {
  if (ownedGame) await stopGame(process.env.AUTOFACTORIO_PROFILE_FILE ? undefined : path.join(runtimeRoot, 'factorio-profile.json'));
  if (error instanceof StartupError && error.stage === 'Node.js check') printPrerequisiteHelp();
  else console.error(`\nSTARTUP ERROR: ${text(error)}`);
  process.exitCode = 1;
} finally {
  for (const child of childProcesses) child.kill('SIGTERM');
}
