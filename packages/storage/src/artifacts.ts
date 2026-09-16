import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { EventContext, Visibility } from '../../core/execution/durable.js';
import { visibility } from './journal.js';
import { permits } from '../../core/context/authorization.js';
export interface Artifact { id: string; run: string; sha256: string; size: number; visibility: Visibility; mediaType: string; purpose: 'agent-observation' | 'operator-telemetry' | 'public-transcript' | 'save' | 'checkpoint'; redacted: boolean }
export type Evidence = { available: true; bytes: Buffer } | { available: false; reason: 'missing' | 'corrupt' | 'unauthorized' };
export type Audience = { kind: 'operator' } | { kind: 'agent'; run: string; agent: string; role: string; task: string | null };
export const digest = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
/** Explicit credentials plus common structured/inline credential forms; never record raw auth configuration. */
export function redactor(secrets: string[] = []): (value: unknown) => unknown {
  const text = (s: string) => {
    for (const secret of secrets.filter(Boolean).sort((a,b) => b.length-a.length)) s = s.split(secret).join('[REDACTED]');
    return s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]').replace(/\b(password|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|rcon[_-]?password)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]');
  };
  const visit = (v: unknown): unknown => {
    if (typeof v === 'string') return text(v);
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k,x]) => [k, /^(password|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|rcon[_-]?password|client[_-]?secret)$/i.test(k) ? '[REDACTED]' : visit(x)]));
    return v;
  }; return visit;
}
export class Artifacts {
  constructor(readonly directory: string, private sanitize: (value: unknown) => unknown) { mkdirSync(directory, { recursive: true }); }
  put(context: EventContext, purpose: Artifact['purpose'], value: unknown): Artifact {
    const original = JSON.stringify(value); const safe = JSON.stringify(this.sanitize(value));
    return this.bytes(context, purpose, Buffer.from(safe), 'application/json', original !== safe);
  }
  bytes(context: EventContext, purpose: Artifact['purpose'], bytes: Buffer, mediaType: string, redacted = false): Artifact {
    visibility(context.visibility);
    // Binary save data is operator-only and comes exclusively from the managed checkpoint adapter.
    if (mediaType !== 'application/json' && (purpose !== 'save' || context.visibility.kind !== 'operator')) throw new Error('Binary evidence must be an operator save');
    const id = randomUUID(); const file = path.join(this.directory, id); const temporary = file + '.pending';
    const fd = openSync(temporary, 'wx');
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, file);
    return { id, run: context.run, sha256: digest(bytes), size: bytes.length, visibility: context.visibility, mediaType, purpose, redacted };
  }
  read(a: Artifact, audience: Audience): Evidence {
    if (!a || !/^[a-f0-9-]{36}$/.test(a.id)) return { available: false, reason: 'corrupt' };
    try { visibility(a.visibility); } catch { return { available: false, reason: 'unauthorized' }; }
    if (audience.kind === 'agent' && (a.run !== audience.run || ['save', 'checkpoint', 'operator-telemetry'].includes(a.purpose) || !permits(a.visibility, { ...audience, tasks: audience.task ? [audience.task] : [] }))) return { available: false, reason: 'unauthorized' };
    let bytes: Buffer; try { bytes = readFileSync(path.join(this.directory, a.id)); } catch { return { available: false, reason: 'missing' }; }
    if (bytes.length !== a.size || digest(bytes) !== a.sha256) return { available: false, reason: 'corrupt' };
    return { available: true, bytes };
  }
}
