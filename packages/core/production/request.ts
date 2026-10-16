import type { ProductionProduct, ProductionRequest } from '@autofactorio/contracts';
import { Q, ZERO } from './rational.js';

export const productId = (p: Pick<ProductionProduct, 'kind' | 'name'>) => `${p.kind}:${p.name}`;
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid production object');
  return v as Record<string, unknown>;
};
function keys(v: unknown, allowed: string[], required = allowed) {
  const r = record(v);
  if (Object.keys(r).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(r, k))) throw new Error('Invalid production fields');
  return r;
}
function product(v: unknown) {
  const p = keys(v, ['kind', 'name', 'quality', 'surface']);
  if (!['item', 'fluid'].includes(String(p.kind)) || typeof p.name !== 'string' || !/^[\w.-]{1,100}$/.test(p.name) || p.quality !== 'normal' || p.surface !== 'nauvis') throw new Error('Only normal Nauvis products supported');
}
export function validateRequest(value: unknown): ProductionRequest {
  if (Buffer.byteLength(JSON.stringify(value)) > 64000) throw new Error('Production request byte limit');
  const r = keys(value, ['schema', 'target', 'mode', 'rate', 'quantity', 'profile', 'facts', 'externalInputs', 'initialStock', 'utilities', 'constructionEquipment', 'sinks', 'routes', 'machines', 'fuels', 'headroom', 'transport'], ['schema', 'target', 'mode', 'profile', 'facts', 'externalInputs', 'initialStock', 'utilities', 'constructionEquipment', 'sinks', 'routes', 'machines', 'fuels']);
  if (r.schema !== 1 || !['explore', 'rate', 'quantity'].includes(String(r.mode))) throw new Error('Invalid production mode');
  product(r.target);
  if (r.mode === 'rate') {
    const rate = keys(r.rate, ['numerator', 'denominator', 'unit']);
    if (rate.unit !== ((r.target as ProductionProduct).kind === 'item' ? 'items-per-game-second' : 'units-per-game-second') || Q.from(rate as unknown as ProductionRequest['rate'] & object).cmp(ZERO) <= 0) throw new Error('Positive target with game-second units required');
  } else if (r.rate !== undefined) throw new Error('Rate only valid in rate mode');
  if (r.mode === 'quantity') { if (!Number.isSafeInteger(r.quantity) || Number(r.quantity) <= 0) throw new Error('Positive whole quantity required'); }
  else if (r.quantity !== undefined) throw new Error('Quantity only valid in quantity mode');
  if (r.headroom !== undefined && (r.mode !== 'rate' || typeof r.headroom !== 'number' || !Number.isFinite(r.headroom) || r.headroom < 0 || r.headroom > 10)) throw new Error('Invalid rate headroom');
  const profile = keys(r.profile, ['id', 'revision', 'fingerprint', 'recipes', 'equipment']);
  if (typeof profile.id !== 'string' || !/^[\w.-]{1,100}$/.test(profile.id) || !Number.isSafeInteger(profile.revision) || Number(profile.revision) < 1 || typeof profile.fingerprint !== 'string' || profile.fingerprint.length > 100 || !profile.fingerprint) throw new Error('Invalid profile identity');
  for (const k of ['recipes', 'equipment']) if (profile[k] !== null && (!Array.isArray(profile[k]) || (profile[k] as unknown[]).length > 2000 || (profile[k] as unknown[]).some(n => typeof n !== 'string' || !/^[\w.-]{1,100}$/.test(n)))) throw new Error('Invalid profile restriction');
  const facts = keys(r.facts, ['schema', 'id', 'fingerprint', 'availabilityRevision']);
  if (facts.schema !== 1 || typeof facts.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(facts.fingerprint) || facts.id !== `production.${facts.fingerprint}` || typeof facts.availabilityRevision !== 'string' || !/^[a-f0-9]{64}$/.test(facts.availabilityRevision)) throw new Error('Invalid facts reference');
  for (const key of ['externalInputs', 'initialStock', 'sinks']) {
    if (!Array.isArray(r[key]) || (r[key] as unknown[]).length > 128) throw new Error('Production boundary limit');
    const ids = new Set<string>();
    for (const entry of r[key] as unknown[]) {
      const e = keys(entry, key === 'initialStock' ? ['product', 'quantity'] : ['product', 'capacity']); product(e.product);
      const id = productId(e.product as ProductionProduct); if (ids.has(id)) throw new Error('Duplicate boundary product'); ids.add(id);
      if (key === 'initialStock') { if (typeof e.quantity !== 'number' || !Number.isFinite(e.quantity) || e.quantity < 0) throw new Error('Invalid finite stock'); }
      else {
        const c = record(e.capacity);
        if (c.kind === 'rate') { keys(c, ['kind', 'numerator', 'denominator']); if (Q.from(c as unknown as { numerator: string; denominator: string }).cmp(ZERO) < 0) throw new Error('Negative capacity'); }
        else { keys(c, ['kind']); if (c.kind !== 'unlimited' && !(key === 'externalInputs' && c.kind === 'unknown')) throw new Error('Invalid supply capacity'); }
      }
    }
  }
  const u = keys(r.utilities, ['electricityWatts']);
  if (r.transport !== undefined) {
    if (!Array.isArray(r.transport) || r.transport.length > 128) throw new Error('Transport limit');
    const seen = new Set<string>();
    for (const row of r.transport) {
      const t = keys(row, ['product', 'capacity', 'laneCapacity'], ['product', 'capacity']); product(t.product);
      const id = productId(t.product as ProductionProduct); if (seen.has(id)) throw new Error('Duplicate transport product'); seen.add(id);
      for (const k of ['capacity', 'laneCapacity']) if (t[k] !== undefined) { keys(t[k], ['numerator', 'denominator']); if (Q.from(t[k] as unknown as { numerator: string; denominator: string }).cmp(ZERO) <= 0) throw new Error('Positive transport capacity required'); }
    }
  }
  if (u.electricityWatts !== null && (typeof u.electricityWatts !== 'number' || !Number.isFinite(u.electricityWatts) || u.electricityWatts < 0)) throw new Error('Invalid electricity allowance');
  for (const [name, count] of Object.entries(record(r.constructionEquipment))) if (!/^[\w.-]{1,100}$/.test(name) || !Number.isSafeInteger(count) || Number(count) < 0) throw new Error('Invalid equipment allowance');
  for (const key of ['routes', 'machines', 'fuels']) {
    const entries = Object.entries(record(r[key])); if (entries.length > 128) throw new Error('Selection limit');
    for (const [id, v] of entries) {
      if (key === 'routes') { if (!/^(item|fluid):[\w.-]{1,100}$/.test(id) || typeof v !== 'string' || !/^recipe:[\w.-]{1,100}$/.test(v)) throw new Error('Invalid route choice'); }
      else { if (!/^recipe:[\w.-]{1,100}$/.test(id)) throw new Error('Invalid stage selector'); if (key === 'fuels') product(v); else if (typeof v !== 'string' || !/^machine:[\w.-]{1,100}$/.test(v)) throw new Error('Invalid machine choice'); }
    }
  }
  return structuredClone(value) as ProductionRequest;
}
