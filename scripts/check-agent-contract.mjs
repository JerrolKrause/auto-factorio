import { readFile, realpath, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const relativePath = value => nonempty(value) && !value.includes('\\') && !value.includes(':') &&
  !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const natural = value => Number.isSafeInteger(value) && value >= 0;
const key = value => typeof value === 'string' ? value.toLowerCase() : value;

/** Structural consistency only: reports and referenced evidence still require author adjudication. */
export function validateContract(assignment, result) {
  const errors = []; const readinessErrors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const notReady = (condition, message) => { if (condition) readinessErrors.push(message); };
  const object = (value, label, fields) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${label}: expected object`); return {};
    }
    for (const field of Object.keys(value)) require(fields.includes(field), `${label}: unknown field ${field}`);
    for (const field of fields) require(Object.hasOwn(value, field), `${label}: missing ${field}`);
    return value;
  };
  const array = (value, label, nonemptyRequired = false) => {
    if (!Array.isArray(value)) { errors.push(`${label}: expected array`); return []; }
    require(!nonemptyRequired || value.length > 0, `${label}: must not be empty`); return value;
  };
  const strings = (value, label, required = false) => {
    const values = array(value, label, required);
    values.forEach((item, i) => require(nonempty(item), `${label}[${i}]: expected nonempty string`));
    return values;
  };
  const records = (value, label, fields, identity, required = false) => {
    const seen = new Set();
    return array(value, label, required).map((item, i) => {
      const row = object(item, `${label}[${i}]`, fields);
      const id = identity === 'path' ? key(row[identity]) : row[identity];
      require(nonempty(id), `${label}[${i}]: missing ${identity}`);
      require(!seen.has(id), `${label}: duplicate ${identity} ${id}`); seen.add(id);
      return row;
    });
  };
  const exact = (expected, observed, field, label) => {
    const wanted = new Set(expected.map(row => row[field]));
    const actual = new Set(observed.map(row => row[field]));
    for (const id of wanted) require(actual.has(id), `${label}: missing ${id}`);
    for (const id of actual) require(wanted.has(id), `${label}: unknown ${id}`);
  };
  const source = (value, label, observed = false) => {
    const state = object(value, label, ['revision', 'files', ...(observed ? ['stable'] : [])]);
    require(nonempty(state.revision), `${label}.revision: expected nonempty revision`);
    const files = records(state.files, `${label}.files`, ['path', 'sha256'], 'path', true);
    files.forEach(file => {
      require(relativePath(file.path), `${label}: invalid relative path ${file.path}`);
      require(file.sha256 === null || sha256(file.sha256), `${label}: invalid sha256 for ${file.path}`);
    });
    if (observed) require(typeof state.stable === 'boolean', `${label}.stable: expected boolean`);
    return { ...state, files };
  };
  const a = object(assignment, 'assignment', ['version', 'assignmentId', 'role', 'objective', 'criteria', 'source',
    'scope', 'checks', 'allowedActions', 'additionalChecks', 'resources', 'evidenceDirectory', 'budget', 'stopConditions', 'returnConditions']);
  require(a.version === 1, 'assignment.version: expected 1');
  require(nonempty(a.assignmentId), 'assignment.assignmentId: expected unique nonempty ID');
  require(['verification', 'review'].includes(a.role), 'assignment.role: expected verification or review');
  require(nonempty(a.objective), 'assignment.objective: expected nonempty string');
  const criteria = records(a.criteria, 'assignment.criteria', ['id', 'description'], 'id', true);
  criteria.forEach(row => require(nonempty(row.description), `criterion ${row.id}: missing description`));
  const assignedSource = source(a.source, 'assignment.source');
  const scope = records(a.scope, 'assignment.scope', ['path', 'boundary'], 'path', true);
  scope.forEach(row => {
    require(relativePath(row.path), `scope: invalid path ${row.path}`);
    require(nonempty(row.boundary), `scope ${row.path}: missing boundary`);
    require(assignedSource.files.some(file => file.path === row.path), `scope ${row.path}: missing source hash`);
  });
  const prescribed = records(a.checks, 'assignment.checks', ['id', 'command', 'expected'], 'id');
  prescribed.forEach(row => {
    require(nonempty(row.command), `check ${row.id}: missing command`);
    require(nonempty(row.expected), `check ${row.id}: missing expected observation`);
  });
  const actions = strings(a.allowedActions, 'assignment.allowedActions', true);
  require(['forbidden', 'within-scope'].includes(a.additionalChecks), 'assignment.additionalChecks: invalid policy');
  if (a.role === 'review') {
    require(prescribed.length === 0, 'review assignments cannot prescribe execution checks');
    require(a.additionalChecks === 'forbidden', 'review assignments must forbid additional execution checks');
  }
  const resources = records(a.resources, 'assignment.resources', ['id', 'owner', 'cleanup'], 'id');
  resources.forEach(row => {
    require(nonempty(row.owner), `resource ${row.id}: missing owner`);
    require(nonempty(row.cleanup), `resource ${row.id}: missing cleanup requirement`);
  });
  require(relativePath(a.evidenceDirectory) && a.evidenceDirectory.startsWith('.runtime/'),
    'assignment.evidenceDirectory: expected ignored .runtime/ subdirectory');
  const budget = object(a.budget, 'assignment.budget', ['timeSeconds', 'providerCalls']);
  require(natural(budget.timeSeconds) && budget.timeSeconds > 0, 'budget.timeSeconds: expected positive integer');
  require(natural(budget.providerCalls), 'budget.providerCalls: expected nonnegative integer');
  strings(a.stopConditions, 'assignment.stopConditions', true);
  strings(a.returnConditions, 'assignment.returnConditions', true);
  if (result === undefined) return { valid: errors.length === 0, ready: null, errors, readinessErrors };

  const common = ['version', 'assignmentId', 'role', 'summary', 'disposition', 'source', 'limits', 'model', 'cleanup'];
  const r = object(result, 'result', [...common, ...(a.role === 'review' ? ['scope', 'findings'] : ['criteria', 'checks'])]);
  for (const field of ['version', 'assignmentId', 'role']) require(r[field] === a[field], `result.${field}: assignment mismatch`);
  require(nonempty(r.summary), 'result.summary: expected nonempty string');
  require(['returned', 'blocked'].includes(r.disposition), 'result.disposition: invalid disposition');
  notReady(r.disposition === 'blocked', 'worker returned blocked');
  const observed = source(r.source, 'result.source', true);
  require(observed.revision === assignedSource.revision, 'result.source.revision: assignment mismatch');
  exact(assignedSource.files, observed.files, 'path', 'result.source.files');
  notReady(observed.stable === false, 'source was not stable during work');
  for (const file of observed.files) {
    const original = assignedSource.files.find(row => row.path === file.path);
    notReady(original && original.sha256 !== file.sha256, `stale source: ${file.path}`);
  }
  array(r.limits, 'result.limits').forEach((value, i) => {
    const limit = object(value, `result.limits[${i}]`, ['description', 'affectsCoverage']);
    require(nonempty(limit.description), `limit ${i}: missing description`);
    require(typeof limit.affectsCoverage === 'boolean', `limit ${i}: affectsCoverage must be boolean`);
    notReady(limit.affectsCoverage === true, `coverage limit: ${limit.description}`);
  });
  const model = object(r.model, 'result.model', ['requested', 'observed', 'usage']);
  require(nonempty(model.requested), 'model.requested: expected nonempty string');
  require(model.observed === null || nonempty(model.observed), 'model.observed: expected string or null');
  if (model.usage !== null) {
    const usage = object(model.usage, 'model.usage', ['providerCalls', 'totalTokens']);
    require(natural(usage.providerCalls), 'model.usage.providerCalls: expected nonnegative integer');
    require(natural(usage.totalTokens), 'model.usage.totalTokens: expected nonnegative integer');
    notReady(usage.providerCalls > budget.providerCalls, 'provider call budget exceeded');
  }
  const cleanup = records(r.cleanup, 'result.cleanup', ['id', 'status', 'observation', 'evidence'], 'id');
  exact(resources, cleanup, 'id', 'result.cleanup');
  cleanup.forEach(row => {
    require(['completed', 'not-needed', 'unresolved'].includes(row.status), `cleanup ${row.id}: invalid status`);
    require(nonempty(row.observation), `cleanup ${row.id}: missing observation`);
    strings(row.evidence, `cleanup ${row.id}.evidence`, row.status === 'completed');
    if (row.status === 'not-needed') require(resources.some(resource => resource.id === row.id && resource.cleanup === 'none'),
      `cleanup ${row.id}: not-needed requires assignment cleanup "none"`);
    notReady(row.status === 'unresolved', `unresolved cleanup: ${row.id}`);
  });
  if (a.role === 'review') {
    const coverage = records(r.scope, 'result.scope', ['path', 'status', 'observation'], 'path');
    exact(scope, coverage, 'path', 'result.scope');
    coverage.forEach(row => {
      require(['reviewed', 'unreviewed'].includes(row.status), `scope ${row.path}: invalid status`);
      require(nonempty(row.observation), `scope ${row.path}: missing observation`);
      notReady(row.status === 'unreviewed', `unreviewed scope: ${row.path}`);
    });
    const findings = records(r.findings, 'result.findings', ['id', 'severity', 'confidence', 'path', 'line', 'description', 'evidence', 'fix'], 'id');
    findings.forEach(row => {
      require(['P0', 'P1', 'P2', 'P3'].includes(row.severity), `finding ${row.id}: invalid severity`);
      require(['high', 'medium'].includes(row.confidence), `finding ${row.id}: invalid confidence`);
      require(scope.some(item => item.path === row.path), `finding ${row.id}: path outside scope`);
      require(Number.isSafeInteger(row.line) && row.line > 0, `finding ${row.id}: invalid line`);
      require(nonempty(row.description) && nonempty(row.fix), `finding ${row.id}: missing description or fix`);
      strings(row.evidence, `finding ${row.id}.evidence`, true);
    });
    notReady(findings.length > 0, 'review findings require author adjudication and resolution');
  } else {
    const checks = records(r.checks, 'result.checks', ['id', 'command', 'authorization', 'status', 'exit', 'outcome', 'observation', 'evidence'], 'id');
    for (const check of prescribed) require(checks.some(row => row.id === check.id), `result.checks: missing ${check.id}`);
    checks.forEach(row => {
      const original = prescribed.find(item => item.id === row.id);
      require(nonempty(row.command), `check ${row.id}: missing command`);
      if (original) {
        require(row.command === original.command, `check ${row.id}: prescribed command mismatch`);
        require(row.authorization === null, `check ${row.id}: prescribed authorization must be null`);
      } else {
        require(a.additionalChecks === 'within-scope', `check ${row.id}: additional checks forbidden`);
        require(nonempty(row.authorization) && actions.includes(row.authorization), `check ${row.id}: missing assigned action authorization`);
      }
      require(['executed', 'skipped', 'blocked'].includes(row.status), `check ${row.id}: invalid status`);
      require(row.exit === null || (Number.isSafeInteger(row.exit) && row.exit >= 0), `check ${row.id}: invalid exit`);
      require(['pass', 'fail', 'unverified'].includes(row.outcome), `check ${row.id}: invalid outcome`);
      require(nonempty(row.observation), `check ${row.id}: missing observation`);
      const evidence = strings(row.evidence, `check ${row.id}.evidence`);
      if (row.status !== 'executed') require(row.exit === null && row.outcome === 'unverified', `check ${row.id}: unexecuted check must be unverified with null exit`);
      if (row.outcome === 'pass') require(row.status === 'executed' && row.exit === 0 && evidence.length > 0, `check ${row.id}: pass requires executed zero exit and evidence`);
      notReady(row.outcome !== 'pass', `check not passed: ${row.id}`);
    });
    const coverage = records(r.criteria, 'result.criteria', ['id', 'status', 'observation', 'evidence', 'checks'], 'id');
    exact(criteria, coverage, 'id', 'result.criteria');
    coverage.forEach(row => {
      require(['pass', 'fail', 'unverified'].includes(row.status), `criterion ${row.id}: invalid status`);
      require(nonempty(row.observation), `criterion ${row.id}: missing observation`);
      const evidence = strings(row.evidence, `criterion ${row.id}.evidence`);
      const refs = strings(row.checks, `criterion ${row.id}.checks`);
      require(new Set(refs).size === refs.length, `criterion ${row.id}: duplicate check references`);
      refs.forEach(id => {
        const check = checks.find(item => item.id === id);
        require(Boolean(check), `criterion ${row.id}: unknown check reference ${id}`);
        if (row.status === 'pass') require(check?.outcome === 'pass', `criterion ${row.id}: pass references nonpassing check ${id}`);
      });
      if (row.status === 'pass') require(evidence.length > 0, `criterion ${row.id}: pass requires evidence`);
      notReady(row.status !== 'pass', `criterion not passed: ${row.id}`);
    });
  }
  return { valid: errors.length === 0, ready: errors.length === 0 && readinessErrors.length === 0, errors, readinessErrors };
}

/** Hash bytes only; realpath also confines symlinks and junctions beneath the chosen workspace. */
export async function checkSource(assignment, root = process.cwd()) {
  const errors = []; const base = await realpath(root);
  const confined = target => {
    const relative = path.relative(base, target);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  for (const file of assignment.source.files) {
    if (!relativePath(file.path)) { errors.push(`invalid source path: ${file.path}`); continue; }
    try {
      const requested = path.resolve(base, file.path);
      if (file.sha256 === null) {
        // Even absent descendants must not be accepted through an escaping junction.
        let ancestor = path.dirname(requested);
        for (;;) {
          try {
            if (!confined(await realpath(ancestor))) throw new Error('ancestor escapes workspace');
            break;
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            ancestor = path.dirname(ancestor);
          }
        }
        try {
          await lstat(requested); errors.push(`source expected absent but exists: ${file.path}`);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        continue;
      }
      const target = await realpath(requested);
      if (target === base || !confined(target)) {
        errors.push(`source escapes workspace: ${file.path}`); continue;
      }
      const actual = createHash('sha256').update(await readFile(target)).digest('hex');
      if (actual !== file.sha256) errors.push(`current source hash mismatch: ${file.path}`);
    } catch (error) { errors.push(`cannot read source ${file.path}: ${error.code ?? error.message}`); }
  }
  return errors;
}

export async function main(args, root = process.cwd()) {
  try {
    const filenames = []; const flags = new Set();
    for (const arg of args) {
      if (arg.startsWith('--')) {
        if (!['--check-source', '--require-ready'].includes(arg) || flags.has(arg)) throw new Error(`unknown or repeated flag: ${arg}`);
        flags.add(arg);
      } else filenames.push(arg);
    }
    if (filenames.length < 1 || filenames.length > 2 || (flags.has('--require-ready') && filenames.length !== 2)) {
      throw new Error('Usage: node scripts/check-agent-contract.mjs assignment.json [result.json] [--check-source] [--require-ready]');
    }
    const readJson = async filename => JSON.parse(await readFile(path.resolve(root, filename), 'utf8'));
    const assignment = await readJson(filenames[0]);
    const result = filenames[1] ? await readJson(filenames[1]) : undefined;
    const report = validateContract(assignment, result);
    if (flags.has('--check-source') && report.valid) {
      const sourceErrors = await checkSource(assignment, root);
      report.readinessErrors.push(...sourceErrors);
      if (result !== undefined && sourceErrors.length) report.ready = false;
      report.sourceMatches = sourceErrors.length === 0;
    }
    const exitCode = !report.valid ? 1 : flags.has('--require-ready') && !report.ready ? 2 : 0;
    return { report, exitCode };
  } catch (error) {
    return { report: { valid: false, ready: false, errors: [error.message], readinessErrors: [] }, exitCode: 1 };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { report, exitCode } = await main(process.argv.slice(2));
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exitCode;
}
