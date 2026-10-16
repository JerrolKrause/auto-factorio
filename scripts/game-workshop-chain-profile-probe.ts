import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProductionRequest } from '@autofactorio/contracts';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';
import { resolveWorkshopChain } from '../packages/core/workshop/production.js';
import { createProfile, listProjectProcesses, startServer, stopProfile, waitForServer } from './dev/game-processes.js';

// Read-only planning evidence in a fresh project world; no caller-selected save,
// construction, fixtures, player research edits or provider invocation.
if (process.argv.length > 2) throw new Error('Chain profile probe accepts no arguments');
await listProjectProcesses();
const profile = await createProfile(false, true), evidence = await mkdtemp(path.join(profile.dir, 'workshop-chain-profile-'));
let port: Awaited<ReturnType<typeof waitForServer>> | undefined;
let failure: string | null = null, cleanup = false;
const checks: string[] = [];
console.log(JSON.stringify({ evidence, profile: profile.config }));
try {
  await startServer(profile); port = await waitForServer(profile);
  await port.command('/silent-command rcon.print("chain-profile-console-ready")');
  assert.match(await port.command('/silent-command rcon.print("chain-profile-console-ready")'), /chain-profile-console-ready/);
  const control = new WorkshopControl(port), context = await control.installedChainProfile('production-chain');
  assert.equal(context.snapshot.catalog.mods.base, '2.0.77');
  assert(context.profile.recipes.includes('basic-oil-processing') && context.profile.recipes.includes('sulfur'));
  assert(context.profile.allowedEquipment.includes('oil-refinery') && context.profile.allowedEquipment.includes('chemical-plant'));
  checks.push('Installed Nauvis chain preset supplies effective sulfur/refining facts and compatible machines');
  const product = (kind: 'item' | 'fluid', name: string) => ({ kind, name, quality: 'normal' as const, surface: 'nauvis' });
  const request: ProductionRequest = { schema: 1, target: product('item', 'sulfur'), mode: 'rate', rate: { numerator: '1', denominator: '1', unit: 'items-per-game-second' },
    profile: { id: context.profile.id, revision: context.profile.revision, fingerprint: context.profile.fingerprint, recipes: context.profile.recipes, equipment: context.profile.allowedEquipment },
    facts: { schema: 1, id: `production.${context.snapshot.catalog.fingerprint}`, fingerprint: context.snapshot.catalog.fingerprint, availabilityRevision: context.snapshot.availabilityRevision },
    externalInputs: ['crude-oil', 'water'].map(name => ({ product: product('fluid', name), capacity: { kind: 'unlimited' as const } })), initialStock: [], utilities: { electricityWatts: 2_000_000 },
    constructionEquipment: { 'oil-refinery': 10, 'chemical-plant': 10 }, sinks: [], routes: { 'fluid:petroleum-gas': 'recipe:basic-oil-processing' }, machines: {}, fuels: {} };
  const resolved = resolveWorkshopChain(request, context.snapshot, context.profile);
  assert.equal(resolved.plan.status, 'feasible'); assert.equal(resolved.stages.length, 2);
  assert.deepEqual(resolved.ports.filter(port => port.direction === 'input').map(port => port.product.name).sort(), ['crude-oil', 'water']);
  assert.deepEqual(resolved.stages.map(stage => stage.recipe).sort(), ['basic-oil-processing', 'sulfur']);
  checks.push('Shared planner resolves installed 1/s sulfur without internal petroleum source or added co-products');
  const assembly = await control.installedChainProfile('advanced-assembly');
  assert(!assembly.profile.allowedEquipment.includes('oil-refinery'));
  assert.throws(() => resolveWorkshopChain({ ...request, profile: { id: assembly.profile.id, revision: assembly.profile.revision, fingerprint: assembly.profile.fingerprint, recipes: assembly.profile.recipes, equipment: assembly.profile.allowedEquipment }, facts: { ...request.facts, availabilityRevision: assembly.snapshot.availabilityRevision } }, assembly.snapshot, assembly.profile));
  checks.push('Assembly preset remains restricted and rejects refining chain before mutation');
  const component = await control.installedProfile('starter-assembly', 'electronic-circuit');
  assert.equal(component.recipe.id, 'electronic-circuit'); assert.equal(component.machine, 'assembling-machine-1');
  checks.push('Legacy single-recipe installed profile remains available');
  await writeFile(path.join(evidence, 'profiles.json'), JSON.stringify({ context, assembly, component }, null, 2));
  await writeFile(path.join(evidence, 'resolution.json'), JSON.stringify(resolved, null, 2));
} catch (error) { failure = String(error); process.exitCode = 1; console.error(failure.slice(0, 1500)); }
finally {
  port?.close();
  try { await stopProfile(profile.config); cleanup = !(await listProjectProcesses()).some(process => process.config === profile.config); }
  catch (error) { failure ??= String(error); process.exitCode = 1; }
  if (!cleanup) { failure ??= 'Owned profile cleanup unresolved'; process.exitCode = 1; }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: failure === null, checks, failure, cleanup, modelInference: false }, null, 2));
  console.log(JSON.stringify({ evidence, checks: checks.length, failure, cleanup }));
}
