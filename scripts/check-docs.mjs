import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(file => file.endsWith('.md'));
const errors = [];
let links = 0;
// Count the whole snapshot, including headings/links; exclude only its final newline.
const handoffPath = 'docs/IMPLEMENTATION_HANDOFF.md';
try {
  const handoff = await readFile(handoffPath, 'utf8');
  const words = handoff.trim().split(/\s+/u).filter(Boolean).length;
  const lines = handoff === '' ? 0 : handoff.replace(/\r?\n$/, '').split(/\r?\n/).length;
  if (words > 800 || lines > 80) errors.push(`${handoffPath}: snapshot exceeds cap (${words}/800 words, ${lines}/80 lines); replace superseded status and move details to task reports or IMPLEMENTATION_HISTORY.md.`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  errors.push(`${handoffPath}: required current snapshot is missing`);
}
for (const file of files) {
  let text;
  try { text = await readFile(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  if (/\uFFFD|^(?:<{7}|={7}|>{7})/m.test(text)) errors.push(`${file}: encoding or conflict marker`);
  if ((text.match(/^\s*```/gm) ?? []).length % 2) errors.push(`${file}: unbalanced code fences`);
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    links++;
    try { await access(path.resolve(path.dirname(file), decodeURIComponent(target))); }
    catch { errors.push(`${file}: missing local link ${target}`); }
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`PASS: ${files.length} Markdown files, ${links} local links, encoding/conflict markers and balanced fences.`);
