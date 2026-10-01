import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assessSliceReadiness } from './slice-readiness.mjs';
import { assessReviewLedger } from './review-ledger.mjs';
import { evaluatePlan, validatePlan } from './usage.mjs';
import { boundedJson, createEvidenceDirectory, safeRuntimePath, sha256, writeNewJson } from './safe-artifacts.mjs';

/** A replacement receives references to full proof, not another transcript or a replenished plan. */
export async function createSliceHandoff(input, { root = process.cwd(), startSlice, records = [], usageReport, decisions = [], nextAction, outputRoot = '.runtime/development/handoffs' } = {}) {
  const readiness = await assessSliceReadiness(input, { root, startSlice });
  if (!startSlice || !readiness.ready) throw new Error(`handoff prerequisites are incomplete: ${readiness.errors.join('; ')}`);
  if (typeof nextAction !== 'string' || !nextAction.trim() || nextAction.length > 500 || !Array.isArray(decisions) || decisions.length > 10 || decisions.some(row => typeof row !== 'string' || row.length > 300)) throw new Error('bounded decisions and next action required');
  validatePlan(input.sessionPlan);
  const lineage = await assessReviewLedger(records, { root });
  if (!lineage.ready) throw new Error('handoff finding/adjudication lineage is incomplete');
  const proof = [], resources = [];
  for (const id of readiness.requiredSlices) for (const role of ['verification', 'review']) {
    const pair = input.slices.find(row => row.id === id).acceptance[role];
    const references = {};
    for (const [kind, filename] of Object.entries(pair)) {
      const target = await realpath(path.resolve(root, filename)), relative = path.relative(await realpath(root), target);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('proof escapes workspace');
      const bytes = await readFile(target); references[kind] = { path: filename, sha256: sha256(bytes) };
    }
    const assignment = JSON.parse(await readFile(path.resolve(root, pair.assignment), 'utf8')), result = JSON.parse(await readFile(path.resolve(root, pair.result), 'utf8'));
    proof.push({ slice: id, role, assignmentId: assignment.assignmentId, references, sourceFingerprint: sha256(JSON.stringify(assignment.source)), revision: assignment.source.revision });
    for (const resource of assignment.resources) resources.push({ ...resource, assignmentId: assignment.assignmentId, cleanup: result.cleanup.find(row => row.id === resource.id) ?? null });
  }
  const unknownUsage = { usage: { input: null, cachedInput: null, output: null, reasoning: null }, coverage: { aggregate: false } };
  const observation = usageReport ?? unknownUsage;
  const now = Date.now(), budget = evaluatePlan(input.sessionPlan, observation, now);
  budget.balance = input.sessionPlan.limits.map(limit => {
    const spent = limit.unit === 'wallMs' ? now - Date.parse(input.sessionPlan.startTime) : limit.unit === 'tokens' && observation.coverage?.complete === true ? observation.usage.input + observation.usage.output : null;
    const known = typeof spent === 'number' && Number.isFinite(spent) && spent >= 0;
    return { unit: limit.unit, limit: limit.value, reserve: limit.closeoutReserve, spent: known ? spent : null, remaining: known ? Math.max(0, limit.value - spent) : null };
  });
  const packet = {
    version: 1, change: input.change, nextSlice: startSlice, at: new Date().toISOString(), decisions, proof,
    findings: lineage.findings, ledger: records, resources,
    sharedPlan: input.sessionPlan, budget,
    usage: { aggregateComplete: observation.coverage?.aggregate === true, totals: observation.coverage?.aggregate === true ? observation.usage : null },
    nextAction, compaction: 'automatic-defaults', replacementResetsBudget: false,
    enforcement: 'Managed admissions enforce the original plan; direct commands and already-running reasoning remain outside enforcement.'
  };
  // Recheck the same source after reading proof; never publish a mixed-candidate packet.
  const final = await assessSliceReadiness(input, { root, startSlice });
  if (!final.ready) throw new Error('handoff source changed during capture');
  const directory = await createEvidenceDirectory(root, outputRoot, 'slice');
  const filename = path.join(directory, 'packet.json');
  await writeNewJson(filename, packet);
  return { path: path.relative(root, filename).split(path.sep).join('/'), sha256: sha256(await readFile(filename)), packet };
}

export async function main(args, { root = process.cwd(), write = console.log } = {}) {
  if (args.length !== 2 || args[0] !== '--input') throw new Error('usage: handoff.mjs --input <runtime.json>');
  const options = JSON.parse(await readFile(await safeRuntimePath(root, args[1], { mustExist: true }), 'utf8'));
  const result = await createSliceHandoff(options.manifest, { ...options, root });
  write(boundedJson({ path: result.path, sha256: result.sha256, nextSlice: result.packet.nextSlice, budget: result.packet.budget, replacementResetsBudget: false }));
  return 0;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(boundedJson({ error: error.message })); process.exitCode = 1; });
