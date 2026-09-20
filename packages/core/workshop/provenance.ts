import type { WorkshopInvocationProvenance, WorkshopRole } from '@autofactorio/contracts';

export type WorkshopContextScope = 'designer-private'|'library-blind-score'|'private-comparison'|'learning-review';
const roleScope: Record<WorkshopRole|'private-comparison'|'learning-review',WorkshopContextScope> = {
  designer:'designer-private', scorer:'library-blind-score', learnings:'learning-review', 'private-comparison':'private-comparison', 'learning-review':'learning-review',
};
export function validateInvocationProvenance(value: WorkshopInvocationProvenance, expectedRole: keyof typeof roleScope, sessionId: string, iteration: number|null): void {
  if (value.role!==expectedRole||value.session!==sessionId||value.iteration!==iteration||value.contextScope!==roleScope[expectedRole]) throw new Error('Invocation provenance or context isolation mismatch');
  if (value.selection.provider!=='openai'||!value.modelConcreteId||value.modelConcreteId!==value.selection.modelId) throw new Error('Managed concrete model provenance missing');
}
export function admissibleFeedback(source: WorkshopInvocationProvenance, destination: WorkshopRole): boolean {
  if (source.role==='private-comparison') return false;
  if (source.role==='scorer') return destination==='designer';
  if (source.role==='learning-review'||source.role==='learnings') return destination==='learnings';
  return source.role===destination;
}
export function redactBlindCandidate<T extends Record<string,unknown>>(candidate:T):T {
  const copy=structuredClone(candidate); for(const key of ['family','variant','revisionId','libraryHistory','designerSession','providerHistory','privateComparison']) delete copy[key]; return copy;
}
