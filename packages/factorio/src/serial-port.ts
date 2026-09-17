import type { CommandPort } from './rcon.js';

/** All consumers of one RCON connection share this FIFO. A failed send is never replayed. */
export class SerialPort implements CommandPort {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private queued = 0;
  constructor(private port: CommandPort) {}
  command(lua: string): Promise<string> {
    if (this.closed) return Promise.reject(new Error('Game transport closed'));
    if (this.queued >= 64) return Promise.reject(new Error('Game transport queue exhausted'));
    this.queued++;
    const result = this.tail.then(async () => {
      if (this.closed) throw new Error('Game transport closed');
      try { return await this.port.command(lua); }
      catch (error) { this.close(); throw error; }
    }).finally(() => { this.queued--; });
    // Keep the queue usable for rejection delivery without swallowing the caller's error.
    this.tail = result.catch(() => {});
    return result;
  }
  close(): void { if (!this.closed) { this.closed = true; this.port.close(); } }
}
