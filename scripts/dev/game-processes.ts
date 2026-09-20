import { spawn, spawnSync } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { realpath, readFile, writeFile, mkdir, mkdtemp, cp } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Rcon } from '../../packages/factorio/src/rcon.js';

export interface GameProfile {
  dir: string; executable: string; config: string; observerConfig: string; observerData: string;
  mods: string; settings: string; save: string; log: string; port: number; gamePort: number; password: string;
}
export interface ProjectProcess { pid: number; config: string; startedAt: string; kind: 'server' | 'observer'; gamePort?: number; rconPort?: number }
const installation = process.env.AUTOFACTORIO_FACTORIO_DIR ?? 'C:/Program Files (x86)/Steam/steamapps/common/Factorio';
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export async function ownedPath(file: string): Promise<string> {
  const root = await realpath('.runtime'); const resolved = await realpath(file); const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Expected a project-owned runtime path');
  return resolved;
}
/** Allowlist projection: never return a command line, environment, password, or unrecognized field. */
export function safeProcess(value: unknown): ProjectProcess {
  const v = value as Record<string, unknown>;
  if (!v || !Number.isSafeInteger(v.pid) || Number(v.pid) <= 0 || typeof v.config !== 'string' || typeof v.startedAt !== 'string' || !['server', 'observer'].includes(String(v.kind))) throw new Error('Malformed project process record');
  const result: ProjectProcess = { pid: Number(v.pid), config: v.config, startedAt: v.startedAt, kind: v.kind as ProjectProcess['kind'] };
  for (const key of ['gamePort', 'rconPort'] as const) if (Number.isInteger(v[key]) && Number(v[key]) > 0 && Number(v[key]) <= 65535) result[key] = Number(v[key]);
  return result;
}
// Filter and project inside PowerShell: raw Win32_Process records never cross the tool boundary.
const inventoryScript = `
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($env:AF_RUNTIME_ROOT).TrimEnd('\\')+'\\'
$result=@(Get-CimInstance Win32_Process -Filter "Name = 'factorio.exe'" | ForEach-Object {
 $line=$_.CommandLine
 if ($line -match '(?:^|\\s)--config(?:=|\\s+)(?:"([^"]+)"|(\\S+))') {
  $candidate=if($Matches[1]){$Matches[1]}else{$Matches[2]}
  $profile=[IO.Path]::GetFullPath($candidate)
  if ($profile.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) {
   $item=@{pid=[int]$_.ProcessId;config=$profile;startedAt=$_.CreationDate.ToUniversalTime().ToString('o');kind=if([IO.Path]::GetFileName($profile) -eq 'observer-config.ini'){'observer'}else{'server'}}
   if($line -match '--(?:bind|mp-connect)\\s+"?127\\.0\\.0\\.1:(\\d+)'){$item.gamePort=[int]$Matches[1]}
   if($line -match '--rcon-bind\\s+"?127\\.0\\.0\\.1:(\\d+)'){$item.rconPort=[int]$Matches[1]}
   [pscustomobject]$item
  }
 }
})
ConvertTo-Json -InputObject $result -Compress
`;
export async function listProjectProcesses(): Promise<ProjectProcess[]> {
  const root = await realpath('.runtime');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', inventoryScript], { windowsHide: true, encoding: 'utf8', env: { ...process.env, AF_RUNTIME_ROOT: root }, timeout: 15000 });
  if (result.status !== 0) throw new Error('Project process inspection failed; raw process output withheld');
  const values = JSON.parse(result.stdout) as unknown[];
  const safe: ProjectProcess[] = [];
  for (const value of values) { const item = safeProcess(value); await ownedPath(item.config); safe.push(item); }
  return safe;
}
export async function stopProfile(config: string): Promise<number[]> {
  const target = await ownedPath(config); const matches = (await listProjectProcesses()).filter(p => path.resolve(p.config).toLowerCase() === target.toLowerCase());
  for (const item of matches) {
    const script = `$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${item.pid}'; if($p -and $p.Name -eq 'factorio.exe' -and $p.CreationDate.ToUniversalTime().ToString('o') -eq ${quote(item.startedAt)}) { Stop-Process -Id $p.ProcessId -ErrorAction Stop }`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
    if (result.status !== 0) throw new Error('Could not stop the identified project process');
  }
  return matches.map(p => p.pid);
}
export async function waitFor<T>(label: string, inspect: () => Promise<T | undefined>, timeoutMs = 180000, intervalMs = 500): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) { const value = await inspect(); if (value !== undefined) return value; await delay(intervalMs); }
  throw new Error(`${label} readiness unconfirmed after ${timeoutMs}ms`);
}
export async function waitForServer(profile: GameProfile): Promise<Rcon> {
  return waitFor('RCON', async () => { try { return await Rcon.connect(profile.port, profile.password); } catch { return undefined; } }, 20000, 200);
}
export async function readProfile(dir: string): Promise<GameProfile> {
  dir = await ownedPath(dir); const v = JSON.parse(await readFile(path.join(dir, 'launch.json'), 'utf8')) as GameProfile;
  const profile = { ...v, dir, config: v.config ?? path.join(dir, 'config.ini'), observerConfig: v.observerConfig ?? path.join(dir, 'observer-config.ini'), observerData: v.observerData ?? path.join(dir, 'observer-data'), mods: v.mods ?? path.join(dir, 'mods'), settings: v.settings ?? path.join(dir, 'server-settings.json'), log: v.log ?? path.join(dir, 'host-process.log') };
  await ownedPath(profile.config); return profile;
}
export async function configureProfile(dir: string, save: string, options: { port: number; gamePort: number; source?: GameProfile }): Promise<GameProfile> {
  dir = await ownedPath(dir);
  const profile: GameProfile = { dir, save, executable: options.source?.executable ?? path.join(installation, 'bin/x64/factorio.exe'), config: path.join(dir, 'config.ini'), observerConfig: path.join(dir, 'observer-config.ini'), observerData: path.join(dir, 'observer-data'), mods: path.join(dir, 'mods'), settings: path.join(dir, 'server-settings.json'), log: path.join(dir, 'host-process.log'), port: options.port, gamePort: options.gamePort, password: randomBytes(24).toString('hex') };
  await mkdir(path.join(dir, 'data/saves'), { recursive: true }); await mkdir(profile.observerData, { recursive: true });
  if (options.source) { await cp(options.source.mods, profile.mods, { recursive: true }); await cp(options.source.settings, profile.settings); }
  else {
    await mkdir(profile.mods); await cp('mods/autofactorio', path.join(profile.mods, 'autofactorio_0.1.0'), { recursive: true });
    await writeFile(path.join(profile.mods, 'mod-list.json'), JSON.stringify({ mods: ['base', 'space-age', 'quality', 'elevated-rails', 'autofactorio'].map(name => ({ name, enabled: true })) }));
    await writeFile(profile.settings, JSON.stringify({ name: 'AutoFactorio diagnostic', description: 'Project-scoped deterministic validation', visibility: { public: false, lan: false }, require_user_verification: false, auto_pause: false, autosave_interval: 0, allow_commands: 'admins-only' }));
  }
  const ini = (data: string) => `[path]\nread-data=${installation}/data\nwrite-data=${data.replaceAll('\\', '/')}\n[general]\nlocale=en\n[graphics]\nfull-screen=false\n[other]\ncheck-updates=false\nenable-blueprint-storage-cloud-sync=false\n`;
  await writeFile(profile.config, ini(path.join(dir, 'data'))); await writeFile(profile.observerConfig, ini(profile.observerData));
  await writeFile(path.join(dir, 'launch.json'), JSON.stringify(profile, null, 2));
  return profile;
}
export async function createProfile(phase04: boolean, headless: boolean): Promise<GameProfile> {
  const base = path.resolve(phase04 ? '.runtime/phase04' : '.runtime/phase03'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'game-')); const profile = await configureProfile(dir, path.join(dir, 'sandbox.zip'), { port: phase04 ? 27024 : headless ? 27019 : 27018, gamePort: phase04 ? 34204 : headless ? 34199 : 34198 });
  const gen = path.join(dir, 'map-gen.json'); await writeFile(gen, JSON.stringify({ width: 128, height: 128, seed: 42, water: 0, autoplace_controls: { 'enemy-base': { frequency: 0 }, trees: { frequency: 0 } } }));
  const result = spawnSync(profile.executable, ['--config', profile.config, '--mod-directory', profile.mods, '--create', profile.save, '--map-gen-settings', gen], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  await writeFile(path.join(dir, 'create.log'), (result.stdout ?? '') + (result.stderr ?? ''));
  if (result.status !== 0) throw new Error('Map creation failed; inspect project create.log'); return profile;
}
export function serverArgs(p: GameProfile): string[] { return ['--config', p.config, '--mod-directory', p.mods, '--start-server', p.save, '--server-settings', p.settings, '--bind', `127.0.0.1:${p.gamePort}`, '--rcon-bind', `127.0.0.1:${p.port}`, '--rcon-password', p.password]; }
export async function startServer(profile: GameProfile): Promise<number> {
  await ownedPath(profile.config);
  if ((await listProjectProcesses()).some(p => p.config.toLowerCase() === profile.config.toLowerCase() || p.rconPort === profile.port || p.gamePort === profile.gamePort)) throw new Error('Project profile or port already in use; inspect game:processes');
  const fd = openSync(profile.log, 'a');
  const child = spawn(profile.executable, serverArgs(profile), { windowsHide: true, detached: true, stdio: ['ignore', fd, fd] }); closeSync(fd);
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('Dedicated server launch failed'))); }); child.unref();
  await recordProcesses(profile, { serverPid: child.pid! });
  try { const port = await waitForServer(profile); port.close(); } catch (error) { await stopProfile(profile.config); throw error; }
  return child.pid!;
}
export async function recordProcesses(profile: GameProfile, update: Record<string, unknown>): Promise<void> {
  const file = path.join(profile.dir, 'processes.json'); let old = {};
  try { old = JSON.parse(await readFile(file, 'utf8')); } catch { /* first launch */ }
  await writeFile(file, JSON.stringify({ ...old, config: profile.config, observerConfig: profile.observerConfig, ...update }, null, 2));
}
export async function startObserver(profile: GameProfile, replaceConfig?: string, onSpawn?: (pid:number)=>void): Promise<number> {
  await ownedPath(profile.observerConfig);
  if (replaceConfig) await stopProfile(replaceConfig);
  const observers = (await listProjectProcesses()).filter(p => p.kind === 'observer');
  if (observers.length) throw new Error('A project observer is already running; reuse it or explicitly replace its paused profile');
  const child = spawn('C:/Program Files (x86)/Steam/steam.exe', ['-applaunch', '427520', '--config', profile.observerConfig, '--mod-directory', profile.mods, '--mp-connect', `127.0.0.1:${profile.gamePort}`, '--disable-audio', '--window-size', '1280x800'], { windowsHide: false, detached: true, stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('Steam observer launch failed'))); }); child.unref();onSpawn?.(child.pid!);
  await recordProcesses(profile, { observerLauncherPid: child.pid! }); return child.pid!;
}
export async function identifyObserver(profile: GameProfile): Promise<number> {
  const found = await waitFor('Observer process', async () => (await listProjectProcesses()).find(p => p.kind === 'observer' && p.config.toLowerCase() === profile.observerConfig.toLowerCase()), 20000);
  await recordProcesses(profile, { observerPid: found.pid, observerStartedAt: found.startedAt }); return found.pid;
}
export async function writeLaunchScripts(profile: GameProfile): Promise<void> {
  await writeFile(path.join(profile.dir, 'launch.ps1'), '& ' + [profile.executable, ...serverArgs(profile)].map(quote).join(' ') + '\n');
  await writeFile(path.join(profile.dir, 'launch-observer.ps1'), '& ' + ['C:/Program Files (x86)/Steam/steam.exe', '-applaunch', '427520', '--config', profile.observerConfig, '--mod-directory', profile.mods, '--mp-connect', `127.0.0.1:${profile.gamePort}`].map(quote).join(' ') + '\n');
}
