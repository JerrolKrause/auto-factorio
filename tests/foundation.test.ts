import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { prepareDataDirectory } from '../scripts/data-directory.js';
import { commandCheck, modCheck } from '../scripts/compatibility.js';
import { probeSqlite } from '../scripts/sqlite-probe.js';

let fixture: string;
beforeAll(async () => {
  await mkdir('.runtime/tests', { recursive: true });
  fixture = await mkdtemp(path.resolve('.runtime/tests/foundation-'));
});

describe('SQLite on the actual host', () => {
  it('commits, rolls back, reopens and verifies a backup with the real driver', async () => {
    const result = await probeSqlite(fixture);
    expect(result, result.detail).toMatchObject({ status: 'supported' });
  });
  it('rejects an unsupported driver without loading or writing anything', async () => {
    const before = await readdir(fixture);
    const result = await probeSqlite(fixture, 'unknown', async () => { throw new Error('must not be called'); });
    expect(result).toMatchObject({ status: 'unsupported' });
    expect(result.detail).toContain('Unsupported SQLite driver');
    expect(await readdir(fixture)).toEqual(before);
  });
  it('reports a missing native driver explicitly without falling back', async () => {
    const result = await probeSqlite(fixture, 'better-sqlite3', async () => { throw new Error('native binding unavailable'); });
    expect(result).toMatchObject({ status: 'unsupported' });
    expect(result.detail).toContain('native binding unavailable');
  });
});

describe('data isolation', () => {
  it('creates and reuses only owned or empty directories', async () => {
    const target = path.join(fixture, 'owned');
    expect(await prepareDataDirectory(target, [])).toBe(target);
    await writeFile(path.join(target, 'keep.txt'), 'keep');
    expect(await prepareDataDirectory(target, [])).toBe(target);
    expect(await readFile(path.join(target, 'keep.txt'), 'utf8')).toBe('keep');
  });
  it('refuses personal saves without altering their contents', async () => {
    const target = path.join(fixture, 'personal');
    await mkdir(target);
    await writeFile(path.join(target, 'save.zip'), 'personal-save-sentinel');
    await expect(prepareDataDirectory(target, [])).rejects.toThrow('existing nonempty');
    expect(await readdir(target)).toEqual(['save.zip']);
    expect(await readFile(path.join(target, 'save.zip'), 'utf8')).toBe('personal-save-sentinel');
  });
  it('rejects a protected directory and ancestors or descendants', async () => {
    const protectedPath = path.join(fixture, 'protected');
    for (const target of [protectedPath, path.join(protectedPath, 'child'), fixture]) {
      await expect(prepareDataDirectory(target, [protectedPath])).rejects.toThrow('protected directory');
    }
  });
  it('resolves junctions before checking protected paths', async () => {
    const protectedPath = path.join(fixture, 'junction-target');
    await mkdir(protectedPath);
    const link = path.join(fixture, 'junction');
    await symlink(protectedPath, link, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(prepareDataDirectory(path.join(link, 'child'), [protectedPath])).rejects.toThrow('protected directory');
    expect(await readdir(protectedPath)).toEqual([]);
  });
  it('requires an explicit absolute data path', async () => {
    await expect(prepareDataDirectory('relative', [])).rejects.toThrow('absolute');
  });
});

describe('compatibility failures', () => {
  it('reports a missing command as unsupported', () => {
    expect(commandCheck('missing', [path.join(fixture, 'missing.exe')], fixture)).toMatchObject({ status: 'unsupported' });
  });
  it('rejects an incompatible runtime version even when the command succeeds', () => {
    const result = commandCheck('version', [process.execPath, '-e', "console.log('v20.10.0')"], fixture, text => /^v24\./.test(text));
    expect(result).toMatchObject({ status: 'unsupported', exitCode: 0, stdout: 'v20.10.0' });
  });
  it('reports absent and malformed mod metadata', async () => {
    expect(await modCheck(fixture, 'space-age')).toMatchObject({ status: 'unsupported' });
    const target = path.join(fixture, 'data', 'base');
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'info.json'), '{invalid');
    expect(await modCheck(fixture, 'base')).toMatchObject({ status: 'unsupported' });
    await writeFile(path.join(target, 'info.json'), JSON.stringify({ name: 'wrong', version: '2.0.77' }));
    expect(await modCheck(fixture, 'base')).toMatchObject({ status: 'unsupported' });
  });
});
