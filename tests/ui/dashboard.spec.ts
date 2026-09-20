import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dashboardFixture } from '../../scripts/dev/dashboard-fixture.js';
import { dashboard } from '../../apps/runtime/http.js';
import { LiveWorkshopHost } from '../../apps/runtime/workshop-live-host.js';
import type { WorkshopGame, WorkshopInference } from '../../apps/runtime/workshop-live-host.js';
import type { WorkshopEvaluationReport } from '@autofactorio/contracts';
import { WorkshopEffectOutcomeError } from '../../packages/core/workshop/runtime.js';

function productionWorkshopHost(directory:string,buildFailure:string|null=null){
  const inference:WorkshopInference={async invoke(_session,role,_selection,observation){if(role==='workshop-designer'){const assignment=(observation as {assignment:{ports:unknown[]}}).assignment;return JSON.stringify({schema:1,label:'Managed production host cell',description:'Production host composed with acceptance adapters',entities:[{id:'assembler',entityNumber:1,name:'assembling-machine-1',position:{x:0,y:0},direction:0,quality:'normal',recipe:'electronic-circuit'}],wires:[],ports:assignment.ports,icons:[{index:1,name:'electronic-circuit'}],tiles:[]});}return role==='workshop-scorer'?JSON.stringify({feedback:'Measured production-host candidate'}):JSON.stringify({decision:'no-change',reason:'No repeated failure',evidence:['valid-attempts']});},async close(){}};
  const game:WorkshopGame={async resolveProfile(profileId,product){return{gameVersion:'2.0.77',mods:{base:'2.0.77'},profileId,profileRevision:1,surface:'nauvis',technologies:['automation','electronics'],allowedEquipment:['assembling-machine-1','transport-belt','inserter','small-electric-pole'],modules:[],beacons:[],recipe:{id:product,category:'crafting',energy:0.5,ingredients:[{type:'item',name:'iron-plate',amount:1},{type:'item',name:'copper-cable',amount:3}],products:[{type:'item',name:product,amount:1}]},machine:'assembling-machine-1'};},async build(session){if(buildFailure)throw new WorkshopEffectOutcomeError('failed',buildFailure);return{id:`${session.id}-${session.activeIteration}`,generation:1,surface:'af-ui-production',characterEvidence:session.assignment.construction==='character'?['game-receipt:ui-character']:null};},async measure(session):Promise<WorkshopEvaluationReport>{const rule=session.assignment.throughput[0]!,port=session.assignment.ports.find(value=>value.id===rule.portId)!,measured=String((session.activeIteration??1)*60);return{schema:1,attemptId:`${session.id}:${session.activeIteration}`,valid:true,passed:true,reasons:[],ports:[{portId:port.id,windows:Array.from({length:rule.windows},(_,index)=>({index,required:{numerator:'1',denominator:'1'},productionLower:{numerator:measured,denominator:'1'},deliveryLower:{numerator:measured,denominator:'1'},passed:true,reasons:[]}))}],evidence:['production-host-game-adapter']};}};
  return new LiveWorkshopHost(directory,inference,game);
}

test('operator watches two roles, inspects evidence, steers, controls and reopens the browser', async ({ browser }) => {
  const f = await dashboardFixture(mkdtempSync(path.join(os.tmpdir(), 'af-ui-')), true);
  const server = dashboard(f.operator); const origin = await server.listen(); const stop = f.operator.start(100);
  const context = await browser.newContext(); let page = await context.newPage();
  const url = origin;
  try {
    await page.goto(url); await expect(page.getByRole('heading', { name: 'Control room.' })).toBeVisible();
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
    page = await context.newPage(); await page.goto(url); await expect(page.locator('.intervention')).toContainText('Inspect copper');
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
    await page.goto(origin + '/#cap=' + server.capability);
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
  const f=await dashboardFixture(mkdtempSync(path.join(os.tmpdir(),'af-ui-workshop-failure-')),true),server=dashboard(f.operator,undefined,{managedModels:[{id:'gpt-6-astra',displayName:'Astra',efforts:['low']}],workshopHost:productionWorkshopHost(f.runtime.directory,'character actor disconnected')});
  const origin=await server.listen();
  try{await page.goto(origin);const panel=page.getByTestId('workshop'),response=page.waitForResponse(value=>value.url().endsWith('/api/workshop/launch'));await panel.getByRole('button',{name:'Launch workshop'}).click();expect((await response).status()).toBe(202);await expect(panel.getByRole('status')).toContainText('accepted');await expect(panel.locator('.workshop-row.stopped')).toContainText('character actor disconnected');await expect(page.locator('.detail pre')).toContainText('character actor disconnected');const session=f.runtime.journal.list<{operationIntents:Record<string,{status:string;failure?:string}>}>(f.runtime.run,'workshopSessions')[0]!;expect(Object.values(session.operationIntents)).toContainEqual(expect.objectContaining({status:'failed',failure:expect.stringContaining('character actor disconnected')}));}finally{await server.close();f.close();}
});

test('workshop form resolves supported selections, launches five-attempt character mode, and survives reconnect', async ({ browser }) => {
  const f=await dashboardFixture(mkdtempSync(path.join(os.tmpdir(),'af-ui-workshop-')),true);
  const server=dashboard(f.operator,undefined,{managedModels:[{id:'gpt-6-astra',displayName:'Astra',efforts:['low','medium']},{id:'gpt-5.6-sol',displayName:'Sol',efforts:['medium']}],workshopHost:productionWorkshopHost(f.runtime.directory)});const origin=await server.listen();const context=await browser.newContext();let page=await context.newPage();const url=origin+'/#cap='+server.capability;
  try{
    await page.goto(url);const panel=page.getByTestId('workshop');
    await expect(panel.getByRole('heading',{name:'Design, prove, preserve.'})).toBeVisible();
    await expect(panel.getByLabel('Attempts',{exact:true})).toHaveValue('5');
    await panel.getByLabel('Construction').selectOption('character');
    await panel.getByLabel('Designer model').selectOption('gpt-6-astra');
    await panel.getByLabel('Designer effort').selectOption('medium');
    await panel.getByLabel('Scorer model').selectOption('gpt-5.6-sol');
    await expect(panel.getByLabel('Scorer effort')).toHaveValue('medium');
    await panel.getByLabel('Learnings model').selectOption('gpt-5.6-sol');
    await panel.getByLabel('afterScore').check();
    await panel.getByLabel('Preset name').fill('Five character attempts');
    await panel.getByRole('button',{name:'Save preset'}).click();
    await expect(panel.getByLabel('Load preset')).toContainText('five-character-attempts');
    await panel.getByLabel('Attempts',{exact:true}).fill('3');await panel.getByLabel('Load preset').selectOption('five-character-attempts');await expect(panel.getByLabel('Attempts',{exact:true})).toHaveValue('5');
    await panel.getByRole('button',{name:'Launch workshop'}).click();
    await expect(panel).toContainText('checkpoint');await expect(panel).toContainText('gpt-5.6-sol');
    let sessions=f.runtime.journal.list<{id:string;stage:string;activeIteration:number;assignment:Record<string,unknown>}>(f.runtime.run,'workshopSessions');expect(sessions).toHaveLength(1);expect(sessions[0]?.assignment).toMatchObject({construction:'character',iterations:{attempts:5},checkpoints:{afterScore:true},models:{overrides:{designer:{reasoningEffort:'medium'},scorer:{modelId:'gpt-5.6-sol'},learnings:{modelId:'gpt-5.6-sol'}}}});const assistedId=sessions[0]!.id;await panel.getByTestId(`checkpoint-${assistedId}`).getByRole('button',{name:'Continue'}).click();await expect.poll(()=>f.runtime.journal.get<{stage:string;activeIteration:number}>(f.runtime.run,'workshopSessions',assistedId)).toMatchObject({stage:'checkpoint',activeIteration:2});await expect(panel.locator('.workshop-row').filter({hasText:'Produce 60 electronic circuits'}).first()).toContainText('iteration 2');await panel.getByTestId(`checkpoint-${assistedId}`).getByRole('button',{name:'Finish'}).click();await expect.poll(()=>f.runtime.journal.get<{stage:string}>(f.runtime.run,'workshopSessions',assistedId)?.stage).toBe('complete');sessions=f.runtime.journal.list(f.runtime.run,'workshopSessions') as typeof sessions;
    const bad={...sessions[0]!.assignment,id:'unsupported-selection',comparisonSeries:'new-series',models:{sessionDefault:{provider:'other',modelId:'unknown',reasoningEffort:'low'},overrides:{}}};const response=await server.app.inject({method:'POST',url:'/api/workshop/launch',headers:{host:new URL(origin).host,origin,authorization:'Bearer '+server.capability},payload:{assignment:bad}});expect(response.statusCode).toBe(400);expect(response.body).toContain('unavailable');expect(f.runtime.journal.list(f.runtime.run,'workshopSessions')).toHaveLength(1);
    await page.close();page=await context.newPage();await page.goto(url);
    const reopened=page.getByTestId('workshop');await expect(reopened).toContainText('Produce 60 electronic circuits');await reopened.getByLabel('Construction').selectOption('direct');await reopened.getByLabel('afterScore').uncheck();await reopened.getByLabel('libraryAdmission').check();await reopened.getByLabel('learningActivation').check();await reopened.getByRole('button',{name:'Launch workshop'}).click();await page.close();page=await context.newPage();await page.goto(url);const direct=()=>f.runtime.journal.list<{id:string;stage:string;checkpoint:{kind:string}|null;iterations:unknown[]}>(f.runtime.run,'workshopSessions').find(value=>value.id!==assistedId)!;await expect.poll(()=>direct()).toMatchObject({stage:'checkpoint',checkpoint:{kind:'libraryAdmission'}});const directPanel=page.getByTestId(`checkpoint-${direct().id}`);await directPanel.getByRole('button',{name:'Continue'}).click();await expect.poll(()=>direct().stage).toBe('complete');await expect(page.getByTestId('workshop')).toContainText('no-change');expect(f.runtime.journal.list(f.runtime.run,'learningOutcomes')).toHaveLength(1);expect(f.runtime.journal.list(f.runtime.run,'workshopSessions')).toHaveLength(2);expect(direct().iterations).toHaveLength(5);
  }finally{await context.close();await server.close();f.close();}
});
