import { readFile, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { safeRuntimePath, sha256, writeNewJson } from './safe-artifacts.mjs';

const relative = value => typeof value === 'string' && !path.isAbsolute(value) && !value.includes('\\') && !value.includes(':') && value.split('/').every(part => part && part !== '.' && part !== '..');
export async function fingerprintInputs(root, inputs) {
  if (!Array.isArray(inputs) || !inputs.length) throw new Error('unknown dependency boundary');
  const base = await realpath(root); const seen = new Set(); const result = [];
  for (const input of inputs) {
    if (!relative(input.path) || seen.has(input.path.toLowerCase()) || !['source', 'build', 'fixture', 'config', 'tool', 'game', 'mod'].includes(input.kind)) throw new Error('invalid dependency');
    seen.add(input.path.toLowerCase());
    const actual = await realpath(path.resolve(base, input.path)); const rel = path.relative(base, actual);
    if (rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) throw new Error('dependency escapes workspace');
    result.push({ path: input.path, kind: input.kind, sha256: sha256(await readFile(actual)) });
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

export function checkIdentity(check, dependencies, tools) {
  if (!check.observationVersion || !check.configIdentity || !tools?.node || !tools?.assertion) throw new Error('unknown configuration/tool/assertion identity');
  const observation = check.observation === 'exit' ? 'exit' : check.observation && typeof check.observation.path === 'string' && Array.isArray(check.observation.truthyFields) && check.observation.truthyFields.length ? { path: check.observation.path, truthyFields: [...new Set(check.observation.truthyFields)].sort() } : null;
  if (!observation) throw new Error('unknown observation declaration');
  return { command: check.command, args: check.args, environment: check.env ?? {}, dependencies, tools, configIdentity: check.configIdentity, observationVersion: check.observationVersion, observation, criteria: [...check.criteria].sort(), ...(check.outputRoots ? { outputRoots: check.outputRoots, outputs: check.outputs ?? [] } : {}) };
}

export async function fingerprintOutputs(root, roots) {
  const files = [];
  const walk = async directory => {
    if (!relative(directory)) throw new Error('invalid output dependency');
    let entries;
    try { entries = await readdir(path.join(root, directory), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('output dependency symlink refused');
      const filename = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(filename); else if (entry.isFile()) files.push({ path: filename, kind: 'build' });
    }
  };
  for (const directory of roots) await walk(directory);
  return files.length ? fingerprintInputs(root, files) : [];
}

export async function writeReceipt(file, input, { root = process.cwd() } = {}) {
  if (input.outcome !== 'pass' || input.observed !== true || input.sourceStable !== true || input.cleanup !== 'completed' || !input.identity?.dependencies?.length || !Array.isArray(input.evidence) || !input.evidence.length) throw new Error('incomplete evidence cannot become a reusable receipt');
  const evidence = [];
  for (const reference of input.evidence) {
    const actual = await safeRuntimePath(root, reference, { mustExist: true });
    evidence.push({ path: path.relative(root, actual).split(path.sep).join('/'), sha256: sha256(await readFile(actual)) });
  }
  const receipt = { version: 1, ...input, evidence };
  const target = await safeRuntimePath(root, file);
  await writeNewJson(target, receipt);
  return { path: path.relative(root, target).split(path.sep).join('/'), sha256: sha256(await readFile(target)), receipt };
}

/** Historical proof checks integrity, not permission to rerun against today's source. */
export async function assessReceiptIntegrity(reference, { root = process.cwd() } = {}) {
  try {
    if (!reference?.path || !reference.sha256) throw new Error('receipt identity unknown');
    const bytes = await readFile(await safeRuntimePath(root, reference.path, { mustExist: true }));
    if (sha256(bytes) !== reference.sha256) throw new Error('receipt integrity mismatch');
    const receipt = JSON.parse(bytes);
    if (receipt.version !== 1 || receipt.outcome !== 'pass' || receipt.observed !== true || receipt.sourceStable !== true || receipt.cleanup !== 'completed' || !receipt.identity?.observation || !receipt.identity?.dependencies?.length || !Array.isArray(receipt.evidence) || !receipt.evidence.length) throw new Error('historical receipt incomplete');
    for (const item of receipt.evidence) if (sha256(await readFile(await safeRuntimePath(root, item.path, { mustExist: true }))) !== item.sha256) throw new Error('evidence integrity mismatch');
    return { intact: true, receipt, reason: 'historical-proof-integrity-only' };
  } catch (error) { return { intact: false, reason: error.message }; }
}

/** Historical receipts stay immutable; every reuse has a separate decision record. */
export async function assessReuse(reference, identity, { root = process.cwd(), freshRequired = false, criteria = identity.criteria } = {}) {
  const refused = reason => ({ reusable: false, reason });
  if (freshRequired) return refused('fresh-run-required');
  if (!reference?.path || !reference.sha256) return refused('receipt-identity-unknown');
  try {
    const actual = await safeRuntimePath(root, reference.path, { mustExist: true }); const bytes = await readFile(actual);
    if (sha256(bytes) !== reference.sha256) return refused('receipt-integrity-mismatch');
    const receipt = JSON.parse(bytes);
    if (receipt.version !== 1 || receipt.outcome !== 'pass' || receipt.observed !== true || receipt.sourceStable !== true || receipt.cleanup !== 'completed') return refused('incomplete-outcome-or-cleanup');
    if (!identity?.dependencies?.length || JSON.stringify(receipt.identity) !== JSON.stringify(identity)) return refused('dependency-command-config-tool-or-observation-change');
    if (!identity.observation || !receipt.identity?.observation) return refused('observation-declaration-unknown');
    for (const file of identity.tools.files ?? []) {
      if (!path.isAbsolute(file.path) || sha256(await readFile(file.path)) !== file.sha256) return refused('installed-tool-or-game-change');
    }
    if (!criteria.every(id => receipt.identity.criteria.includes(id))) return refused('criterion-coverage-missing');
    const current = await fingerprintInputs(root, identity.dependencies);
    if (JSON.stringify(current) !== JSON.stringify(identity.dependencies)) return refused('current-dependency-change');
    if (identity.outputRoots && (!identity.outputs?.length || JSON.stringify(await fingerprintOutputs(root, identity.outputRoots)) !== JSON.stringify(identity.outputs))) return refused('build-output-change-or-unknown');
    if (!Array.isArray(receipt.evidence) || !receipt.evidence.length) return refused('evidence-missing');
    for (const item of receipt.evidence) {
      const evidence = await safeRuntimePath(root, item.path, { mustExist: true });
      if (sha256(await readFile(evidence)) !== item.sha256) return refused('evidence-integrity-mismatch');
    }
    return { reusable: true, reason: 'complete-matching-dependencies', receipt };
  } catch { return refused('unknown-or-unreadable-evidence'); }
}
