import { createHash } from 'node:crypto';

export const WORKSPACE_IDENTITY_SCHEMA = 1 as const;

export type WorkspaceGroupIdentity = {
  schema: typeof WORKSPACE_IDENTITY_SCHEMA;
  id: string;
  kind: 'brief' | 'scenario' | 'legacy';
  title: string;
  objective: string | null;
  scenario: { id: string; version: string | null } | null;
  parentGroupId: string | null;
  /** Unknown is intentional for imported records that never retained a brief identity. */
  coverage: 'recorded' | 'legacy-unknown';
};

export type WorkspaceRunIdentity = {
  schema: typeof WORKSPACE_IDENTITY_SCHEMA;
  id: string;
  groupId: string;
  runtimeRun: string;
  kind: 'workshop' | 'scenario';
  assignmentHash: string;
  assignment: unknown;
  comparisonSeries: string | null;
  createdAt: string;
};

export type WorkspaceAttemptIdentity = {
  schema: typeof WORKSPACE_IDENTITY_SCHEMA;
  id: string;
  runId: string;
  ordinal: number;
  sourceId: string | null;
  coverage: 'recorded' | 'legacy-unknown';
};

/** Only outer whitespace is ignored; edited wording never silently merges histories. */
export function sameBriefObjective(left: string, right: string): boolean {
  return left.trim() === right.trim();
}

export function selectBriefGroup(id: string, objective: string, selected: WorkspaceGroupIdentity | null = null): WorkspaceGroupIdentity {
  const normalized = objective.trim();
  if (!id || !normalized) throw new Error('Brief identity requires an objective and new ID');
  if (selected?.kind === 'brief' && selected.objective !== null && sameBriefObjective(selected.objective, objective)) return selected;
  return { schema: WORKSPACE_IDENTITY_SCHEMA, id, kind: 'brief', title: normalized, objective: normalized,
    scenario: null, parentGroupId: selected?.id ?? null, coverage: 'recorded' };
}

export function immutableAssignmentHash(assignment: unknown): string {
  return createHash('sha256').update(JSON.stringify(assignment)).digest('hex');
}

export function createWorkspaceRunIdentity(input: Omit<WorkspaceRunIdentity, 'schema' | 'assignmentHash'>): WorkspaceRunIdentity {
  const value = { schema: WORKSPACE_IDENTITY_SCHEMA, ...input, assignment: structuredClone(input.assignment), assignmentHash: immutableAssignmentHash(input.assignment) };
  assertWorkspaceRunIdentity(value);
  return value;
}

export function assertWorkspaceRunIdentity(value: WorkspaceRunIdentity): void {
  if (value.schema !== WORKSPACE_IDENTITY_SCHEMA || !value.id || !value.groupId || !value.runtimeRun || !['workshop', 'scenario'].includes(value.kind) ||
      !/^[a-f0-9]{64}$/.test(value.assignmentHash) || value.assignmentHash !== immutableAssignmentHash(value.assignment) ||
      !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Invalid workspace run identity');
}

export function assertWorkspaceAttemptIdentity(value: WorkspaceAttemptIdentity): void {
  if (value.schema !== WORKSPACE_IDENTITY_SCHEMA || !value.id || !value.runId || !Number.isSafeInteger(value.ordinal) || value.ordinal < 1 ||
      !['recorded', 'legacy-unknown'].includes(value.coverage) || (value.coverage === 'recorded' && !value.sourceId) ||
      (value.coverage === 'legacy-unknown' && value.sourceId !== null)) throw new Error('Invalid workspace attempt identity');
}
