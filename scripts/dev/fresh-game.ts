import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ControlState } from '../../packages/factorio/src/lifecycle.js';
import { listProjectProcesses, ownedPath } from './game-processes.js';
import type { GameProfile, ProjectProcess } from './game-processes.js';

export interface FreshGameReceipt {
  id: string;
  profile: string;
  server: Pick<ProjectProcess, 'pid' | 'startedAt'>;
  createdAt: string;
}

/** Only game-launch calls this, after creating a new map in a unique profile. */
export async function recordFreshGame(profile: GameProfile): Promise<string> {
  const directory = await ownedPath(profile.dir);
  const servers = (await listProjectProcesses()).filter(p => p.kind === 'server' && p.config.toLowerCase() === profile.config.toLowerCase());
  if (servers.length !== 1) throw new Error('Fresh game server identity unconfirmed');
  const server = servers[0]!;
  const receipt: FreshGameReceipt = { id: randomUUID(), profile: directory, server: { pid: server.pid, startedAt: server.startedAt }, createdAt: new Date().toISOString() };
  await writeFile(path.join(directory, 'fresh-game.json'), JSON.stringify(receipt), { flag: 'wx' });
  return receipt.id;
}

export function validateFreshGame(receipt: FreshGameReceipt, id: string, directory: string, control: ControlState, processes: ProjectProcess[], now = Date.now()): FreshGameReceipt {
  const age = now - Date.parse(receipt.createdAt);
  const server = processes.find(p => p.kind === 'server' && p.config.toLowerCase() === path.join(directory, 'config.ini').toLowerCase());
  // Fixed epoch strings are not world identities. Require the freshly created
  // profile, the exact live process and its untouched initial control barrier.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) || receipt.id !== id || receipt.profile !== directory || !Number.isFinite(age) || age < 0 || age > 180_000 ||
      !server || processes.filter(p => p.kind === 'server').length !== 1 || server.pid !== receipt.server?.pid || server.startedAt !== receipt.server?.startedAt ||
      control.revision !== 0 || control.generation !== 1 || control.armed || !control.neutral || Object.keys(control.ledger).length || Object.keys(control.intents).length) {
    throw new Error('Fresh game boundary unconfirmed; retained ownership was preserved');
  }
  return receipt;
}

export async function readFreshGame(profile: GameProfile, id: string, control: ControlState): Promise<FreshGameReceipt> {
  const directory = await ownedPath(profile.dir);
  const receipt = JSON.parse(await readFile(path.join(directory, 'fresh-game.json'), 'utf8')) as FreshGameReceipt;
  return validateFreshGame(receipt, id, directory, control, await listProjectProcesses());
}
