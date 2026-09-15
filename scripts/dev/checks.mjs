import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Sequential checks with full local logs, concise output, and no dependent step after failure. */
export async function runChecks(steps, { cwd, evidence, status = console.log }) {
  await mkdir(evidence, { recursive: true });
  const results = [];
  for (const [index, step] of steps.entries()) {
    const log = path.join(evidence, `${index + 1}-${step.name}.log`);
    const output = createWriteStream(log, { flags: 'wx' });
    const started = Date.now();
    status(JSON.stringify({ check: step.name, status: 'running', log }));
    const pulse = setInterval(() => status(JSON.stringify({ check: step.name, status: 'running', elapsedMs: Date.now() - started, log })), 30000);
    const exit = await new Promise(resolve => {
      const child = spawn(step.command, step.args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
      child.once('error', () => resolve(1));
      child.once('close', code => resolve(code ?? 1));
    });
    clearInterval(pulse);
    await new Promise(resolve => output.end(resolve));
    const result = { check: step.name, command: step.command, args: step.args, exit, elapsedMs: Date.now() - started, log };
    results.push(result); status(JSON.stringify({ check: step.name, exit, elapsedMs: result.elapsedMs, log }));
    const skipped = exit ? steps.slice(index + 1).map(s => s.name) : [];
    await writeFile(path.join(evidence, 'results.json'), JSON.stringify({ passed: exit === 0 && index === steps.length - 1, results, skipped }, null, 2));
    if (exit !== 0) return { passed: false, results, skipped };
  }
  return { passed: true, results, skipped: [] };
}
