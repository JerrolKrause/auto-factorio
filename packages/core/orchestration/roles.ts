import type { AgentDefinition } from '@autofactorio/contracts';
import { ASTRA } from '../../codex/src/protocol.js';

export const foreman: AgentDefinition = {
  id: 'foreman', instructions: 'Choose goals, decompose work, assign tasks, arbitrate resources and revise strategy. Treat completion as a claim until deterministic evidence verifies it.',
  tools: ['plan', 'message', 'observe'], observations: ['assigned-tasks', 'messages', 'history'], model: ASTRA, effort: 'low',
  output: 'Explain material decisions briefly and link evidence. Request assistance through scoped messages.', limits: { tools: 12 },
};
export const engineer: AgentDefinition = {
  ...foreman, id: 'engineer', instructions: 'Inspect assigned space, design layouts, submit legal character batches, diagnose faults and report evidence. Use runtime-assigned ownership.',
  tools: ['message', 'execute', 'observe'],
};
export const solo: AgentDefinition = { ...foreman, id: 'solo', instructions: foreman.instructions + ' ' + engineer.instructions, tools: ['plan', 'message', 'execute', 'observe'] };
export const team = (actor = 'builder-1') => [{ id: 'foreman', definition: foreman, actors: [] }, { id: 'engineer', definition: engineer, actors: [actor] }];
export const soloTeam = (actor = 'builder-1') => [{ id: 'solo', definition: solo, actors: [actor] }];
