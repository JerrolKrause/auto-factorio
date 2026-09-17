import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkSource, validateContract } from '../check-agent-contract.mjs';
import { boundedJson, createEvidenceDirectory, safeRuntimePath, sha256, workspaceRoot, writeNewJson } from './safe-artifacts.mjs';

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
  const allowed = ['role', 'objective', 'criteria', 'revision', 'sourcePaths', 'scope', 'checks', 'allowedActions', 'additionalChecks', 'resources', 'budget', 'stopConditions', 'returnConditions', 'outputRoot'];
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
    version: 1,
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
  return {
    version: 1,
    assignmentId: assignment.assignmentId ?? null,
    role: assignment.role ?? null,
    structurallyValid: validation.valid,
    ready: validation.ready === true && sourceErrors.length === 0,
    errors: validation.errors,
    readinessGaps: [...validation.readinessErrors, ...sourceErrors],
    findings: Array.isArray(result?.findings) ? result.findings : [],
    criteria: Array.isArray(result?.criteria) ? result.criteria : [],
    sourceStable: result?.source?.stable ?? null,
    semanticAcceptanceByAuthorRequired: true,
  };
}

function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
async function main() {
  const mode = process.argv[2];
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
  throw new Error('usage: dev:contract prepare|summary ...');
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(boundedJson({ error: error.message })); process.exitCode = 1; });
