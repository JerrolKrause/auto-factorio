import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { object, PINNED_CODEX } from './protocol.js';
import type { RpcPort } from './protocol.js';

/** Only supported app-server calls needed by this phase; no billing or admin writes. */
const METHODS = new Set(['initialize', 'config/read', 'account/read', 'getAuthStatus', 'model/list',
  'account/rateLimits/read', 'thread/start', 'thread/resume', 'thread/read', 'thread/turns/list',
  'thread/items/list', 'turn/start', 'turn/steer', 'turn/interrupt', 'mcpServerStatus/list']);
export function cleanEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  for (const key of Object.keys(result)) {
    if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|BASE_URL|CODEX_THREAD|CODEX_INTERNAL|CODEX_CI|CODEX_SANDBOX/i.test(key)) delete result[key];
  }
  return result;
}
export class AppServerRpc implements RpcPort {
  private readonly child;
  private sequence = 0;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private readonly listeners = new Set<(method: string, params: unknown) => void>();
  private closed = false;
  constructor(executable: string, cwd: string, overrides: Record<string, unknown> = {}) {
    const version = execFileSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
    if (version !== `codex-cli ${PINNED_CODEX}`) throw new Error(`Unsupported Codex: ${version}; expected ${PINNED_CODEX}`);
    const args = ['app-server', '--stdio', '--strict-config'];
    for (const [key, value] of Object.entries(overrides)) args.push('-c', `${key}=${JSON.stringify(value)}`);
    this.child = spawn(executable, args, { cwd, env: cleanEnvironment(process.env), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    // Stderr may contain local paths or provider credentials; expose only the existence of diagnostics.
    this.child.stderr.on('data', () => this.emit('transport/stderr', { message: 'Provider emitted stderr (content withheld)' }));
    createInterface({ input: this.child.stdout }).on('line', line => {
      try {
        const message = object(JSON.parse(line));
        if (message.method && message.id !== undefined) {
          this.child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Unsupported server request; denied' } }) + '\n');
          this.emit('transport/requestDenied', { method: message.method });
        } else if (typeof message.id === 'number') {
          const entry = this.pending.get(message.id);
          if (!entry) { this.emit('transport/lateResponse', { id: message.id }); return; }
          this.pending.delete(message.id); clearTimeout(entry.timer);
          if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
          else entry.resolve(message.result);
        } else if (typeof message.method === 'string') this.emit(message.method, message.params);
      } catch (error) { this.fail(new Error(`Invalid app-server message: ${String(error)}`)); }
    });
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', code => { this.fail(new Error(`App-server disconnected (${code})`)); this.emit('transport/disconnected', { code }); });
    this.child.stdin.on('error', error => this.fail(error));
  }
  private emit(method: string, params: unknown): void { for (const listener of this.listeners) listener(method, params); }
  private fail(error: Error): void {
    this.closed = true;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }
  async call(method: string, params: unknown = {}): Promise<unknown> {
    if (!METHODS.has(method)) throw new Error(`Provider method forbidden: ${method}`);
    if (this.closed) throw new Error('App-server disconnected');
    const result = await new Promise<unknown>((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} outcome unconfirmed: timeout`)); }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
    if (method === 'initialize') this.child.stdin.write('{"method":"initialized"}\n');
    return result;
  }
  onEvent(listener: (method: string, params: unknown) => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  close(): void { this.fail(new Error('App-server closed')); this.child.kill(); }
}
