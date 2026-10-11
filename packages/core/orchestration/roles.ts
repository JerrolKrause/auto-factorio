import { readPrompt } from '../../../agents/prompts.js';
import type { AgentDefinition } from '@autofactorio/contracts';
import { ASTRA } from '../../codex/src/protocol.js';

export const foreman: AgentDefinition = {
  id: 'foreman', instructions: readPrompt('foreman', 'instructions'),
  tools: ['plan', 'message', 'observe'], observations: ['assigned-tasks', 'messages', 'history'], model: ASTRA, effort: 'low',
  output: readPrompt('shared/gameplay', 'output'), limits: { tools: 12 },
};
export const engineer: AgentDefinition = {
  ...foreman, id: 'engineer', instructions: readPrompt('engineer', 'instructions'),
  tools: ['message', 'execute', 'observe'],
};
export const solo: AgentDefinition = { ...foreman, id: 'solo', instructions: readPrompt('solo', 'instructions', { foreman: foreman.instructions, engineer: engineer.instructions }), tools: ['plan', 'message', 'execute', 'observe'] };
export const team = (actor = 'builder-1') => [{ id: 'foreman', definition: foreman, actors: [] }, { id: 'engineer', definition: engineer, actors: [actor] }];
export const soloTeam = (actor = 'builder-1') => [{ id: 'solo', definition: solo, actors: [actor] }];

const workshop = (id: string, instructions: string, tools: ToolName[]): AgentDefinition => ({
  id, instructions, tools, observations: ['assignment', 'workshop-evidence'], model: ASTRA, effort: 'low',
  output: readPrompt('shared/workshop', 'output'), limits: { tools: 12 },
});
type ToolName = AgentDefinition['tools'][number];
export const workshopDesigner = workshop('workshop-designer', readPrompt('workshop/designer', 'role'), ['observe']);
export const workshopScorer = workshop('workshop-scorer', readPrompt('workshop/scorer', 'role'), ['observe']);
export const workshopLearnings = workshop('workshop-learnings', readPrompt('workshop/learnings', 'role'), ['observe']);
export const workshopPrivateComparison = workshop('workshop-private-comparison', readPrompt('workshop/private-comparison', 'role'), ['observe']);
