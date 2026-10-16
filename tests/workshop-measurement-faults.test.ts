import { describe, expect, it } from 'vitest';
import { measurementAcknowledgementLoss } from '../scripts/dev/workshop-measurement-faults.js';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';
import { wrapper, type CommandPort } from '../packages/factorio/src/rcon.js';

type Request = Record<string, unknown>;

function requestFromWrapper(lua: string): { channel: string; request: Request } | null {
  const match = /^\/silent-command rcon\.print\(remote\.call\("(autofactorio_operator_v1|autofactorio_v1)","rpc","((?:\\\d{3})+)"\)\)$/.exec(lua);
  if (!match) return null;
  const bytes = (match[2]!.match(/\d{3}/g) ?? []).map(Number);
  if (bytes.some(value => value > 255)) return null;
  try {
    const request: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
    return request && typeof request === 'object' && !Array.isArray(request)
      ? { channel: match[1]!, request: request as Request }
      : null;
  } catch {
    return null;
  }
}

function fakeCommandPort() {
  const forwarded: string[] = [];
  let closes = 0;
  const port: CommandPort = {
    async command(lua) {
      forwarded.push(lua);
      const decoded = requestFromWrapper(lua);
      if (!decoded) return 'forwarded malformed or console command';
      const { op } = decoded.request;
      if (op === 'workshop-measure-status') {
        return JSON.stringify({ ok: true, attemptId: decoded.request.attemptId, present: true, state: 'settling', finished: false });
      }
      if (op === 'workshop-measure-read') {
        return JSON.stringify({ ok: true, tick: 480, state: 'aborted', finished: true, samples: [], requestedSpeed: 1, achievedSpeed: 1 });
      }
      return JSON.stringify({ ok: true, op });
    },
    close() { closes++; },
  };
  return { port, forwarded, closeCount: () => closes };
}

const configure: Parameters<WorkshopControl['measureConfigure']>[0] & { op: string } = {
  op: 'workshop-measure-configure', id: 'workshop-1', generation: 4, attemptId: 'attempt-ack-loss',
  settlingTicks: 60, windowTicks: 120, windows: 2, requestedSpeed: 1,
  ports: [{ id: 'output', fixtureId: 'sink', product: { kind: 'item', name: 'iron-plate', quality: 'normal' } }],
};

describe('measurement acknowledgement-loss fault port', () => {
  it('forwards the genuine escaped configure once, loses its acknowledgement, then fails status without forwarding', async () => {
    const native = fakeCommandPort();
    const fault = measurementAcknowledgementLoss(native.port);
    const control = new WorkshopControl(fault.port);

    await expect(control.measureConfigure(configure)).rejects.toThrow('Diagnostic configure acknowledgement lost after native effect');
    await expect(control.measureStatus('workshop-1', 'attempt-ack-loss')).rejects.toThrow('Diagnostic status acknowledgement unavailable');

    expect(native.forwarded).toHaveLength(1);
    expect(requestFromWrapper(native.forwarded[0]!)).toMatchObject({
      channel: 'autofactorio_operator_v1', request: { op: 'workshop-measure-configure', attemptId: 'attempt-ack-loss' },
    });
    expect(fault.state).toEqual({ configureForwards: 1, configureLosses: 1, statusFailures: 1, readFailures: 0 });
  });

  it('refuses an uncertain configure retry before forwarding a second copy', async () => {
    const native = fakeCommandPort();
    const fault = measurementAcknowledgementLoss(native.port);
    const control = new WorkshopControl(fault.port);

    await expect(control.measureConfigure(configure)).rejects.toThrow('acknowledgement lost');
    await expect(control.measureConfigure(configure)).rejects.toThrow('Diagnostic uncertain configure retry refused');

    expect(native.forwarded).toHaveLength(1);
    expect(fault.state).toEqual({ configureForwards: 1, configureLosses: 1, statusFailures: 0, readFailures: 0 });
  });

  it('passes unrelated operator, public RPC, and console commands through without triggering the fault', async () => {
    const native = fakeCommandPort();
    const fault = measurementAcknowledgementLoss(native.port);
    const unrelatedOperator = wrapper({ op: 'workshop-inspect', id: 'workshop-1' }, true);
    const publicRpc = wrapper(configure, false);
    const consoleText = '/silent-command rcon.print("workshop-measure-configure")';

    expect(await fault.port.command(unrelatedOperator)).toBe(JSON.stringify({ ok: true, op: 'workshop-inspect' }));
    expect(await fault.port.command(publicRpc)).toBe(JSON.stringify({ ok: true, op: 'workshop-measure-configure' }));
    expect(await fault.port.command(consoleText)).toBe('forwarded malformed or console command');

    expect(native.forwarded).toEqual([unrelatedOperator, publicRpc, consoleText]);
    expect(fault.state).toEqual({ configureForwards: 0, configureLosses: 0, statusFailures: 0, readFailures: 0 });
  });

  it('does not inject faults for a malformed decimal-escaped operator wrapper', async () => {
    const native = fakeCommandPort();
    const fault = measurementAcknowledgementLoss(native.port);
    const malformed = '/silent-command rcon.print(remote.call("autofactorio_operator_v1","rpc","\\999"))';

    expect(await fault.port.command(malformed)).toBe('forwarded malformed or console command');
    expect(native.forwarded).toEqual([malformed]);
    expect(fault.state).toEqual({ configureForwards: 0, configureLosses: 0, statusFailures: 0, readFailures: 0 });
  });

  it('does not close the borrowed underlying command port', () => {
    const native = fakeCommandPort();
    const fault = measurementAcknowledgementLoss(native.port);

    fault.port.close();

    expect(native.closeCount()).toBe(0);
  });

  it('keeps an abandoned delayed SDK read from reaching or clearing the replacement outcome', async () => {
    const native = fakeCommandPort();
    const fault = measurementAcknowledgementLoss(native.port);
    await expect(new WorkshopControl(fault.port).measureConfigure(configure)).rejects.toThrow('acknowledgement lost');

    let releaseAbandonedRead!: () => void;
    const pollBoundary = new Promise<void>(resolve => { releaseAbandonedRead = resolve; });
    let abandonedReadEntered = false;
    const delayedAbandonedPort: CommandPort = {
      async command(lua) {
        if (requestFromWrapper(lua)?.request.op === 'workshop-measure-read') {
          abandonedReadEntered = true;
          await pollBoundary;
        }
        return fault.port.command(lua);
      },
      close() {},
    };
    const abandonedRead = new WorkshopControl(delayedAbandonedPort).measureRead('workshop-1', 'attempt-ack-loss', -1);
    expect(abandonedReadEntered).toBe(true);

    // This is the 100 ms poll boundary: the stale read is still held while a
    // fresh SDK instance performs replacement reconciliation against the owner port.
    const replacementPage = await new WorkshopControl(native.port).measureRead('workshop-1', 'attempt-ack-loss', -1);
    expect(replacementPage).toMatchObject({ state: 'aborted', finished: true, samples: [] });
    expect(native.forwarded).toHaveLength(2);
    expect(requestFromWrapper(native.forwarded[1]!)?.request.op).toBe('workshop-measure-read');

    releaseAbandonedRead();
    await expect(abandonedRead).rejects.toThrow('Diagnostic abandoned host read unavailable');
    expect(native.forwarded).toHaveLength(2);
    expect(fault.state).toEqual({ configureForwards: 1, configureLosses: 1, statusFailures: 0, readFailures: 1 });
  });
});
