import { createHash } from 'node:crypto';
import type { WorkshopAssignment } from '@autofactorio/contracts';
import { validateWorkshopAssignment } from '@autofactorio/contracts';
import { Q } from '../production/rational.js';

// Boundary arrays describe sets, not execution order. Normalize rationals and
// object keys as well so spelling/order cannot split equivalent evaluations.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (!value || typeof value !== 'object') return value;
  const row = value as Record<string,unknown>;
  const normalized = typeof row.numerator === 'string' && typeof row.denominator === 'string' ? {...row,...Q.from(row as {numerator:string;denominator:string}).json()} : row;
  return Object.fromEntries(Object.keys(normalized).sort().filter(key => normalized[key] !== undefined).map(key => [key,canonical(normalized[key])]));
}
export function evaluationBoundary(assignment: WorkshopAssignment): {schema:1;hash:string;definition:unknown} {
  const a = validateWorkshopAssignment(assignment);
  const request = a.chainRequest;
  const definition = canonical({schema:1,mode:a.productionMode??'component',profile:{id:a.profileId,revision:a.profileRevision,fingerprint:a.gameFingerprint},
    ports:a.ports,footprint:a.footprint,construction:a.construction,speed:a.requestedSpeed,settlingTicks:a.settlingTicks,throughput:a.throughput,
    finiteStock:request ? request.initialStock : 'empty-workshop-fixtures',
    request:request ? {...request,facts:undefined,headroom:request.headroom??0,transport:request.transport??[]} : null});
  return {schema:1,hash:createHash('sha256').update(JSON.stringify(definition)).digest('hex'),definition};
}
