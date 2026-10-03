export interface CleanupStep { id: string; run: () => unknown | Promise<unknown> }
export interface CleanupReceipt { id: string; completed: boolean; failure: string | null }

/** Cleanup is best-effort across every owner, never short-circuited by another close. */
export async function cleanupAll(steps: CleanupStep[]): Promise<CleanupReceipt[]> {
  const receipts: CleanupReceipt[] = [];
  for (const step of steps) {
    try { await step.run(); receipts.push({ id: step.id, completed: true, failure: null }); }
    catch (error) { receipts.push({ id: step.id, completed: false, failure: String(error) }); }
  }
  return receipts;
}
