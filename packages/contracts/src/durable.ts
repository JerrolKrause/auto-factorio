/** Durable product state; independent of any provider thread or database driver. */
export interface RunManifest {
  objective: string; scenario: string; scenarioVersion: string; seed: number; codeCommit: string;
  gameVersion: string; mods: Record<string, string>; roster: string[]; model: string; effort: string;
  instructionHashes: Record<string, string>; assisted: boolean; status: string;
}
export interface TaskRecord {
  id: string; goal: string; parent: string | null; owner: string | null; dependencies: string[];
  scope: Record<string, unknown>; resources: Record<string, number>; successCriteria: string[];
  deadline: number | null; revision: number; committedPlan: string; status: string; evidence: string[];
}
export interface AgentRecord { id: string; role: string; assignment: string | null; session: string | null; status: string }
export interface MessageRecord { id: string; sender: string; recipient: string; task: string | null; intent: string; content: string; evidence: string[] }
export interface InterventionRecord { id: string; text: string; recipient: string; wallTime: string; gameTick: number; delivery: string; interpretation: string | null; resultingTasks: string[]; supersededTasks: string[] }
export interface MeasurementRecord { id: string; name: string; gameTick: number; value: number | null; evidence: string[]; complete: boolean }
