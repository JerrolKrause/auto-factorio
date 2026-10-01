import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { checkSource, checkResultEvidence, validateContract } from '../check-agent-contract.mjs';
import { sha256 } from './safe-artifacts.mjs';

export const SLICE_LIFECYCLE = ['candidate', 'smoke-verified', 'reviewed-with-findings', 'corrected', 'reviewed-clean', 'acceptance-verified', 'closable'];
const text = value => typeof value === 'string' && value.trim().length > 0;

// A mutable status index may point at a separately pinned acceptance definition. Only status and
// returned contract pointers are excluded; scenario/check/plan semantics remain reviewed inputs.
export function acceptanceDefinition(input) {
  return { change: input.change, capabilities: input.capabilities, integrationBoundaries: input.integrationBoundaries, slices: input.slices?.map(slice => { const declaration = { ...slice }; delete declaration.acceptance; delete declaration.historicalAcceptance; return declaration; }), scenarios: input.scenarios, sessionPlan: input.sessionPlan, closeout: input.closeout };
}

async function file(root, relative) {
  if (!text(relative) || path.isAbsolute(relative) || relative.includes('\\') || relative.includes(':') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('invalid workspace-relative path');
  const target = await realpath(path.resolve(root, relative));
  const rel = path.relative(root, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('path escapes workspace');
  return target;
}

async function contractPair(pair, role, root) {
  const assignment = JSON.parse(await readFile(await file(root, pair?.assignment), 'utf8'));
  const result = JSON.parse(await readFile(await file(root, pair?.result), 'utf8'));
  const validation = validateContract(assignment, result);
  if (assignment.role !== role || !validation.ready) throw new Error(`${role} contract is not ready: ${[...validation.errors, ...validation.readinessErrors].join('; ')}`);
  const errors = [...await checkSource(assignment, root), ...await checkResultEvidence(assignment, result, root)];
  if (errors.length) throw new Error(`${role} evidence is stale or incomplete: ${errors.join('; ')}`);
  return { assignment, result };
}

async function closeoutTask(root, closeout) {
  if (!closeout?.archivedTaskFile) return file(root, closeout?.taskFile);
  const candidates = [];
  for (const filename of [closeout.taskFile, closeout.archivedTaskFile]) {
    try { candidates.push(await file(root, filename)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  // Archiving relocates an already accepted task, it cannot introduce a competing checklist.
  if (candidates.length !== 1) throw new Error('closeout task location missing or ambiguous');
  return candidates[0];
}

/** Admission validates current predecessor proof. Historical acceptance is provenance, never current coverage. */
export async function assessSliceReadiness(input, { root = process.cwd(), startSlice } = {}) {
  const base = await realpath(root), errors = [], contracts = {};
  const slices = Array.isArray(input?.slices) ? input.slices : [], scenarios = Array.isArray(input?.scenarios) ? input.scenarios : [];
  if (input?.version !== 2 || !text(input.change)) errors.push('version/change: expected a version 2 change');
  if (!SLICE_LIFECYCLE.includes(input?.lifecycle)) errors.push('lifecycle: invalid v2 state');
  if (!startSlice && !['acceptance-verified', 'closable'].includes(input?.lifecycle)) errors.push('lifecycle: final acceptance is incomplete');
  if (!slices.length || !scenarios.length) errors.push('slices/scenarios: nonempty arrays required');
  if (input.definition) try {
    const bytes = await readFile(await file(base, input.definition.path));
    if (sha256(bytes) !== input.definition.sha256 || JSON.stringify(JSON.parse(bytes)) !== JSON.stringify(acceptanceDefinition(input))) errors.push('acceptance definition changed or corrupt');
  } catch (error) { errors.push(`acceptance definition: ${error.message}`); }
  const byId = new Map(), ids = new Set(), ownership = new Map();
  for (const scenario of scenarios) {
    if (!text(scenario?.id) || ids.has(scenario.id)) errors.push('scenarios: invalid or duplicate identity');
    ids.add(scenario?.id);
    if (!text(scenario?.requirement) || scenario?.entrypoint?.kind !== 'production') errors.push(`scenario ${scenario?.id}: production requirement/entrypoint required`);
    try { await file(base, scenario?.entrypoint?.path); } catch (error) { errors.push(`scenario ${scenario?.id}: ${error.message}`); }
    if (!Array.isArray(scenario?.checks) || !scenario.checks.length || scenario.checks.some(row => !text(row.command) || !Array.isArray(row.evidence) || !row.evidence.length)) errors.push(`scenario ${scenario?.id}: command/evidence required`);
    if (scenario?.effectful && (!Array.isArray(scenario.negativeCases) || !scenario.negativeCases.length || scenario.recovery !== true)) errors.push(`scenario ${scenario.id}: negative/recovery coverage required`);
  }
  for (const slice of slices) {
    if (!text(slice?.id) || byId.has(slice.id)) errors.push('slices: invalid or duplicate identity');
    byId.set(slice?.id, slice);
    if (!Array.isArray(slice?.prerequisites) || new Set(slice.prerequisites).size !== slice.prerequisites.length) errors.push(`slice ${slice?.id}: explicit unique prerequisites required`);
    if (!Array.isArray(slice?.scenarios) || !slice.scenarios.length) errors.push(`slice ${slice?.id}: scenarios required`);
    for (const id of slice?.scenarios ?? []) {
      if (!ids.has(id) || ownership.has(id)) errors.push(`scenario ${id}: unknown or multiple owners`);
      ownership.set(id, slice.id);
    }
  }
  for (const id of ids) if (!ownership.has(id)) errors.push(`scenario ${id}: no owner`);
  for (const label of ['capabilities', 'integrationBoundaries']) {
    const values = input?.[label];
    if (!Array.isArray(values) || !values.length || values.some(value => !text(value)) || new Set(values).size !== values.length) errors.push(`${label}: unique declarations required`);
    const assigned = new Set();
    for (const slice of slices) {
      if (!Array.isArray(slice?.[label]) || !slice[label].length) errors.push(`slice ${slice?.id}: ${label} required`);
      for (const value of slice?.[label] ?? []) { if (!values?.includes(value)) errors.push(`${label}: unknown ${value}`); assigned.add(value); }
    }
    for (const value of values ?? []) if (!assigned.has(value)) errors.push(`${label}: unassigned ${value}`);
  }
  if (((input?.capabilities?.length ?? 0) > 2 || (input?.integrationBoundaries?.length ?? 0) > 4) && slices.length < 2) errors.push('large changes require multiple accepted slices');
  const visiting = new Set(), visited = new Set();
  const visit = id => {
    if (!byId.has(id)) { errors.push(`prerequisite ${id}: unknown slice`); return; }
    if (visiting.has(id)) { errors.push(`prerequisite ${id}: cycle`); return; }
    if (visited.has(id)) return;
    visiting.add(id); for (const predecessor of byId.get(id).prerequisites ?? []) visit(predecessor); visiting.delete(id); visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
  const required = new Set();
  const requirePredecessors = id => { for (const predecessor of byId.get(id)?.prerequisites ?? []) if (!required.has(predecessor)) { required.add(predecessor); requirePredecessors(predecessor); } };
  if (startSlice) { if (!byId.has(startSlice)) errors.push(`start slice ${startSlice}: unknown`); else requirePredecessors(startSlice); }
  else for (const id of byId.keys()) required.add(id);
  if (!errors.length) for (const id of required) {
    const slice = byId.get(id), pairs = slice.acceptance;
    try {
      const verification = await contractPair(pairs?.verification, 'verification', base), review = await contractPair(pairs?.review, 'review', base);
      contracts[id] = { verification: verification.assignment.assignmentId, review: review.assignment.assignmentId, ready: true };
      if (input.definition) {
        for (const pair of [verification, review]) if (!pair.assignment.source.files.some(row => row.path === input.definition.path && row.sha256 === input.definition.sha256)) errors.push(`slice ${id}: acceptance definition is outside contract authority`);
        if (!review.result.scope.some(row => row.path === input.definition.path && row.status === 'reviewed')) errors.push(`slice ${id}: acceptance definition was not independently reviewed`);
      }
      for (const scenarioId of slice.scenarios) {
        const scenario = scenarios.find(row => row.id === scenarioId);
        if (!verification.result.criteria?.some(row => row.id === scenarioId && row.status === 'pass')) errors.push(`scenario ${scenarioId}: criterion is not passed`);
        const entrypoint = scenario.entrypoint.path;
        if (!verification.assignment.source.files.some(row => row.path === entrypoint)) errors.push(`scenario ${scenarioId}: entrypoint outside verified source`);
        if (!review.result.scope?.some(row => row.path === entrypoint && row.status === 'reviewed')) errors.push(`scenario ${scenarioId}: entrypoint outside independent review`);
        for (const check of scenario.checks) {
          for (const evidence of check.evidence) await file(base, evidence);
          if (!verification.result.checks.some(row => row.command === check.command && ['executed', ...(verification.assignment.version === 2 ? ['reused'] : [])].includes(row.status) && row.outcome === 'pass' && check.evidence.every(evidence => row.evidence.includes(evidence)))) errors.push(`scenario ${scenarioId}: command/evidence not bound to passing check`);
        }
      }
    } catch (error) { errors.push(`slice ${id}: ${error.message}`); }
  }
  if (!startSlice && required.size === Object.keys(contracts).length) {
    // Refuse silently dropping an accepted scenario from the mutable closeout map.
    const covered = new Set();
    for (const slice of slices) try {
      const assignment = JSON.parse(await readFile(await file(base, slice.acceptance.verification.assignment), 'utf8'));
      for (const criterion of assignment.criteria) covered.add(criterion.id);
    } catch { /* Existing contract errors above preserve incomplete state. */ }
    for (const criterion of covered) if (!ids.has(criterion)) errors.push(`accepted criterion ${criterion}: absent from scenario ownership`);
  }
  // Closeout status lives outside reusable implementation fingerprints and is checked afresh here.
  if (!startSlice) {
    try {
      const tasks = await readFile(await closeoutTask(base, input?.closeout), 'utf8');
      const rows = [...tasks.matchAll(/^- \[([ xX])\] (\d+(?:\.\d+)*)\s+/gm)];
      if (!rows.length || rows.some(row => row[1] === ' ')) errors.push('closeout: task acceptance is incomplete');
      const handoff = await readFile(await file(base, input?.closeout?.handoffFile), 'utf8');
      const markers = input?.closeout?.requiredHandoffMarkers;
      if (!Array.isArray(markers) || !markers.length || markers.some(marker => !text(marker) || !handoff.includes(marker))) errors.push('closeout: handoff markers missing');
    } catch (error) { errors.push(`closeout: ${error.message}`); }
  }
  return { version: 2, change: input?.change, lifecycle: input?.lifecycle, mode: startSlice ? 'admission' : 'closeout', startSlice: startSlice ?? null, ready: errors.length === 0, errors, warnings: [], contracts, coverage: { scenarios: scenarios.length, slices: slices.length, capabilities: input?.capabilities?.length ?? 0, integrationBoundaries: input?.integrationBoundaries?.length ?? 0 }, requiredSlices: [...required] };
}
