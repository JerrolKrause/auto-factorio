import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(file => file.endsWith('.md'));
const errors = [];
let links = 0;
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
