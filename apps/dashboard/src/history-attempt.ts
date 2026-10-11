/** Older journals left rejected and scored attempts at the session's routing stage. */
export function historyAttempt(iteration: Record<string, unknown>, intents: unknown): Record<string, unknown> {
  const operations = intents && typeof intents === 'object' ? intents as Record<string, { status?: string }> : {};
  const rejected = iteration.valid === false && ['design', 'build'].some(kind => operations[`${String(iteration.id)}:${kind}`]?.status === 'failed');
  // Failed measurement targets are completed measurements, distinct from a rejected build.
  const stage = rejected ? 'failed' : iteration.score ? 'complete' : iteration.stage;
  return { ...iteration, stage };
}
