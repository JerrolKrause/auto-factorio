import { readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runChecks } from './checks.mjs';
import { fingerprintInputs, fingerprintOutputs, checkIdentity, writeReceipt, assessReuse } from './receipts.mjs';
import { acquireResource, releaseResource, probePreflight } from './resources.mjs';
import { appendEvent, reportEvents } from './events.mjs';
import { admitWork, reserveAdmission } from './admission.mjs';
import { checkCorrectionAdmission, recordCorrectionAdmission } from './review-ledger.mjs';
import { validatePlan } from './usage.mjs';
import { validateContract, checkSource } from '../check-agent-contract.mjs';
import { boundedJson, createEvidenceDirectory, safeRuntimePath, sha256, writeNewJson } from './safe-artifacts.mjs';

export const commandIdentity = check => JSON.stringify([check.command, ...check.args]);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(value);
const envKeys = new Set(['AF_GAME_PROFILE_ROOT', 'AUTOFACTORIO_FACTORIO_DIR']);

/** A supplied manifest describes work. The independent assignment supplies its authority. */
export function validateManifest(manifest, assignment) {
  if (manifest?.version !== 1 || !id(manifest.change) || !id(manifest.slice) || !id(manifest.candidate) || !id(manifest.owner) || !Array.isArray(manifest.criteria) || !manifest.criteria.length || !Array.isArray(manifest.checks) || !manifest.checks.length || !Array.isArray(manifest.resources)) throw new Error('invalid verification manifest');
  if (!assignment?.checks || !assignment?.criteria || assignment.role !== 'verification' || !assignment.allowedActions?.includes('Execute this manifest within declared effects and resources')) throw new Error('author-approved manifest assignment required');
  if (!validateContract(assignment).valid) throw new Error('invalid author assignment');
  if (assignment.version === 2 && assignment.execution?.manifestSha256 !== sha256(JSON.stringify(manifest))) throw new Error('manifest differs from independently approved fingerprint');
  validatePlan(manifest.plan);
  if (!manifest.usageReport?.usage || !manifest.usageReport?.coverage) throw new Error('explicit usage coverage required');
  if (!Number.isInteger(manifest.cleanupReserveMs) || manifest.cleanupReserveMs <= 0) throw new Error('cleanup reserve required');
  const ids = new Set(); const covered = new Set(); const resourceIds = new Set();
  for (const resource of manifest.resources) {
    if (!id(resource.id) || resourceIds.has(resource.id) || !assignment.resources?.some(row => row.id === resource.id && row.owner === manifest.owner) || !Array.isArray(resource.cleanup)) throw new Error('invalid resource authority');
    resourceIds.add(resource.id);
    for (const cleanup of resource.cleanup) if (!assignment.checks.some(row => row.command === commandIdentity(cleanup))) throw new Error('cleanup command unauthorized');
  }
  for (const check of manifest.checks) {
    if (!id(check.id) || ids.has(check.id) || typeof check.command !== 'string' || !Array.isArray(check.args) || check.args.some(arg => typeof arg !== 'string') || !Array.isArray(check.dependsOn) || check.dependsOn.some(dep => !ids.has(dep)) || !Array.isArray(check.criteria) || !check.criteria.length || !Array.isArray(check.resources) || check.resources.some(resource => !resourceIds.has(resource)) || !['none', 'game', 'browser'].includes(check.effects) || !Number.isSafeInteger(check.timeoutMs) || check.timeoutMs <= 0 || typeof check.freshRequired !== 'boolean') throw new Error(`invalid check/dependencies: ${check?.id}`);
    if (!assignment.checks.some(row => row.id === check.assignmentCheckId && row.command === commandIdentity(check))) throw new Error(`unauthorized argv: ${check.id}`);
    if (Object.keys(check.env ?? {}).some(key => !envKeys.has(key))) throw new Error('environment outside allowlist');
    if (Object.values(check.env ?? {}).some(value => typeof value !== 'string') || !Array.isArray(check.inputs) || !check.inputs.length) throw new Error('invalid environment/dependency boundary');
    checkIdentity(check, check.inputs, check.tools ?? manifest.tools);
    if (check.effects !== 'none' && (!check.resources.length || !check.preflight)) throw new Error('effectful check requires owned resources and preflight');
    if (check.effects !== 'none' && check.observation === 'exit') throw new Error('effects require actual observations beyond exit status');
    if (check.effects !== 'none' && check.resources.some(id => !manifest.resources.find(row => row.id === id).cleanup.length)) throw new Error('effectful resource cleanup required');
    if (check.effects !== 'none' && check.preflight.timeoutMs > check.timeoutMs) throw new Error('preflight exceeds check deadline');
    if (check.effects !== 'none' && !check.dependsOn.includes(check.preflight.fakeCheckId)) throw new Error('source-matched fake composition prerequisite required');
    for (const criterion of check.criteria) { if (!manifest.criteria.includes(criterion) || !assignment.criteria.some(row => row.id === criterion)) throw new Error('criterion authority missing'); covered.add(criterion); }
    ids.add(check.id);
  }
  if (new Set(manifest.criteria).size !== manifest.criteria.length || manifest.criteria.some(criterion => !covered.has(criterion))) throw new Error('missing or duplicate criterion mapping');
  return manifest;
}

function subprocessEnvironment(values = {}) {
  const result = {};
  for (const [key, value] of Object.entries(process.env)) if (/^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|HOMEDRIVE|HOMEPATH)$/i.test(key)) result[key] = value;
  return { ...result, ...values };
}

async function observation(check, root) {
  if (check.observation === 'exit') return { passed: true, kind: 'exit-only', coverage: 'declared software assertion only' };
  if (!check.observation?.path || !Array.isArray(check.observation.truthyFields) || !check.observation.truthyFields.length) return { passed: false, kind: 'missing-observation' };
  try {
    const file = await safeRuntimePath(root, check.observation.path, { mustExist: true });
    const value = JSON.parse(await readFile(file, 'utf8'));
    return { passed: check.observation.truthyFields.every(field => field.split('.').reduce((row, key) => row?.[key], value) === true), kind: 'recorded-observation', evidence: check.observation.path };
  } catch { return { passed: false, kind: 'unknown-observation' }; }
}

export async function executeManifest(manifest, assignment, { root = process.cwd(), outputRoot = '.runtime/development', status = console.log, signal, dependencies = {} } = {}) {
  validateManifest(manifest, assignment);
  const sourceErrors = await checkSource(assignment, root);
  if (sourceErrors.length) throw new Error('assignment source changed before admission');
  const directory = await createEvidenceDirectory(root, outputRoot, `verify-${manifest.slice}`);
  const relativeDirectory = path.relative(root, directory).split(path.sep).join('/');
  const stream = `${relativeDirectory}/events.jsonl`; const runId = path.basename(directory); let sequence = 0; let admissions = 0;
  await writeFile(path.join(directory, 'events.jsonl'), '', { flag: 'wx' });
  const events = async (kind, extra = {}) => appendEvent(stream, { version: 1, eventId: `${runId}-${++sequence}`, sequence, runId, workerId: manifest.owner, kind, at: new Date().toISOString(), change: manifest.change, slice: manifest.slice, candidate: manifest.candidate, phase: 'verification', role: 'verification', assignmentId: assignment.assignmentId, provenance: 'rule', ...extra }, { root });
  const leases = []; const results = []; const receipts = new Map(); const cleanup = []; let stopped = false;
  const activatedResources = new Set();
  const defaultTools = manifest.tools;
  const execute = dependencies.execute ?? ((step, evidence, cleanupMode = false) => runChecks([step], { cwd: root, evidence, signal: cleanupMode ? undefined : signal, status: line => status(boundedJson(JSON.parse(line))) }));
  try {
    for (const resource of manifest.resources) leases.push({ resource, lease: await (dependencies.acquire ?? acquireResource)(resource, manifest.owner, { root }) });
    for (const check of manifest.checks) {
      const tools = check.tools ?? defaultTools;
      if (stopped || signal?.aborted || check.dependsOn.some(dep => results.find(row => row.id === dep)?.outcome !== 'pass')) { results.push({ id: check.id, criteria: check.criteria, status: 'skipped', outcome: 'unverified', reason: 'failed-prerequisite-or-stopped' }); continue; }
      const before = await fingerprintInputs(root, check.inputs);
      const grouping = row => JSON.stringify([row.command, row.args, row.env ?? {}, row.inputs, row.observationVersion, row.configIdentity, row.observation]);
      const criteria = [...new Set(manifest.checks.filter(row => grouping(row) === grouping(check)).flatMap(row => row.criteria))];
      let identity = checkIdentity({ ...check, criteria, ...(check.outputRoots ? { outputs: await fingerprintOutputs(root, check.outputRoots) } : {}) }, before, tools);
      let key = sha256(JSON.stringify(identity));
      // A fresh successful execution in this run supersedes an invalid historical
      // hint for the same dependency identity; otherwise siblings repeat stale work.
      const prior = receipts.get(key) ?? check.retainedReceipt;
      if (prior) {
        const reuse = await assessReuse(prior, identity, { root, freshRequired: check.freshRequired });
        await events('reuse', { checkId: check.id, outcome: reuse.reusable ? 'pass' : 'unverified', evidence: [prior.path] });
        if (reuse.reusable) { results.push({ id: check.id, status: 'reused', outcome: 'pass', receipt: prior, identity, evidence: reuse.receipt.evidence.map(row => row.path), sourceStable: true, observation: 'validated-original-evidence', criteria: check.criteria }); continue; }
        if (check.effects !== 'none' && !check.freshRequired) { results.push({ id: check.id, criteria: check.criteria, status: 'blocked', outcome: 'unverified', reason: `reuse-refused-reconciliation-required:${reuse.reason}` }); stopped = true; continue; }
      }
      if (check.observation !== 'exit') {
        const destination = await safeRuntimePath(root, check.observation.path);
        let exists = false;
        try { await lstat(destination); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        // A fresh execution cannot borrow an earlier positive. Keep old evidence
        // immutable and require a new destination rather than erasing it.
        if (exists) { results.push({ id: check.id, criteria: check.criteria, status: 'blocked', outcome: 'unverified', reason: 'fresh-observation-destination-already-exists' }); stopped = true; continue; }
      }
      const usage = dependencies.usageCheckpoint ? await dependencies.usageCheckpoint() : manifest.usageReport;
      let correctionProof;
      if (manifest.correction) {
        const correction = await recordCorrectionAdmission({ ...manifest.correction, command: commandIdentity(check), inputs: check.inputs }, { root });
        if (!correction.allowed) { results.push({ id: check.id, criteria: check.criteria, status: 'blocked', outcome: 'unverified', exit: null, sourceStable: true, identity, evidence: [], reason: `corrective admission refused: ${correction.reason}` }); await events('escalation', { checkId: check.id, outcome: 'unverified', failureClass: 'coverage-gap' }); stopped = true; continue; }
        correctionProof = correction.admission;
      }
      const admission = manifest.sharedAdmission === true ? await reserveAdmission(manifest.plan, usage, { root, owner: manifest.owner, alternative: manifest.unknownAlternative }) : admitWork(manifest.plan, usage, { admissions, alternative: manifest.unknownAlternative });
      await events('budget', { checkId: check.id, decision: admission.decision, ...(usage.coverage?.aggregate === true ? { usage: usage.usage } : {}) });
      await writeNewJson(path.join(directory, `checkpoint-${check.id}.json`), { observedAt: new Date().toISOString(), admission, coverage: usage.coverage, usage: usage.coverage?.aggregate === true ? usage.usage : null });
      if (!admission.admitted) { results.push({ id: check.id, criteria: check.criteria, status: 'blocked', outcome: 'unverified', reason: admission.reason ?? admission.decision }); stopped = true; continue; }
      admissions++;
      if (check.env?.AF_GAME_PROFILE_ROOT) await safeRuntimePath(root, check.env.AF_GAME_PROFILE_ROOT);
      if (check.preflight) {
        const fake = results.find(row => row.id === check.preflight.fakeCheckId);
        await (dependencies.preflight ?? probePreflight)({ ...check.preflight, fakeCompositionPassed: fake?.outcome === 'pass', fakeCompositionSourceMatched: fake?.sourceStable === true }, { root });
      }
      if (correctionProof) await checkCorrectionAdmission(correctionProof, { root });
      await events('start', { checkId: check.id, attemptId: check.id });
      for (const resource of check.resources) activatedResources.add(resource);
      const outcome = await execute({ name: check.id, command: check.command, args: check.args, timeoutMs: check.timeoutMs, env: subprocessEnvironment(check.env) }, path.join(directory, check.id));
      const executed = outcome.results[0]; const observed = executed?.exit === 0 && !executed?.interrupted ? await (dependencies.observe ?? observation)(check, root) : { passed: false };
      const after = await fingerprintInputs(root, check.inputs); let sourceStable = JSON.stringify(before) === JSON.stringify(after);
      if (check.outputRoots) {
        const outputs = await fingerprintOutputs(root, check.outputRoots);
        if (!outputs.length) observed.passed = false;
        if (!check.producesOutputs && JSON.stringify(identity.outputs) !== JSON.stringify(outputs)) sourceStable = false;
        identity = checkIdentity({ ...check, criteria, outputs }, before, tools); key = sha256(JSON.stringify(identity));
      }
      const passed = outcome.passed && observed.passed && sourceStable;
      if (!executed?.log) throw new Error('execution evidence missing');
      const log = path.relative(root, executed.log).split(path.sep).join('/');
      const result = { id: check.id, status: 'executed', outcome: passed ? 'pass' : executed.interrupted ? 'unknown' : 'fail', exit: executed.exit, observed, sourceStable, criteria: check.criteria, evidence: [log, ...(observed.evidence ? [observed.evidence] : [])], identity, ...(correctionProof ? { correctionAdmission: correctionProof } : {}) };
      results.push(result); stopped ||= !passed;
      await events(passed ? 'end' : 'failure', { checkId: check.id, attemptId: check.id, exit: executed.exit, durationMs: executed.elapsedMs, outcome: passed ? 'pass' : executed.interrupted ? 'unknown' : 'fail', evidence: result.evidence, failureClass: sourceStable ? 'unknown' : 'stale-evidence' });
      const afterUsage = dependencies.usageCheckpoint ? await dependencies.usageCheckpoint() : usage;
      await events('budget', { checkId: check.id, decision: admitWork(manifest.plan, afterUsage, { admissions, alternative: manifest.unknownAlternative }).decision, ...(afterUsage.coverage?.aggregate === true ? { usage: afterUsage.usage } : {}) });
      if (passed && check.effects === 'none') {
        const receipt = await writeReceipt(`${relativeDirectory}/${check.id}/receipt.json`, { identity, outcome: 'pass', observed: true, sourceStable, cleanup: 'completed', evidence: result.evidence }, { root });
        result.receipt = { path: receipt.path, sha256: receipt.sha256 }; receipts.set(key, result.receipt);
      }
    }
  } catch (error) { stopped = true; results.push({ id: 'runner', status: 'blocked', outcome: 'unverified', reason: error.message }); }
  finally {
    // Admission exhaustion never spends the separate cleanup reserve on new work.
    const cleanupDeadline = Date.now() + manifest.cleanupReserveMs;
    for (const { resource, lease } of leases.reverse()) {
      let resolved = true;
      const evidence = []; const checks = [];
      for (const [index, command] of (activatedResources.has(resource.id) ? resource.cleanup : []).entries()) {
        try {
          const remaining = cleanupDeadline - Date.now();
          if (remaining <= 0) { resolved = false; continue; }
          const outcome = await execute({ name: `cleanup-${index}`, ...command, timeoutMs: remaining, env: subprocessEnvironment() }, path.join(directory, `cleanup-${resource.id}-${index}`), true);
          resolved &&= outcome.passed && !outcome.results[0]?.interrupted;
          const executed = outcome.results[0];
          if (executed?.log) evidence.push(path.relative(root, executed.log).split(path.sep).join('/'));
          checks.push({ command: commandIdentity(command), exit: executed?.exit ?? null, passed: outcome.passed && !executed?.interrupted, evidence: executed?.log ? [path.relative(root, executed.log).split(path.sep).join('/')] : [] });
        } catch { resolved = false; }
      }
      if (resolved) {
        try { await (dependencies.release ?? releaseResource)(lease); } catch { resolved = false; }
      }
      cleanup.push({ id: resource.id, resolved, evidence, checks });
      await events('cleanup', { checkId: resource.id, outcome: resolved ? 'pass' : 'unknown' });
    }
  }
  const report = { version: 1, runId, directory: relativeDirectory, candidate: manifest.candidate, results, cleanup, admissions, passed: !stopped && results.length === manifest.checks.length && results.every(row => row.outcome === 'pass') && cleanup.every(row => row.resolved), criteria: manifest.criteria.map(id => ({ id, outcome: results.filter(row => row.criteria?.includes(id)).length && results.filter(row => row.criteria?.includes(id)).every(row => row.outcome === 'pass') ? 'pass' : 'unverified' })), enforcement: 'managed-admissions-only', providerCalls: 0 };
  if ((await checkSource(assignment, root)).length) { report.passed = false; report.sourceStable = false; }
  if (report.passed) for (const row of results.filter(result => result.status === 'executed' && !result.receipt)) {
    const receipt = await writeReceipt(`${relativeDirectory}/${row.id}/receipt.json`, { identity: row.identity, outcome: 'pass', observed: true, sourceStable: true, cleanup: 'completed', evidence: row.evidence }, { root });
    row.receipt = { path: receipt.path, sha256: receipt.sha256 };
  }
  await writeNewJson(path.join(directory, 'results.json'), report);
  if (assignment.version === 2) {
    const files = await Promise.all(assignment.source.files.map(async file => {
      try { return { path: file.path, sha256: sha256(await readFile(path.resolve(root, file.path))) }; }
      catch { return { path: file.path, sha256: null }; }
    }));
    const contractChecks = assignment.checks.map(prescribed => {
      const check = manifest.checks.find(row => row.assignmentCheckId === prescribed.id);
      const row = check ? results.find(result => result.id === check.id) : cleanup.flatMap(resource => resource.checks).find(result => result.command === prescribed.command);
      const reused = row?.status === 'reused'; const executed = row?.status === 'executed' || row?.exit != null;
      return { id: prescribed.id, command: prescribed.command, authorization: null, status: reused ? 'reused' : executed ? 'executed' : 'skipped', exit: reused ? null : row?.exit ?? null, outcome: row?.outcome === 'pass' || row?.passed ? 'pass' : executed ? 'fail' : 'unverified', observation: reused ? 'Validated original receipt; no current execution' : row?.reason ?? (executed ? 'Recorded exit and declared observation' : 'No execution evidence'), evidence: row?.evidence ?? [], reuse: reused ? { receipt: row.receipt, identity: row.identity, criteria: check.criteria, freshRequired: false } : null };
    });
    const generated = { version: 2, assignmentId: assignment.assignmentId, role: 'verification', summary: 'Mechanical runner observations; semantic acceptance remains with the author', disposition: report.passed ? 'returned' : 'blocked', source: { revision: assignment.source.revision, files, stable: files.every(file => assignment.source.files.some(original => original.path === file.path && original.sha256 === file.sha256)) }, limits: [], model: { requested: 'deterministic runner / no inference', observed: null, usage: null }, cleanup: assignment.resources.map(resource => { const row = cleanup.find(item => item.id === resource.id); return { id: resource.id, status: row?.resolved ? 'completed' : 'unresolved', observation: row?.resolved ? 'Exact ownership reconciled and released' : 'Cleanup remains unknown', evidence: row?.evidence.length ? row.evidence : [stream] }; }), checks: contractChecks, criteria: report.criteria.map(criterion => { const mapped = manifest.checks.filter(check => check.criteria.includes(criterion.id)); return { id: criterion.id, status: criterion.outcome, observation: criterion.outcome === 'pass' ? 'All mapped checks passed with declared observations' : 'Required mapped coverage remains unverified', evidence: [...new Set(results.filter(row => row.criteria?.includes(criterion.id)).flatMap(row => row.evidence ?? []))], checks: mapped.map(check => check.assignmentCheckId) }; }) };
    await writeNewJson(path.join(directory, 'contract-result.json'), generated);
  }
  await reportEvents([stream], `${relativeDirectory}/report`, { root });
  status(boundedJson({ passed: report.passed, evidence: relativeDirectory, executed: results.filter(row => row.status === 'executed').length, reused: results.filter(row => row.status === 'reused').length }));
  return report;
}

async function main() {
  const option = flag => { const index = process.argv.indexOf(flag); return index < 0 ? null : process.argv[index + 1]; };
  const file = option('--manifest'); const assignmentFile = option('--assignment');
  if (!file || !assignmentFile) throw new Error('dev:verify requires --manifest and --assignment; a manifest alone is not authority');
  const manifest = JSON.parse(await readFile(file, 'utf8')); const assignment = JSON.parse(await readFile(assignmentFile, 'utf8'));
  const result = await executeManifest(manifest, assignment, { outputRoot: option('--output-root') ?? '.runtime/development' });
  if (!result.passed) process.exitCode = 1;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(boundedJson({ error: error.message })); process.exitCode = 1; });
