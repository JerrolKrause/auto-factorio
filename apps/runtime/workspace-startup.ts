import type { DurableRuntime } from './durable-runtime.js';
import type { WorkspaceCatalog } from '../../packages/storage/src/workspace-catalog.js';

/** Call only after the startup path has attested the fresh process and control barrier. */
export function reconcileWorkspaceStartup(catalog: WorkspaceCatalog, runtime: Pick<DurableRuntime, 'directory' | 'run' | 'journal'>,
  freshGame?: { id: string; profile: string }) {
  const imported = catalog.importLegacy(500, runtime.directory);
  const retired = freshGame ? catalog.retireLegacyForFreshGame(freshGame.id, freshGame.profile, runtime.directory) : 0;
  catalog.syncCurrent(runtime.directory, runtime.run, runtime.journal);
  const owner = catalog.reconcileStartup(runtime.directory, runtime.run, runtime.journal);
  return { imported, retired, owner };
}
