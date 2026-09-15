import { readFile, realpath, writeFile, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function editUtf8(plan, root = process.cwd()) {
  const base = await realpath(root); const file = await realpath(path.resolve(base, plan.path));
  const relative = path.relative(base, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Edit must name an existing workspace file');
  const bytes = await readFile(file); const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  let text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const digest = value => createHash('sha256').update(value).digest('hex');
  if (plan.sha256 && digest(bytes) !== plan.sha256) throw new Error('File changed since the expected snapshot');
  let replacements = 0;
  if (!Array.isArray(plan.edits) || !plan.edits.length) throw new Error('An edit list is required');
  for (const edit of plan.edits) {
    if (typeof edit.before !== 'string' || !edit.before || typeof edit.after !== 'string' || !Number.isSafeInteger(edit.count ?? 1) || (edit.count ?? 1) < 1) throw new Error('Invalid contextual edit');
    const count = text.split(edit.before).length - 1;
    if (count !== (edit.count ?? 1)) throw new Error(`Context match count differs: expected ${edit.count ?? 1}, found ${count}`);
    text = text.split(edit.before).join(edit.after); replacements += count;
  }
  if (!(await readFile(file)).equals(bytes)) throw new Error('File changed during edit preparation');
  const result = Buffer.from((bom ? '\ufeff' : '') + text, 'utf8');
  const temporary = file + '.edit-' + randomUUID();
  await writeFile(temporary, result, { flag: 'wx' }); await rename(temporary, file);
  return { path: relative, replacements, sha256: digest(result) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await editUtf8(JSON.parse(await readFile(process.argv[2], 'utf8'))))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
