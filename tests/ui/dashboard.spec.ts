import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dashboardFixture } from '../../scripts/dev/dashboard-fixture.js';
import { dashboard } from '../../apps/runtime/http.js';
import { LiveWorkshopHost } from '../../apps/runtime/workshop-live-host.js';
import type { WorkshopGame, WorkshopInference } from '../../apps/runtime/workshop-live-host.js';
import type { WorkshopEvaluationReport } from '@autofactorio/contracts';
import { WorkshopEffectOutcomeError } from '../../packages/core/workshop/runtime.js';
import { WorkspaceCatalog } from '../../packages/storage/src/workspace-catalog.js';
import { effectReceipt } from '@autofactorio/contracts';
import { SqliteJournal } from '../../packages/storage/src/journal.js';
import { WorkshopInvocationRecorder } from '../../apps/runtime/workshop-invocation.js';

async function waitForWorkshopOptions(page:Page){
  // An available launch button no longer supplies Playwright's implicit wait for setup readiness.
  await expect(page.getByLabel('Session model').getByRole('option',{name:'Astra',exact:true})).toHaveCount(1);
}

function productionWorkshopHost(directory:string,buildFailure:string|null=null){
  const inference:WorkshopInference={async invoke(_session,role,_selection,observation){if(role==='workshop-designer'){const assignment=(observation as {assignment:{ports:unknown[]}}).assignment;return JSON.stringify({schema:1,label:'Managed production host cell',description:'Production host composed with acceptance adapters',entities:[{id:'assembler',entityNumber:1,name:'assembling-machine-1',position:{x:0,y:0},direction:0,quality:'normal',recipe:'electronic-circuit'}],wires:[],ports:assignment.ports,icons:[{index:1,name:'electronic-circuit'}],tiles:[]});}return role==='workshop-scorer'?JSON.stringify({feedback:'Measured production-host candidate'}):JSON.stringify({decision:'no-change',reason:'No repeated failure',evidence:['valid-attempts']});},cancel:id=>effectReceipt(`inference:${id}`,'cancelled'),async close(){}};
  const game:WorkshopGame={async resolveProfile(profileId,product){return{gameVersion:'2.0.77',mods:{base:'2.0.77'},profileId,profileRevision:1,surface:'nauvis',technologies:['automation','electronics'],allowedEquipment:['assembling-machine-1','transport-belt','inserter','small-electric-pole'],modules:[],beacons:[],recipe:{id:product,category:'crafting',energy:0.5,ingredients:[{type:'item',name:'iron-plate',amount:1},{type:'item',name:'copper-cable',amount:3}],products:[{type:'item',name:product,amount:1}]},machine:'assembling-machine-1'};},async build(session){if(buildFailure)throw new WorkshopEffectOutcomeError('failed',buildFailure);return{id:`${session.id}-${session.activeIteration}`,generation:1,surface:'af-ui-production',characterEvidence:session.assignment.construction==='character'?['game-receipt:ui-character']:null};},async measure(session):Promise<WorkshopEvaluationReport>{const rule=session.assignment.throughput[0]!,port=session.assignment.ports.find(value=>value.id===rule.portId)!,measured=String((session.activeIteration??1)*60);return{schema:1,attemptId:`${session.id}:${session.activeIteration}`,valid:true,passed:true,reasons:[],ports:[{portId:port.id,windows:Array.from({length:rule.windows},(_,index)=>({index,required:{numerator:'1',denominator:'1'},productionLower:{numerator:measured,denominator:'1'},deliveryLower:{numerator:measured,denominator:'1'},passed:true,reasons:[]}))}],evidence:['production-host-game-adapter']};},cancel:id=>effectReceipt(`game:${id}`,'cancelled')};
  return Object.assign(new LiveWorkshopHost(directory,inference,game),{profileReader:(profileId:string)=>game.resolveProfile(profileId,'electronic-circuit')});
}

test('operator watches two roles, inspects evidence, steers, controls and reopens the browser', async ({ browser }) => {
  const f = await dashboardFixture(mkdtempSync(path.join(os.tmpdir(), 'af-ui-')), true);
  const server = dashboard(f.operator); const origin = await server.listen(); const stop = f.operator.start(100);
  const context = await browser.newContext(); let page = await context.newPage();
  const url = origin;
  try {
    await page.goto(url+'/scenarios'); await expect(page.getByRole('heading', { name: 'Control room.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'foreman', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: 'engineer', exact: true })).toBeVisible();
    await page.locator('.agent').filter({ has: page.getByRole('heading', { name: 'foreman', exact: true }) }).getByRole('button').click(); await expect(page.locator('.detail pre')).toContainText('foreman');
    await page.getByLabel('Advice', { exact: true }).fill('Inspect copper before committing the layout.'); await page.getByRole('button', { name: 'Send advice' }).click();
    await expect(page.locator('.intervention')).toContainText('received');
    await expect(page.getByTestId('run-accounting')).toContainText('Assisted run');
    await page.getByRole('button', { name: 'pause', exact: true }).click(); await expect(page.locator('.controlbar .badge')).toHaveText('paused');
    await page.getByRole('button', { name: 'resume', exact: true }).click(); await expect(page.locator('.controlbar .badge')).toHaveText('running');
    const cursor = f.runtime.journal.cursor(); await page.close();
    f.c.activity('engineer', 'explanation', { text: 'Continued while the browser was closed.' }); await f.operator.poll();
    expect(f.runtime.journal.cursor()).toBeGreaterThan(cursor); expect(f.operator.state().status).toBe('running');
    page = await context.newPage(); await page.goto(url+'/scenarios'); await expect(page.locator('.intervention')).toContainText('Inspect copper');
    const sequence = f.runtime.journal.events().find(e => JSON.stringify(e).includes('Continued while'))!.sequence;
    await expect(page.locator('.event').filter({ hasText: '#' + sequence })).toHaveCount(1);
    f.disconnect(); await expect(page.locator('.controlbar .badge')).toHaveText('disconnected');
    await expect(page.locator('.controlbar')).toContainText('Cancellation unconfirmed');
    await page.screenshot({ path: '.runtime/ui-dashboard-disconnected.png', fullPage: true });
    f.disconnect(false); await page.getByRole('button', { name: 'stop', exact: true }).click(); await expect(page.locator('.controlbar .badge')).toHaveText('stopped');
    await page.screenshot({ path: '.runtime/ui-dashboard.png', fullPage: true });
  } finally { await context.close(); await stop(); await server.close(); f.close(); }
});

test('all documented role states remain distinct in deterministic UI fixtures', async ({ page }) => {
  const f = await dashboardFixture(mkdtempSync(path.join(os.tmpdir(), 'af-ui-states-')));
  const server = dashboard(f.operator); const origin = await server.listen();
  try {
    const states = ['reasoning', 'executing', 'waiting-dependency', 'waiting-game', 'waiting-user', 'blocked-usage', 'disconnected', 'completed', 'failed'];
    for (const status of states) f.runtime.record('agent/status-fixture', [{ entity: 'agents', id: status, value: { ...f.c.agent('engineer'), id: status, status, assignment: null, synthetic: true } }]);
    await page.goto(origin + '/scenarios#cap=' + server.capability);
    for (const label of ['Reasoning', 'Executing', 'Waiting for dependency', 'Waiting for game', 'Awaiting user input', 'Blocked by usage', 'Disconnected', 'Completed', 'Failed']) await expect(page.locator('.agent .badge').filter({ hasText: new RegExp('^' + label + '$') }).first()).toBeVisible();
    const t = f.c.budget.admit('engineer'); f.c.bind('engineer', 'unacknowledged', t.id, async () => {});
    await page.getByRole('button', { name: 'pause', exact: true }).click();
    await expect(page.locator('.controlbar .badge')).toHaveText('unconfirmed');
    await expect(page.locator('.controlbar')).toContainText('Inference unconfirmed');
    f.state.production = {}; f.c.finish(t.id, true); await f.operator.poll();
    await expect(page.locator('.measurement')).toContainText('Telemetry unavailable');
  } finally { await server.close(); f.close(); }
});

test('workshop surfaces asynchronous failure reasons and keeps the evidence inspector current',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-workshop-failure-')),f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root),server=dashboard(f.operator,undefined,{workspaceCatalog:catalog,managedModels:[{id:'gpt-6-astra',displayName:'Astra',efforts:['low']}],workshopHost:productionWorkshopHost(f.runtime.directory,'character actor disconnected')});
  const origin=await server.listen();
  try{await page.goto(origin+'/workshop');const panel=page.getByTestId('workshop'),response=page.waitForResponse(value=>value.url().endsWith('/api/workshop/launch'));await waitForWorkshopOptions(page);await panel.getByRole('button',{name:'Launch workshop'}).click();expect((await response).status()).toBe(202);
    await expect(page).toHaveURL(/\/history\//);await expect(page.locator('.workspace-page')).toContainText('character actor disconnected');
    const session=f.runtime.journal.list<{operationIntents:Record<string,{status:string;failure?:string}>}>(f.runtime.run,'workshopSessions')[0]!;
    expect(Object.values(session.operationIntents)).toContainEqual(expect.objectContaining({status:'failed',failure:expect.stringContaining('character actor disconnected')}));
  }finally{await server.close();catalog.close();f.close();}
});

test('workshop setup restores its draft and run detail controls checkpoints across navigation', async ({ browser }) => {
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-workshop-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  const host=productionWorkshopHost(f.runtime.directory);
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog,managedModels:[{id:'gpt-6-astra',displayName:'Astra',efforts:['low','medium']},{id:'gpt-5.6-sol',displayName:'Sol',efforts:['medium']}],workshopHost:host,profileReader:host.profileReader});
  const origin=await server.listen(),context=await browser.newContext(),page=await context.newPage();
  try{
    await page.goto(origin+'/workshop');const panel=page.getByTestId('workshop');
    await expect(panel.getByRole('heading',{name:'Design, prove, preserve.'})).toBeVisible();
    await expect(panel).toContainText('Permitted equipment: assembling-machine-1');
    await panel.getByLabel('Construction').selectOption('character');
    await panel.getByText('Advanced settings').click();
    await panel.getByLabel('Designer model').selectOption('gpt-6-astra');
    await panel.getByLabel('Designer effort').selectOption('medium');
    await panel.getByLabel('Scorer model').selectOption('gpt-5.6-sol');
    await panel.getByLabel('afterScore').check();
    await panel.getByLabel('Preset name').fill('Five character attempts');
    await panel.getByRole('button',{name:'Save preset'}).click();
    await expect(panel.getByLabel('Load preset')).toContainText('five-character-attempts');
    await page.reload();await expect(page.getByTestId('workshop').getByLabel('Construction')).toHaveValue('character');
    await expect(page.getByTestId('workshop').getByLabel('Designer effort')).toHaveValue('medium');
    await waitForWorkshopOptions(page);await page.getByTestId('workshop').getByRole('button',{name:'Launch workshop'}).click();
    await expect(page).toHaveURL(/\/history\//);
    await expect(page.locator('.workspace-page')).toContainText('Waiting for you');
    const session=f.runtime.journal.list<{id:string;stage:string;assignment:Record<string,unknown>}>(f.runtime.run,'workshopSessions')[0]!;
    expect(session.assignment).toMatchObject({construction:'character',iterations:{attempts:5},models:{overrides:{designer:{reasoningEffort:'medium'},scorer:{modelId:'gpt-5.6-sol'}}}});
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await expect.poll(()=>f.runtime.journal.get<{activeIteration:number;stage:string}>(f.runtime.run,'workshopSessions',session.id)).toMatchObject({activeIteration:2,stage:'checkpoint'});
    await page.getByRole('button',{name:'Finish after this attempt'}).click();
    await expect.poll(()=>f.runtime.journal.get<{stage:string}>(f.runtime.run,'workshopSessions',session.id)?.stage).toBe('complete');
    await page.getByRole('link',{name:'Run History'}).click();await expect(page.locator('.history-row').first()).toContainText('create 15 green circuits per second');
    await page.locator('a.history-row').first().click();await expect(page).toHaveURL(new RegExp(`/history/${session.id}$`));
    await page.reload();await expect(page.getByRole('heading',{name:/Workshop/})).toBeVisible();
    await page.goBack();await expect(page.getByRole('heading',{name:'Briefs, scenarios and runs'})).toBeVisible();
    await page.goForward();await expect(page).toHaveURL(new RegExp(`/history/${session.id}$`));
    await page.getByRole('link',{name:'Run History'}).click();
    await page.getByRole('button',{name:'Run this brief again'}).click();
    await expect(page.getByTestId('workshop').getByLabel('Construction')).toHaveValue('character');
    const existingSessionCount=f.runtime.journal.list(f.runtime.run,'workshopSessions').length;
    await page.evaluate(()=>{const key='autofactorio.workshop.draft.v1',saved=JSON.parse(localStorage.getItem(key)!) as {values:{model:string;effort:string;profile:string}};saved.values.model='retired-model';saved.values.effort='low';saved.values.profile='starter-assembly';localStorage.setItem(key,JSON.stringify(saved));});
    await page.reload();await expect(page.getByTestId('workshop')).toContainText('retired-model/low is unavailable');
    const launch=page.getByRole('button',{name:'Launch workshop'});await expect(launch).toBeEnabled();await launch.click();
    await expect(page.getByRole('alert').filter({hasText:'Choose an available session model'})).toBeVisible();
    await expect(page.getByLabel('Session model')).toBeFocused();expect(f.runtime.journal.list(f.runtime.run,'workshopSessions')).toHaveLength(existingSessionCount);
    await page.evaluate(()=>{const key='autofactorio.workshop.draft.v1',saved=JSON.parse(localStorage.getItem(key)!) as {values:Record<string,string>};saved.values.model='gpt-6-astra';saved.values.effort='ultra';saved.values.profile='starter-assembly';localStorage.setItem(key,JSON.stringify(saved));});
    await page.reload();await waitForWorkshopOptions(page);await page.getByRole('button',{name:'Launch workshop'}).click();
    await expect(page.getByRole('alert').filter({hasText:'Choose an available session effort'})).toBeVisible();await expect(page.getByLabel('Session effort')).toBeFocused();expect(f.runtime.journal.list(f.runtime.run,'workshopSessions')).toHaveLength(existingSessionCount);
    await page.evaluate(()=>{const key='autofactorio.workshop.draft.v1',saved=JSON.parse(localStorage.getItem(key)!) as {values:Record<string,string>};saved.values.effort='medium';saved.values.profile='retired-profile';localStorage.setItem(key,JSON.stringify(saved));});
    await page.reload();await waitForWorkshopOptions(page);await page.getByRole('button',{name:'Launch workshop'}).click();
    await expect(page.getByRole('alert').filter({hasText:'Choose an available capability profile'})).toBeVisible();await expect(page.getByLabel('Capability profile')).toBeFocused();expect(f.runtime.journal.list(f.runtime.run,'workshopSessions')).toHaveLength(existingSessionCount);
    await page.evaluate(()=>{const key='autofactorio.workshop.draft.v1',saved=JSON.parse(localStorage.getItem(key)!) as {values:Record<string,string>};saved.values.profile='starter-assembly';saved.values.designerModel='retired-model';saved.values.designerEffort='low';localStorage.setItem(key,JSON.stringify(saved));});
    await page.reload();await waitForWorkshopOptions(page);await page.getByRole('button',{name:'Launch workshop'}).click();
    await expect(page.getByRole('alert').filter({hasText:'Designer model is unavailable'})).toBeVisible();await expect(page.getByLabel('Designer model')).toBeFocused();
    await expect(page.locator('details.advanced-options')).toHaveAttribute('open','');expect(f.runtime.journal.list(f.runtime.run,'workshopSessions')).toHaveLength(existingSessionCount);
    await page.getByRole('button',{name:'Reset saved setup'}).click();
    await expect(panel.locator('textarea')).toHaveValue('create 15 green circuits per second');
    await expect(panel.getByLabel('Session model')).toHaveValue('gpt-6-astra');await expect(panel.getByLabel('Session effort')).toHaveValue('medium');
    await expect(panel.getByRole('button',{name:'Launch workshop'})).toBeEnabled();await waitForWorkshopOptions(page);await panel.getByRole('button',{name:'Launch workshop'}).click();await expect(page).toHaveURL(/\/history\//);
    const resetId=new URL(page.url()).pathname.split('/').at(-1)!;
    await expect.poll(()=>f.runtime.journal.get<{id:string;assignment:Record<string,unknown>}>(f.runtime.run,'workshopSessions',resetId)).toMatchObject({id:resetId,assignment:{objective:'create 15 green circuits per second'}});
    const resetSession=f.runtime.journal.get<{id:string;assignment:Record<string,unknown>}>(f.runtime.run,'workshopSessions',resetId)!;
    expect(resetSession.assignment).toMatchObject({objective:'create 15 green circuits per second',source:{numericTargetText:'15 per second'},models:{sessionDefault:{modelId:'gpt-6-astra',reasoningEffort:'medium'}}});
  }finally{await context.close();await server.close();catalog.close();f.close();}
});

test('a second tab cannot silently replace local setup edits',async({browser})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-draft-tabs-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog,managedModels:[{id:'gpt-6-astra',displayName:'Astra',efforts:['low']}],workshopHost:productionWorkshopHost(f.runtime.directory)});
  const origin=await server.listen(),context=await browser.newContext(),first=await context.newPage();
  try{
    await first.goto(origin+'/workshop');
    await first.locator('textarea').fill('First tab local edit');
    await expect.poll(()=>first.evaluate(()=>localStorage.getItem('autofactorio.workshop.draft.v1'))).toContain('First tab local edit');
    const second=await context.newPage();await second.goto(origin+'/workshop');
    await second.locator('textarea').fill('Second tab saved edit');
    await expect(first.getByTestId('workshop')).toContainText('Setup changed in another tab');
    await expect(first.locator('textarea')).toHaveValue('First tab local edit');
    const launch=first.getByRole('button',{name:'Launch workshop'});await expect(launch).toBeEnabled();await launch.click();
    await expect(first.getByRole('alert').filter({hasText:'Reset saved setup or load the other tab settings'})).toBeVisible();
    await expect(first.locator('[data-launch-field="setup"]')).toBeFocused();expect(f.runtime.journal.list(f.runtime.run,'workshopSessions')).toHaveLength(0);
    await first.getByRole('button',{name:'Load other tab settings'}).click();
    await expect(first.locator('textarea')).toHaveValue('Second tab saved edit');
  }finally{await context.close();await server.close();catalog.close();f.close();}
});

test('fresh setup admits the Astra preferred medium default brief',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-fresh-default-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root),host=productionWorkshopHost(f.runtime.directory);
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog,managedModels:[{id:'gpt-5.6-sol',displayName:'Sol',efforts:['low','medium']},{id:'gpt-6-astra',displayName:'Astra',efforts:['low','medium']}],workshopHost:host,profileReader:host.profileReader}),origin=await server.listen();
  try{await page.goto(origin+'/workshop');const panel=page.getByTestId('workshop');
    await expect(panel.locator('textarea')).toHaveValue('create 15 green circuits per second');await expect(panel.getByLabel('Session model')).toHaveValue('gpt-6-astra');await expect(panel.getByLabel('Session effort')).toHaveValue('medium');
    await waitForWorkshopOptions(page);await panel.getByRole('button',{name:'Launch workshop'}).click();await expect(page).toHaveURL(/\/history\//);
    const id=new URL(page.url()).pathname.split('/').at(-1)!;
    await expect.poll(()=>f.runtime.journal.get<{id:string;assignment:Record<string,unknown>}>(f.runtime.run,'workshopSessions',id)).toMatchObject({id,assignment:{objective:'create 15 green circuits per second'}});
    const session=f.runtime.journal.get<{assignment:Record<string,unknown>}>(f.runtime.run,'workshopSessions',id)!;
    expect(session.assignment).toMatchObject({objective:'create 15 green circuits per second',source:{numericTargetText:'15 per second'},models:{sessionDefault:{modelId:'gpt-6-astra',reasoningEffort:'medium'}}});
  }finally{await server.close();catalog.close();f.close();}
});

test('brief and simulation speed validation keeps invalid launches out of admission',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-invalid-brief-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root),host=productionWorkshopHost(f.runtime.directory);
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog,managedModels:[{id:'gpt-6-astra',displayName:'Astra',efforts:['low']}],workshopHost:host,profileReader:host.profileReader}),origin=await server.listen();
  try{await page.setViewportSize({width:900,height:600});await page.goto(origin+'/workshop');await waitForWorkshopOptions(page);const panel=page.getByTestId('workshop'),launch=panel.getByRole('button',{name:'Launch workshop'});
    await panel.locator('textarea').fill('   ');await launch.scrollIntoViewIfNeeded();const before=await page.evaluate(()=>scrollY);expect(before).toBeGreaterThan(0);
    await launch.click();const briefAlert=page.getByRole('alert').filter({hasText:'Enter a product and target rate'});await expect(briefAlert).toBeVisible();await expect(panel.locator('textarea')).toBeFocused();
    await expect(panel.locator('textarea')).toBeInViewport();await expect(briefAlert).toBeInViewport();await expect.poll(()=>page.evaluate(()=>scrollY)).toBeLessThan(before);
    await panel.locator('textarea').fill('create 15 green circuits per second');await page.getByText('Advanced settings').click();await panel.getByLabel('Evaluation speed').fill('0');await page.getByText('Advanced settings').click();await launch.click();
    await expect(page.getByRole('alert').filter({hasText:'Enter a positive simulation speed'})).toBeVisible();await expect(panel.getByLabel('Evaluation speed')).toBeFocused();await expect(panel.getByLabel('Evaluation speed')).toBeInViewport();await expect(page.locator('details.advanced-options')).toHaveAttribute('open','');expect(f.runtime.journal.list(f.runtime.run,'workshopSessions')).toHaveLength(0);
  }finally{await server.close();catalog.close();f.close();}
});

test('options load failure and empty model list give actionable launch feedback',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-options-failure-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root),host=productionWorkshopHost(f.runtime.directory);
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog,managedModels:[],workshopHost:host,profileReader:host.profileReader}),origin=await server.listen();
  try{await page.route('**/api/workshop/options',route=>route.fulfill({status:503,json:{error:'Options unavailable'}}));await page.goto(origin+'/workshop');
    const panel=page.getByTestId('workshop'),launch=panel.getByRole('button',{name:'Launch workshop'});await expect(launch).toBeEnabled();await launch.click();
    await expect(page.getByRole('alert').filter({hasText:'Could not load managed options'})).toBeVisible();await expect(panel.getByLabel('Session model')).toBeFocused();
    await page.unroute('**/api/workshop/options');await page.reload();await expect(panel.getByLabel('Session model')).toHaveValue('');await launch.click();
    await expect(page.getByRole('alert').filter({hasText:'No managed models are available'})).toBeVisible();await expect(panel.getByLabel('Session model')).toBeFocused();expect(f.runtime.journal.list(f.runtime.run,'workshopSessions')).toHaveLength(0);
  }finally{await server.close();catalog.close();f.close();}
});

test('an active workshop owner keeps launch available and refuses another admission',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-active-owner-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  catalog.admit('already-active','workshop',{id:'already-active'},f.runtime.directory);
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog,managedModels:[{id:'gpt-6-astra',displayName:'Astra',efforts:['low']}],workshopHost:productionWorkshopHost(f.runtime.directory)}),origin=await server.listen();
  try{await page.goto(origin+'/workshop');const panel=page.getByTestId('workshop'),launch=panel.getByRole('button',{name:'Launch workshop'});await expect(launch).toBeEnabled();await launch.click();
    await expect(page.getByRole('alert').filter({hasText:'Another run owns the managed game'})).toBeVisible();await expect(panel.locator('[data-launch-field="ownership"]')).toBeFocused();
    expect(catalog.owner()?.id).toBe('already-active');expect(f.runtime.journal.list(f.runtime.run,'workshopSessions')).toHaveLength(0);
  }finally{await server.close();catalog.close();f.close();}
});

test('history keeps brief, run and attempt scope across direct links and refresh',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-history-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  let selectedGroup:string|null=null;
  for(let n=1;n<=5;n++){
    const id=`run-${n}`,objective=n<=3?'Make 15 red science per minute':'Make 15 green science per minute';
    if(n===4)selectedGroup=null;
    const history=catalog.beginWorkshop(f.runtime.directory,f.runtime.run,{id,objective,comparisonSeries:`series-${n}`} as never,selectedGroup);
    selectedGroup=history.group.id;
    f.runtime.record('workspace/identity-recorded',[{entity:'workspaceGroups',id:history.group.id,value:{...history.group}},{entity:'workspaceRuns',id,value:{...history.run}}]);
    catalog.journaled(id);
    for(let attempt=1;attempt<=(n<=3?5:3);attempt++){
      const attemptId=`${id}:${attempt}`;catalog.recordAttempt({schema:1,id:attemptId,runId:id,ordinal:attempt,sourceId:attemptId,coverage:'recorded'});
      f.runtime.record('workshop/iteration-started',[{entity:'workshopIterations',id:attemptId,value:{id:attemptId,sessionId:id,number:attempt}}]);
    }
  }
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog}),origin=await server.listen();
  try{await page.goto(origin+'/history');await expect(page.getByRole('heading',{name:'Briefs, scenarios and runs'})).toBeVisible();
    await expect(page.getByRole('button',{name:/Make 15 red science/})).toBeVisible();await expect(page.getByRole('button',{name:/Make 15 green science/})).toBeVisible();
    await page.getByRole('button',{name:/Make 15 green science/}).click();await expect(page.locator('a.history-row')).toHaveCount(2);
    await page.goto(origin+'/history/run-5');await expect(page.locator('.workspace-page .history-row')).toHaveCount(3);
    await expect(page.getByRole('heading',{name:/Workshop/})).toBeFocused();
    await page.getByRole('button',{name:/Attempt 1/}).click();await page.getByRole('button',{name:'Designer output'}).click();
    await expect(page.locator('.evidence-inspector')).toContainText('Not retained or unavailable');
    await page.getByRole('button',{name:/Attempt 2/}).click();await expect(page.locator('.evidence-inspector')).toHaveCount(0);
    await page.goto(origin+'/history/run-1');await expect(page.locator('.workspace-page .history-row')).toHaveCount(5);
    await expect(page.locator('.evidence-inspector')).toHaveCount(0);
  }finally{await server.close();catalog.close();f.close();}
});

test('late attempt and invocation pages cannot enter another run detail',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-history-race-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  for(const [id,count] of [['run-a',51],['run-b',1]] as const){
    const identity=catalog.beginWorkshop(f.runtime.directory,f.runtime.run,{id,objective:'Make gears',comparisonSeries:id} as never);
    f.runtime.record('workspace/identity-recorded',[{entity:'workspaceGroups',id:identity.group.id,value:{...identity.group}},{entity:'workspaceRuns',id,value:{...identity.run}}]);catalog.journaled(id);
    for(let number=1;number<=count;number++)catalog.recordAttempt({schema:1,id:`${id}:${number}`,runId:id,ordinal:number,sourceId:null,coverage:'recorded'});
  }
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog}),origin=await server.listen();
  let releaseAttempt!:()=>void,releaseInvocation!:()=>void;
  const heldAttempt=new Promise<void>(resolve=>{releaseAttempt=resolve;}),heldInvocation=new Promise<void>(resolve=>{releaseInvocation=resolve;});
  let attemptReady!:()=>void,invocationReady!:()=>void;
  const attemptPending=new Promise<void>(resolve=>{attemptReady=resolve;}),invocationPending=new Promise<void>(resolve=>{invocationReady=resolve;});
  await page.route(url=>url.pathname.endsWith('/api/workspace/runs/run-a/attempts')&&url.searchParams.has('cursor'),async route=>{const response=await route.fetch();attemptReady();await heldAttempt;await route.fulfill({response});});
  await page.route('**/api/workspace/runs/run-a/invocations/**',async route=>{const response=await route.fetch();invocationReady();await heldInvocation;await route.fulfill({response});});
  try{
    await page.goto(origin+'/history/run-a');await expect(page.getByRole('button',{name:'More attempts'})).toBeVisible();
    await page.getByRole('button',{name:'More attempts'}).click();
    await page.getByRole('button',{name:'Attempt 1 · run-a:1',exact:true}).click();await page.getByRole('button',{name:'Designer output'}).click();
    await Promise.all([attemptPending,invocationPending]);
    await page.evaluate(()=>{history.pushState(null,'','/history/run-b');window.dispatchEvent(new PopStateEvent('popstate'));});
    await expect(page.getByRole('button',{name:/run-b:1/})).toBeVisible();
    const lateAttempt=page.waitForResponse(url=>url.url().includes('/runs/run-a/attempts?')&&url.url().includes('cursor='));
    const lateInvocation=page.waitForResponse(url=>url.url().includes('/runs/run-a/invocations/'));
    releaseAttempt();releaseInvocation();await Promise.all([lateAttempt,lateInvocation]);
    // Wait for fetch continuations to process the released bodies before testing scope isolation.
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await expect(page.getByRole('button',{name:/run-a:51/})).toHaveCount(0);
    await expect(page.locator('.evidence-inspector')).toHaveCount(0);
  }finally{releaseAttempt();releaseInvocation();await server.close();catalog.close();f.close();}
});

test('a delayed group page cannot append runs or cursors to another brief',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-group-race-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  let groupA:string|null=null;
  for(let number=1;number<=51;number++){
    const identity=catalog.beginWorkshop(f.runtime.directory,f.runtime.run,{id:`group-a-run-${number}`,objective:'Group A brief',comparisonSeries:`series-a-${number}`} as never,groupA);
    groupA=identity.group.id;catalog.journaled(identity.run.id);
  }
  const b=catalog.beginWorkshop(f.runtime.directory,f.runtime.run,{id:'group-b-run',objective:'Group B brief',comparisonSeries:'series-b'} as never);catalog.journaled(b.run.id);
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog}),origin=await server.listen();
  let release!:()=>void,ready!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),pending=new Promise<void>(resolve=>{ready=resolve;});
  await page.route(url=>url.pathname===`/api/workspace/groups/${groupA}/runs`&&url.searchParams.has('cursor'),async route=>{const response=await route.fetch();ready();await held;await route.fulfill({response});});
  try {
    await page.goto(origin+'/history');await page.getByRole('button',{name:/Group A brief/}).click();
    await expect(page.locator('a.history-row')).toHaveCount(50);
    await page.getByRole('button',{name:'More runs',exact:true}).click();await pending;
    await expect(page.getByRole('button',{name:'Loading more runs…'})).toBeDisabled();
    await page.getByRole('button',{name:/Group B brief/}).click();await expect(page.locator('a.history-row')).toHaveCount(1);
    const response=page.waitForResponse(value=>value.url().includes(`/groups/${groupA}/runs?`)&&value.url().includes('cursor='));
    release();await response;await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await expect(page.locator('a.history-row')).toHaveCount(1);await expect(page.locator('a.history-row')).toContainText('group-b-run');
    await expect(page.getByRole('button',{name:'More runs',exact:true})).toHaveCount(0);
  }finally{release();await server.close();catalog.close();f.close();}
});

test('library revision inspection and native export are visible on the Library page',async({page})=>{
  const f=await dashboardFixture(mkdtempSync(path.join(os.tmpdir(),'af-ui-library-result-')),true);
  const server=dashboard(f.operator),origin=await server.listen();
  const revision={label:'Retained gear cell',revisionHash:'revision-gear',profileId:'starter-assembly'};
  await page.route('**/api/workshop/library?*',route=>route.fulfill({json:{items:[revision]}}));
  await page.route('**/api/workshop/library/revision-gear/export',route=>route.fulfill({json:{blueprint:'0native-blueprint-export',revisionHash:'revision-gear'}}));
  try {
    await page.goto(origin+'/library');await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.getByRole('button',{name:/Retained gear cell/}).click();await expect(page.getByRole('region',{name:'Library result'})).toContainText('revision-gear');
    await page.getByRole('button',{name:'Export',exact:true}).click();await expect(page.getByRole('region',{name:'Library result'})).toContainText('0native-blueprint-export');
    await expect(page).toHaveURL(/\/library$/);await page.getByRole('button',{name:'Close result'}).click();await expect(page.getByRole('region',{name:'Library result'})).toHaveCount(0);
  }finally{await server.close();f.close();}
});

test('below-fold launch gives immediate feedback and focuses once without later scroll changes',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-launch-focus-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog,managedModels:[{id:'gpt-6-astra',displayName:'Astra',efforts:['low']}],workshopHost:productionWorkshopHost(f.runtime.directory)});
  const origin=await server.listen();let release!:()=>void,ready!:()=>void,launchPosts=0;
  const held=new Promise<void>(resolve=>{release=resolve;}),pending=new Promise<void>(resolve=>{ready=resolve;});
  await page.setViewportSize({width:900,height:600});await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/api/workshop/launch',async route=>{launchPosts++;const response=await route.fetch();ready();await held;await route.fulfill({response});});
  try {
    await page.goto(origin+'/workshop');const panel=page.getByTestId('workshop');
    await expect(panel).toContainText('A separate sandbox creates entities instantly');
    await panel.getByLabel('Construction').selectOption('character');await expect(panel).toContainText('normal game rules');await expect(panel).toContainText('finite character inventory');
    await panel.getByText('Advanced settings').click();await panel.getByLabel('brief',{exact:true}).check();
    const launch=panel.getByRole('button',{name:'Launch workshop'});await expect(launch).toBeEnabled();await launch.scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>scrollY)).toBeGreaterThan(0);await launch.click();await pending;
    await expect(panel.getByRole('button',{name:'Submitting run…'})).toBeEnabled();
    await panel.getByRole('button',{name:'Submitting run…'}).click();expect(launchPosts).toBe(1);
    await expect(panel.getByRole('status').filter({hasText:'Submitting run request'})).toBeVisible();
    release();await expect(page.getByRole('heading',{name:/Workshop ·/})).toBeFocused();
    const heading=page.getByRole('heading',{name:/Workshop ·/});expect(await heading.evaluate(element=>element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
    await page.getByText('Configuration and provenance').click();await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
    const position=await page.evaluate(()=>scrollY);
    f.runtime.record('workshop/activity',[{entity:'workshopOperations',id:'focus-check',value:{id:'focus-check',sessionId:catalog.owner()!.id,category:'designer',status:'started',detail:'Later observed activity'}}]);
    await expect(page.locator('.workspace-page')).toContainText('Later observed activity');expect(await page.evaluate(()=>scrollY)).toBe(position);
  }finally{release();await server.close();catalog.close();f.close();}
});

test('delayed preset, library search and export show pending rejection and retry without losing input',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-action-feedback-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog,managedModels:[{id:'gpt-6-astra',displayName:'Astra',efforts:['low']}],workshopHost:productionWorkshopHost(f.runtime.directory)}),origin=await server.listen();
  let release=()=>{},fail=true;
  async function hold(pattern:string,success:unknown){let ready!:()=>void;const pending=new Promise<void>(resolve=>{ready=resolve;});const held=new Promise<void>(resolve=>{release=resolve;});await page.route(pattern,async route=>{ready();await held;await route.fulfill({status:fail?503:200,json:fail?{error:'Deliberate delayed rejection'}:success});});return{pending};}
  try {
    await page.goto(origin+'/workshop');await page.getByText('Advanced settings').click();await page.getByLabel('Preset name').fill('Keep my preset input');
    let pending=(await hold('**/api/workshop/preset',{id:'saved'})).pending;await page.getByRole('button',{name:'Save preset',exact:true}).click();await pending;
    await expect(page.getByRole('button',{name:'Saving preset…'})).toBeDisabled();release();await expect(page.getByRole('alert')).toContainText('Deliberate delayed rejection');await expect(page.getByLabel('Preset name')).toHaveValue('Keep my preset input');
    fail=false;await page.getByRole('button',{name:'Save preset',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Preset saved.'})).toBeVisible();
    await page.getByRole('link',{name:'Blueprint Library'}).click();await page.getByLabel('Library search').fill('Keep gear query');fail=true;
    pending=(await hold('**/api/workshop/library?*',{items:[{label:'Feedback gear',revisionHash:'feedback-gear'}]})).pending;await page.getByRole('button',{name:'Search',exact:true}).click();await pending;
    await expect(page.getByRole('button',{name:'Searching…'})).toBeDisabled();release();await expect(page.getByRole('alert')).toContainText('Deliberate delayed rejection');await expect(page.getByLabel('Library search')).toHaveValue('Keep gear query');
    fail=false;await page.getByRole('button',{name:'Search',exact:true}).click();await expect(page.getByRole('button',{name:/Feedback gear/})).toBeVisible();fail=true;
    pending=(await hold('**/api/workshop/library/feedback-gear/export',{blueprint:'0feedback-export'})).pending;await page.getByRole('button',{name:'Export',exact:true}).click();await pending;
    await expect(page.getByRole('button',{name:/^Exporting/})).toBeDisabled();release();await expect(page.getByRole('alert')).toContainText('Deliberate delayed rejection');
    fail=false;await page.getByRole('button',{name:'Export',exact:true}).click();await expect(page.getByRole('region',{name:'Library result'})).toContainText('0feedback-export');
  }finally{release();await server.close();catalog.close();f.close();}
});

test('reopened imported workshop retains original attempts, learning and paged redacted evidence',async({browser})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-legacy-evidence-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  const directory=path.join(root,'startup','dashboard-legacy'),journal=new SqliteJournal(path.join(directory,'runtime.sqlite'));
  const sourceId='legacy-original',ctx={run:'legacy-container',epoch:'legacy-epoch',wallTime:'2026-09-22T12:00:00Z',gameTick:null,actor:null,task:null,causation:null,correlation:null,visibility:{kind:'operator' as const}};
  const iterations=[{id:'original-attempt-one',number:1,feedback:'Original measured result',evaluation:{valid:true,passed:true},score:{eligible:true,dimensions:{throughput:{value:60,unit:'items/minute'}}}},{id:'original-attempt-two',number:2,evaluation:{valid:false,passed:false},feedback:'Original invalid measurement'}];
  journal.append(ctx,'workshop/complete',[{entity:'workshopSessions',id:sourceId,value:{id:sourceId,assignment:{id:sourceId,objective:'Retained legacy brief'},stage:'complete',iterations,bestIteration:1,finalOutcome:'best-valid'}}]);
  journal.append(ctx,'workshop/iteration-scored',[{entity:'workshopIterations',id:iterations[0]!.id,value:{...iterations[0],sessionId:sourceId}}]);
  journal.append(ctx,'workshop/learning',[{entity:'learningOutcomes',id:`${sourceId}-learning`,value:{sessionId:sourceId,decision:'no-change',reason:'Retained immutable lesson diff',diffs:[{path:'lesson',before:'old',after:'new'}]}}]);
  journal.close();
  const record=new WorkshopInvocationRecorder(directory,sourceId,`${sourceId}:1:designer`,'workshop-designer',{modelId:'gpt-6-astra'},'Retained instructions','Original prompt',{objective:'Retained legacy brief',authorization:'Bearer do-not-retain'});
  record.dispatch('Retained instructions','Runtime-added observe instruction');record.delivery('tool/result',{tool:'observe',result:{supplied:'Original delivered context',secret:'do-not-retain'}});record.complete('a'.repeat(20_000)+'END');
  const scorer=new WorkshopInvocationRecorder(directory,sourceId,`${sourceId}:1:scorer`,'workshop-scorer',{},'Scorer instruction','Prompt',{});scorer.complete('OK');
  catalog.importLegacy(500,f.runtime.directory);const group=catalog.listGroups().find(value=>value.title==='Retained legacy brief')!,id=catalog.listRuns(group.id)[0]!.identity.id;
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog}),origin=await server.listen(),context=await browser.newContext();let page=await context.newPage();
  try {
    await page.goto(origin+'/history/'+id);await expect(page.locator('.terminal-summary')).toContainText('Attempts: 2');
    await page.getByRole('button',{name:new RegExp(`Attempt 1 · ${id}:1`)}).click();await expect(page.locator('.workspace-page')).toContainText('Original measured result');
    await page.getByRole('button',{name:'Designer instructions'}).click();await expect(page.locator('.evidence-inspector')).toContainText('Runtime-added observe instruction');
    await page.getByRole('button',{name:'Designer context'}).click();await expect(page.locator('.evidence-inspector')).toContainText('Recorded part with redactions');await expect(page.locator('.evidence-inspector')).not.toContainText('do-not-retain');
    await page.getByRole('button',{name:'Designer tools'}).click();await expect(page.locator('.evidence-inspector')).toContainText('Original delivered context');await expect(page.locator('.evidence-inspector')).not.toContainText('do-not-retain');
    await page.getByRole('button',{name:'Designer output'}).click();await expect(page.locator('.evidence-inspector')).toContainText('16000 of 20003 characters');await page.getByRole('button',{name:'More recorded content'}).click();await expect(page.locator('.evidence-inspector')).toContainText('20003 of 20003 characters');await expect(page.locator('.evidence-inspector pre')).toContainText('END');
    await page.getByRole('button',{name:'Scorer output'}).click();await expect(page.locator('.evidence-inspector')).toContainText('2 of 2 characters');await expect(page.locator('.evidence-inspector pre')).toHaveText('OK');
    expect((await page.request.get(`${origin}/api/workspace/runs/${id}/invocations/unrelated:1:designer`)).status()).toBe(404);
    await page.close();page=await context.newPage();await page.goto(origin+'/history/'+id);await expect(page.locator('.terminal-summary')).toContainText('Best eligible: attempt 1');
    await page.getByText('Learning and activation',{exact:true}).click();await expect(page.locator('.workspace-page')).toContainText('Retained immutable lesson diff');await expect(page.locator('.workspace-page')).toContainText('"after": "new"');
    await expect(page.locator('.workspace-page .history-row button',{hasText:'Attempt'})).toHaveCount(2);await expect(page.locator('.evidence-inspector')).toHaveCount(0);
  }finally{await context.close();await server.close();catalog.close();f.close();}
});

test('an earlier attempt and its inspector stay selected while attempt three progresses',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-live-history-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root),id='live-three';
  catalog.admit(id,'workshop',{id},f.runtime.directory);
  const identity=catalog.beginWorkshop(f.runtime.directory,f.runtime.run,{id,objective:'Three visible attempts',comparisonSeries:'live-three'} as never);catalog.journaled(id);catalog.transitionRequest(id,'active');
  const iterations=[1,2,3].map(number=>({id:`${id}:${number}`,number,feedback:number===1?'First retained evidence':'Later attempt',evaluation:number===1?{valid:true,passed:false}:null}));
  let session={id,assignment:{id,objective:'Three visible attempts'},stage:'measure',iterations,activeIteration:3};
  f.runtime.record('workspace/identity-recorded',[{entity:'workspaceGroups',id:identity.group.id,value:{...identity.group}},{entity:'workspaceRuns',id,value:{...identity.run}}]);
  f.runtime.record('workshop/configured',[{entity:'workshopSessions',id,value:session}]);
  for(const iteration of iterations){catalog.recordAttempt({schema:1,id:iteration.id,runId:id,ordinal:iteration.number,sourceId:iteration.id,coverage:'recorded'});f.runtime.record('workshop/iteration-started',[{entity:'workshopIterations',id:iteration.id,value:{...iteration,sessionId:id}}]);}
  const record=new WorkshopInvocationRecorder(f.runtime.directory,id,`${id}:1:designer`,'workshop-designer',{},'First instructions','First prompt',{});record.complete('First exact output');
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog}),origin=await server.listen();
  try {
    await page.goto(origin+'/history/'+id);const first=page.getByRole('button',{name:`Attempt 1 · ${id}:1`,exact:true});await first.click();
    await page.getByRole('button',{name:'Designer output'}).click();await expect(page.locator('.evidence-inspector pre')).toHaveText('First exact output');
    session={...session,iterations:iterations.map(value=>value.number===3?{...value,feedback:'Third-only result'}:value)};
    f.runtime.record('workshop/iteration-progress',[{entity:'workshopSessions',id,value:session},{entity:'workshopIterations',id:`${id}:3`,value:{...session.iterations[2]!,sessionId:id}},{entity:'workshopOperations',id:'third-progress',value:{id:'third-progress',sessionId:id,iteration:3,category:'game',status:'started',detail:'Third-only result'}}]);
    await expect(page.getByRole('button',{name:`Attempt 3 · ${id}:3 · Current`,exact:true})).toBeVisible();
    await expect(first).toHaveAttribute('aria-expanded','true');await expect(page.locator('.evidence-inspector pre')).toHaveText('First exact output');
    await expect(page.locator('.active-run-banner').getByRole('button',{name:'Stop run',exact:true})).toBeVisible();await expect(page.locator('.evidence-inspector')).not.toContainText('Third-only result');
  }finally{await server.close();catalog.close();f.close();}
});

test('rerunning a brief pins new settings and editing its objective creates immutable linked history',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-brief-lineage-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog,managedModels:[{id:'gpt-6-astra',displayName:'Astra',efforts:['low','medium']}],workshopHost:productionWorkshopHost(f.runtime.directory)}),origin=await server.listen();
  async function launchAndStop(){await waitForWorkshopOptions(page);await page.getByRole('button',{name:'Launch workshop'}).click();await expect(page.locator('.workspace-page')).toContainText('Waiting for you');const id=page.url().split('/history/')[1]!;await page.locator('.active-run-banner').getByRole('button',{name:'Stop run',exact:true}).click();await expect.poll(()=>catalog.request(id)?.state).toBe('cancelled');await expect(page.locator('.active-run-banner')).toHaveCount(0);return catalog.run(id)!.identity;}
  async function rerun(groupId:string){await page.getByRole('link',{name:'Run History'}).click();await page.getByRole('button',{name:/create 15 green circuits per second/}).click();await page.getByRole('button',{name:'Run this brief again'}).click();await expect(page).toHaveURL(new RegExp(`group=${groupId}`));}
  try {
    await page.goto(origin+'/workshop');await page.getByText('Advanced settings').click();await page.getByLabel('brief',{exact:true}).check();const first=await launchAndStop();
    await rerun(first.groupId);await page.getByLabel('Session effort').selectOption('low');const second=await launchAndStop();
    expect(second.groupId).toBe(first.groupId);expect(second.assignmentHash).not.toBe(first.assignmentHash);expect(second.comparisonSeries).not.toBe(first.comparisonSeries);
    await rerun(first.groupId);await page.locator('textarea').fill('Produce 120 electronic circuits per minute');const third=await launchAndStop();
    expect(third.groupId).not.toBe(first.groupId);expect(catalog.group(third.groupId)?.parentGroupId).toBe(first.groupId);
    expect(catalog.run(first.id)!.identity).toEqual(first);expect(catalog.listRuns(first.groupId)).toHaveLength(2);expect(catalog.listRuns(third.groupId)).toHaveLength(1);
  }finally{await server.close();catalog.close();f.close();}
});

test('Improve preserves exact source and local edits during a cross-tab setup conflict',async({browser})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-improve-conflict-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog,managedModels:[{id:'gpt-6-astra',displayName:'Astra',efforts:['low']}],workshopHost:productionWorkshopHost(f.runtime.directory)}),origin=await server.listen();
  const context=await browser.newContext(),first=await context.newPage(),second=await context.newPage();
  await first.route('**/api/workshop/library?*',route=>route.fulfill({json:{items:[{label:'Exact source cell',revisionHash:'exact-source-revision'}]}}));
  try {
    await first.goto(origin+'/workshop');await first.locator('textarea').fill('First tab local objective');
    await second.goto(origin+'/workshop');await second.locator('textarea').fill('Second tab saved objective');await expect(first.getByTestId('workshop')).toContainText('Setup changed in another tab');
    await first.getByRole('link',{name:'Blueprint Library'}).click();await first.getByRole('button',{name:'Search',exact:true}).click();await first.getByRole('button',{name:'Improve',exact:true}).click();
    await expect(first).toHaveURL(/improve=exact-source-revision/);await expect(first.locator('textarea')).toHaveValue('First tab local objective');await expect(first.getByTestId('workshop')).toContainText('Improving exact library revision exact-source-revision');
    const launch=first.getByRole('button',{name:'Launch workshop'});await expect(launch).toBeEnabled();await launch.click();await expect(first.getByRole('alert').filter({hasText:'Reset saved setup or load the other tab settings'})).toBeVisible();
    await expect(first.locator('[data-launch-field="setup"]')).toBeFocused();expect(catalog.owner()).toBeNull();expect(f.runtime.journal.list(f.runtime.run,'workshopSessions')).toHaveLength(0);
    await first.getByRole('button',{name:'Load other tab settings'}).click();await expect(first.locator('textarea')).toHaveValue('Second tab saved objective');await expect(first.getByTestId('workshop')).toContainText('Improving exact library revision exact-source-revision');
    await expect.poll(()=>first.evaluate(()=>JSON.parse(localStorage.getItem('autofactorio.workshop.draft.v1')!).values.improveRevision)).toBe('exact-source-revision');
  }finally{await context.close();await server.close();catalog.close();f.close();}
});

test('delayed checkpoint and history failures expose pending state and a scoped retry',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-checkpoint-feedback-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog,managedModels:[{id:'gpt-6-astra',displayName:'Astra',efforts:['low']}],workshopHost:productionWorkshopHost(f.runtime.directory)}),origin=await server.listen();
  let release=()=>{},fail=true,ready!:()=>void;
  let held=new Promise<void>(resolve=>{release=resolve;}),pending=new Promise<void>(resolve=>{ready=resolve;});
  try {
    await page.goto(origin+'/workshop');await page.getByText('Advanced settings').click();await page.getByLabel('brief',{exact:true}).check();await waitForWorkshopOptions(page);await page.getByRole('button',{name:'Launch workshop'}).click();await expect(page.locator('.workspace-page')).toContainText('Waiting for you');
    await page.route('**/api/workshop/checkpoint',async route=>{if(fail){ready();await held;await route.fulfill({status:503,json:{error:'Checkpoint temporarily unavailable'}});}else await route.continue();});
    await page.getByRole('button',{name:'Finish after this attempt',exact:true}).click();await pending;await expect(page.getByRole('button',{name:'Finish after this attempt',exact:true})).toBeDisabled();await expect(page.getByRole('status').filter({hasText:'Submitting checkpoint decision'})).toBeVisible();
    release();await expect(page.locator('.workspace-page').getByRole('alert').filter({hasText:'Submitting checkpoint decision failed'})).toContainText('Checkpoint temporarily unavailable');fail=false;await page.getByRole('button',{name:'Finish after this attempt',exact:true}).click();await expect(page.locator('.terminal-summary')).toBeVisible();
    fail=true;held=new Promise<void>(resolve=>{release=resolve;});pending=new Promise<void>(resolve=>{ready=resolve;});
    await page.route('**/api/workspace/groups?*',async route=>{if(fail){ready();await held;await route.fulfill({status:503,json:{error:'History temporarily unavailable'}});}else await route.continue();});
    await page.getByRole('link',{name:'Run History'}).click();await pending;await expect(page.getByRole('status').filter({hasText:'Loading history'})).toBeVisible();release();await expect(page.getByRole('alert')).toContainText('History temporarily unavailable');fail=false;await page.getByRole('button',{name:'Retry history'}).click();await expect(page.getByRole('button',{name:/create 15 green circuits per second/})).toBeVisible();
  }finally{release();await server.close();catalog.close();f.close();}
});

test('a completed run is announced while the operator stays on another page',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-completion-banner-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog}),origin=await server.listen();
  let ownerPolls=0;
  await page.route('**/api/workspace/owner',route=>route.fulfill({json:{owner:++ownerPolls===1?{id:'finished-off-page',kind:'workshop',state:'active',reason:null}:null}}));
  await page.route('**/api/workspace/requests/finished-off-page',route=>route.fulfill({json:{request:{state:'completed',reason:null},run:null}}));
  try{await page.goto(origin+'/library');await expect(page.getByRole('link',{name:'Blueprint Library'})).toHaveAttribute('aria-current','page');
    await expect(page.getByRole('status').filter({hasText:'Workshop finished-off-page completed'})).toBeVisible({timeout:7000});
    await expect(page).toHaveURL(/\/library$/);
  }finally{await server.close();catalog.close();f.close();}
});

test('launch recovers the same request after a response is lost to refresh',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-launch-loss-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog,managedModels:[{id:'gpt-6-astra',displayName:'Astra',efforts:['low']}],workshopHost:productionWorkshopHost(f.runtime.directory)});
  const origin=await server.listen();let releaseResponse=()=>{};
  const held=new Promise<void>(resolve=>{releaseResponse=resolve;});
  try{
    await page.route('**/api/workshop/launch',async route=>{const response=await route.fetch();await held;await route.fulfill({response});});
    await page.goto(origin+'/workshop');await waitForWorkshopOptions(page);await page.getByRole('button',{name:'Launch workshop'}).click();
    await expect(page.getByRole('status').filter({hasText:'Submitting run request'})).toBeVisible();
    await expect(page.getByRole('button',{name:/^Submitting run/})).toBeEnabled();
    await expect(page.getByRole('button',{name:'Check launch status'})).toBeVisible();
    const requestId=await page.evaluate(()=>JSON.parse(localStorage.getItem('autofactorio.workshop.pending.v1')!).id as string);
    await expect.poll(()=>catalog.request(requestId)?.state).toBe('active');
    await page.reload();releaseResponse();
    await expect(page).toHaveURL(new RegExp(`/history/${requestId}$`));
    expect(f.runtime.journal.list(f.runtime.run,'workshopSessions')).toHaveLength(1);
    expect(catalog.run(requestId)?.identity.id).toBe(requestId);
    await expect.poll(()=>page.evaluate(()=>localStorage.getItem('autofactorio.workshop.pending.v1'))).toBeNull();
  }finally{releaseResponse();await server.close();catalog.close();f.close();}
});

test('Stop during preparation closes admission before the first attempt',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-stop-preparing-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  const host=productionWorkshopHost(f.runtime.directory),resolve=host.resolve.bind(host);
  let releasePreparation=()=>{};const held=new Promise<void>(done=>{releasePreparation=done;});
  host.resolve=async input=>{await held;return resolve(input);};
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog,managedModels:[{id:'gpt-6-astra',displayName:'Astra',efforts:['low']}],workshopHost:host});
  const origin=await server.listen();
  try{
    await page.goto(origin+'/workshop');await waitForWorkshopOptions(page);await page.getByRole('button',{name:'Launch workshop'}).click();
    await expect(page).toHaveURL(/\/history\//);
    const id=new URL(page.url()).pathname.split('/').at(-1)!;
    await expect(page.getByRole('button',{name:'Stop run'})).toBeVisible();
    await page.getByRole('button',{name:'Stop run'}).click();
    await expect.poll(()=>catalog.request(id)?.state).toBe('cancelled');
    releasePreparation();
    await expect.poll(()=>f.runtime.journal.list(f.runtime.run,'workshopSessions').length).toBe(0);
    await page.reload();await expect(page.getByRole('heading',{name:'Run cancelled'})).toBeVisible();
    expect(catalog.owner()).toBeNull();
  }finally{releasePreparation();await server.close();catalog.close();f.close();}
});

test('scenario owner can be stopped from the shared banner on its run page',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-scenario-banner-'));
  const f=await dashboardFixture(path.join(root,'dashboard','run-fixture'),true),catalog=new WorkspaceCatalog(root);
  const id='scenario-banner',manifest={scenario:'S1',scenarioVersion:'fixture-v1',objective:'Build a small fuel loop'};
  catalog.admit(id,'scenario',manifest,f.runtime.directory);
  const history=catalog.beginScenario(f.runtime.directory,f.runtime.run,id,manifest);
  f.runtime.record('workspace/identity-recorded',[{entity:'workspaceGroups',id:history.group.id,value:history.group},{entity:'workspaceRuns',id,value:history.run}]);
  catalog.journaled(id);catalog.transitionRequest(id,'active');
  f.operator.workspaceControlSettled=(action,state)=>{if(action==='stop'&&state.status==='stopped'&&state.cancellation==='confirmed'&&state.inference==='confirmed')catalog.transitionRequest(id,'cancelled','operator_stop');};
  const server=dashboard(f.operator,undefined,{workspaceCatalog:catalog}),origin=await server.listen();
  try{await page.goto(origin+`/history/${id}`);await expect(page.getByRole('region',{name:'Active run'})).toContainText('Scenario');
    await page.getByRole('region',{name:'Active run'}).getByRole('button',{name:'Stop run'}).click();
    await expect.poll(()=>catalog.request(id)?.state).toBe('cancelled');await expect(page.getByRole('status').filter({hasText:'Scenario stop status'})).toBeVisible();
  }finally{await server.close();catalog.close();f.close();}
});

test('delayed Library export cannot replace a newer selection or reopen a closed result',async({page})=>{
  const f=await dashboardFixture(mkdtempSync(path.join(os.tmpdir(),'af-ui-library-selection-')),true),server=dashboard(f.operator),origin=await server.listen();
  const revisions=[{label:'Revision A',revisionHash:'selection-a'},{label:'Revision B',revisionHash:'selection-b'}];
  await page.route('**/api/workshop/library?*',route=>route.fulfill({json:{items:revisions}}));
  let release=()=>{},ready=()=>{};
  try {
    await page.goto(origin+'/library');await page.getByRole('button',{name:'Search',exact:true}).click();
    for(const close of [false,true]){
      const held=new Promise<void>(resolve=>{release=resolve;}),pending=new Promise<void>(resolve=>{ready=resolve;});
      await page.route('**/api/workshop/library/selection-a/export',async route=>{ready();await held;await route.fulfill({json:{blueprint:'0stale-export-a'}});});
      await page.getByRole('button',{name:'Revision A'}).click();
      await page.locator('.workshop-row').filter({has:page.getByRole('button',{name:'Revision A'})}).getByRole('button',{name:'Export',exact:true}).click();await pending;
      if(close)await page.getByRole('button',{name:'Close result'}).click();else await page.getByRole('button',{name:'Revision B'}).click();
      const response=page.waitForResponse('**/api/workshop/library/selection-a/export');release();await response;
      await expect(page.getByRole('button',{name:/^Exporting/})).toHaveCount(0);
      if(close)await expect(page.getByRole('region',{name:'Library result'})).toHaveCount(0);
      else {await expect(page.getByRole('region',{name:'Library result'})).toContainText('selection-b');await expect(page.getByRole('region',{name:'Library result'})).not.toContainText('0stale-export-a');}
      await page.unroute('**/api/workshop/library/selection-a/export');
    }
  }finally{release();await server.close();f.close();}
});
