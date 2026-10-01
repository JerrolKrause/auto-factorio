import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedJson, createEvidenceDirectory, sha256, writeNewJson } from './safe-artifacts.mjs';
import { reserveAdmission } from './admission.mjs';
import { checkCorrectionAdmission, recordCorrectionAdmission } from './review-ledger.mjs';
import { validatePlan } from './usage.mjs';
import { appendEvent } from './events.mjs';

const roles = new Set(['author', 'verification', 'review']);
const efforts = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'inherit-author']);
const modelPattern = /^(gpt-[a-z0-9.-]+|inherit-author)$/;

export function parseRouting(markdown) {
  const tasks = new Map();
  for (const match of markdown.matchAll(/^- \[([ xX])\] (\d+(?:\.\d+)*)\s+(.+)$/gm)) {
    if (tasks.has(match[2])) throw new Error(`duplicate task: ${match[2]}`);
    tasks.set(match[2], { id: match[2], done: match[1].toLowerCase() === 'x', description: match[3].trim() });
  }
  const heading = markdown.indexOf('## Model routing');
  if (heading < 0) throw new Error('missing Model routing table');
  const rows = markdown.slice(heading).split(/\r?\n/).filter(line => /^\|/.test(line)).slice(2);
  const routing = new Map();
  for (const line of rows) {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.length !== 6) throw new Error('malformed routing row');
    const [id, role, model, effort, rationale, escalateWhen] = cells;
    if (routing.has(id)) throw new Error(`duplicate routing task: ${id}`);
    if (!tasks.has(id)) throw new Error(`unknown routing task: ${id}`);
    if (!roles.has(role) || !modelPattern.test(model) || !efforts.has(effort) || !rationale || !escalateWhen) throw new Error(`invalid routing metadata: ${id}`);
    if (role === 'review' ? model !== 'inherit-author' || effort !== 'inherit-author' : model === 'inherit-author' || effort === 'inherit-author') throw new Error(`role/model mismatch: ${id}`);
    routing.set(id, { role, model, effort, rationale, escalateWhen });
  }
  for (const id of tasks.keys()) if (!routing.has(id)) throw new Error(`missing routing task: ${id}`);
  return new Map([...tasks].map(([id, task]) => [id, { ...task, ...routing.get(id) }]));
}

function cleanEnvironment(environment) {
  const output = { ...environment };
  for (const key of Object.keys(output)) if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|BASE_URL|CODEX_THREAD|CODEX_INTERNAL|CODEX_CI/i.test(key)) delete output[key];
  return output;
}

/** Read-only app-server preflight. It starts no thread and submits no prompt. */
export async function discoverCodex(executable, model, effort, { cwd = process.cwd(), spawnProcess = spawn, timeoutMs = 15000 } = {}) {
  const child = spawnProcess(executable, ['app-server', '--stdio', '--strict-config', '-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"'], { cwd, env: cleanEnvironment(process.env), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  let sequence = 0; const pending = new Map(); let closed = false;
  const fail = error => { closed = true; for (const value of pending.values()) { clearTimeout(value.timer); value.reject(error); } pending.clear(); };
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) child.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32601, message: 'denied' } })}\n`);
      else if (typeof message.id === 'number') {
        const entry = pending.get(message.id); if (!entry) return;
        pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error('Codex discovery RPC failed')); else entry.resolve(message.result);
      }
    } catch { fail(new Error('invalid Codex discovery output')); }
  });
  child.once('error', fail); child.once('exit', code => fail(new Error(`Codex discovery disconnected (${code})`)));
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('Codex discovery closed'));
    const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} outcome unknown`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer }); child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  try {
    await call('initialize', { clientInfo: { name: 'autofactorio_dev_task', version: '0.1.0' }, capabilities: { experimentalApi: true } }); child.stdin.write('{"method":"initialized"}\n');
    const account = await call('account/read', { refreshToken: false }); const auth = await call('getAuthStatus', { includeToken: false, refreshToken: false });
    if (account?.account?.type !== 'chatgpt' || auth?.authMethod !== 'chatgpt') throw new Error('managed ChatGPT authentication required; API fallback forbidden');
    let cursor = null; let found; const seen = new Set();
    do {
      const page = await call('model/list', { includeHidden: true, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(page?.data)) throw new Error('model catalog unavailable');
      found ??= page.data.find(item => item.model === model);
      cursor = page.nextCursor ?? null; if (cursor && seen.has(cursor)) throw new Error('repeated model cursor'); if (cursor) seen.add(cursor);
    } while (cursor);
    if (!found) throw new Error(`requested model unavailable: ${model}`);
    if (!found.supportedReasoningEfforts?.some(item => item.reasoningEffort === effort)) throw new Error(`requested effort unavailable for ${model}: ${effort}`);
    const allowance = await call('account/rateLimits/read'); const limits = allowance?.rateLimits ?? {};
    if (allowance?.ordinaryUsageAllowed === false || limits.spendControlReached === true || ['primary', 'secondary'].some(key => limits[key]?.usedPercent >= 100)) throw new Error('included allowance exhausted; paid fallback forbidden');
    return { authentication: 'chatgpt', plan: account.account.planType ?? null, model, effort, ordinaryUsageAllowed: allowance?.ordinaryUsageAllowed ?? null };
  } finally { fail(new Error('Codex discovery closed')); child.kill(); }
}

/** Dedicated verification stays separate from author launching and reviewer inheritance. */
export async function validateVerificationRoute({ model = 'gpt-6-luna', effort = 'medium', executable = 'codex.exe', root = process.cwd() } = {}, dependencies = {}) {
  if (!((model === 'gpt-6-luna' && ['medium', 'high'].includes(effort)) || (model === 'gpt-6.1-sol' && effort === 'high'))) return { state: 'blocked', model, effort, reason: 'unsupported verification route; no fallback' };
  try {
    const discovery = await (dependencies.discover ?? discoverCodex)(executable, model, effort, { cwd: root });
    return { state: 'ready', model, effort, discovery, authorizesInference: false };
  } catch (error) { return { state: 'blocked', model, effort, reason: error.message, authorizesInference: false }; }
}

/** A bounded handoff proposes stronger work; it never launches or resets the shared plan. */
export function escalationPacket(input) {
  const id = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(value);
  if (!id(input?.assignmentId) || !id(input?.invariantId) || !Array.isArray(input.evidence) || !input.evidence.length || input.evidence.some(file => typeof file !== 'string' || !file.startsWith('.runtime/') || file.includes('..') || file.includes('\\'))) throw new Error('invalid diagnosis identity/evidence');
  if (!id(input.nextCheckId) || !['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'].includes(input.currentModel)) throw new Error('invalid diagnosis route/check');
  return { version: 1, state: 'blocked', assignmentId: input.assignmentId, invariantId: input.invariantId, evidence: input.evidence.slice(0, 20), nextCheckId: input.nextCheckId, recommended: input.currentModel === 'gpt-6-luna' ? { model: 'gpt-6.1-sol', effort: 'high' } : { model: 'gpt-6-astra', effort: 'medium' }, admissionRequiresCapabilityCheck: true, sharedBudgetPreserved: true, automaticLaunch: false, authorizesInference: false };
}

export async function selectTask({ tasksFile, taskId, model, effort, reason, start = false, outputRoot = '.runtime/dev-task', executable = 'codex.exe', root = process.cwd(), plan, usageReport, unknownAlternative, correction }, dependencies = {}) {
  const source = await readFile(tasksFile); const table = parseRouting(source.toString('utf8')); const task = table.get(taskId);
  if (!task) throw new Error(`unknown task: ${taskId}`); if (task.done) throw new Error(`task already completed: ${taskId}`);
  if (task.role !== 'author') return { started: false, dedicatedWorkflow: task.role, task };
  if ((model || effort) && !reason?.trim()) throw new Error('model or effort override requires --reason');
  const effectiveModel = model ?? task.model; const effectiveEffort = effort ?? task.effort;
  if (!modelPattern.test(effectiveModel) || !efforts.has(effectiveEffort) || effectiveModel === 'inherit-author' || effectiveEffort === 'inherit-author') throw new Error('invalid effective model or effort');
  const preview = { task, recommendation: { model: task.model, effort: task.effort }, requested: { model: model ?? null, effort: effort ?? null, reason: reason ?? null }, effective: { model: effectiveModel, effort: effectiveEffort }, tasksFingerprint: sha256(source), started: false };
  if (!start) return preview;
  if (!plan || !usageReport?.usage || !usageReport?.coverage) throw new Error('managed task start requires shared session plan and usage coverage');
  validatePlan(plan);
  let correctionProof;
  if (correction) {
    const decision = await recordCorrectionAdmission(correction, { root });
    if (!decision.allowed) throw new Error(`corrective admission refused: ${decision.reason}`);
    correctionProof = decision.admission;
  }
  const evidence = await createEvidenceDirectory(root, outputRoot, `task-${taskId.replaceAll('.', '-')}`);
  const discovery = await (dependencies.discover ?? discoverCodex)(executable, effectiveModel, effectiveEffort, { cwd: root });
  const current = await readFile(tasksFile); if (sha256(current) !== preview.tasksFingerprint) throw new Error('task source changed before launch');
  if (correctionProof) await checkCorrectionAdmission(correctionProof, { root });
  const admission = await (dependencies.admit ?? reserveAdmission)(plan, usageReport, { root, owner: `task-${taskId}`, alternative: unknownAlternative });
  const stream = path.relative(root, path.join(evidence, 'events.jsonl')).split(path.sep).join('/');
  const runId = path.basename(evidence);
  const event = (kind, sequence, extra = {}) => appendEvent(stream, { version: 1, eventId: `${runId}-${sequence}`, sequence, runId, workerId: `task-${taskId}`, kind, at: new Date().toISOString(), phase: 'authoring', role: 'author', checkId: taskId, requestedModel: effectiveModel, requestedEffort: effectiveEffort, provenance: 'rule', ...extra }, { root });
  await event('budget', 1, { decision: admission.decision });
  await writeNewJson(path.join(evidence, 'admission.json'), admission);
  if (!admission.admitted) return { ...preview, blocked: true, admission, evidence: path.relative(root, evidence).split(path.sep).join('/') };
  const prompt = `Apply authorized OpenSpec task ${taskId}: ${task.description}\nUse ${tasksFile} and the linked change artifacts. Escalate when: ${task.escalateWhen}. Stay within this task; do not mark it complete without its acceptance evidence.`;
  const promptFile = path.join(evidence, 'prompt.txt'); await writeFile(promptFile, prompt, { encoding: 'utf8', flag: 'wx' });
  const record = { ...preview, ...(correctionProof ? { correctionAdmission: correctionProof } : {}), started: null, discovery, evidence: path.relative(root, evidence).split(path.sep).join('/'), launchOutcome: 'unknown' };
  await writeNewJson(path.join(evidence, 'launch.json'), record);
  const launch = dependencies.launch ?? ((script, args) => spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { cwd: root, detached: true, windowsHide: true, stdio: 'ignore' }));
  // Reservation and artifact writes await I/O. Bind the actual launch to the same candidate,
  // with no awaited operation after this final successful check and before requesting launch.
  if (correctionProof) {
    try { await checkCorrectionAdmission(correctionProof, { root }); }
    catch (error) {
      record.launchOutcome = 'refused'; record.error = error.message;
      await writeNewJson(path.join(evidence, 'launch-result.json'), record);
      await event('failure', 2, { outcome: 'unverified', failureClass: 'stale-evidence' });
      throw error;
    }
  }
  let child;
  try {
    child = launch(path.resolve(root, 'scripts/codex-terminal.ps1'), ['-Model', effectiveModel, '-Effort', effectiveEffort, '-PromptFile', promptFile]); child.unref?.();
    record.started = new Date().toISOString(); record.launchOutcome = child.pid ? 'requested' : 'unknown'; record.pid = child.pid ?? null;
  } catch (error) { record.launchOutcome = 'failed'; record.error = error.message; }
  await writeNewJson(path.join(evidence, 'launch-result.json'), record);
  await event(record.launchOutcome === 'failed' ? 'failure' : 'start', 2, { attemptId: runId, outcome: record.launchOutcome === 'failed' ? 'fail' : 'unknown' });
  if (record.launchOutcome === 'failed') throw new Error('Codex launch failed; no retry attempted');
  return record;
}

function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
async function main() {
  if (option('--escalation')) {
    console.log(boundedJson(escalationPacket(JSON.parse(await readFile(option('--escalation'), 'utf8'))))); return;
  }
  if (process.argv.includes('--verify-capability')) {
    const result = await validateVerificationRoute({ model: option('--model'), effort: option('--effort'), executable: option('--codex') ?? 'codex.exe' });
    console.log(boundedJson(result)); if (result.state !== 'ready') process.exitCode = 1; return;
  }
  const change = option('--change'); const taskId = option('--task'); if (!change || !taskId) throw new Error('usage: dev:task --change <name> --task <id> [--start]');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(change)) throw new Error('invalid change name');
  const tasksFile = path.resolve('openspec', 'changes', change, 'tasks.md');
  const load = async flag => option(flag) ? JSON.parse(await readFile(option(flag), 'utf8')) : undefined;
  const result = await selectTask({ tasksFile, taskId, model: option('--model'), effort: option('--effort'), reason: option('--reason'), start: process.argv.includes('--start'), outputRoot: option('--output-root') ?? '.runtime/dev-task', executable: option('--codex') ?? 'codex.exe', plan: await load('--plan'), usageReport: await load('--usage'), unknownAlternative: await load('--unknown-alternative'), correction: await load('--correction') });
  console.log(boundedJson(result));
  if (result.blocked) process.exitCode = 1;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(boundedJson({ error: error.message })); process.exitCode = 1; });
