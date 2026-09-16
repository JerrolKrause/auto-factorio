import { record } from '@autofactorio/contracts';
import type { AdmissionAck } from '../../core/evaluation/contracts.js';
import type { CommandPort } from './rcon.js';
import { wrapper } from './rcon.js';
import type { ControlState } from './lifecycle.js';
import { fence } from './lifecycle.js';

/** Operator-only guard. A failed call must be reconciled with inspect; never invent an ack. */
export class VerificationControl {
  constructor(private port: CommandPort, private sink: (e: unknown) => void) {}
  private async rpc(s: ControlState, fields: Record<string, unknown>) {
    const request = { op: 'verification', ...fence(s), ...fields };
    this.sink({ kind: 'evaluation/guard-request', request });
    const result = record(JSON.parse(await this.port.command(wrapper(request, true))));
    this.sink({ kind: 'evaluation/guard-response', result });
    if (result.ok !== true) throw new Error(String(result.error ?? 'Verification guard unacknowledged'));
    return record(result.verification);
  }
  configure(s: ControlState, scope: string, version: string, settlingTicks = 600) { return this.rpc(s, { action: 'configure', scope, version, settlingTicks }); }
  inspect(s: ControlState) { return this.rpc(s, { action: 'state' }); }
  repair(s: ControlState, attempt: string) { return this.rpc(s, { action: 'repair', attempt }); }
  invalidate(s: ControlState, attempt: string) { return this.rpc(s, { action: 'invalidate', attempt }); }
  async admit(s: ControlState, attempt: string): Promise<AdmissionAck> {
    const v = await this.rpc(s, { action: 'admit', attempt });
    const b = record(v.baseline);
    if (v.state !== 'admitted' || b.attempt !== attempt || b.scope !== v.scope || typeof b.scope !== 'string' || !Number.isSafeInteger(b.tick) || Number(b.tick) < 0 || b.mutationsClosed !== true || b.pendingMutations !== 0 || b.neutral !== true) throw new Error('Verification admission not acknowledged');
    return { attempt, scope: b.scope, tick: Number(b.tick), mutationsClosed: true, pendingMutations: 0, neutral: true, raw: v };
  }
}
