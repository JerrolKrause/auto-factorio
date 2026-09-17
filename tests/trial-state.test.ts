import { expect, it } from 'vitest';
import { SerialPort } from '../packages/factorio/src/serial-port.js';
import { cleanupSetupFailure, replacementMatchesPending, trialControl, replacementStatus, TrialResources } from '../apps/runtime/trial-state.js';
import { Budget, PROBE_CAPS } from '../packages/codex/src/budget.js';
import type { OperatorState } from '../apps/runtime/operator.js';

it('serializes overlapping operator, observation and evaluator traffic without replaying a failed request', async () => {
  let busy = false; let release!: () => void; const sent: string[] = [];
  const port = new SerialPort({ command: async request => {
    if (busy) throw new Error('Concurrent RCON request forbidden'); busy = true; sent.push(request);
    if (request === 'operator') await new Promise<void>(resolve => { release = resolve; });
    busy = false; if (request === 'failure') throw new Error('outcome unknown'); return request;
  }, close: () => {} });
  const operator = port.command('operator'); const observe = port.command('observe'); const evaluate = port.command('evaluate');
  await Promise.resolve(); expect(sent).toEqual(['operator']); release();
  expect(await Promise.all([operator, observe, evaluate])).toEqual(['operator', 'observe', 'evaluate']);
  const failed = port.command('failure'); const queued = port.command('must-not-send');
  await expect(failed).rejects.toThrow('outcome unknown'); await expect(queued).rejects.toThrow('closed');
  expect(sent).toEqual(['operator', 'observe', 'evaluate', 'failure']);
});
it('keeps paused and transitional trials alive and distinguishes stop/disconnect from resume', () => {
  const base = { status: 'running', requested: null, admission: true } as OperatorState;
  expect(trialControl(base)).toBe('run');
  expect(trialControl({ ...base, status: 'paused', requested: 'pause', admission: false })).toBe('wait');
  expect(trialControl({ ...base, status: 'unconfirmed', requested: 'resume', admission: false })).toBe('wait');
  expect(trialControl({ ...base, status: 'stopped', requested: 'stop', admission: false })).toBe('stop');
  expect(trialControl({ ...base, status: 'disconnected', admission: false })).toBe('disconnected');
});
it('does not turn preparation, absent pending work or missing observations into replacement success', () => {
  const budget = new Budget(PROBE_CAPS, () => 0, () => {}); const before = budget.snapshot(); budget.admit('engineer');
  const record = { previousSession: 'old', session: 'new', pendingAtBinding: ['batch'], budgetBefore: before, budgetAtBinding: budget.snapshot(), observation: null, at: 'now', tick: 10 };
  expect(replacementStatus(record).complete).toBe(false);
  const observed = { ...record, observation: { tick: 12, task: 'construction', session: 'new' } };
  expect(replacementStatus(observed).complete).toBe(true);
  expect(replacementStatus({ ...observed, pendingAtBinding: [] }).complete).toBe(false);
  expect(replacementStatus({ ...observed, budgetAtBinding: before }).complete).toBe(false);
  expect(replacementStatus({ ...observed, observation: { ...observed.observation, session: 'old' } }).complete).toBe(false);
});
it('keeps replacement-held dispatch closed for a different task or revision', () => {
  const evidence = { previousSession: 'old', session: 'new', pendingAtBinding: ['command-1'], budgetBefore: {} as never, budgetAtBinding: {} as never, observation: null, at: 'now', tick: 1 };
  const command = { batch: { commandId: 'command-1', task: 'current-task', revision: 2 } } as never;
  expect(replacementMatchesPending(evidence, 'current-task', { id: 'current-task', owner: 'engineer', revision: 2 }, [command])).toBe(true);
  expect(replacementMatchesPending(evidence, 'historical-task', { id: 'historical-task', owner: 'engineer', revision: 2 }, [command])).toBe(false);
  expect(replacementMatchesPending(evidence, 'current-task', { id: 'current-task', owner: 'engineer', revision: 3 }, [command])).toBe(false);
  expect(replacementMatchesPending(evidence, 'current-task', { id: 'current-task', owner: 'foreman', revision: 2 }, [command])).toBe(false);
});
it('holds and stops an exact prepared profile after setup failure even when holding fails', async () => {
  const calls: string[] = []; let recorded: unknown;
  const result = await cleanupSetupFailure({
    hold: async () => { calls.push('hold'); throw new Error('connection lost'); },
    closeResources: async () => { calls.push('resources'); return [{ name: 'mcp', status: 'closed' }]; },
    stopObserver: async () => { calls.push('observer'); return [2]; },
    stopServer: async () => { calls.push('server'); return [1]; },
    record: async value => { calls.push('record'); recorded = structuredClone(value); },
  });
  expect(calls).toEqual(['hold', 'resources', 'observer', 'server', 'record']);
  expect(result).toMatchObject({ resources: [{ name: 'mcp', status: 'closed' }], observer: [2], server: [1], errors: [expect.stringContaining('connection lost')] });
  expect(recorded).toEqual(result);
});
it.each(['mcp', 'dashboard'])('closes partial setup resources in reverse order after %s setup fails', async failAfter => {
  const calls: string[] = []; const resources = new TrialResources();
  resources.register('rcon', () => { calls.push('rcon'); });
  resources.register('runtime', () => { calls.push('runtime'); });
  resources.register('mcp', () => { calls.push('mcp'); });
  if (failAfter === 'dashboard') resources.register('dashboard', () => { calls.push('dashboard'); });
  const first = await resources.close(); const second = await resources.close();
  expect(calls).toEqual(failAfter === 'dashboard' ? ['dashboard', 'mcp', 'runtime', 'rcon'] : ['mcp', 'runtime', 'rcon']);
  expect(first).toEqual(second);
  expect(first.every(entry => entry.status === 'closed')).toBe(true);
});
it('serializes a setup-failure hold behind in-flight operator polling', async () => {
  let busy = false; let release!: () => void; const sent: string[] = [];
  const port = new SerialPort({ command: async request => {
    if (busy) throw new Error('Concurrent RCON request forbidden');
    busy = true; sent.push(request);
    if (request === 'poll') await new Promise<void>(resolve => { release = resolve; });
    busy = false; return request;
  }, close: () => {} });
  const poll = port.command('poll');
  const cleanup = cleanupSetupFailure({
    hold: () => port.command('hold'),
    closeResources: async () => [],
    stopObserver: async () => [],
    stopServer: async () => [],
    record: async () => {},
  });
  await Promise.resolve(); expect(sent).toEqual(['poll']);
  release();
  await expect(Promise.all([poll, cleanup])).resolves.toBeDefined();
  expect(sent).toEqual(['poll', 'hold']);
});
