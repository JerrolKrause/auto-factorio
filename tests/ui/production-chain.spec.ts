import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProductionPlan, ProductionProduct, ProductionStage } from '@autofactorio/contracts';
import { dashboard } from '../../apps/runtime/http.js';
import { dashboardFixture } from '../../scripts/dev/dashboard-fixture.js';
import { digest } from '../../packages/core/production/graph.js';

const canary = 'private-evaluator-canary-must-not-appear';
const product = (name: string): ProductionProduct => ({ kind: 'item', name, quality: 'normal', surface: 'nauvis' });

function stage(index: number): ProductionStage {
  return {
    id: `stage-${index}`, recipe: index === 0 ? 'iron-plate' : `intermediate-${index}`,
    machine: 'stone-furnace', inputs: ['iron-ore'], outputs: ['iron-plate'],
    meaning: `Produce ${index === 0 ? 'iron plate' : `intermediate ${index}`}`,
    evidence: [`stage-evidence-${index}`], crafts: { numerator: '2', denominator: '1' },
    nominalCraftsPerSecond: { numerator: index === 0 ? '1' : '5', denominator: '1' },
  };
}

function plan(id: string, name: string, stages: ProductionStage[], revision = 1): ProductionPlan {
  return {
    schema: 1, id, revision,
    request: { target: product(name) } as ProductionPlan['request'],
    fingerprint: 'a'.repeat(64), availabilityRevision: 'fixture-availability',
    status: 'feasible', executable: true, routePolicy: 'fixture', routes: {}, stages,
    products: stages.flatMap(row => row.outputs), blockers: [], assumptions: [], balances: [],
    transport: [], omitted: 0, invalidatedEvidence: [],
  };
}

function recordPlan(f: Awaited<ReturnType<typeof dashboardFixture>>, id: string, revision: number, name: string) {
  const row = stage(0), value = { owner: 'foreman', planId: id, revision, plan: plan(id, name, [row], revision) };
  f.runtime.record('fixture/production-plan', [{ entity: 'productionPlans', id: `${id}.${revision}`, value }]);
  return row;
}

function recordLiveTaskBinding(f: Awaited<ReturnType<typeof dashboardFixture>>, planId: string, revision: number, row: ProductionStage) {
  const task = {
    id: 'live-stage-task', goal: row.meaning, parent: null, owner: 'foreman', dependencies: [], scope: {}, resources: {},
    successCriteria: ['Construction recorded'], deadline: null, revision: 4, committedPlan: `${planId}.${revision}/${row.id}`,
    status: 'assigned', evidence: [], manager: 'foreman', actor: null, reservations: [], criteria: [], wait: null,
    epoch: f.runtime.context().epoch,
  };
  const binding = {
    id: `${planId}.${revision}.${digest(row.id).slice(0, 16)}`, owner: 'foreman', planId, revision,
    stage: row.id, meaning: row.meaning, task: task.id, taskRevision: task.revision, active: true,
  };
  f.runtime.record('fixture/production-task-binding', [
    { entity: 'tasks', id: task.id, value: task },
    { entity: 'productionBindings', id: binding.id, value: binding },
  ]);
}

function seedProduction(f: Awaited<ReturnType<typeof dashboardFixture>>) {
  const runtime = f.runtime;
  const finalId = `plan.${'0'.repeat(31)}a`;
  for (let index = 0; index < 11; index++) {
    const id = `plan.${index.toString(16).padStart(32, '0')}`;
    const rows = index === 10 ? Array.from({ length: 5 }, (_, stageIndex) => stage(stageIndex)) : [stage(0)];
    const value = { owner: 'foreman', planId: id, revision: 1, plan: plan(id, `production-target-${index + 1}`, rows) };
    runtime.record('fixture/production-plan', [{ entity: 'productionPlans', id: `${id}.1`, value }]);
  }

  const stages = Array.from({ length: 5 }, (_, index) => stage(index));
  const bindingRows = stages.slice(0, 2).map((row, index) => {
    const taskId = index === 0 ? 'completed-stage-task' : 'pending-stage-task';
    const task = {
      id: taskId, goal: row.meaning, parent: null, owner: 'foreman', dependencies: [], scope: {}, resources: {},
      successCriteria: ['Construction recorded'], deadline: null, revision: index === 0 ? 3 : 2,
      committedPlan: `${finalId}.1/${row.id}`, status: index === 0 ? 'succeeded' : 'assigned',
      evidence: index === 0 ? ['construction-receipt-fixture'] : [], manager: 'foreman', actor: null,
      reservations: [], criteria: [], wait: null, epoch: runtime.context().epoch,
    };
    const binding = {
      id: `${finalId}.1.${digest(row.id).slice(0, 16)}`, owner: 'foreman', planId: finalId,
      revision: 1, stage: row.id, meaning: row.meaning, task: taskId, taskRevision: task.revision, active: true,
    };
    return { task, binding };
  });
  for (const { task, binding } of bindingRows) {
    runtime.record('fixture/production-task-binding', [
      { entity: 'tasks', id: task.id, value: task },
      { entity: 'productionBindings', id: binding.id, value: binding },
    ]);
  }

  const privateStatusId = `${finalId}.1.${digest(stages[0]!.id).slice(0, 16)}`;
  runtime.record('fixture/private-evaluator-status', [{
    entity: 'productionStatuses', id: privateStatusId,
    value: { id: privateStatusId, planned: [], stale: false, evaluationFixture: canary },
    visibility: { kind: 'restricted', agents: [], roles: [], tasks: ['completed-stage-task'] },
  }]);
  return { id: finalId, revision: 1 };
}

async function inspectFirstStage(page: Page, target: string) {
  const plans = page.getByRole('region', { name: 'Production plans' });
  await expect(plans.getByText(target, { exact: true })).toBeVisible();
  await plans.getByRole('button', { name: 'Inspect stages' }).click();
  const stages = page.locator('[aria-label="Production stage progress"]');
  await expect(stages.getByRole('heading', { name: `${target} · revision 1` })).toBeVisible();
  return { plans, stages };
}

test('S4A production control-room pages preserve task evidence and unknown health across browser reopen', async ({ browser }) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'af-ui-production-chain-'));
  const f = await dashboardFixture(path.join(root, 'dashboard', 'run-fixture'));
  const { id, revision } = seedProduction(f);
  const server = dashboard(f.operator);
  const origin = await server.listen();
  const context = await browser.newContext();
  let page = await context.newPage();
  try {
    await page.goto(`${origin}/scenarios`);
    await expect(page.getByRole('heading', { name: 'Control room.' })).toBeVisible();
    const plans = page.getByRole('region', { name: 'Production plans' });
    await expect(plans.getByRole('button', { name: 'Next plans (1 remaining)' })).toBeVisible();
    await plans.getByRole('button', { name: 'Next plans (1 remaining)' }).click();
    await expect(plans.getByText('production-target-11', { exact: true })).toBeVisible();

    const stages = page.locator('[aria-label="Production stage progress"]');
    await plans.getByRole('button', { name: 'Inspect stages' }).click();
    await expect(stages.getByText('Task completed-stage-task · revision 3 · construction complete · health shortfall')).toBeVisible();
    await expect(stages.getByText('Hypothesis: Input supply, output blockage or utility loss may explain shortfall; these are hypotheses, not established root causes.')).toBeVisible();
    await expect(stages.getByText('Task pending-stage-task · revision 2 · construction pending · health unknown')).toBeVisible();
    await expect(stages.getByText('unknown: No current observed stage binding; construction is not production evidence.').first()).toBeVisible();
    await expect(stages.getByRole('button', { name: 'Next stages (1 remaining)' })).toBeVisible();

    await stages.getByRole('button', { name: 'Stage evidence' }).first().click();
    await expect(page.locator('.detail pre')).toContainText('completed-stage-task');
    await expect(page.locator('.detail pre')).toContainText('construction-receipt-fixture');
    await expect(page.locator('body')).not.toContainText(canary);
    const responseText = await page.evaluate(async ({ planId, planRevision }) => {
      const response = await fetch(`/api/production/plans/${planId}/${planRevision}/stages`);
      return response.text();
    }, { planId: id, planRevision: revision });
    expect(responseText).not.toContain(canary);
    await stages.getByRole('button', { name: 'Next stages (1 remaining)' }).click();
    await expect(stages.getByText('intermediate-4', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('region', { name: 'Production plans' })).toBeVisible();
    await page.getByRole('region', { name: 'Production plans' }).getByRole('button', { name: 'Next plans (1 remaining)' }).click();
    const reopened = await inspectFirstStage(page, 'production-target-11');
    await expect(reopened.stages.getByText('Task completed-stage-task · revision 3 · construction complete · health shortfall')).toBeVisible();
    await reopened.stages.getByRole('button', { name: 'Stage evidence' }).first().click();
    await expect(page.locator('.detail pre')).toContainText('completed-stage-task');

    await page.close();
    page = await context.newPage();
    await page.goto(`${origin}/scenarios`);
    await page.getByRole('region', { name: 'Production plans' }).getByRole('button', { name: 'Next plans (1 remaining)' }).click();
    const newBrowser = await inspectFirstStage(page, 'production-target-11');
    await expect(newBrowser.stages.getByText('Task completed-stage-task · revision 3 · construction complete · health shortfall')).toBeVisible();
    await newBrowser.stages.getByRole('button', { name: 'Stage evidence' }).first().click();
    await expect(page.locator('.detail pre')).toContainText('completed-stage-task');
    await expect(page.locator('body')).not.toContainText(canary);
  } finally {
    await context.close();
    await server.close();
    f.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('S4A live production plans discover revisions without navigation and preserve selected stage revision', async ({ browser }) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'af-ui-production-live-plans-'));
  const f = await dashboardFixture(path.join(root, 'dashboard', 'run-fixture'));
  const server = dashboard(f.operator), origin = await server.listen();
  const context = await browser.newContext(), page = await context.newPage();
  const id = `plan.${'f'.repeat(32)}`;
  let holdOneResponse = false, releaseOldResponse!: () => void, oldRequestEntered!: () => void, oldResponseFinished!: () => void;
  let oldRequest = new Promise<void>(resolve => { oldRequestEntered = resolve; });
  let oldResponse = new Promise<void>(resolve => { oldResponseFinished = resolve; });
  let releaseOld = new Promise<void>(resolve => { releaseOldResponse = resolve; });
  try {
    await page.goto(`${origin}/scenarios`);
    await expect(page.getByRole('heading', { name: 'Control room.' })).toBeVisible();
    const plans = page.getByRole('region', { name: 'Production plans' });
    await expect(page.getByText('No production plans recorded.')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();

    await page.route('**/api/production/plans?offset=0', async route => {
      if (!holdOneResponse) { await route.continue(); return; }
      holdOneResponse = false;
      const response = await route.fetch();
      oldRequestEntered();
      await releaseOld;
      await route.fulfill({ response });
      oldResponseFinished();
    });

    const firstStage = recordPlan(f, id, 1, 'live-production-target');
    recordLiveTaskBinding(f, id, 1, firstStage);
    const revisionOne = plans.locator('article.task').filter({ hasText: 'Revision 1 · feasible · 1 stages' });
    await expect(revisionOne.getByText('live-production-target', { exact: true })).toBeVisible();
    await revisionOne.getByRole('button', { name: 'Inspect stages' }).click();
    const progress = page.locator('[aria-label="Production stage progress"]');
    await expect(progress.getByRole('heading', { name: 'live-production-target · revision 1' })).toBeVisible();
    await expect(progress.getByText('Task live-stage-task · revision 4 · construction pending · health shortfall')).toBeVisible();

    recordPlan(f, id, 2, 'live-production-target');
    const revisionTwo = plans.locator('article.task').filter({ hasText: 'Revision 2 · feasible · 1 stages' });
    await expect(revisionTwo.getByText('live-production-target', { exact: true })).toBeVisible();
    await expect(revisionOne).toBeVisible();
    await expect(progress.getByRole('heading', { name: 'live-production-target · revision 1' })).toBeVisible();
    await expect(progress.getByText('Task live-stage-task · revision 4 · construction pending · health shortfall')).toBeVisible();

    const manualRefresh = page.waitForResponse(response => response.url() === `${origin}/api/production/plans?offset=0` && response.request().method() === 'GET');
    await plans.getByRole('button', { name: 'Refresh production plans' }).click();
    const refreshed = await manualRefresh;
    expect((await refreshed.json() as { plans: { revision: number }[] }).plans.map(item => item.revision)).toEqual([1, 2]);
    await expect(progress.getByRole('heading', { name: 'live-production-target · revision 1' })).toBeVisible();

    holdOneResponse = true;
    oldRequest = new Promise<void>(resolve => { oldRequestEntered = resolve; });
    oldResponse = new Promise<void>(resolve => { oldResponseFinished = resolve; });
    releaseOld = new Promise<void>(resolve => { releaseOldResponse = resolve; });
    recordPlan(f, id, 3, 'live-production-target');
    await oldRequest;
    recordPlan(f, id, 4, 'live-production-target');
    const revisionFour = plans.locator('article.task').filter({ hasText: 'Revision 4 · feasible · 1 stages' });
    await expect(revisionFour.getByText('live-production-target', { exact: true })).toBeVisible();
    releaseOldResponse();
    await oldResponse;
    await expect(revisionFour).toBeVisible();
    await expect(plans.locator('article.task').filter({ hasText: 'Revision 3 · feasible · 1 stages' })).toBeVisible();
    await expect(progress.getByRole('heading', { name: 'live-production-target · revision 1' })).toBeVisible();
  } finally {
    releaseOldResponse();
    await context.close();
    await server.close();
    f.close();
    rmSync(root, { recursive: true, force: true });
  }
});
