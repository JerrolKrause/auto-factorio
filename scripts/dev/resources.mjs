import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import dgram from 'node:dgram';
import path from 'node:path';
import { safeRuntimePath, sha256 } from './safe-artifacts.mjs';

const execute = promisify(execFile);
export async function processIdentity(pid = process.pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('invalid process identity');
  if (process.platform === 'win32') {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`], { windowsHide: true });
    return { pid, startedAt: stdout.trim() };
  }
  const { stdout } = await execute('ps', ['-p', String(pid), '-o', 'lstart=']);
  if (!stdout.trim()) throw new Error('process identity unavailable');
  return { pid, startedAt: stdout.trim() };
}

export async function acquireResource(resource, owner, { root = process.cwd(), identify = processIdentity } = {}) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(resource.id) || !owner) throw new Error('invalid resource owner');
  const target = await safeRuntimePath(root, `.runtime/development/locks/${resource.id}.json`);
  await mkdir(path.dirname(target), { recursive: true });
  const record = { version: 1, resourceId: resource.id, owner, process: await identify(), state: 'owned' };
  try { await writeFile(target, JSON.stringify(record), { flag: 'wx', encoding: 'utf8' }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`resource ${resource.id} already owned; exact reconciliation required, heartbeat expiry grants no authority`); throw error; }
  return { target, record, fingerprint: sha256(JSON.stringify(record)) };
}

export async function releaseResource(lease, { identify = processIdentity } = {}) {
  const bytes = await readFile(lease.target, 'utf8'); const identity = await identify();
  if (sha256(bytes) !== lease.fingerprint || JSON.stringify(identity) !== JSON.stringify(lease.record.process)) throw new Error('resource ownership/process identity changed; cleanup unresolved');
  await unlink(lease.target);
}

export async function availablePort(port, protocol = 'tcp') {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !['tcp', 'udp'].includes(protocol)) throw new Error('invalid port declaration');
  await new Promise((resolve, reject) => {
    const socket = protocol === 'udp' ? dgram.createSocket('udp4') : net.createServer();
    socket.once('error', error => { try { socket.close(); } catch { /* No successful bind to release. */ } reject(new Error(`port ${port}/${protocol} unavailable: ${error.code}`)); });
    const done = () => socket.close(resolve);
    if (protocol === 'udp') socket.bind(port, '127.0.0.1', done); else socket.listen(port, '127.0.0.1', done);
  });
}

export async function graphicalFactorioAvailable() {
  if (process.platform !== 'win32') throw new Error('graphical Factorio inventory unavailable on this platform');
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-Command', "@(Get-CimInstance Win32_Process -Filter \"Name='factorio.exe'\" | Where-Object { $_.CommandLine -notmatch '--(start-server|create|benchmark|version)' }).Count"], { windowsHide: true });
  if (stdout.trim() !== '0') throw new Error('A graphical Factorio instance is already running; explicit reuse authority is required');
}

export async function probePreflight(input, { root = process.cwd(), portCheck = availablePort, guiCheck = graphicalFactorioAvailable } = {}) {
  if (!input || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0 || input.timeoutMs > 900000 || !Number.isSafeInteger(input.intervalMs) || input.intervalMs <= 0 || input.intervalMs > input.timeoutMs) throw new Error('invalid probe deadline arithmetic');
  if (input.fakeCompositionPassed !== true || input.fakeCompositionSourceMatched !== true) throw new Error('source-matched fake composition evidence required before launch');
  if (!Array.isArray(input.paths) || !input.paths.length || !Array.isArray(input.ports) || (!input.ports.length && input.mode !== 'owned-observation')) throw new Error('probe paths/ports required');
  for (const requested of input.paths) await safeRuntimePath(root, requested, { mustExist: input.mode === 'owned-observation' });
  if (input.gui === true && input.mode !== 'owned-observation') await guiCheck();
  for (const port of input.ports) await portCheck(port.number, port.protocol);
  return { ready: true, actorReadiness: 'required-after-owned-launch', providerCalls: 0 };
}

export async function waitObservation(inspect, { timeoutMs, intervalMs, signal, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(intervalMs) || intervalMs <= 0 || intervalMs > timeoutMs) throw new Error('invalid wait deadline');
  const deadline = now() + timeoutMs;
  if (!Number.isSafeInteger(deadline)) throw new Error('invalid deadline arithmetic');
  while (now() < deadline) {
    if (signal?.aborted) return { outcome: 'interrupted', effects: 'unknown' };
    let timer; let abort;
    const controller = new AbortController();
    let state;
    try {
      state = await Promise.race([
        Promise.resolve().then(() => inspect({ signal: controller.signal, remainingMs: deadline - now() })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ deadlineReached: true }), Math.max(1, deadline - now())); }),
        new Promise(resolve => { abort = () => resolve({ interrupted: true }); signal?.addEventListener('abort', abort, { once: true }); }),
      ]);
    } catch { return { outcome: 'inspection-error', effects: 'unknown' }; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
    if (state?.interrupted) return { outcome: 'interrupted', effects: 'unknown' };
    if (state?.deadlineReached) return { outcome: 'timeout', effects: 'unknown' };
    if (state?.terminalError) return { outcome: 'terminal-error', error: state.terminalError };
    if (state?.ready === true) return { outcome: 'ready', observation: state.observation };
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  return { outcome: 'timeout', effects: 'unknown' };
}
