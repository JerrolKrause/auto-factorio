import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const sha256 = value => createHash('sha256').update(value).digest('hex');

export async function workspaceRoot(start = process.cwd()) {
  return realpath(path.resolve(start));
}

const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function nearestExisting(target) {
  let candidate = target;
  for (;;) {
    try { return await realpath(candidate); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

/** Resolve a selected ignored runtime path without trusting junctions or symlinks. */
export async function safeRuntimePath(root, requested, { mustExist = false } = {}) {
  const base = await workspaceRoot(root);
  const target = path.resolve(base, requested);
  const runtime = path.join(base, '.runtime');
  if (!inside(runtime, target) && target !== runtime) throw new Error('path must be beneath .runtime');
  await mkdir(runtime, { recursive: true });
  if ((await lstat(runtime)).isSymbolicLink()) throw new Error('.runtime must not be a symlink or junction');
  const actualRuntime = await realpath(runtime);
  if (!inside(base, actualRuntime)) throw new Error('.runtime escapes workspace');
  const ancestor = await nearestExisting(target);
  if (!inside(actualRuntime, ancestor) && ancestor !== actualRuntime) throw new Error('path escapes .runtime');
  if (mustExist) {
    const actual = await realpath(target);
    if (!inside(actualRuntime, actual) && actual !== actualRuntime) throw new Error('path escapes .runtime');
    return actual;
  }
  return target;
}

export async function createEvidenceDirectory(root, requested, prefix) {
  const parent = await safeRuntimePath(root, requested);
  await mkdir(parent, { recursive: true });
  const actualParent = await realpath(parent);
  const base = await workspaceRoot(root);
  if (!inside(path.join(base, '.runtime'), actualParent)) throw new Error('runtime directory escapes workspace');
  const directory = path.join(actualParent, `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await mkdir(directory, { recursive: false });
  return directory;
}

export async function writeNewJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

export async function ensureOrdinaryFile(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`not an ordinary file: ${file}`);
}

export function boundedJson(value, maxBytes = 4096) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) <= maxBytes) return json;
  return JSON.stringify({ truncated: true, originalBytes: Buffer.byteLength(json), preview: json.slice(0, Math.max(0, maxBytes - 100)) });
}
