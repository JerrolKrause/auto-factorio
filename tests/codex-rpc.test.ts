import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppServerRpc, readCodexVersion } from '../packages/codex/src/rpc.js';
import { profileOverrides } from '../packages/codex/src/preflight.js';

const subprocess = vi.hoisted(() => ({ execFileSync: vi.fn(), spawn: vi.fn() }));
vi.mock('node:child_process', () => subprocess);

function fakeChild() {
  const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
  return Object.assign(new EventEmitter(), {
    stdin, stdout, stderr,
    kill: vi.fn(() => { stdin.destroy(); stdout.destroy(); stderr.destroy(); return true; }),
  });
}

describe('Codex CLI identity and RPC startup', () => {
  let child: ReturnType<typeof fakeChild>;
  beforeEach(() => {
    subprocess.execFileSync.mockReset();
    subprocess.spawn.mockReset();
    child = fakeChild();
    subprocess.spawn.mockReturnValue(child);
  });
  afterEach(() => { child.kill(); vi.unstubAllEnvs(); });

  it.each(['0.154.0', '0.160.0', '0.160.1', '0.160.2', '1.2.3', '2.0.0-preview.1', '2.0.0+build.5'])(
    'starts Codex %s with isolation intact and reports its actual version', version => {
      subprocess.execFileSync.mockReturnValue(`codex-cli ${version}\r\n`);
      vi.stubEnv('OPENAI_API_KEY', 'test-secret');
      vi.stubEnv('OPENAI_BASE_URL', 'https://untrusted.invalid');
      const rpc = new AppServerRpc('managed/codex.exe', 'isolated/role', profileOverrides(['host-tools'], 'isolated/logs'));
      expect(rpc.version).toBe(version);
      expect(subprocess.execFileSync).toHaveBeenCalledWith('managed/codex.exe', ['--version'], {
        encoding: 'utf8', windowsHide: true, timeout: 10_000,
      });
      expect(subprocess.spawn).toHaveBeenCalledTimes(1);
      const [executable, args, options] = subprocess.spawn.mock.calls[0]!;
      expect(executable).toBe('managed/codex.exe');
      expect(args.slice(0, 3)).toEqual(['app-server', '--stdio', '--strict-config']);
      for (const override of [
        'forced_login_method="chatgpt"', 'model_provider="openai"', 'approval_policy="never"',
        'sandbox_mode="read-only"', 'web_search="disabled"', 'project_doc_max_bytes=0',
        'features.shell_tool=false', 'features.apps=false', 'features.multi_agent_v2=false',
        'mcp_servers.host-tools.enabled=false', 'log_dir="isolated/logs"',
      ]) {
        const index = args.indexOf(override);
        expect(index, override).toBeGreaterThan(3);
        expect(args[index - 1], override).toBe('-c');
      }
      expect(options).toMatchObject({ cwd: 'isolated/role', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      expect(options.env).not.toHaveProperty('OPENAI_API_KEY');
      expect(options.env).not.toHaveProperty('OPENAI_BASE_URL');
      rpc.close();
      expect(child.kill).toHaveBeenCalledOnce();
    },
  );

  it.each(['', 'codex-cli unknown', 'codex-cli 0.160', 'other-cli 0.160.1', 'codex-cli 0.160.1 trailing',
    'warning\ncodex-cli 0.160.1', 'codex-cli 0.160.1-'])(
    'refuses to spawn an executable with malformed version output %j', output => {
      subprocess.execFileSync.mockReturnValue(output);
      expect(() => new AppServerRpc('unknown.exe', 'isolated/role')).toThrow('Could not identify the Codex CLI version');
      expect(subprocess.spawn).not.toHaveBeenCalled();
    },
  );

  it('does not spawn or fall back when the executable version probe fails', () => {
    subprocess.execFileSync.mockImplementation(() => { throw new Error('Executable unavailable'); });
    expect(() => new AppServerRpc('missing.exe', 'isolated/role')).toThrow('Executable unavailable');
    expect(subprocess.execFileSync).toHaveBeenCalledOnce();
    expect(subprocess.spawn).not.toHaveBeenCalled();
  });

  it('reads version metadata without launching an app-server', () => {
    subprocess.execFileSync.mockReturnValue('codex-cli 9.2.1+build.7\n');
    expect(readCodexVersion('managed/codex.exe')).toBe('9.2.1+build.7');
    expect(subprocess.spawn).not.toHaveBeenCalled();
  });
});
