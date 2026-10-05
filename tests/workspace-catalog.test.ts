import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { WorkshopAssignment } from '@autofactorio/contracts';
import { SqliteJournal } from '../packages/storage/src/journal.js';
import { WorkspaceCatalog } from '../packages/storage/src/workspace-catalog.js';

const context = (run: string) => ({ run, epoch: 'epoch', wallTime: '2026-09-22T12:00:00Z', gameTick: null,
  actor: null, task: null, causation: null, correlation: null, visibility: { kind: 'operator' as const } });
const assignment = (id: string, objective = 'Make circuits', comparisonSeries = 'comparison-a') =>
  ({ id, objective, comparisonSeries }) as WorkshopAssignment;

describe('project workspace catalog', () => {
  it('imports identity metadata from a long activity journal without truncating late timestamps or changing bytes', () => {
    const root=mkdtempSync(path.join(os.tmpdir(),'af-catalog-long-'));
    const file=path.join(root,'startup','dashboard-long','runtime.sqlite');
    const journal=new SqliteJournal(file);
    journal.append(context('long'),'run/created',[{entity:'runs',id:'early',value:{objective:'Early retained scenario',scenario:'01-first-shift'}}]);
    journal.close();
    const db=new Database(file);
    const insert=db.prepare('INSERT INTO events(json) VALUES(?)');
    const activity=JSON.stringify({...context('long'),version:1,type:'activity',changes:[]});
    db.transaction(()=>{for(let i=0;i<10001;i++)insert.run(activity);})();
    db.close();
    const late=new SqliteJournal(file),createdAt='2026-10-01T12:00:00Z';
    late.append({...context('long'),wallTime:createdAt},'workshop/configured',[
      {entity:'workshopSessions',id:'late',value:{id:'late',stage:'complete',assignment:assignment('late','Late retained workshop'),iterations:[]}},
    ]);
    late.close();
    const original=readFileSync(file),catalog=new WorkspaceCatalog(root);
    try {
      expect(catalog.importLegacy()).toEqual({inspected:1,registered:2});
      const group=catalog.listGroups().find(value=>value.title==='Late retained workshop')!;
      expect(catalog.listRuns(group.id)[0]?.identity.createdAt).toBe(createdAt);
      expect(catalog.importLegacy().registered).toBe(0);
      // Compare bytes natively: recursive matcher traversal dominates this >2MB fixture.
      expect(readFileSync(file).equals(original)).toBe(true);
    } finally {catalog.close();rmSync(root,{recursive:true,force:true});}
  });
  it('reads terminal summaries through the live exclusive journal and preserves historical timestamps', () => {
    const root=mkdtempSync(path.join(os.tmpdir(),'af-catalog-terminal-'));
    const directory=path.join(root,'startup','dashboard-one');
    const journal=new SqliteJournal(path.join(directory,'runtime.sqlite'));
    const catalog=new WorkspaceCatalog(root);
    let closed=false;
    try {
      catalog.beginWorkshop(directory,'container',assignment('run-one'));
      catalog.journaled('run-one');
      expect(catalog.detail('run-one',{directory,journal}).terminalAt).toBeNull();
      const terminal='2026-09-22T12:01:00Z';
      journal.append({...context('container'),wallTime:terminal},'workshop/complete',[
        {entity:'usage',id:'run-one',value:{}},
        {entity:'workshopSessions',id:'run-one',value:{id:'run-one',stage:'complete',iterations:[],finalOutcome:'no-valid-result'}},
      ]);
      journal.append({...context('container'),wallTime:'2026-09-22T12:02:00Z'},'workshop/complete',[
        {entity:'workshopSessions',id:'another-run',value:{id:'another-run',stage:'complete'}},
      ]);
      expect(catalog.detail('run-one',{directory,journal})).toMatchObject({terminalAt:terminal,lifecycle:{execution:'completed',result:'no-valid-result'}});
      journal.close();
      closed=true;
      expect(catalog.detail('run-one').terminalAt).toBe(terminal);
    } finally {catalog.close();if(!closed)journal.close();rmSync(root,{recursive:true,force:true});}
  });
  it('retains separate brief/run identities, pending crash intents and a new startup directory', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-catalog-'));
    const first = path.join(root, 'startup', 'dashboard-one'), second = path.join(root, 'startup', 'dashboard-two');
    mkdirSync(first, { recursive: true }); mkdirSync(second, { recursive: true });
    const oldJournal = new SqliteJournal(path.join(first, 'runtime.sqlite'));
    let catalog = new WorkspaceCatalog(root);
    try {
      const one = catalog.beginWorkshop(first, 'container-one', assignment('run-one'));
      expect(catalog.run('run-one')).toMatchObject({ registration: 'pending' });
      expect(() => catalog.beginWorkshop(first, 'container-one', assignment('run-one'))).toThrow('pending or interrupted');
      expect(() => catalog.beginWorkshop(first, 'container-one', assignment('run-one', 'changed'))).toThrow('collision');
      oldJournal.append(context('container-one'), 'workspace/identity-recorded', [
        { entity: 'workspaceGroups', id: one.group.id, value: { ...one.group } },
        { entity: 'workspaceRuns', id: one.run.id, value: { ...one.run } },
      ]);
      catalog.syncCurrent(first, 'container-one', oldJournal);
      catalog.journaled(one.run.id);
      catalog.close(); catalog = new WorkspaceCatalog(root);
      const two = catalog.beginWorkshop(second, 'container-two', assignment('run-two', 'Make circuits', 'comparison-b'), one.group.id);
      expect(two.group.id).toBe(one.group.id);
      expect(two.run.assignmentHash).not.toBe(one.run.assignmentHash);
      expect(catalog.listRuns(one.group.id).map(row => row.identity.id)).toEqual(['run-one', 'run-two']);
      expect(catalog.run(one.run.id)?.availability).toBe('available');
    } finally { catalog.close(); oldJournal.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it('imports scenario and hosted workshop from all retained roots without changing journals or duplicating records', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-catalog-legacy-'));
    let catalog: WorkspaceCatalog | undefined;
    try {
      for (const folder of ['startup/dashboard-a', 'dashboard/run-b', 'scenarios/runs/run-c']) {
        const directory = path.join(root, folder); mkdirSync(directory, { recursive: true });
        const journal = new SqliteJournal(path.join(directory, 'runtime.sqlite'));
        const runtimeRun = folder.replaceAll('/', '-');
        journal.append(context(runtimeRun), 'run/created', [{ entity: 'runs', id: runtimeRun,
          value: { objective: 'Sustain red science', scenario: '01-first-shift', scenarioVersion: 'v2' } }]);
        journal.append(context(runtimeRun), 'workshop/configured', [{ entity: 'workshopSessions', id: `workshop-${runtimeRun}`,
          value: { id: `workshop-${runtimeRun}`, assignment: assignment(`workshop-${runtimeRun}`), iterations: [{ id: 'attempt-one' }] } }]);
        journal.close();
      }
      const journalFile = path.join(root, 'scenarios', 'runs', 'run-c', 'runtime.sqlite');
      const original = readFileSync(journalFile);
      catalog = new WorkspaceCatalog(root);
      expect(catalog.importLegacy()).toEqual({ inspected: 3, registered: 6 });
      expect(catalog.importLegacy()).toEqual({ inspected: 3, registered: 0 });
      const groups = catalog.listGroups();
      expect(groups).toHaveLength(6);
      expect(groups.filter(group => group.scenario?.version === 'v2')).toHaveLength(3);
      const workshop = groups.find(group => group.title === 'Make circuits')!;
      expect(catalog.listRuns(workshop.id)[0]?.identity.kind).toBe('workshop');
      expect(readFileSync(journalFile)).toEqual(original);
      rmSync(path.join(root, 'dashboard', 'run-b', 'runtime.sqlite'));
      const missing = catalog.listGroups().flatMap(group => catalog!.listRuns(group.id)).filter(row => row.availability === 'journal-missing');
      expect(missing).toHaveLength(2);
      mkdirSync(path.join(root, 'startup', 'dashboard-missing'));
      expect(catalog.importLegacy().registered).toBe(1);
      expect(catalog.listGroups().some(group => group.title === 'Unavailable retained dashboard')).toBe(true);
    } finally { catalog?.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it('does not synthesize a legacy scenario beside an imported native scenario', () => {
    const root=mkdtempSync(path.join(os.tmpdir(),'af-catalog-native-scenario-'));
    const directory=path.join(root,'scenarios','runs','run-native');mkdirSync(directory,{recursive:true});
    const journal=new SqliteJournal(path.join(directory,'runtime.sqlite'));
    let catalog=new WorkspaceCatalog(root);
    try{
      const identity=catalog.beginScenario(directory,'runtime-native','scenario-native',{scenario:'01-first-shift',scenarioVersion:'v2',objective:'Sustain red science'});
      journal.append(context('runtime-native'),'workspace/identity-recorded',[
        {entity:'workspaceGroups',id:identity.group.id,value:{...identity.group}},
        {entity:'workspaceRuns',id:identity.run.id,value:{...identity.run}}]);
      journal.append(context('runtime-native'),'scenario/origin',[{entity:'runs',id:'scenario-origin',value:{scenario:'01-first-shift',scenarioVersion:'v2',objective:'Sustain red science'}}]);
      journal.close();
      catalog.close();catalog=new WorkspaceCatalog(root);
      catalog.importLegacy();
      const runs=catalog.listGroups().flatMap(group=>catalog.listRuns(group.id));
      expect(runs.map(row=>row.identity.id)).toEqual(['scenario-native']);
      expect(runs[0]?.identity.kind).toBe('scenario');
    }finally{catalog.close();rmSync(root,{recursive:true,force:true});}
  });

  it('resolves imported workshop details and evidence through immutable original session identities', () => {
    const root=mkdtempSync(path.join(os.tmpdir(),'af-catalog-legacy-details-'));
    const directory=path.join(root,'startup','dashboard-legacy');
    const journal=new SqliteJournal(path.join(directory,'runtime.sqlite'));
    const catalog=new WorkspaceCatalog(root);
    const sessionId='original-session',attemptId='original-attempt';
    const iteration={id:attemptId,number:1,evaluation:{valid:true,passed:true},feedback:'Retained measured success'};
    journal.append(context('container'),'workshop/configured',[{entity:'workshopSessions',id:sessionId,
      value:{id:sessionId,assignment:assignment(sessionId),stage:'complete',iterations:[iteration],bestIteration:1,finalOutcome:'best-valid'}}]);
    journal.append(context('container'),'workshop/activity',[{entity:'workshopOperations',id:'original-operation',value:{id:'original-operation',sessionId,category:'scorer',status:'complete'}}]);
    journal.append(context('container'),'workshop/usage',[{entity:'usage',id:sessionId,value:{totalTokens:42,sessionId}}]);
    journal.append(context('container'),'workshop/learning',[{entity:'learningOutcomes',id:`${sessionId}-learning`,value:{sessionId,decision:'no-change'}}]);
    journal.append(context('container'),'workshop/iteration-scored',[{entity:'workshopIterations',id:attemptId,value:{...iteration,sessionId}}]);
    journal.append(context('container'),'workshop/complete',[{entity:'workshopSessions',id:sessionId,
      value:{id:sessionId,assignment:assignment(sessionId),stage:'complete',iterations:[iteration],bestIteration:1,finalOutcome:'best-valid'}}]);
    journal.append(context('container'),'workshop/complete',[{entity:'workshopSessions',id:'unrelated',value:{id:'unrelated',assignment:assignment('unrelated','Other brief'),stage:'complete',iterations:[]}}]);
    journal.close();
    try {
      expect(catalog.importLegacy().registered).toBe(2);
      const group=catalog.listGroups().find(value=>value.title==='Make circuits')!;
      const run=catalog.listRuns(group.id)[0]!.identity;
      expect(run.id).not.toBe(sessionId);
      expect(catalog.workshopSourceId(run.id)).toBe(sessionId);
      expect(catalog.detail(run.id)).toMatchObject({session:{id:sessionId,iterations:[iteration]},usage:{totalTokens:42},
        learningOutcome:{decision:'no-change'},operations:[{id:'original-operation',sessionId}],terminalAt:context('container').wallTime,
        lifecycle:{execution:'completed',evaluation:'passed',result:'best-valid'}});
      expect(catalog.pageAttempts(run.id).items[0]).toMatchObject({id:`${run.id}:1`,sourceId:attemptId});
      const events=catalog.pageEvents(run.id).items;
      expect(events).toHaveLength(6);
      expect(events.some(event=>event.changes.some(change=>change.id==='unrelated'))).toBe(false);
      expect(catalog.importLegacy().registered).toBe(0);
      expect(catalog.detail(run.id).session?.id).toBe(sessionId);
    } finally {catalog.close();rmSync(root,{recursive:true,force:true});}
  });

  it('rejects sources and legacy links outside the project runtime', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-catalog-safe-'));
    const outside = mkdtempSync(path.join(os.tmpdir(), 'af-catalog-outside-'));
    const catalog = new WorkspaceCatalog(root);
    try {
      expect(() => catalog.registerCurrent(outside, 'run')).toThrow('outside project runtime');
      mkdirSync(path.join(root, 'startup'));
      symlinkSync(outside, path.join(root, 'startup', 'dashboard-escape'), 'junction');
      expect(() => catalog.importLegacy()).toThrow('escapes project runtime');
      expect(existsSync(path.join(outside, 'runtime.sqlite'))).toBe(false);
      writeFileSync(path.join(outside, 'untouched'), 'yes');
    } finally { catalog.close(); rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
  });

  it('pages a two-brief, five-run, 21-attempt history with scoped cursors and evidence', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-catalog-pages-'));
    const directory = path.join(root, 'startup', 'dashboard-new'); mkdirSync(directory, { recursive: true });
    const journal = new SqliteJournal(path.join(directory, 'runtime.sqlite'));
    const catalog = new WorkspaceCatalog(root);
    let journalOpen = true;
    try {
      const groups: string[] = [];
      const runs: string[] = [];
      for (let runNumber = 1; runNumber <= 5; runNumber++) {
        const objective = runNumber <= 3 ? 'Make 15 red science per minute' : 'Make 15 green science per minute';
        const runId = `run-${runNumber}`;
        const history = catalog.beginWorkshop(directory, 'container', assignment(runId, objective, `series-${runNumber}`),
          runNumber === 1 || runNumber === 4 ? null : groups.at(-1)!);
        if (runNumber === 1 || runNumber === 4) groups.push(history.group.id);
        runs.push(history.run.id);
        journal.append(context('container'), 'workspace/identity-recorded', [
          { entity: 'workspaceGroups', id: history.group.id, value: { ...history.group } },
          { entity: 'workspaceRuns', id: history.run.id, value: { ...history.run } },
        ]);
        catalog.journaled(runId);
        for (let attempt = 1; attempt <= (runNumber <= 3 ? 5 : 3); attempt++) {
          catalog.recordAttempt({ schema: 1, id: `${runId}:${attempt}`, runId, ordinal: attempt, sourceId: `${runId}:${attempt}`, coverage: 'recorded' });
          journal.append(context('container'), 'workshop/iteration-started', [{ entity: 'workshopIterations', id: `${runId}:${attempt}`,
            value: { id: `${runId}:${attempt}`, sessionId: runId, number: attempt } }]);
        }
      }
      expect(catalog.pageGroups(1).next).toBeTruthy();
      const first = catalog.pageGroups(1);
      expect(catalog.pageGroups(1, first.next!).items).toHaveLength(1);
      const firstRuns = catalog.pageRuns(groups[0]!, 2);
      expect(firstRuns.items.map(row => row.identity.id)).toEqual(['run-1', 'run-2']);
      expect(catalog.pageRuns(groups[0]!, 2, firstRuns.next!).items.map(row => row.identity.id)).toEqual(['run-3']);
      expect(() => catalog.pageRuns(groups[1]!, 2, firstRuns.next!)).toThrow('scope mismatch');
      expect(catalog.pageAttempts('run-1', 2).items.map(value => value.ordinal)).toEqual([1, 2]);
      const next = catalog.pageAttempts('run-1', 2).next!;
      expect(catalog.pageAttempts('run-1', 2, next).items.map(value => value.ordinal)).toEqual([3, 4]);
      expect(() => catalog.pageAttempts('run-2', 2, next)).toThrow('scope mismatch');
      expect(runs.flatMap(runId => catalog.listAttempts(runId))).toHaveLength(21);
      const events = catalog.pageEvents('run-1', 3, undefined, { directory, journal });
      expect(events.items).toHaveLength(3);
      expect(events.items.every(event => event.changes.every(change => change.id.startsWith('run-1') || change.id.startsWith('brief-')))).toBe(true);
      expect(() => catalog.pageEvents('run-2', 3, events.next!, { directory, journal })).toThrow('scope mismatch');
      journal.close(); journalOpen = false;
      rmSync(path.join(directory, 'runtime.sqlite'));
      expect(catalog.pageEvents('run-1', 3, undefined, { directory, journal }).unavailable).toBe('journal-missing');
    } finally { catalog.close(); if (journalOpen) journal.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it('admits one experiment before work and preserves request identity across replacement', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-catalog-owner-'));
    let catalog = new WorkspaceCatalog(root);
    try {
      expect(catalog.owner()).toBeNull(); // Idle dashboard infrastructure is not an experiment.
      const first = catalog.admit('workshop-one', 'workshop', { objective: 'Make circuits' });
      expect(first).toMatchObject({ newlyAdmitted: true, request: { state: 'preparing' } });
      expect(catalog.admit('workshop-one', 'workshop', { objective: 'Make circuits' })).toMatchObject({ newlyAdmitted: false });
      expect(() => catalog.admit('workshop-one', 'workshop', { objective: 'Make belts' })).toThrow('collision');
      expect(() => catalog.admit('scenario-two', 'scenario', { scenario: 'S1' })).toThrow('owned by workshop-one');
      catalog.transitionRequest('workshop-one', 'active');
      catalog.close(); catalog = new WorkspaceCatalog(root);
      expect(catalog.owner()).toMatchObject({ id: 'workshop-one', state: 'active' });
      catalog.transitionRequest('workshop-one', 'held', 'checkpoint unresolved');
      expect(() => catalog.admit('scenario-two', 'scenario', { scenario: 'S1' })).toThrow('owned by workshop-one');
      catalog.transitionRequest('workshop-one', 'completed');
      expect(catalog.admit('scenario-two', 'scenario', { scenario: 'S1' }).newlyAdmitted).toBe(true);
    } finally { catalog.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('transfers only the exact active scenario owner after a verified checkpoint handoff', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-catalog-transfer-'));
    const catalog = new WorkspaceCatalog(root);
    try {
      catalog.admit('scenario-one', 'scenario', { scenario: 'S1' });
      expect(() => catalog.transferScenario('different', 'scenario-two', { scenario: 'S1' })).toThrow('not safely active');
      catalog.transitionRequest('scenario-one', 'held', 'unknown command');
      expect(() => catalog.transferScenario('scenario-one', 'scenario-two', { scenario: 'S1' })).toThrow('not safely active');
      catalog.transitionRequest('scenario-one', 'active');
      expect(catalog.transferScenario('scenario-one', 'scenario-two', { scenario: 'S1' })).toMatchObject({ state: 'preparing' });
      expect(catalog.owner()?.id).toBe('scenario-two');
      expect(catalog.request('scenario-one')).toMatchObject({ state: 'cancelled', reason: 'reset_successor:scenario-two' });
      expect(() => catalog.admit('workshop-three', 'workshop', {})).toThrow('owned by scenario-two');
    } finally { catalog.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('reconciles exact preparation absence and terminal receipts, but retains unknown effects across dashboard replacement', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-catalog-recovery-'));
    const old = path.join(root, 'startup', 'dashboard-old'), current = path.join(root, 'startup', 'dashboard-new');
    mkdirSync(old, { recursive: true }); mkdirSync(current, { recursive: true });
    const oldFile = path.join(old, 'runtime.sqlite');
    let oldJournal: SqliteJournal | null = new SqliteJournal(oldFile);
    const currentJournal = new SqliteJournal(path.join(current, 'runtime.sqlite'));
    const catalog = new WorkspaceCatalog(root);
    try {
      catalog.admit('absent', 'workshop', { id: 'absent' }, old);
      oldJournal.close(); oldJournal = null;
      expect(catalog.reconcileStartup(current, 'current', currentJournal)).toMatchObject({ state: 'failed', reason: 'preparation_not_admitted' });
      expect(catalog.owner()).toBeNull();
      catalog.admit('unknown', 'workshop', { id: 'unknown' }, old);
      oldJournal = new SqliteJournal(oldFile);
      oldJournal.append(context('old'), 'workshop/configured', [{ entity: 'workshopSessions', id: 'unknown',
        value: { id: 'unknown', stage: 'held', stopReason: 'provider outcome unknown', operationIntents: { design: { status: 'unknown' } } } }]);
      const budgetDirectory = path.join(old, 'workshop-live', 'unknown'); mkdirSync(budgetDirectory, { recursive: true });
      const budgetFile = path.join(budgetDirectory, 'provider-budget.json');
      const budget = JSON.stringify({ workshop: { turns: 1, tools: 8 }, invocations: { design: { status: 'unknown' } } });
      writeFileSync(budgetFile, budget);
      const before = oldJournal.cursor();
      oldJournal.close(); oldJournal = null;
      expect(catalog.reconcileStartup(current, 'current', currentJournal)).toMatchObject({ state: 'held', reason: 'unresolved_effect_receipt' });
      expect(catalog.owner()?.id).toBe('unknown');
      oldJournal = new SqliteJournal(oldFile);
      expect(oldJournal.cursor()).toBe(before);
      expect(readFileSync(budgetFile, 'utf8')).toBe(budget);
      oldJournal.append(context('old'), 'workshop/stopped', [{ entity: 'workshopSessions', id: 'unknown',
        value: { id: 'unknown', stage: 'stopped', stopReason: 'operator_stop', operationIntents: { design: { status: 'acknowledged' } } } }]);
      writeFileSync(budgetFile, JSON.stringify({ workshop: { turns: 1, tools: 8 }, invocations: { design: { status: 'complete' } } }));
      oldJournal.close(); oldJournal = null;
      expect(catalog.reconcileStartup(current, 'current', currentJournal)).toMatchObject({ state: 'cancelled' });
      expect(catalog.owner()).toBeNull();
      oldJournal = new SqliteJournal(oldFile);
      expect(oldJournal.events().filter(event => event.type.includes('activation') || event.type.includes('library'))).toEqual([]);
    } finally { catalog.close(); currentJournal.close(); oldJournal?.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
