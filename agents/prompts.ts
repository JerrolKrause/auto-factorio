import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// tsc emits into dist/agents; Markdown remains in the source tree used by npm start.
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const promptDirectory = path.basename(path.dirname(moduleDirectory)) === 'dist'
  ? path.resolve(moduleDirectory, '../../agents') : moduleDirectory;

/** Render a named Markdown section. Values are substituted once, never evaluated as code. */
export function renderPrompt(markdown: string, section: string, values: Record<string, string | number> = {}): string {
  const sections = new Map<string, string>();
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let name: string | undefined;
  let body: string[] = [];
  const save = () => {
    if (name === undefined) return;
    if (sections.has(name)) throw new Error(`Duplicate prompt section: ${name}`);
    sections.set(name, body.join('\n').trim());
  };
  for (const line of lines) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) { save(); name = heading[1]!.trim(); body = []; }
    else if (name !== undefined) body.push(line);
  }
  save();
  const template = sections.get(section);
  if (!template) throw new Error(`Missing or empty prompt section: ${section}`);
  const used = new Set<string>();
  const result = template.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (_, key: string) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Missing prompt value: ${key}`);
    used.add(key);
    return String(values[key]);
  });
  for (const key of Object.keys(values)) if (!used.has(key)) throw new Error(`Unused prompt value: ${key}`);
  return result;
}

export function readPrompt(role: string, section: string, values: Record<string, string | number> = {}): string {
  if (!/^[a-z-]+(?:\/[a-z-]+)*$/.test(role)) throw new Error(`Invalid prompt role: ${role}`);
  const file = path.join(promptDirectory, role, 'PROMPTS.md');
  try { return renderPrompt(readFileSync(file, 'utf8'), section, values); }
  catch (error) { throw new Error(`Cannot load agent prompt ${role}/${section}: ${String(error)}`); }
}
