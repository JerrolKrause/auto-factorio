import type { CommandPort } from '../../packages/factorio/src/rcon.js';

/** Decode only the complete operator RPC emitted by rcon.wrapper. Console
 * commands and public gameplay RPCs are unrelated to this diagnostic fault. */
function operatorOperation(lua: string): string | null {
  const encoded = /^\/silent-command rcon\.print\(remote\.call\("autofactorio_operator_v1","rpc","((?:\\\d{3})+)"\)\)$/.exec(lua)?.[1];
  if (!encoded) return null;
  const bytes = encoded.match(/\d{3}/g)!.map(Number);
  if (bytes.some(value => value > 255)) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
    return payload && typeof payload === 'object' && 'op' in payload && typeof payload.op === 'string' ? payload.op : null;
  } catch { return null; }
}

/** Borrow the port; its owner retains cleanup. Forward the genuine configure
 * once, lose its reply, then deny status/read acknowledgements to model an
 * abandoned host and force a durable fence. Never forward its uncertain retry. */
export function measurementAcknowledgementLoss(port: CommandPort) {
  const state = { configureForwards: 0, configureLosses: 0, statusFailures: 0, readFailures: 0 };
  const faultPort: CommandPort = {
    async command(lua) {
      const operation = operatorOperation(lua);
      if (state.configureLosses && operation === 'workshop-measure-status') {
        state.statusFailures++;
        throw new Error('Diagnostic status acknowledgement unavailable');
      }
      if (state.configureLosses && operation === 'workshop-measure-read') {
        state.readFailures++;
        throw new Error('Diagnostic abandoned host read unavailable');
      }
      if (state.configureLosses && operation === 'workshop-measure-configure') throw new Error('Diagnostic uncertain configure retry refused');
      const response = await port.command(lua);
      if (operation === 'workshop-measure-configure') {
        state.configureForwards++;
        state.configureLosses++;
        throw new Error('Diagnostic configure acknowledgement lost after native effect');
      }
      return response;
    },
    close() {},
  };
  return { port: faultPort, state };
}
