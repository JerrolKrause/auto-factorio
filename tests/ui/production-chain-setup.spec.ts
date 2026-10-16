import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dashboardFixture } from '../../scripts/dev/dashboard-fixture.js';
import { dashboard } from '../../apps/runtime/http.js';

const models=[{id:'gpt-6-astra',displayName:'Astra',efforts:['low','medium']}];
const draftKey='autofactorio.workshop.draft.v1';

test('chain setup keeps its own profile and boundary through mode switches and browser reload',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-chain-setup-'));
  const f=await dashboardFixture(path.join(root,'dashboard','fixture'),true),server=dashboard(f.operator,undefined,{managedModels:models}),origin=await server.listen();
  try{
    await page.goto(origin+'/workshop');const panel=page.getByTestId('workshop');
    const mode=panel.getByLabel('Production mode');await mode.selectOption('chain');
    await panel.getByLabel('Target product').fill('sulfur');await panel.getByLabel('Target units per game second').fill('2.5');
    await panel.getByLabel('External input rates').fill('crude-oil 100\nwater 100');await panel.getByLabel('Co-product destination rates').fill('light-oil 25\nheavy-oil 10');
    await panel.getByLabel('Oil route').selectOption('advanced');await panel.getByLabel('Capability profile').selectOption('starter-assembly');
    await expect(panel.getByLabel('Allow library access')).toBeEnabled();
    await mode.selectOption('component');await panel.getByLabel('Capability profile').selectOption('advanced-assembly');
    await mode.selectOption('chain');
    await expect(panel.getByLabel('Capability profile')).toHaveValue('starter-assembly');
    await expect(panel.getByLabel('Target units per game second')).toHaveValue('2.5');
    await expect(panel.getByLabel('Oil route')).toHaveValue('advanced');
    const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),draftKey);
    expect(saved.values).toMatchObject({productionMode:'chain',chainProfile:'starter-assembly',chainSetup:{target:'sulfur',rate:'2.5',inputs:'crude-oil 100\nwater 100',sinks:'light-oil 25\nheavy-oil 10',oilRoute:'advanced'}});
    await page.reload();
    await expect(page.getByLabel('Production mode')).toHaveValue('chain');
    await expect(page.getByLabel('Capability profile')).toHaveValue('starter-assembly');
    await expect(page.getByLabel('Target units per game second')).toHaveValue('2.5');
    await expect(page.getByLabel('External input rates')).toHaveValue('crude-oil 100\nwater 100');
  }finally{await server.close();f.close();rmSync(root,{recursive:true,force:true});}
});

test('malformed chain fields and Improve query source are rejected before launch POST',async({page})=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'af-ui-chain-denial-'));
  const f=await dashboardFixture(path.join(root,'dashboard','fixture'),true),server=dashboard(f.operator,undefined,{managedModels:models}),origin=await server.listen();let launchPosts=0;
  await page.route('**/api/workshop/launch',async route=>{launchPosts++;await route.fulfill({status:400,json:{error:'fixture launch must remain blocked'}});});
  try{
    await page.goto(origin+'/workshop');const panel=page.getByTestId('workshop');await panel.getByLabel('Production mode').selectOption('chain');
    await expect(panel.getByLabel('Allow library access')).toBeEnabled();
    await panel.getByLabel('Target units per game second').fill('NaN');await panel.getByRole('button',{name:'Launch workshop'}).click();
    await expect(panel.getByRole('alert').filter({hasText:'positive decimal'})).toBeVisible();expect(launchPosts).toBe(0);
    await page.evaluate(key=>{const draft=JSON.parse(localStorage.getItem(key)!);draft.values.productionMode='chain';draft.values.chainProfile='production-chain';draft.values.chainSetup={target:'sulfur',rate:'1',inputs:'crude-oil 100\nwater 100',sinks:'',electricityMW:'10',equipment:'oil-refinery 5\nchemical-plant 10\npipe 200\nstorage-tank 20',oilRoute:'basic'};localStorage.setItem(key,JSON.stringify(draft));},draftKey);
    await page.goto(origin+'/workshop?improve=source-revision');
    await expect(page.getByLabel('Production mode')).toHaveValue('chain');
    await page.getByRole('button',{name:'Launch workshop'}).click();
    await expect(page.getByRole('alert').filter({hasText:'Load a revision with known boundary provenance'})).toBeVisible();
    expect(launchPosts).toBe(0);
  }finally{await page.unroute('**/api/workshop/launch');await server.close();f.close();rmSync(root,{recursive:true,force:true});}
});
