export const WORKSHOP_DRAFT_KEY = 'autofactorio.workshop.draft.v1';
export interface WorkshopDraftValues {
  objective: string; profile: string; construction: 'direct' | 'character'; libraryAccess: boolean;
  attempts: number; earlyStop: boolean; checkpoints: { brief: boolean; afterScore: boolean; libraryAdmission: boolean; learningActivation: boolean };
  model: string; effort: string; designerModel: string; designerEffort: string; scorerModel: string; scorerEffort: string; learningsModel: string; learningsEffort: string;
  speed: string; settling: number; windowTicks: number; windows: number; wallMinutes: number; turns: number; toolCalls: number;
  learningCadence: string; learningBatch: number; learningCandidates: number; learningAttempts: number; learningTurns: number; autoActivate: boolean;
  improveRevision: string | null;
  selectedGroupId: string | null;
}
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type DraftRead = { values: WorkshopDraftValues | null; message: string | null; writable: boolean };

function validDraft(value: unknown): value is WorkshopDraftValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const strings = ['objective','profile','model','effort','designerModel','designerEffort','scorerModel','scorerEffort','learningsModel','learningsEffort','speed','learningCadence'];
  const numbers = ['attempts','settling','windowTicks','windows','wallMinutes','turns','toolCalls','learningBatch','learningCandidates','learningAttempts','learningTurns'];
  const booleans = ['libraryAccess','earlyStop','autoActivate'];
  const checkpoints = v.checkpoints as Record<string, unknown> | null;
  return strings.every(key => typeof v[key] === 'string') && numbers.every(key => typeof v[key] === 'number' && Number.isFinite(v[key])) &&
    booleans.every(key => typeof v[key] === 'boolean') && (v.construction === 'direct' || v.construction === 'character') &&
    (v.improveRevision === null || typeof v.improveRevision === 'string') && (v.selectedGroupId === null || typeof v.selectedGroupId === 'string') && !!checkpoints && typeof checkpoints === 'object' &&
    ['brief','afterScore','libraryAdmission','learningActivation'].every(key => typeof checkpoints[key] === 'boolean');
}

export function readWorkshopDraft(store: Store): DraftRead {
  try {
    const raw = store.getItem(WORKSHOP_DRAFT_KEY);
    if (!raw) return { values: null, message: null, writable: true };
    const parsed = JSON.parse(raw) as { schema?: unknown; values?: unknown };
    if (parsed.schema !== 1) return { values: null, message: 'Saved setup uses an unsupported version. Reset it to start a new draft.', writable: false };
    const v = parsed.values;
    if (!validDraft(v)) {
      return { values: null, message: 'Saved setup is incomplete or damaged. Reset it to start a new draft.', writable: false };
    }
    return { values: v, message: 'Saved workshop setup restored on this device.', writable: true };
  } catch (error) {
    return { values: null, message: `Saved setup unavailable; edits will stay in memory: ${String(error)}`, writable: true };
  }
}

export function saveWorkshopDraft(store: Store, values: WorkshopDraftValues): string | null {
  try { store.setItem(WORKSHOP_DRAFT_KEY, JSON.stringify({ schema: 1, values })); return null; }
  catch (error) { return `Could not save setup on this device: ${String(error)}`; }
}
export function clearWorkshopDraft(store: Store): string | null {
  try { store.removeItem(WORKSHOP_DRAFT_KEY); return null; }
  catch (error) { return `Could not clear saved setup: ${String(error)}`; }
}
