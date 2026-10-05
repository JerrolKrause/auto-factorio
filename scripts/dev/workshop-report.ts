import type { ModelSelection, WorkshopEvaluationReport, WorkshopWindowMeasurement } from '@autofactorio/contracts';
import type { WorkshopSessionState } from '../../packages/core/workshop/orchestrator.js';

export interface WorkshopReport {
  schema: number; stage: string; targetPassed: boolean; distinctCandidates: number;
  sessionId?: string; objective?: string; activeIteration?: number | null; bestIteration?: number | null;
  finalOutcome?: string | null; stopReason?: string | null; model?: ModelSelection; limits?: string[];
  iterations: { number: number; stage: string; candidate: string | null; valid: boolean | null; passed: boolean | null;
    reasons: string[]; feedback: string | null; ports: WorkshopEvaluationReport['ports']; measurements: WorkshopWindowMeasurement[] | null; evidence: string[] }[];
}

/** Terminal polling can return a session directly or a failure/deadline envelope. */
export function workshopTrialSession(outcome: unknown): WorkshopSessionState | null {
  if (!outcome || typeof outcome !== 'object') return null;
  const value = 'session' in outcome ? outcome.session : outcome;
  return value && typeof value === 'object' && 'iterations' in value && Array.isArray(value.iterations)
    ? value as WorkshopSessionState : null;
}

/** Persist acceptance last so diagnostic failures cannot leave a successful result. */
export async function writeWorkshopTrialReports<T extends { failure: string | null; cleanup: boolean; recovery: unknown }>(
  base: T, session: WorkshopSessionState | null,
  readReport: () => Promise<WorkshopReport>,
  writeArtifact: (name: string, value: unknown) => Promise<void>,
  summaryDetails: Record<string, unknown>,
) {
  let failure = base.failure;
  let report = workshopReport(session);
  try { report = await readReport(); }
  catch (error) { failure = [failure, `Report read failed: ${String(error)}`].filter(Boolean).join('; '); }
  const result = () => ({ ...base, failure, targetPassed: report.targetPassed,
    harnessPassed: !failure && base.cleanup && base.recovery !== null,
    passed: !failure && base.cleanup && base.recovery !== null && report.targetPassed });
  const { passed, targetPassed, harnessPassed } = result();
  try { await writeArtifact('summary.json', { ...report, ...summaryDetails, passed, targetPassed, harnessPassed, failure }); }
  catch (error) { failure = [failure, `Summary write failed: ${String(error)}`].filter(Boolean).join('; '); }
  const finalResult = result();
  await writeArtifact('result.json', finalResult);
  return finalResult;
}

/** Compact diagnostic projection. It never upgrades missing or partial evidence. */
export function workshopReport(session: WorkshopSessionState | null, measurements: Record<number, WorkshopWindowMeasurement[]> = {}): WorkshopReport {
  if (!session) return { schema: 1, stage: 'preparing', targetPassed: false, iterations: [], distinctCandidates: 0 };
  const best = session.iterations.find(iteration => iteration.number === session.bestIteration);
  return {
    schema: 1, sessionId: session.id, objective: session.assignment.objective, stage: session.stage,
    activeIteration: session.activeIteration, bestIteration: session.bestIteration, finalOutcome: session.finalOutcome,
    stopReason: session.stopReason, model: session.selections.designer,
    targetPassed: session.stage === 'complete' && best?.valid === true && best.evaluation?.passed === true,
    distinctCandidates: new Set(session.iterations.flatMap(iteration => iteration.artifact ? [iteration.artifact.artifactHash] : [])).size,
    iterations: session.iterations.map(iteration => ({
      number: iteration.number, stage: iteration.stage, candidate: iteration.artifact?.artifactHash ?? null,
      valid: iteration.evaluation?.valid ?? null, passed: iteration.evaluation?.passed ?? null,
      reasons: iteration.evaluation?.reasons ?? [], feedback: iteration.feedback,
      ports: iteration.evaluation?.ports.map(port => ({ portId: port.portId, windows: port.windows })) ?? [],
      // Keep raw stock separate from evaluated lower bounds and all of its coverage markers.
      measurements: measurements[iteration.number] ?? null,
      evidence: iteration.evaluation?.evidence ?? [],
    })),
    limits: ['Nominal design estimates are not measurements.', 'Repeated candidate hashes are not independent designs.', 'Null measurements mean raw window evidence is unavailable, not zero production.'],
  };
}
