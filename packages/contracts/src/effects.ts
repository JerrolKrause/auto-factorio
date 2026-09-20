export const EFFECT_RECEIPT_SCHEMA = 1 as const;

export type EffectOutcome = 'completed' | 'cancelled' | 'unknown';

export interface EffectReceipt {
  schema: typeof EFFECT_RECEIPT_SCHEMA;
  effectId: string;
  outcome: EffectOutcome;
  failures: string[];
}

const unknown = (effectId: string, failure: string, details: string[] = []): EffectReceipt => ({
  schema: EFFECT_RECEIPT_SCHEMA,
  effectId,
  outcome: 'unknown',
  failures: [failure, ...details],
});

/** Strictly validates an effect receipt. Missing, malformed and contradictory values fail closed. */
export function normalizeEffectReceipt(value: unknown, expectedEffectId: string, source: string): EffectReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unknown(expectedEffectId, `${source}:missing_receipt`);
  const receipt = value as Partial<EffectReceipt>;
  const keys = Object.keys(receipt);
  if (keys.some(key => !['schema', 'effectId', 'outcome', 'failures'].includes(key)) ||
      receipt.schema !== EFFECT_RECEIPT_SCHEMA || receipt.effectId !== expectedEffectId ||
      !['completed', 'cancelled', 'unknown'].includes(String(receipt.outcome)) ||
      !Array.isArray(receipt.failures) || receipt.failures.some(item => typeof item !== 'string' || !item.trim())) {
    return unknown(expectedEffectId, `${source}:malformed_receipt`);
  }
  if (receipt.outcome === 'unknown') {
    return receipt.failures.length
      ? { schema: EFFECT_RECEIPT_SCHEMA, effectId: expectedEffectId, outcome: 'unknown', failures: [...receipt.failures] }
      : unknown(expectedEffectId, `${source}:unconfirmed_receipt`);
  }
  if (receipt.failures.length) return unknown(expectedEffectId, `${source}:contradictory_receipt`, receipt.failures);
  return { schema: EFFECT_RECEIPT_SCHEMA, effectId: expectedEffectId, outcome: receipt.outcome as 'completed'|'cancelled', failures: [] };
}

export function effectReceipt(effectId: string, outcome: Exclude<EffectOutcome, 'unknown'>): EffectReceipt {
  return { schema: EFFECT_RECEIPT_SCHEMA, effectId, outcome, failures: [] };
}

export function unknownEffectReceipt(effectId: string, failure: string): EffectReceipt {
  return unknown(effectId, failure);
}

/** A cancellation aggregate succeeds only when every exact child receipt confirms cancellation or completion. */
export function combineEffectReceipts(effectId: string, receipts: EffectReceipt[]): EffectReceipt {
  const failures = receipts.flatMap((receipt, index) => {
    if (receipt.outcome === 'unknown') return receipt.failures.length
      ? receipt.failures
      : [`${receipt.effectId || `${effectId}:child:${index}`}:unconfirmed_receipt`];
    return receipt.failures.length
      ? [`${receipt.effectId || `${effectId}:child:${index}`}:contradictory_receipt`, ...receipt.failures]
      : [];
  });
  return failures.length ? { schema: EFFECT_RECEIPT_SCHEMA, effectId, outcome: 'unknown', failures } : effectReceipt(effectId, 'cancelled');
}
