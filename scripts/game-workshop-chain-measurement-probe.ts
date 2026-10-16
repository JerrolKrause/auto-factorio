import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BlueprintDocument, ProductionRequest, WorkshopAssignment } from '@autofactorio/contracts';
import type { ChainMeasurementManifest } from '../apps/runtime/workshop-chain-measurement.js';
import { LiveWorkshopGame, LiveWorkshopHost, reconcileWorkshopMeasurementFence } from '../apps/runtime/workshop-live-host.js';
import type { WorkshopSessionState } from '../packages/core/workshop/orchestrator.js';
import { blueprintContentHash } from '../packages/core/workshop/blueprint.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';
import { measurementAcknowledgementLoss } from './dev/workshop-measurement-faults.js';
import { calibrateWorkshopBurner } from './dev/workshop-burner-calibration.js';
import { createProfile, identifyObserver, listProjectProcesses, startObserver, startServer, stopProfile, waitFor, waitForServer } from './dev/game-processes.js';

// A diagnostic host-owned measurement check; disconnected candidates cannot pass.
// No caller-selected save, ports, profile, runtime host or provider invocation.
if (process.argv.length > 2) throw new Error('Chain construction probe accepts no arguments');
const graphical = spawnSync('powershell.exe', ['-NoProfile', '-Command', '@(Get-CimInstance Win32_Process -Filter "Name=\'factorio.exe\'" | Where-Object { $_.CommandLine -notmatch "--(start-server|create|benchmark|version)" }).Count'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
if (graphical.status !== 0 || graphical.stdout.trim() !== '0') throw new Error('Graphical Factorio is occupied or its inventory is unavailable; no project client started');
await listProjectProcesses();
const profile = await createProfile(false, false, { port: 27029, gamePort: 34209 });
const evidence = await mkdtemp(path.join(profile.dir, 'chain-measurement-'));
let port: Awaited<ReturnType<typeof waitForServer>> | undefined;
let observer = false, cleanup = false, failure: string | null = null;
const checks: string[] = [], events: unknown[] = [];
console.log(JSON.stringify({ evidence, profile: profile.config }));
try {
  await startServer(profile); port = await waitForServer(profile);
  await port.command('/silent-command rcon.print("chain-construction-ready")');
  await port.command('/silent-command rcon.print("chain-construction-ready")');
  await startObserver(profile); observer = true; await identifyObserver(profile);
  const client = new GameClient(port, event => events.push(event));
  const life = new Lifecycle(port, client, event => events.push(event));
  await waitFor('chain construction builder', async () => {
    const world = await client.request({ op: 'observe', surface: 'nauvis', area: [{ x: -32, y: -32 }, { x: 32, y: 32 }], offset: 0, limit: 50 });
    return (world.actors as Record<string, { connected?: boolean }>)['builder-1']?.connected ? true : undefined;
  }, 120000, 200);
  const control = new WorkshopControl(port), context = await control.installedChainProfile('production-chain');
  const product = (kind: 'item' | 'fluid', name: string) => ({ kind, name, quality: 'normal' as const, surface: 'nauvis' });
  const request: ProductionRequest = { schema: 1, target: product('item', 'sulfur'), mode: 'rate', rate: { numerator: '1', denominator: '1', unit: 'items-per-game-second' },
    profile: { id: context.profile.id, revision: context.profile.revision, fingerprint: context.profile.fingerprint, recipes: context.profile.recipes, equipment: context.profile.allowedEquipment },
    facts: { schema: 1, id: `production.${context.snapshot.catalog.fingerprint}`, fingerprint: context.snapshot.catalog.fingerprint, availabilityRevision: context.snapshot.availabilityRevision },
    externalInputs: ['crude-oil', 'water'].map(name => ({ product: product('fluid', name), capacity: { kind: 'rate' as const, numerator: '100', denominator: '1' } })),
    initialStock: [], utilities: { electricityWatts: 2_000_000 }, constructionEquipment: { 'oil-refinery': 2, 'chemical-plant': 1, pipe: 2 },
    sinks: ['heavy-oil', 'light-oil'].map(name => ({ product: product('fluid', name), capacity: { kind: 'rate' as const, numerator: '20', denominator: '1' } })),
    routes: { 'fluid:petroleum-gas': 'recipe:advanced-oil-processing' }, machines: {}, fuels: {} };
  const game = new LiveWorkshopGame(port, client, life, activity => events.push(activity));
  const host = new LiveWorkshopHost(evidence, { async invoke() { throw new Error('No inference permitted'); }, async close() {} }, game);
  const component = await control.installedChainProfile('starter-assembly');
  const componentSetup = await control.setup({ id: 'legacy-component', surface: 'af-legacy-component', force: 'af-legacy-component', profile: component.profile,
    area: [{ x: -256, y: -256 }, { x: 256, y: 256 }], maxTiles: 512 * 512,
    fixtures: [{ id: 'power', kind: 'power', position: { x: 0, y: 14 }, product: { kind: 'item', name: 'electricity', quality: 'normal' }, rate: 0 }] });
  assert.equal(componentSetup.ok, true);
  checks.push('Legacy component setup accepts fixtures without the optional chain identity or bounded-rate fields');
  await writeFile(path.join(evidence, 'component.json'), JSON.stringify(componentSetup, null, 2));

  let priorAssignment: WorkshopAssignment | undefined;
  for (const scenario of ['direct', 'character', 'mixed', 'discontinuity', 'abort', 'membership', 'counter', 'epoch'] as const) {
    const construction = scenario === 'character' ? 'character' : 'direct';
    const id = `chain-${scenario}`, selected = { provider: 'openai', modelId: 'gpt-6-astra', reasoningEffort: 'low' };
    const assignment = await host.resolve({ schema: 1, id, revision: 1, comparisonSeries: id, objective: 'Reconstruct installed sulfur chain', source: { kind: 'brief', id: null },
      profileId: 'production-chain', productionMode: 'chain', chainRequest: scenario === 'mixed' ? {
        ...request, target: product('fluid', 'petroleum-gas'),
        rate: { numerator: '20', denominator: '1', unit: 'units-per-game-second' },
        constructionEquipment: { ...request.constructionEquipment, 'medium-electric-pole': 4 },
        sinks: [{ product: product('fluid', 'heavy-oil'), capacity: { kind: 'rate', numerator: '20', denominator: '1' } },
          { product: product('fluid', 'light-oil'), capacity: { kind: 'rate', numerator: '1', denominator: '1' } }],
        routes: { 'fluid:petroleum-gas': 'recipe:light-oil-cracking', 'fluid:light-oil': 'recipe:advanced-oil-processing' },
      } : request, construction, libraryAccess: false, improveRevision: null,
      requestedSpeed: { numerator: '1', denominator: '1' }, settlingTicks: 0, windowTicks: 60, windows: 1,
      rubric: { version: 'rubric-1', weights: { throughput: { numerator: '1', denominator: '1' } }, materiality: { throughput: { numerator: '0', denominator: '1' } }, directions: { throughput: 'maximize' } },
      iterations: { attempts: 1, mode: 'exact', earlyStop: false, plateauRounds: 1 }, checkpoints: { brief: false, afterScore: false, libraryAdmission: false, learningActivation: false, timeoutMs: 1000, timeoutAction: 'finish' },
      budgets: { wallMs: 120000, gameTicks: 30000, turns: 3, toolCalls: 8, reportedTokens: 1000, learningReservedTurns: 0, learningReservedTools: 0 },
      models: { sessionDefault: selected, overrides: {} }, learning: { cadence: 'off', batchSessions: 2, candidateCap: 2, attemptsPerCandidate: 1, autoActivate: false } });
    priorAssignment = assignment;
    const document: BlueprintDocument = { schema: 1, label: 'Installed chain configuration', description: 'Disconnected construction diagnostic',
      entities: [{ id: 'refinery', entityNumber: 1, name: 'oil-refinery', position: { x: -8.5, y: 0.5 }, direction: 4, quality: 'normal', recipe: 'advanced-oil-processing' },
        { id: 'refinery-b', entityNumber: 5, name: 'oil-refinery', position: { x: -8.5, y: 9.5 }, direction: 4, quality: 'normal', recipe: 'advanced-oil-processing' },
        { id: 'chemical', entityNumber: 2, name: 'chemical-plant', position: { x: 4.5, y: 0.5 }, direction: 8, quality: 'normal', recipe: scenario === 'mixed' ? 'light-oil-cracking' : 'sulfur' },
        { id: 'pipe-a', entityNumber: 3, name: 'pipe', position: { x: -8.5, y: 4.5 }, direction: 0, quality: 'normal' },
        { id: 'pipe-b', entityNumber: 4, name: 'pipe', position: { x: 4.5, y: 3.5 }, direction: 0, quality: 'normal' }],
      ports: assignment.ports, wires: [], icons: [{ index: 1, name: 'sulfur' }], tiles: [] };
    if (scenario === 'mixed') {
      document.entities = document.entities.filter(entity => entity.name !== 'pipe');
      for (const [index, position] of [{ x: -4.5, y: 5.5 }, { x: 0.5, y: 6.5 }, { x: 0.5, y: 12.5 }, { x: 4.5, y: 3.5 }].entries()) {
        document.entities.push({ id: `pole-${index}`, entityNumber: 6+index, name: 'medium-electric-pole', position, direction: 0, quality: 'normal' });
      }
      const wireIds = JSON.parse(await port.command('/silent-command rcon.print(helpers.table_to_json(defines.wire_connector_id))')) as { pole_copper: number };
      assert(Number.isSafeInteger(wireIds.pole_copper) && wireIds.pole_copper > 0);
      for (const [from, to] of [[0,1],[1,2],[1,3]]) document.wires.push({ from: { entityId: `pole-${from}`, connector: String(wireIds.pole_copper) },
        to: { entityId: `pole-${to}`, connector: String(wireIds.pole_copper) }, color: 'copper' });
    }
    const artifactHash = blueprintContentHash(document), directory = path.join(evidence, 'workshop-live', id);
    await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, `${artifactHash}.json`), JSON.stringify(document));
    const session = { id, assignment, activeIteration: 1 , pinnedBundleHash: 'baseline' } as WorkshopSessionState;
    const candidate = { sessionId: id, iteration: 1, artifactHash, assignmentRevision: 1, bundleHash: 'baseline', evidence: [] };
    await host.build(session, candidate);
    if (scenario === 'mixed') {
      const built = JSON.parse(await readFile(path.join(directory, `${artifactHash}.built.json`), 'utf8')) as {
        id: string; generation: number; surface: string; chainMeasurement: ChainMeasurementManifest;
      };
      const manifest = built.chainMeasurement, attemptId = 'calibration-mixed';
      assert.deepEqual(manifest.bindings.map(stage => stage.recipe).sort(), ['advanced-oil-processing', 'light-oil-cracking']);
      assert(assignment.ports.some(value => value.direction === 'byproduct' && value.product.name === 'light-oil'));
      await port.command('/silent-command game.tick_paused=true;rcon.print("mixed-held")');
      const admitted = await control.measureConfigure({ id: built.id, generation: built.generation, attemptId,
        settlingTicks: 600, windowTicks: 600, windows: 1, requestedSpeed: 1,
        ports: assignment.ports.filter(value => value.direction === 'output' || value.direction === 'byproduct')
          .map(value => ({ id: value.id, fixtureId: value.id, product: { kind: value.product.kind, name: value.product.name, quality: 'normal' as const } })),
        chain: { boundaryFingerprint: manifest.boundaryFingerprint, candidateFingerprint: manifest.candidateFingerprint, stages: manifest.bindings } });
      // Calibration transport only: move existing fluid with checked conservation.
      // No pipe-layout/physical-chain acceptance follows from console transport.
      // Storage is private per mod. This fixed, no-inference diagnostic explicitly
      // selects its owner; an ordinary console command runs in the level context.
      const transport = `/silent-command __autofactorio__
        assert(script.mod_name=='autofactorio','wrong diagnostic context')
        local w=storage.af.workshops[${JSON.stringify(built.id)}];local s=game.surfaces[w.surface];local m=w.measurement
        local function box(e,name,direction)
          for i=1,#e.fluidbox do local f=e.fluidbox.get_filter(i);local p=e.fluidbox.get_prototype(i)
            local fluid=e.fluidbox[i]
            if p.production_type==direction and (direction=='output' and fluid and fluid.name==name or direction=='input' and f and f.name==name) then return i end
          end
          if direction=='output' then return nil end
          error('missing calibration input fluid box '..name)
        end
        local function move(a,ai,b,bi,limit)
          if not ai then return 0 end
          local af=a.fluidbox[ai];if not af then return 0 end;local bf=b.fluidbox[bi]
          assert(not bf or bf.name==af.name);local beforeA=af.amount;local beforeB=bf and bf.amount or 0
          local n=math.min(beforeA,limit,b.fluidbox.get_capacity(bi)-beforeB);if n<=0 then return 0 end
          b.fluidbox[bi]={name=af.name,amount=beforeB+n,temperature=af.temperature}
          a.fluidbox[ai]=beforeA>n and {name=af.name,amount=beforeA-n,temperature=af.temperature} or nil
          local aa=a.fluidbox[ai];local bb=b.fluidbox[bi]
          assert(math.abs(beforeA+beforeB-(aa and aa.amount or 0)-(bb and bb.amount or 0))<=0.002,'calibration transport loss')
          return n
        end
        --[[ Small input buffers leave finite source flow available to every stage. ]]
        local function fill(source,e,name,target)
          local bi=box(e,name,'input');local fluid=e.fluidbox[bi]
          return move(source,1,e,bi,math.max(0,target-(fluid and fluid.amount or 0)))
        end
        local function fixture(id) local f=assert(w.fixtures[id]);return assert(s.find_entity(f.entity,f.position)) end
        local c=assert(s.find_entity('chemical-plant',{4.5,0.5}))
        if not m.finished then
          if m.state=='scoring' and not storage.af_mixed_start then storage.af_mixed_start={tick=m.baseline.tick,counts=m.baseline.chain.counts,started=m.baseline.chain.started} end
          local oil=fixture('input-fluid-crude-oil');local water=fixture('input-fluid-water')
          for _,p in ipairs({{-8.5,0.5},{-8.5,9.5}}) do local r=assert(s.find_entity('oil-refinery',p))
            fill(oil,r,'crude-oil',200);fill(water,r,'water',100)
            local li=box(r,'light-oil','output');local light=li and r.fluidbox[li];local half=light and light.amount/2 or 0
            move(r,li,c,box(c,'light-oil','input'),half)
            move(r,li,fixture('byproduct-fluid-light-oil'),1,500)
            move(r,box(r,'heavy-oil','output'),fixture('byproduct-fluid-heavy-oil'),1,500)
            move(r,box(r,'petroleum-gas','output'),fixture('output-fluid-petroleum-gas'),1,500)
          end
          fill(water,c,'water',60)
          move(c,box(c,'petroleum-gas','output'),fixture('output-fluid-petroleum-gas'),1,500)
        end
        local native={};for _,binding in ipairs(m.chain.stages) do for _,unit in ipairs(binding.units) do
          local e=nil;for _,candidate in pairs(s.find_entities_filtered{area=w.area,force=w.force,name=binding.machine}) do if candidate.unit_number==unit then e=candidate;break end end
          assert(e,'missing native calibration unit');native[tostring(unit)]={finished=e.products_finished,progress=e.crafting_progress}
        end end
        rcon.print(helpers.table_to_json{scope=script.mod_name,tick=game.tick,state=m.state,finished=m.finished,opening=storage.af_mixed_start,native=native,closing=m.finished and m.baseline.chain or nil})`.replace(/\r?\n\s*/g, ' ');
      const rounds: unknown[] = [];
      const terminal = await waitFor('native mixed-flow calibration', async () => {
        const raw = await port!.command(transport);
        let value: { scope: string; finished: boolean; opening?: { tick: number; counts: Record<string, number>; started: Record<string, number> }; native: Record<string, { finished: number; progress: number }>; closing?: { counts: Record<string, number>; started: Record<string, number> } };
        try { value = JSON.parse(raw) as typeof value; }
        catch (error) { await writeFile(path.join(evidence,'mixed-console-failure.txt'),raw);throw new Error('Mixed calibration console response is not JSON; raw response retained', { cause: error }); }
        rounds.push(value); return value.finished ? value : undefined;
      }, 45000, 100);
      const page = await control.measureRead(built.id, attemptId, -1);
      await writeFile(path.join(evidence,'mixed-observations.json'),JSON.stringify({admitted,manifest,page,rounds,transportHarness:true,physicalConnectivityAcceptance:false},null,2));
      assert.equal(page.samples.length, 1);
      assert.equal(terminal.scope,'autofactorio');
      const sample = page.samples[0]!;
      assert.equal(sample.endTick-sample.startTick,600);
      assert.equal(sample.stageCoverage, 'complete');assert.deepEqual(sample.contamination, []);
      assert(terminal.opening && terminal.closing);assert.equal(terminal.opening.tick,sample.startTick);
      const refinery = manifest.bindings.find(value => value.recipe === 'advanced-oil-processing')!;
      const cracking = manifest.bindings.find(value => value.recipe === 'light-oil-cracking')!;
      const delta = (units: number[], field: 'counts' | 'started') => units.reduce((sum, unit) => sum + terminal.closing![field][String(unit)]! - terminal.opening![field][String(unit)]!, 0);
      for (const [unit, observed] of Object.entries(terminal.native)) {
        assert.equal(terminal.closing.counts[unit], observed.finished);
        assert.equal(terminal.closing.started[unit], observed.finished + (observed.progress > 0 ? 1 : 0));
      }
      const recipe = context.snapshot.catalog.recipes.find(value => value.name === 'advanced-oil-processing')!;
      const crackRecipe = context.snapshot.catalog.recipes.find(value => value.name === 'light-oil-cracking')!;
      const quantity = (value: { numerator: string; denominator: string }) => Number(value.numerator)/Number(value.denominator);
      const gross = delta(refinery.units,'counts')*recipe.products.find(value=>value.name==='light-oil')!.amount!;
      const consumed = delta(cracking.units,'started')*crackRecipe.ingredients.find(value=>value.name==='light-oil')!.amount!;
      const light = sample.ports.find(value => value.product.name === 'light-oil')!;
      const net = gross-consumed, measured = quantity(light.production), delivered = quantity(light.delivery);
      assert(gross>0 && consumed>0 && net>0 && delivered>0);
      assert(Math.abs(measured-net)<=0.01, `mixed net flow ${measured} differs from completed ${gross} minus started ${consumed}`);
      assert(Math.abs(quantity(light.residual))<=0.01);
      assert(measured<gross);assert(sample.stages!.every(value=>quantity(value.crafts)>0));
      await writeFile(path.join(evidence,'mixed.json'),JSON.stringify({admitted,manifest,page,rounds,oracle:{gross,consumed,net,measured,delivered},transportHarness:true,physicalConnectivityAcceptance:false},null,2));
      checks.push('Native nonzero mixed light-oil flow subtracts started internal consumption once while retaining positive declared surplus delivery and stock balance');
      continue;
    }
    if (scenario === 'discontinuity' || scenario === 'abort' || scenario === 'membership' || scenario === 'counter' || scenario === 'epoch') {
      const built = JSON.parse(await readFile(path.join(directory, `${artifactHash}.built.json`), 'utf8')) as {
        id: string; generation: number; surface: string; chainMeasurement: ChainMeasurementManifest;
      };
      const manifest = built.chainMeasurement;
      // Long settling keeps admission active during retry/abort. The recipe
      // case deliberately mutates only this fresh owned diagnostic candidate.
      const configuration = { id: built.id, generation: built.generation, attemptId: `recovery-${scenario}`,
        settlingTicks: 600, windowTicks: 120, windows: 1, requestedSpeed: 1,
        ports: assignment.ports.filter(value => value.direction === 'output' && value.required || value.direction === 'byproduct')
          .map(value => ({ id: value.id, fixtureId: value.id, product: { kind: value.product.kind, name: value.product.name, quality: 'normal' as const } })),
        chain: { boundaryFingerprint: manifest.boundaryFingerprint, candidateFingerprint: manifest.candidateFingerprint, stages: manifest.bindings } };
      await port.command('/silent-command game.tick_paused=true;game.speed=0.5;rcon.print("recovery-held")');
      const admitted = await control.measureConfigure(configuration);
      const retry = await control.measureConfigure(configuration);
      assert.equal(retry.reconciled, true);
      assert.equal(retry.admittedTick, admitted.admittedTick);
      await assert.rejects(control.measureConfigure({ ...configuration, windowTicks: 121 }), /workshop_measurement_collision/);
      const afterConflict = await control.measureConfigure(configuration);
      assert.equal(afterConflict.reconciled, true);
      assert.equal(afterConflict.admittedTick, admitted.admittedTick);
      assert.equal((await control.measureStatus(built.id, configuration.attemptId)).present, true);
      checks.push(`${scenario}: exact configure retry retains admission tick; changed payload conflicts`);
      if (scenario === 'abort') {
        const first = await control.measureAbort(built.id, configuration.attemptId);
        const second = await control.measureAbort(built.id, configuration.attemptId);
        assert.equal(first.state, 'aborted');
        assert.deepEqual(second, first);
        assert.equal(first.restoredSpeed, 0.5);
        assert.equal(first.restoredPaused, true);
        const page = await control.measureRead(built.id, configuration.attemptId, -1);
        assert.equal(page.finished, true);
        assert.equal(page.state, 'aborted');
        assert.equal(page.samples.length, 0);
        await writeFile(path.join(evidence, 'abort.json'), JSON.stringify({ admitted, retry, afterConflict, first, second, page }, null, 2));
        checks.push('Active chain abort is idempotent, emits no scored window and restores exact paused/speed controls');
      } else {
        const prefix = '/silent-command __autofactorio__ local s=game.surfaces[' + JSON.stringify(built.surface) + '];local e=s.find_entity("oil-refinery",{-8.5,0.5});';
        const changes = {
          discontinuity: 'e.set_recipe("basic-oil-processing");',
          membership: 'storage.af_diag_member=s.create_entity{name="pipe",position={12.5,5.5},force=e.force};assert(storage.af_diag_member);',
          counter: 'assert(e.products_finished==0);e.products_finished=10;',
          epoch: 'storage.af_diag_epoch=storage.af.epoch;storage.af.epoch=storage.af.epoch.."-diagnostic";',
        };
        const restorations = {
          discontinuity: 'e.set_recipe("advanced-oil-processing");assert(e.get_recipe().name=="advanced-oil-processing");',
          membership: 'assert(storage.af_diag_member.valid);storage.af_diag_member.destroy();storage.af_diag_member=nil;',
          counter: 'assert(e.products_finished==10);e.products_finished=0;',
          epoch: 'assert(storage.af.epoch~=storage.af_diag_epoch);storage.af.epoch=storage.af_diag_epoch;storage.af_diag_epoch=nil;',
        };
        const mutation = JSON.parse(await port.command(prefix + changes[scenario] + 'rcon.print(helpers.table_to_json{tick=game.tick,recipe=e.get_recipe().name,count=e.products_finished,epoch=storage.af.epoch})')) as { recipe: string; count:number; epoch:string; tick: number };
        if(scenario==='discontinuity')assert.equal(mutation.recipe, 'basic-oil-processing');
        if(scenario==='counter')assert.equal(mutation.count,10);
        // Observe the real sampler while the mutation is present, then restore
        // it before the baseline: invalidation must survive a later good state.
        const changedPage = await waitFor(`${scenario} discontinuity sampled`, async () => {
          const page = await control.measureRead(built.id, configuration.attemptId, -1);
          return page.tick > mutation.tick + 5 ? page : undefined;
        }, 10000, 100);
        assert.equal(changedPage.finished, false);
        const restored = JSON.parse(await port.command(prefix + restorations[scenario] + 'rcon.print(helpers.table_to_json{recipe=e.get_recipe().name,count=e.products_finished,epoch=storage.af.epoch,tick=game.tick})')) as { recipe: string; count:number; epoch:string; tick: number };
        const restoredTick = restored.tick;
        assert.equal(restored.recipe, 'advanced-oil-processing');
        if(scenario==='counter')assert.equal(restored.count,0);
        if(scenario==='epoch')assert.notEqual(restored.epoch,mutation.epoch);
        assert(Number.isSafeInteger(restoredTick) && restoredTick > mutation.tick);
        assert(restoredTick < Number(admitted.admittedTick) + configuration.settlingTicks);
        const page = await waitFor('invalid chain window', async () => {
          const value = await control.measureRead(built.id, configuration.attemptId, -1);
          return value.finished ? value : undefined;
        }, 15000, 100);
        assert.equal(page.samples.length, 1);
        assert(page.samples[0]!.startTick > restoredTick);
        assert.equal(page.samples[0]!.endTick - page.samples[0]!.startTick, configuration.windowTicks);
        assert.equal(page.samples[0]!.stageCoverage, 'unknown');
        assert(page.samples[0]!.contamination.includes('chain_discontinuity'));
        assert.equal(page.samples[0]!.stages?.length, 2);
        assert(page.samples[0]!.stages?.every(stage => stage.coverage === 'unknown'));
        await writeFile(path.join(evidence, `${scenario}.json`), JSON.stringify({ admitted, retry, afterConflict, mutation, changedPage, restored, page }, null, 2));
        checks.push(`${scenario}: sampled mutation invalidates local stage evidence even after restoration before scoring`);
      }
      // Terminal restoration pauses the dedicated world; host build owns the
      // next candidate and may unpause it under its ordinary control fence.
      continue;
    }
    const evaluation=await host.measure(session,candidate);
    assert.equal(evaluation.passed,false);
    assert(evaluation.reasons.includes('chain_stage_below_target'));
    assert(!evaluation.reasons.includes('chain_manifest_missing'));
    assert(!evaluation.reasons.includes('chain_stage_coverage_incomplete'));
    assert(!evaluation.reasons.includes('measurement_contaminated'));
    const samples=(await readFile(path.join(directory,'iteration-1.measurements.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as {stageCoverage:string;stages:{recipe:string;coverage:string;crafts:{numerator:string}}[]});
    assert(samples.length===1&&samples[0]!.stageCoverage==='complete');
    assert(samples[0]!.stages.every(stage=>stage.coverage==='complete'&&Number(stage.crafts.numerator)===0));
    assert.deepEqual(samples[0]!.stages.map(stage=>stage.recipe).sort(),['advanced-oil-processing','sulfur']);
    await writeFile(path.join(evidence,construction+'-evaluation.json'),JSON.stringify({evaluation,samples},null,2));
    checks.push(construction+': real host measurement covers both stages and all co-products; disconnected stock-free candidate fails without manufactured evidence');
    const inspection = await control.inspect(`${id}-1`), entities = inspection.entities as { name: string; recipe?: string; direction: number }[];
    assert(entities.some(entity => entity.name === 'oil-refinery' && entity.recipe === 'advanced-oil-processing' && entity.direction === 4));
    assert(entities.some(entity => entity.name === 'chemical-plant' && entity.recipe === 'sulfur' && entity.direction === 8));
    const fixtures = inspection.fixtures as Record<string, { kind: string; product: { name: string }; rate: number; bounded: boolean }>;
    assert.deepEqual(Object.values(fixtures).filter(value=>value.kind==='source').map(value=>value.product.name).sort(),['crude-oil','water']);
    if(construction==='character'){
      const actor=await control.actor(`${id}-1`,'builder-1');
      assert(!(actor.inventory as {name:string;count:number}[]).some(value=>['oil-refinery','chemical-plant','pipe'].includes(value.name)&&value.count));
    }
    checks.push(construction+': host build preserves recipes/directions with only declared external fixtures');
    await writeFile(path.join(evidence, `${construction}.json`), JSON.stringify({ assignment, document, inspection }, null, 2));
  }
  const furnaceRequest: ProductionRequest = { ...request, target: product('item', 'iron-plate'),
    externalInputs: [{ product: product('item', 'iron-ore'), capacity: { kind: 'unlimited' } }],
    constructionEquipment: { 'electric-furnace': 2 }, sinks: [], routes: { 'item:iron-plate': 'recipe:iron-plate' } };
  const raw: Record<string, unknown> = { ...priorAssignment, id: 'chain-furnace', comparisonSeries: 'chain-furnace', objective: 'Reconstruct installed iron plate furnace', chainRequest: furnaceRequest, construction: 'character', windowTicks: 60, windows: 1 };
  for (const field of ['ports', 'throughput', 'footprint', 'gameFingerprint', 'profileRevision']) delete raw[field];
  const furnaceAssignment = await host.resolve(raw);
  const furnaceDocument: BlueprintDocument = { schema: 1, label: 'Furnace recipe hint', description: 'Disconnected legal-character furnace regression',
    entities: [{ id: 'furnace', entityNumber: 1, name: 'electric-furnace', position: { x: 0.5, y: 3.5 }, direction: 0, quality: 'normal', recipe: 'iron-plate' },
      { id: 'furnace-b', entityNumber: 2, name: 'electric-furnace', position: { x: 6.5, y: 3.5 }, direction: 0, quality: 'normal', recipe: 'iron-plate' }],
    ports: furnaceAssignment.ports, wires: [], icons: [{ index: 1, name: 'iron-plate' }], tiles: [] };
  const furnaceHash = blueprintContentHash(furnaceDocument), furnaceDirectory = path.join(evidence, 'workshop-live', furnaceAssignment.id);
  await mkdir(furnaceDirectory, { recursive: true }); await writeFile(path.join(furnaceDirectory, `${furnaceHash}.json`), JSON.stringify(furnaceDocument));
  await host.build({ id: furnaceAssignment.id, assignment: furnaceAssignment, activeIteration: 1 , pinnedBundleHash: 'baseline' } as WorkshopSessionState,
    { sessionId: furnaceAssignment.id, iteration: 1, artifactHash: furnaceHash, assignmentRevision: 1, bundleHash: 'baseline', evidence: [] });
  const furnaceInspection = await control.inspect('chain-furnace-1'), furnaceActor = await control.actor('chain-furnace-1', 'builder-1');
  assert.equal((furnaceInspection.entities as { name: string }[]).filter(entity => entity.name === 'electric-furnace').length, 2);
  assert(!(furnaceActor.inventory as { name: string; count: number }[]).some(item => item.name === 'electric-furnace' && item.count));
  checks.push('Legal character furnace recipe hints validate without assembler setter, with exact finite furnace inventory consumed');
  await writeFile(path.join(evidence, 'furnace.json'), JSON.stringify({ assignment: furnaceAssignment, document: furnaceDocument, inspection: furnaceInspection, actor: furnaceActor }, null, 2));

  // A preload is refused before speed/pause mutation, even with the genuine
  // construction receipt and host-owned complete plan.
  const built=JSON.parse(await readFile(path.join(furnaceDirectory,furnaceHash+'.built.json'),'utf8')) as {surface:string};
  await port.command('/silent-command local e=game.surfaces['+JSON.stringify(built.surface)+'].find_entity("electric-furnace",{0.5,3.5});e.get_inventory(defines.inventory.furnace_result).insert{name="iron-plate",count=10};rcon.print("preload-ready")');
  await assert.rejects(host.measure({id:furnaceAssignment.id,assignment:furnaceAssignment,activeIteration:1, pinnedBundleHash: 'baseline' } as WorkshopSessionState,{sessionId:furnaceAssignment.id,iteration:1,artifactHash:furnaceHash,assignmentRevision:1,bundleHash: 'baseline',evidence:[]}),/chain_candidate_preload/);
  const status=await control.measureStatus('chain-furnace-1','attempt-'+(await import('../packages/core/production/graph.js')).digest('chain-furnace:1').slice(0,20));
  assert.equal(status.present,false);
  checks.push('Preloaded furnace output is rejected before measurement admission; exact attempt status remains not-admitted');

  await calibrateWorkshopBurner({host,control,port,context:component,base:priorAssignment!,evidence,checks});

  const freshFurnace = async (id: string) => {
    const assignment = await host.resolve({ ...furnaceAssignment, id, comparisonSeries:id, construction:'direct', settlingTicks:6000, requestedSpeed:{numerator:'1',denominator:'1'} });
    const directory=path.join(evidence,'workshop-live',id),document={...furnaceDocument,ports:assignment.ports},artifactHash=blueprintContentHash(document);
    await mkdir(directory,{recursive:true});await writeFile(path.join(directory,`${artifactHash}.json`),JSON.stringify(document));
    const session={id,assignment,activeIteration:1, pinnedBundleHash: 'baseline' } as WorkshopSessionState;
    const candidate={sessionId:id,iteration:1,artifactHash,assignmentRevision:1,bundleHash: 'baseline',evidence:[]};
    await host.build(session,candidate);
    const built=JSON.parse(await readFile(path.join(directory,artifactHash+'.built.json'),'utf8')) as {id:string;generation:number;surface:string;characterEvidence:null;chainMeasurement:ChainMeasurementManifest};
    return{assignment,session,candidate,built};
  };
  // Lose only acknowledgements, after the genuine engine admission. A failed
  // status read must leave the durable fence until replacement reconciles it.
  const lost=await freshFurnace('chain-lost-ack'),fenceDirectory=path.join(evidence,'lost-ack-fence');
  await port.command('/silent-command game.tick_paused=true;game.speed=0.5;rcon.print("lost-ack-held")');
  let releases=0;
  const fault=measurementAcknowledgementLoss(port);
  const faultGame=new LiveWorkshopGame(fault.port,client,life,activity=>events.push(activity),async()=>()=>{releases++;},fenceDirectory);
  await assert.rejects(faultGame.measure(lost.session,lost.built),/durable game control remains fenced/);
  const fenceFile=path.join(fenceDirectory,'workshop-measurement-fence.json'),fence=JSON.parse(await readFile(fenceFile,'utf8')) as {id:string;attemptId:string};
  // The abandoned host's retained poller stops on its first blocked read.
  // Wait for that observation before replacement uses the genuine transport;
  // otherwise both hosts can race the single RCON connection and fence file.
  await waitFor('abandoned host poller stopped',async()=>fault.state.readFailures===1?true:undefined,10000,10);
  assert.deepEqual(fault.state,{configureForwards:1,configureLosses:1,statusFailures:1,readFailures:1});assert.equal(releases,0);assert.equal(fence.id,lost.built.id);
  const active=await control.measureStatus(fence.id,fence.attemptId);assert.equal(active.present,true);assert.equal(active.finished,false);
  assert.equal(await reconcileWorkshopMeasurementFence(fenceDirectory,control),true);
  await assert.rejects(access(fenceFile));
  const reconciled=await control.measureRead(fence.id,fence.attemptId,-1);
  assert.equal(reconciled.state,'aborted');assert.equal(reconciled.finished,true);assert.deepEqual(reconciled.samples,[]);
  assert.equal((await port.command('/silent-command rcon.print(tostring(game.tick_paused)..":"..tostring(game.speed))')).trim(),'true:0.5');
  assert.deepEqual(fault.state,{configureForwards:1,configureLosses:1,statusFailures:1,readFailures:1});
  await writeFile(path.join(evidence,'lost-ack.json'),JSON.stringify({fence,active,reconciled,injection:fault.state,releases,transportFault:true,nativeEffect:true},null,2));
  checks.push('Lost configure acknowledgement retains durable host fence; exact native replacement reconciliation aborts once without duplicate admission');

  const restart=await freshFurnace('chain-save-load'),manifest=restart.built.chainMeasurement;
  const configuration={id:restart.built.id,generation:restart.built.generation,attemptId:'chain-save-load-attempt',settlingTicks:6000,windowTicks:60,windows:1,requestedSpeed:1,
    ports:restart.assignment.ports.filter(value=>value.direction==='output'&&value.required||value.direction==='byproduct').map(value=>({id:value.id,fixtureId:value.id,product:{kind:value.product.kind,name:value.product.name,quality:'normal' as const}})),
    chain:{boundaryFingerprint:manifest.boundaryFingerprint,candidateFingerprint:manifest.candidateFingerprint,stages:manifest.bindings}};
  await port.command('/silent-command game.tick_paused=true;game.speed=0.5;rcon.print("save-load-held")');
  const admitted=await control.measureConfigure(configuration),beforeSave=await control.measureRead(configuration.id,configuration.attemptId,-1);
  assert.equal(beforeSave.finished,false);assert.deepEqual(beforeSave.samples,[]);
  const save=path.join(profile.dir,'data','saves','chain-active.zip');
  await port.command('/silent-command game.tick_paused=true;game.server_save("chain-active");rcon.print("save-requested")');
  await waitFor('complete chain active save',async()=>{try{const bytes=await readFile(save);return bytes.subarray(-22,-18).equals(Buffer.from([0x50,0x4b,0x05,0x06]))?true:undefined;}catch{return undefined;}},30000,100);
  await stopProfile(profile.observerConfig);observer=false;port.close();port=undefined;await stopProfile(profile.config);
  await startServer({...profile,save});port=await waitForServer(profile);
  const restoredControl=new WorkshopControl(port),restored=await restoredControl.measureRead(configuration.id,configuration.attemptId,-1);
  assert.equal(restored.state,'invalid');assert.equal(restored.finished,true);assert.deepEqual(restored.samples,[]);assert.equal(restored.achievedSpeed,0.5);
  assert.equal((await port.command('/silent-command rcon.print(tostring(game.tick_paused)..":"..tostring(game.speed))')).trim(),'true:0.5');
  const retry=await restoredControl.measureConfigure(configuration);assert.equal(retry.reconciled,true);assert.equal(retry.admittedTick,admitted.admittedTick);
  assert.equal((await restoredControl.measureStatus(configuration.id,configuration.attemptId)).state,'invalid');
  // A replacement uses a fresh candidate and interval, never relabels the
  // restored attempt's incomplete evidence or resumes its old window.
  const replacementClient=new GameClient(port,event=>events.push(event)),replacementLife=new Lifecycle(port,replacementClient,event=>events.push(event));
  const replacementHost=new LiveWorkshopHost(evidence,{async invoke(){throw new Error('No inference permitted');},async close(){}},new LiveWorkshopGame(port,replacementClient,replacementLife,activity=>events.push(activity)));
  const freshAssignment=await replacementHost.resolve({...furnaceAssignment,id:'chain-after-load',comparisonSeries:'chain-after-load',construction:'direct',requestedSpeed:{numerator:'1',denominator:'1'}});
  const freshDirectory=path.join(evidence,'workshop-live',freshAssignment.id),freshDocument={...furnaceDocument,ports:freshAssignment.ports},freshHash=blueprintContentHash(freshDocument);
  await mkdir(freshDirectory,{recursive:true});await writeFile(path.join(freshDirectory,freshHash+'.json'),JSON.stringify(freshDocument));
  const freshSession={id:freshAssignment.id,assignment:freshAssignment,activeIteration:1, pinnedBundleHash: 'baseline' } as WorkshopSessionState,freshCandidate={sessionId:freshAssignment.id,iteration:1,artifactHash:freshHash,assignmentRevision:1,bundleHash: 'baseline',evidence:[]};
  await replacementHost.build(freshSession,freshCandidate);const freshEvaluation=await replacementHost.measure(freshSession,freshCandidate);
  assert.equal(freshEvaluation.passed,false);assert(freshEvaluation.reasons.includes('chain_stage_below_target'));assert(!freshEvaluation.reasons.includes('chain_stage_coverage_incomplete'));assert(!freshEvaluation.reasons.includes('measurement_contaminated'));
  const freshSamples=(await readFile(path.join(freshDirectory,'iteration-1.measurements.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as {startTick:number;endTick:number;stageCoverage:string});
  assert.equal(freshSamples.length,1);assert.equal(freshSamples[0]!.stageCoverage,'complete');assert(freshSamples[0]!.startTick>restored.tick);assert.equal(freshSamples[0]!.endTick-freshSamples[0]!.startTick,60);
  await writeFile(path.join(evidence,'save-load.json'),JSON.stringify({admitted,beforeSave,restored,retry,freshEvaluation,freshSamples,observerRestarted:false},null,2));
  checks.push('Active native save/load invalidates old chain interval and restores controls; replacement measures a fresh complete zero-flow window');
  await writeFile(path.join(evidence, 'events.json'), JSON.stringify(events, null, 2));
} catch (error) { failure = String(error); process.exitCode = 1; console.error(failure.slice(0, 1500)); }
finally {
  port?.close();
  try { if (observer) await stopProfile(profile.observerConfig); await stopProfile(profile.config); cleanup = !(await listProjectProcesses()).some(process => [profile.config, profile.observerConfig].includes(process.config)); }
  catch (error) { failure ??= String(error); process.exitCode = 1; }
  if (!cleanup) { failure ??= 'Owned profile cleanup unresolved'; process.exitCode = 1; }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: failure === null, checks, failure, cleanup, modelInference: false, productionAcceptance: false }, null, 2));
  console.log(JSON.stringify({ evidence, checks: checks.length, failure, cleanup }));
}
