import net from 'node:net';

export interface CommandPort { command(lua: string): Promise<string>; close(): void }
/** One in-flight request, response fragments delimited by a separate fixed print command. */
export class Rcon implements CommandPort {
  private socket: net.Socket;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending: { id: number; end: number; chunks: string[]; delimiterSent: boolean; resolve: (s: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null;
  private authenticated = false;
  private constructor(port: number) {
    this.socket = net.createConnection({ host: '127.0.0.1', port });
    this.socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= 4) {
        const length = this.buffer.readInt32LE(0);
        if (length < 10 || length > 4 * 1024 * 1024) { this.fail(new Error('Invalid RCON frame')); return; }
        if (this.buffer.length < length + 4) return;
        const frame = this.buffer.subarray(4, length + 4); this.buffer = this.buffer.subarray(length + 4);
        const id = frame.readInt32LE(0), type = frame.readInt32LE(4); const p = this.pending;
        if (!p) continue;
        if (id === -1) { this.fail(new Error('RCON authentication failed')); return; }
        if ((!this.authenticated && id === p.id && type === 2) || (this.authenticated && id === p.end)) {
          clearTimeout(p.timer); this.pending = null; p.resolve(p.chunks.join(''));
        } else if (this.authenticated && id === p.id) {
          p.chunks.push(frame.subarray(8, -2).toString('utf8'));
          // Multiplayer remote calls execute on a later tick. An immediate print can overtake them.
          if (!p.delimiterSent) { p.delimiterSent = true; this.packet(p.end, 2, '/silent-command rcon.print("")'); }
        }
      }
    });
    this.socket.on('error', e => this.fail(e)); this.socket.on('close', () => this.fail(new Error('RCON disconnected; outcome unknown')));
  }
  static async connect(port: number, password: string): Promise<Rcon> {
    const rcon = new Rcon(port); await rcon.send(password, 3); rcon.authenticated = true; return rcon;
  }
  private fail(e: Error): void { if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(e); this.pending = null; } this.socket.destroy(); }
  private packet(id: number, type: number, body: string): void {
    const text = Buffer.from(body); const b = Buffer.alloc(text.length + 14);
    b.writeInt32LE(text.length + 10); b.writeInt32LE(id, 4); b.writeInt32LE(type, 8); text.copy(b, 12); this.socket.write(b);
  }
  private send(body: string, type: number): Promise<string> {
    if (this.pending) return Promise.reject(new Error('Concurrent RCON request forbidden'));
    if (this.socket.destroyed) return Promise.reject(new Error('RCON disconnected'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++; const end = this.nextId++;
      const timer = setTimeout(() => this.fail(new Error('RCON timeout; outcome unknown')), 5000);
      this.pending = { id, end, chunks: [], delimiterSent: false, resolve, reject, timer }; this.packet(id, type, body);
    });
  }
  command(lua: string): Promise<string> { return this.send(lua, 2); }
  close(): void { this.fail(new Error('RCON closed')); }
}

/** Decimal escapes encode every UTF-8 byte: data cannot terminate the Lua string. */
export function wrapper(payload: unknown, operator = false): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  // Reconciliation echoes verified receipts; an ordinary S1 ledger exceeds the
  // gameplay batch limit. Only this operator operation receives the larger cap.
  const reconcile = operator && payload !== null && typeof payload === 'object' && 'op' in payload && payload.op === 'reconcile';
  if (bytes.length > (reconcile ? 4 * 1024 * 1024 : 64 * 1024)) throw new Error('RPC payload too large');
  const escaped = Array.from(bytes, b => '\\' + b.toString().padStart(3, '0')).join('');
  return '/silent-command rcon.print(remote.call("' + (operator ? 'autofactorio_operator_v1' : 'autofactorio_v1') + '","rpc","' + escaped + '"))';
}
