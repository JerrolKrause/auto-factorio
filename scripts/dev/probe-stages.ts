import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateRequest } from '@autofactorio/contracts';
import type { Batch } from '@autofactorio/contracts';
import { validateCheckpoint } from '../../packages/factorio/src/lifecycle.js';
import { ownedPath } from './game-processes.js';

export interface ResumeData { manifestPath: string; crafting: Batch; post: Batch; checks: string[]; plan: { cancelledAfterCheckpoint: string[]; absentAfterRollback: string[] } }
interface Stage { name: string; at: string; data: unknown }
interface Journal { schema: 1; profile: string; modHash: string; probeFingerprint: string; stages: Stage[] }
export async function fingerprint(files: string[]): Promise<string> {
  const digest = createHash('sha256');
  for (const file of files) { digest.update(file); digest.update(await readFile(file)); }
  return digest.digest('hex');
}
export class ProbeStages {
  private journal: Journal;
  constructor(private directory: string, metadata: Omit<Journal, 'schema' | 'stages'>) { this.journal = { schema: 1, ...metadata, stages: [] }; }
  async complete(name: string, data: unknown = {}): Promise<void> {
    if (this.journal.stages.some(s => s.name === name)) throw new Error('Probe stage already recorded');
    this.journal.stages.push({ name, at: new Date().toISOString(), data });
    const file = path.join(this.directory, 'stages.json');
    await writeFile(file + '.pending', JSON.stringify(this.journal, null, 2)); await rename(file + '.pending', file);
    console.log(JSON.stringify({ stage: name, status: 'complete' }));
  }
}
export async function resumeProfile(evidence: string): Promise<string> {
  await ownedPath(evidence);
  let journal: Journal;
  try { journal = JSON.parse(await readFile(path.join(evidence, 'stages.json'), 'utf8')) as Journal; }
  catch { throw new Error('No stage journal: legacy or interrupted-before-stage probe requires diagnosis'); }
  if (journal.schema !== 1 || typeof journal.profile !== 'string') throw new Error('Invalid stage journal');
  return ownedPath(journal.profile);
}
export async function readResume(evidence: string, modHash: string, probeFingerprint: string): Promise<ResumeData> {
  await resumeProfile(evidence);
  const journal = JSON.parse(await readFile(path.join(evidence, 'stages.json'), 'utf8')) as Journal;
  if (journal.modHash !== modHash || journal.probeFingerprint !== probeFingerprint) throw new Error('Probe or mod sources changed; cannot reuse stage evidence');
  if (!Array.isArray(journal.stages) || journal.stages.some(s => s.name === 'complete')) throw new Error('Completed or malformed probe is not a recovery source');
  const ready = journal.stages.find(s => s.name === 'restore-ready');
  if (!ready) throw new Error('No restore-ready stage: capture alone does not prove cancellation/rollback prerequisites');
  const data = ready.data as ResumeData;
  if (!data || !Array.isArray(data.checks) || data.checks.some(c => typeof c !== 'string')) throw new Error('Invalid recorded checks');
  await ownedPath(data.manifestPath);
  const checkpoint = await validateCheckpoint(data.manifestPath, modHash);
  validateRequest({ op: 'submit', batch: data.crafting }); validateRequest({ op: 'submit', batch: data.post });
  if (!checkpoint.captured.intents[data.crafting.commandId] || checkpoint.captured.ledger[data.post.commandId] || !data.plan.cancelledAfterCheckpoint.includes(data.crafting.commandId) || !data.plan.absentAfterRollback.includes(data.post.commandId)) throw new Error('Rollback prerequisites do not match checkpoint');
  return data;
}
