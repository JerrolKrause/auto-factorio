import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

const marker = '.autofactorio-data.json';
const markerText = JSON.stringify({ owner: 'AutoFactorio', schemaVersion: 1 });

export function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Resolve existing ancestors too, so junctions cannot bypass protected paths. */
export async function canonical(target: string): Promise<string> {
  try { return await realpath(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(target);
    if (parent === target) throw error;
    return path.join(await canonical(parent), path.basename(target));
  }
}

export async function prepareDataDirectory(requested: string, protectedPaths: string[]): Promise<string> {
  if (!path.isAbsolute(requested)) throw new Error('Data directory must be an explicit absolute path.');
  const data = await canonical(requested);
  for (const protectedPath of protectedPaths) {
    const protectedReal = await canonical(path.resolve(protectedPath));
    if (contains(protectedReal, data) || contains(data, protectedReal)) {
      throw new Error(`Data path conflict with protected directory: ${protectedReal}`);
    }
  }
  let entries: string[] = [];
  try { entries = await readdir(data); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (entries.length) {
    const markerPath = path.join(data, marker);
    let owned = false;
    try {
      owned = !(await lstat(markerPath)).isSymbolicLink() && (await readFile(markerPath, 'utf8')).trim() === markerText;
    } catch { /* Unknown existing directories must never be adopted. */ }
    if (!owned) throw new Error('Data path conflict: existing nonempty directory is not owned by AutoFactorio.');
  }
  await mkdir(data, { recursive: true });
  if (!entries.includes(marker)) await writeFile(path.join(data, marker), `${markerText}\n`, { flag: 'wx' });
  return data;
}
