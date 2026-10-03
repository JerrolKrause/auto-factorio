import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkSource, checkResultEvidence, validateContract } from '../check-agent-contract.mjs';
import { boundedJson, createEvidenceDirectory, safeRuntimePath, sha256, workspaceRoot, writeNewJson } from './safe-artifacts.mjs';
import { appendEvent, readEvents } from './events.mjs';

const relative = value => typeof value === 'string' && value.length > 0 && !value.includes('\\') && !value.includes(':') && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');

async function fingerprint(root, filename) {
  if (!relative(filename)) throw new Error(`invalid source path: ${filename}`);
  const requested = path.resolve(root, filename);
  try {
    const actual = await realpath(requested);
    const rel = path.relative(root, actual);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error(`source escapes workspace: ${filename}`);
    return { path: filename, sha256: sha256(await readFile(actual)) };
  } catch (error) {
    if (error.code === 'ENOENT') return { path: filename, sha256: null };
    throw error;
  }
}

export async function prepareContract(input, root = process.cwd()) {
  const base = await workspaceRoot(root);
  const allowed = ['version', 'execution', 'role', 'objective', 'criteria', 'revision', 'sourcePaths', 'scope', 'checks', 'allowedActions', 'additionalChecks', 'resources', 'budget', 'stopConditions', 'returnConditions', 'outputRoot'];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new Error(`unknown input field: ${key}`);
  if (!['verification', 'review'].includes(input.role)) throw new Error('role must be verification or review');
  if (!Array.isArray(input.sourcePaths) || input.sourcePaths.length === 0) throw new Error('sourcePaths must not be empty');
  const files = await Promise.all(input.sourcePaths.map(item => fingerprint(base, item)));
  const directory = await createEvidenceDirectory(base, input.outputRoot ?? '.runtime/contracts', `${input.role}-assignment`);
  const snapshotRoot = path.join(directory, 'source-snapshot'); const snapshots = [];
  for (const file of files) {
    if (file.sha256 === null) { snapshots.push({ path: file.path, snapshot: null, sha256: null }); continue; }
    const target = path.join(snapshotRoot, ...file.path.split('/'));
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, await readFile(path.resolve(base, file.path)), { flag: 'wx' });
    snapshots.push({ path: file.path, snapshot: path.relative(base, target).split(path.sep).join('/'), sha256: file.sha256 });
  }
  const assignment = {
    version: input.version ?? 1,
    ...(input.version === 2 ? { execution: input.execution ?? null } : {}),
    assignmentId: `${input.role}-${randomUUID()}`,
    role: input.role,
    objective: input.objective,
    criteria: input.criteria,
    source: { revision: input.revision, files },
    scope: input.scope,
    checks: input.checks,
    allowedActions: input.allowedActions,
    additionalChecks: input.additionalChecks,
    resources: input.resources,
    evidenceDirectory: path.relative(base, directory).split(path.sep).join('/'),
    budget: input.budget,
    stopConditions: input.stopConditions,
    returnConditions: input.returnConditions,
  };
  const validation = validateContract(assignment);
  if (!validation.valid) throw new Error(`invalid assignment: ${validation.errors.join('; ')}`);
  const sourceErrors = await checkSource(assignment, base);
  if (sourceErrors.length) throw new Error(`source check failed: ${sourceErrors.join('; ')}`);
  const output = path.join(directory, 'assignment.json');
  await writeNewJson(path.join(directory, 'snapshots.json'), snapshots);
  await writeNewJson(output, assignment);
  return { output, assignment };
}

export async function summarizeContract(assignment, result, root = process.cwd()) {
  const validation = validateContract(assignment, result);
  const sourceErrors = validation.valid ? await checkSource(assignment, root) : [];
  const evidenceErrors = validation.valid ? await checkResultEvidence(assignment, result, root) : [];
  return {
    version: 1,
    assignmentId: assignment.assignmentId ?? null,
    role: assignment.role ?? null,
    structurallyValid: validation.valid,
    ready: validation.ready === true && sourceErrors.length === 0 && evidenceErrors.length === 0,
    errors: validation.errors,
    readinessGaps: [...validation.readinessErrors, ...sourceErrors, ...evidenceErrors],
    findings: Array.isArray(result?.findings) ? result.findings : [],
    criteria: Array.isArray(result?.criteria) ? result.criteria : [],
    sourceStable: result?.source?.stable ?? null,
    semanticAcceptanceByAuthorRequired: true,
  };
}

/** A transferable draft, deliberately unable to establish acceptance. */
export async function scaffoldResult(assignment, root = process.cwd()) {
  const validation = validateContract(assignment);
  if (!validation.valid) throw new Error(`invalid assignment: ${validation.errors.join('; ')}`);
  const errors = await checkSource(assignment, root);
  if (errors.length) throw new Error(`source check failed: ${errors.join('; ')}`);
  const result = {
    version: assignment.version, assignmentId: assignment.assignmentId, role: assignment.role,
    summary: 'Draft: assigned work has not been performed', disposition: 'blocked',
    source: { ...structuredClone(assignment.source), stable: false },
    limits: [{ description: 'Draft requires worker observations and final source validation', affectsCoverage: true }],
    model: { requested: 'Record the assigned model and effort', observed: null, usage: null },
    cleanup: assignment.resources.map(resource => ({ id: resource.id, status: 'unresolved', observation: 'Not inspected', evidence: [] })),
    ...(assignment.role === 'review' ? {
      scope: assignment.scope.map(item => ({ path: item.path, status: 'unreviewed', observation: 'Not reviewed' })), findings: [],
    } : {
      criteria: assignment.criteria.map(item => ({ id: item.id, status: 'unverified', observation: 'Not executed', evidence: [], checks: [] })),
      checks: assignment.checks.map(item => ({ id: item.id, command: item.command, authorization: null, status: 'blocked', exit: null,
        outcome: 'unverified', observation: 'Not executed', evidence: [], ...(assignment.version === 2 ? { reuse: null } : {}) })),
    }),
  };
  const draft = validateContract(assignment, result);
  if (!draft.valid) throw new Error(`invalid result scaffold: ${draft.errors.join('; ')}`);
  return result;
}

/** Validate without rewriting worker-authored observations, limits or findings. */
export async function validateReturn(assignment, result, root = process.cwd()) {
  const summary = await summarizeContract(assignment, result, root);
  if (!summary.structurallyValid) throw new Error(`invalid result: ${summary.errors.join('; ')}`);
  const errors = await checkSource(assignment, root);
  if (errors.length) throw new Error(`source check failed: ${errors.join('; ')}`);
  return summary;
}

/** Actual validation attempts are local events, never invented graph worker records. */
export async function recordReturnAttempt(assignment, result, eventsFile, root = process.cwd()) {
  const summary = await summarizeContract(assignment, result, root);
  return recordValidationAttempt(assignment, summary, sha256(JSON.stringify(result)), eventsFile, root);
}

async function recordValidationAttempt(assignment, summary, resultSha256, eventsFile, root) {
  const validation = validateContract(assignment);
  if (!validation.valid) throw new Error(`invalid assignment: ${validation.errors.join('; ')}`);
  let previous = [];
  try {
    const parsed = await readEvents([eventsFile], { root });
    if (parsed.gaps.length) throw new Error('Existing return stream is corrupt; preserve and reconcile before appending');
    previous = parsed.events;
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const directory = await createEvidenceDirectory(root, '.runtime/contracts', 'return-attempt');
  const evidence = path.relative(root, path.join(directory, 'validation.json')).split(path.sep).join('/');
  const record = { assignmentId: assignment.assignmentId, source: assignment.source, resultSha256,
    guard: 'scripts/check-agent-contract.mjs', verificationLayer: 'agent-contract', defect: 'malformed-or-stale-handoff',
    summary, observedAt: new Date().toISOString() };
  await writeNewJson(path.resolve(root, evidence), record);
  const sourceErrors = summary.structurallyValid ? await checkSource(assignment, root) : [];
  await appendEvent(eventsFile, { version: 1, eventId: randomUUID(), runId: 'contract-return',
    sequence: Math.max(-1, ...previous.filter(event => event.runId === 'contract-return').map(event => event.sequence)) + 1, at: record.observedAt,
    kind: !summary.structurallyValid || sourceErrors.length ? 'failure' : 'handoff', phase: assignment.role, role: assignment.role,
    assignmentId: assignment.assignmentId, checkId: 'agent-contract', invariantId: 'handoff-integrity',
    sourceId: sha256(JSON.stringify(assignment.source)), candidate: sha256(assignment.source.revision),
    failureClass: !summary.structurallyValid ? 'report-format' : sourceErrors.length ? 'stale-evidence' : undefined,
    outcome: !summary.structurallyValid || sourceErrors.length ? 'fail' : summary.ready ? 'pass' : 'unverified',
    evidence: [evidence], provenance: 'rule' }, { root });
  return summary;
}

export async function validateReturnFile(assignment, resultFile, eventsFile, root = process.cwd()) {
  const bytes = await readFile(path.resolve(root, resultFile));
  let result;
  try { result = JSON.parse(bytes.toString('utf8')); }
  catch {
    if (eventsFile) await recordValidationAttempt(assignment, { structurallyValid: false, ready: false,
      errors: ['Worker return is not valid JSON'], readinessGaps: [], findings: [], criteria: [], sourceStable: null,
      semanticAcceptanceByAuthorRequired: true }, sha256(bytes), eventsFile, root);
    throw new Error('Worker return is not valid JSON; original bytes preserved');
  }
  if (eventsFile) await recordValidationAttempt(assignment, await summarizeContract(assignment, result, root), sha256(bytes), eventsFile, root);
  return validateReturn(assignment, result, root);
}

function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
async function main() {
  const mode = process.argv[2];
  if (mode === 'scaffold' || mode === 'validate-return') {
    const assignmentFile = option('--assignment');
    if (!assignmentFile) throw new Error(`${mode} requires --assignment`);
    const assignment = JSON.parse(await readFile(assignmentFile, 'utf8'));
    if (mode === 'scaffold') {
      const output = option('--output'); if (!output) throw new Error('scaffold requires --output');
      const result = await scaffoldResult(assignment);
      await writeNewJson(await safeRuntimePath(process.cwd(), output), result);
      console.log(boundedJson({ output, assignmentId: result.assignmentId, ready: false }));
    } else {
      const resultFile = option('--result'); if (!resultFile) throw new Error('validate-return requires --result');
      const summary = await validateReturnFile(assignment, resultFile, option('--events'));
      console.log(boundedJson(summary));
    }
    return;
  }
  if (mode === 'prepare') {
    const inputFile = option('--input'); if (!inputFile) throw new Error('prepare requires --input');
    const { output, assignment } = await prepareContract(JSON.parse(await readFile(inputFile, 'utf8')));
    console.log(boundedJson({ output, assignmentId: assignment.assignmentId, role: assignment.role })); return;
  }
  if (mode === 'summary') {
    const assignmentFile = option('--assignment'); const resultFile = option('--result'); const output = option('--output');
    if (!assignmentFile || !resultFile || !output) throw new Error('summary requires --assignment, --result and --output');
    const summary = await summarizeContract(JSON.parse(await readFile(assignmentFile, 'utf8')), JSON.parse(await readFile(resultFile, 'utf8')));
    const safeOutput = await safeRuntimePath(process.cwd(), output);
    await writeNewJson(safeOutput, summary); console.log(boundedJson({ output: safeOutput, ready: summary.ready, readinessGaps: summary.readinessGaps, findingCount: summary.findings.length })); return;
  }
  throw new Error('usage: dev:contract prepare|scaffold|validate-return|summary ...');
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(boundedJson({ error: error.message })); process.exitCode = 1; });
