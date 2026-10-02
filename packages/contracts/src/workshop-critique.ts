export interface WorkshopCritiqueFinding {
  id: string; candidateRef: string; evaluationRef: string; observed: string; impact: string;
  suspectedCause: string; uncertainty: string; recommendedChange: string; nextValidation: string;
}
export interface WorkshopCritique {
  schema: 1; status: 'validated' | 'unavailable'; summary: string; findings: WorkshopCritiqueFinding[];
  validation: string | null; rawHash: string;
}
export interface WorkshopChangePlan { schema: 1; summary: string; findingIds: string[]; candidateRef: string }

const string = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
export function parseWorkshopCritique(raw: unknown, refs: { candidate: string; evaluation: string; rawHash: string; failed: boolean }): WorkshopCritique {
  const unavailable = (reason: string): WorkshopCritique => ({ schema: 1, status: 'unavailable',
    summary: 'Structured critique unavailable', findings: refs.failed ? [{ id: 'evidence-gap', candidateRef: refs.candidate,
      evaluationRef: refs.evaluation, observed: 'The scorer did not return a valid structured finding', impact: 'Cause and next change are unconfirmed',
      suspectedCause: 'Unknown', uncertainty: 'No supported diagnosis', recommendedChange: 'Inspect retained measurements and rerun critique within the pinned budget',
      nextValidation: 'Obtain an evidence-linked structured critique' }] : [], validation: reason, rawHash: refs.rawHash });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return unavailable('response_not_object');
  const value = raw as Record<string, unknown>;
  if (value.schema !== 1 || !string(value.summary) || value.summary.length > 1000 || !Array.isArray(value.findings) || value.findings.length > 8) return unavailable('missing_version_summary_or_findings');
  const findings: WorkshopCritiqueFinding[] = [];
  for (const item of value.findings) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return unavailable('malformed_finding');
    const finding = item as Record<string, unknown>;
    if (!['id','candidateRef','evaluationRef','observed','impact','suspectedCause','uncertainty','recommendedChange','nextValidation'].every(key => string(finding[key]) && (finding[key] as string).length <= 500) ||
      finding.candidateRef !== refs.candidate || finding.evaluationRef !== refs.evaluation || findings.some(v => v.id === finding.id)) return unavailable('unsupported_or_unlinked_finding');
    findings.push(finding as unknown as WorkshopCritiqueFinding);
  }
  if (refs.failed && !findings.length) return unavailable('failure_requires_evidence_linked_finding');
  return { schema: 1, status: 'validated', summary: value.summary, findings, validation: null, rawHash: refs.rawHash };
}

export function parseWorkshopChangePlan(raw: unknown, prior: { candidateRef: string; findingIds: string[] }): WorkshopChangePlan | null {
  if (!prior.findingIds.length) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Designer change plan missing');
  const value = raw as Record<string, unknown>;
  if (value.schema !== 1 || !string(value.summary) || value.candidateRef !== prior.candidateRef || !Array.isArray(value.findingIds) ||
    value.findingIds.length === 0 || value.findingIds.some(id => !string(id) || !prior.findingIds.includes(id))) throw new Error('Designer change plan does not link validated prior findings');
  return { schema: 1, summary: value.summary, candidateRef: value.candidateRef, findingIds: value.findingIds as string[] };
}
