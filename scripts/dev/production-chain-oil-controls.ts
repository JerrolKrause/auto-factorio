import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BlueprintDocument, WorkshopWindowMeasurement } from '@autofactorio/contracts';
import type { LiveWorkshopHost } from '../../apps/runtime/workshop-live-host.js';
import type { WorkshopSessionState } from '../../packages/core/workshop/orchestrator.js';
import { blueprintContentHash } from '../../packages/core/workshop/blueprint.js';
import { digest } from '../../packages/core/production/graph.js';
import type { CommandPort } from '../../packages/factorio/src/rcon.js';
import type { WorkshopControl } from '../../packages/factorio/src/workshop.js';
import { referenceBlueprint } from './production-chain-reference.js';

export const OIL_CONTROLS = ['missing-crude', 'blocked-heavy', 'preloaded-target', 'injected-light', 'undeclared-port'] as const;
export type OilControl = typeof OIL_CONTROLS[number];

/** Remove the connector at the machine, not a distant pipe beyond a large
 * buffer. This isolates a supply or blocks the co-product without fake flow. */
export function oilControlBlueprint(input: BlueprintDocument, scenario: OilControl): BlueprintDocument {
  const document = structuredClone(input);
  const position = scenario === 'missing-crude' ? { x: -15.5, y: 3.5 }
    : scenario === 'blocked-heavy' ? { x: -18.5, y: -2.5 } : null;
  if (position) {
    const removed = document.entities.filter(entity => entity.name === 'pipe' && entity.position.x === position.x && entity.position.y === position.y);
    assert.equal(removed.length, 1, 'Expected exactly one physical fault connector');
    document.entities = document.entities.filter(entity => entity.id !== removed[0]!.id);
  }
  if (scenario === 'undeclared-port') {
    const source = document.ports.find(port => port.direction === 'input')!;
    document.ports.push({ ...structuredClone(source), id: 'input-fluid-light-oil', position: { x: -32.5, y: 5.5 }, product: { ...source.product, name: 'light-oil' } });
  }
  return document;
}

const value = (amount: { numerator: string; denominator: string }) => Number(amount.numerator) / Number(amount.denominator);

export function requireOilDeficit(samples: WorkshopWindowMeasurement[], scenario: 'missing-crude' | 'blocked-heavy'): void {
  assert.equal(samples.length, 5);
  samples.forEach((sample, index) => {
    assert.equal(sample.endTick - sample.startTick, 3600);
    if (index) assert.equal(sample.startTick, samples[index - 1]!.endTick);
    assert.equal(sample.stageCoverage, 'complete'); assert.equal(sample.energyCoverage, 'complete');
    assert.equal(sample.connected, true); assert.equal(sample.mutationsFrozen, true); assert.deepEqual(sample.contamination, []);
    assert.equal(sample.stages?.length, 2);
    for (const stage of sample.stages!) {
      assert.equal(stage.coverage, 'complete'); assert(stage.evidence.length > 0);
      assert.equal(value(stage.crafts), 0, `${scenario}: settling must exhaust even the machine's finite buffer`);
      for (const flow of [...stage.inputs, ...stage.outputs]) assert.equal(value(flow.amount), 0);
    }
    for (const port of sample.ports) {
      assert.equal(port.coverage, 'complete');
      assert.equal(value(port.production), 0); assert.equal(value(port.delivery), 0);
      assert.equal(value(port.residual), 0);
    }
  });
}

/** All effects are confined to fresh host-owned workshop surfaces. Deliberate
 * injected fluids are negative controls only, never accepted production. */
export async function runOilControls(options: {
  host: LiveWorkshopHost; control: WorkshopControl; port: CommandPort;
  evidence: string; setup: Record<string, unknown>; copperConnector: number;
}): Promise<string[]> {
  const { host, control, port, evidence, setup, copperConnector } = options;
  const checks: string[] = [];
  const save = async (name: string, data: unknown) => writeFile(path.join(evidence, name), JSON.stringify(data, null, 2), { flag: 'wx' });
  for (const scenario of OIL_CONTROLS) {
    const id = `oil-${scenario}`;
    const assignment = await host.resolve({ ...setup, id, comparisonSeries: id });
    const document = oilControlBlueprint(referenceBlueprint(assignment, 'refining-cracking', copperConnector), scenario);
    const artifactHash = blueprintContentHash(document), directory = path.join(evidence, 'workshop-live', id);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${artifactHash}.json`), JSON.stringify(document), { flag: 'wx' });
    const session = { id, assignment, activeIteration: 1, pinnedBundleHash: 'baseline' } as WorkshopSessionState;
    const candidate = { sessionId: id, iteration: 1, artifactHash, assignmentRevision: 1, bundleHash: 'baseline', evidence: ['deterministic-oil-negative:no-inference'] };
    if (scenario === 'undeclared-port') {
      await assert.rejects(host.build(session, candidate), /Blueprint ports differ from the pinned chain boundary/);
      await assert.rejects(access(path.join(directory, `${artifactHash}.built.json`)), { code: 'ENOENT' });
      checks.push('Undeclared light-oil fixture port is refused by host build before construction');
      await save(`${scenario}.json`, { rejected: true, builtArtifactAbsent: true, assignment, document });
      continue;
    }
    await host.build(session, candidate);
    const built = JSON.parse(await readFile(path.join(directory, `${artifactHash}.built.json`), 'utf8')) as { surface: string };
    const inspect = async () => JSON.parse(await port.command(`/silent-command game.tick_paused=true;local s=game.surfaces[${JSON.stringify(built.surface)}];local out={tick=game.tick,fluid=0,crafts=0,progress=0,machines={}};for _,e in pairs(s.find_entities()) do if e.type=='assembling-machine' then out.crafts=out.crafts+e.products_finished;out.progress=out.progress+e.crafting_progress;local name='unknown';for k,v in pairs(defines.entity_status) do if v==e.status then name=k end end;local m={name=e.name,status=name,fluids={}};for i=1,#e.fluidbox do local f=e.fluidbox[i];if f then m.fluids[#m.fluids+1]={name=f.name,amount=f.amount,capacity=e.fluidbox.get_capacity(i),direction=e.fluidbox.get_prototype(i).production_type} end end;out.machines[#out.machines+1]=m end;if e.type=='pipe' or e.type=='pipe-to-ground' or e.type=='storage-tank' or e.type=='assembling-machine' then for i=1,#e.fluidbox do local f=e.fluidbox[i];out.fluid=out.fluid+(f and f.amount or 0) end end end;rcon.print(helpers.table_to_json(out))`)) as {
      tick: number; fluid: number; crafts: number; progress: number;
      machines: { name: string; status: string; fluids: { name: string; amount: number; capacity: number; direction: string }[] }[];
    };
    const opening = await inspect();
    assert.equal(opening.fluid, 0); assert.equal(opening.crafts, 0); assert.equal(opening.progress, 0);
    await save(`${scenario}-opening.json`, { assignment, document, built, opening });
    if (scenario === 'preloaded-target' || scenario === 'injected-light') {
      const name = scenario === 'preloaded-target' ? 'petroleum-gas' : 'light-oil';
      const machine = scenario === 'preloaded-target' ? 'oil-refinery' : 'chemical-plant';
      const direction = scenario === 'preloaded-target' ? 'output' : 'input';
      const response = await port.command(`/silent-command local s=game.surfaces[${JSON.stringify(built.surface)}];local e=s.find_entities_filtered{name=${JSON.stringify(machine)}}[1];local placed=false;for i=1,#e.fluidbox do local p=e.fluidbox.get_prototype(i);local f=e.fluidbox.get_filter(i);if p.production_type==${JSON.stringify(direction)} and f and f.name==${JSON.stringify(name)} then e.fluidbox[i]={name=${JSON.stringify(name)},amount=100};placed=true;break end end;assert(placed,'negative fluid slot missing');rcon.print('negative-preload-inserted')`);
      assert.match(response, /negative-preload-inserted/);
      const injected = await inspect();
      // Native readback can be smaller than the requested amount (light
      // cracking retained 60 here). Require real positive injected stock,
      // not that every slot can hold the requested 100 units.
      assert(injected.fluid > 0 && injected.fluid <= 100); assert.equal(injected.crafts, 0);
      assert(injected.machines.some(value => value.name === machine && value.fluids.some(fluid => fluid.name === name && fluid.amount > 0)));
      await save(`${scenario}-injected.json`, { requested: 100, actual: injected.fluid, injected });
      await assert.rejects(host.measure(session, candidate), /chain_candidate_preload/);
      const status = await control.measureStatus(`${id}-1`, `attempt-${digest(`${id}:1`).slice(0, 20)}`);
      assert.equal(status.present, false);
      await save(`${scenario}.json`, { rejected: true, injected, status });
      checks.push(`${scenario}: ${injected.fluid} native fluid units rejected before measurement admission`);
      continue;
    }
    const evaluation = await host.measure(session, candidate);
    await save(`${scenario}-evaluation.json`, evaluation);
    assert.equal(evaluation.passed, false); assert.equal(evaluation.valid, true);
    assert(evaluation.reasons.includes('chain_stage_below_target'));
    assert(evaluation.reasons.includes('sustained_target_failed'));
    const samples = (await readFile(path.join(directory, 'iteration-1.measurements.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as WorkshopWindowMeasurement);
    requireOilDeficit(samples, scenario);
    const ending = await inspect();
    const refinery = ending.machines.find(machine => machine.name === 'oil-refinery')!;
    if (scenario === 'missing-crude') {
      assert.equal(ending.crafts, 0);
      assert(!refinery.fluids.some(fluid => fluid.name === 'crude-oil'));
    } else {
      assert.match(refinery.status, /output|overload/);
      assert(refinery.fluids.some(fluid => fluid.name === 'heavy-oil' && fluid.direction === 'output' && fluid.amount > 0));
    }
    await save(`${scenario}-ending.json`, ending);
    checks.push(`${scenario}: five complete fresh windows expose zero stage flow/target delivery; native ${refinery.status}`);
  }
  return checks;
}
