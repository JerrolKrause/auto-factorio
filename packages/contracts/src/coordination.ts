import type { TaskRecord } from './durable.js';
import type { Resource } from './ownership.js';

export type ToolGroup = 'plan' | 'message' | 'execute' | 'observe';
export interface AgentDefinition {
  id: string; instructions: string; tools: ToolGroup[]; observations: string[];
  model: string; effort: string; output: string; limits: { tools: number };
}
export interface AgentInstance {
  id: string; definition: AgentDefinition; actors: string[]; assignment: string | null;
  lineage: { session: string; generation: number; epoch: string }[];
  status: 'idle' | 'reasoning' | 'executing' | 'waiting-dependency' | 'waiting-game' | 'blocked' | 'completed';
}
export type TaskStatus = 'proposed' | 'ready' | 'assigned' | 'running' | 'verifying' | 'succeeded' | 'blocked' | 'failed' | 'cancelled' | 'superseded';
export type Criterion = { kind: 'command-completed'; id: string } | { kind: 'message-delivered'; id: string };
export interface CoordinatedTask extends TaskRecord {
  status: TaskStatus; manager: string; actor: string | null; reservations: Resource[];
  criteria: Criterion[]; wait: string | null; epoch: string;
}
export interface ScopedMessage {
  id: string; sender: string; recipient: string; task: string; revision: number; epoch: string;
  intent: 'handoff' | 'assistance' | 'report'; content: string; evidence: string[];
  delivery: 'pending' | 'delivered' | 'rejected'; reason: string | null;
}
export interface AgentHistory {
  id: string; agent: string; task: string | null; revision: number | null;
  kind: string; detail: unknown; wallTime: string; epoch: string;
}
