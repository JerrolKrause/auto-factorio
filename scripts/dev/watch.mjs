import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedJson, safeRuntimePath, sha256, writeNewJson } from './safe-artifacts.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const allowedKeys = new Set(['passed', 'status', 'state', 'phase', 'results', 'skipped', 'softwareAndSmoke', 'cleanup', 'visible', 'check', 'exit', 'elapsedMs', 'log', 'runId', 'role', 'taskId', 'turn', 'active', 'blocked', 'completed', 'failed', 'updatedAt']);

export function project(value, limits = {}, depth = 0) {
  const maxDepth = limits.maxDepth ?? 5; const maxItems = limits.maxItems ?? 20; const maxString = limits.maxString ?? 256;
  if (depth > maxDepth) return { truncated: true, reason: 'depth' };
  if (typeof value === 'string') return value.length > maxString ? `${value.slice(0, maxString)}…` : value;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return { items: value.slice(0, maxItems).map(item => project(item, limits, depth + 1)), total: value.length, truncated: value.length > maxItems };
  if (typeof value === 'object') {
    const output = {}; let omitted = 0;
    for (const [key, item] of Object.entries(value)) {
      if (!allowedKeys.has(key)) { omitted += 1; continue; }
      output[key] = project(item, limits, depth + 1);
    }
    if (omitted) output.omittedFields = omitted;
    return output;
  }
  return null;
}

function loopback(url) {
  if (url.protocol !== 'http:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
}

export async function dashboardSnapshot(descriptor, requestTimeoutMs, fetcher = fetch) {
  const url = new URL(descriptor.url);
  if (!loopback(url) || url.username || url.password || url.hash || url.search) throw new Error('dashboard URL must be loopback HTTP without embedded credentials, query or fragment');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const headers = descriptor.capability ? { Authorization: `Bearer ${descriptor.capability}` } : {};
    const response = await fetcher(url, { headers, redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) throw new Error('dashboard redirects are forbidden');
    if (!response.ok) throw new Error(`dashboard request failed: ${response.status}`);
    return response.json();
  } finally { clearTimeout(timer); }
}

async function verificationSnapshot(directory) {
  for (const name of ['summary.json', 'results.json']) {
    try { return JSON.parse(await readFile(path.join(directory, name), 'utf8')); }
    catch (error) { if (!['ENOENT', 'Unexpected end of JSON input'].includes(error.code ?? error.message)) throw error; }
  }
  return { state: 'incomplete' };
}

export async function watch(options) {
  const started = Date.now(); const events = []; let lastHash; let lastChange = started; let lastHeartbeat = 0; let outcome = 'duration-expired';
  const push = event => {
    const line = boundedJson(event, options.maxEventBytes ?? 4096);
    const current = events.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)), 0);
    if (current + Buffer.byteLength(line) > (options.maxOutputBytes ?? 65536)) { outcome = 'output-limit'; return false; }
    events.push(JSON.parse(line)); options.onEvent?.(line); return true;
  };
  while (Date.now() - started < options.durationMs) {
    if (options.signal?.aborted) { outcome = 'cancelled'; break; }
    let raw;
    try { raw = options.kind === 'dashboard' ? await dashboardSnapshot(options.descriptor, options.requestTimeoutMs) : await verificationSnapshot(options.directory); }
    catch (error) { push({ type: 'failure', outcome: error.name === 'AbortError' ? 'timeout' : 'disconnect', message: String(error.message).slice(0, 256) }); outcome = error.name === 'AbortError' ? 'timeout' : 'disconnect'; break; }
    const snapshot = project(raw, options.limits); const hash = sha256(JSON.stringify(snapshot)); const now = Date.now();
    if (hash !== lastHash) { if (!push({ type: 'change', at: new Date(now).toISOString(), snapshot })) break; lastHash = hash; lastChange = now; }
    else if (now - lastHeartbeat >= options.heartbeatMs) { if (!push({ type: 'heartbeat', at: new Date(now).toISOString(), unchangedMs: now - lastChange })) break; lastHeartbeat = now; }
    if (raw?.passed === true || raw?.status === 'completed') { outcome = 'completed'; break; }
    if (raw?.passed === false || ['failed', 'blocked'].includes(raw?.status)) { outcome = 'failed'; break; }
    if (options.staleMs && now - lastChange >= options.staleMs) { outcome = 'stale'; break; }
    await sleep(options.pollMs);
  }
  return { version: 1, outcome, elapsedMs: Date.now() - started, source: options.kind === 'dashboard' ? options.descriptor.url.replace(/#.*$/, '') : options.directory, events };
}

function numberOption(name, fallback) { const index = process.argv.indexOf(name); return index >= 0 ? Number(process.argv[index + 1]) : fallback; }
function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
async function main() {
  const directory = option('--verification'); const descriptorFile = option('--dashboard'); const output = option('--output');
  if ((!directory === !descriptorFile) || !output) throw new Error('choose exactly one of --verification or --dashboard and provide --output');
  const descriptorPath = descriptorFile ? await safeRuntimePath(process.cwd(), descriptorFile, { mustExist: true }) : undefined;
  const verificationPath = directory ? await safeRuntimePath(process.cwd(), directory, { mustExist: true }) : undefined;
  const descriptor = descriptorPath ? JSON.parse(await readFile(descriptorPath, 'utf8')) : undefined;
  const controller = new AbortController(); const cancel = () => controller.abort(); process.once('SIGINT', cancel);
  const report = await watch({ kind: descriptor ? 'dashboard' : 'verification', directory: verificationPath, descriptor, pollMs: numberOption('--poll-ms', 1000), heartbeatMs: numberOption('--heartbeat-ms', 30000), staleMs: numberOption('--stale-ms', 120000), requestTimeoutMs: numberOption('--request-timeout-ms', 5000), durationMs: numberOption('--duration-ms', 300000), maxOutputBytes: numberOption('--max-output-bytes', 65536), signal: controller.signal, onEvent: line => console.log(line) });
  process.removeListener('SIGINT', cancel);
  const safeOutput = await safeRuntimePath(process.cwd(), output);
  await writeNewJson(safeOutput, report); console.log(boundedJson({ output: safeOutput, outcome: report.outcome, eventCount: report.events.length }));
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(boundedJson({ error: error.message })); process.exitCode = 1; });
