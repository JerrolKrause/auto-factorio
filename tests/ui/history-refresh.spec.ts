import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dashboardFixture } from '../../scripts/dev/dashboard-fixture.js';
import { dashboard } from '../../apps/runtime/http.js';
import { WorkspaceCatalog } from '../../packages/storage/src/workspace-catalog.js';

function assignment(id: string, objective: string) {
  return { id, objective, comparisonSeries: `series-${id}`, revision: 1 } as never;
}

function recordRun(f: Awaited<ReturnType<typeof dashboardFixture>>, catalog: WorkspaceCatalog, id: string, objective: string, groupId: string | null = null) {
  const identity = catalog.beginWorkshop(f.runtime.directory, f.runtime.run, assignment(id, objective), groupId);
  f.runtime.record('workspace/identity-recorded', [
    { entity: 'workspaceGroups', id: identity.group.id, value: { ...identity.group } },
    { entity: 'workspaceRuns', id, value: { ...identity.run } },
  ]);
  catalog.journaled(id);
  return identity;
}

async function fixture() {
  const liveRoot = path.resolve('.runtime/workspace-resume/pagination-repro/live'); mkdirSync(liveRoot, { recursive: true });
  const root = mkdtempSync(path.join(liveRoot, 'fixture-'));
  const f = await dashboardFixture(path.join(root, 'runtime'), true);
  const catalog = new WorkspaceCatalog(root);
  const server = dashboard(f.operator, path.resolve('apps/dashboard/dist'), { workspaceCatalog: catalog });
  const origin = await server.listen();
  return { root, f, catalog, server, origin, close: async () => { await server.close(); catalog.close(); f.close(); rmSync(root, { recursive: true, force: true }); } };
}

async function advanceBrowserCursor(f: Awaited<ReturnType<typeof dashboardFixture>>, id: string) {
  f.runtime.record('pagination-repro/cursor-advance', [{ entity: 'workshopOperations', id, value: { id } }], { kind: 'operator' });
  await f.operator.poll();
  return f.runtime.journal.cursor();
}

test('history keeps every loaded group and run across an SSE cursor refresh', async ({ page }, testInfo) => {
  const env = await fixture();
  try {
    const target = recordRun(env.f, env.catalog, 'target-run-000', 'Target brief with many runs');
    for (let index = 1; index <= 51; index++) recordRun(env.f, env.catalog, `target-run-${String(index).padStart(3, '0')}`, 'Target brief with many runs', target.group.id);
    for (let index = 1; index <= 51; index++) recordRun(env.f, env.catalog, `other-run-${String(index).padStart(3, '0')}`, `Other brief ${String(index).padStart(3, '0')}`);

    await page.goto(`${env.origin}/history`);
    const groupRows = page.locator('.history-layout button.history-row');
    const runRows = page.locator('.history-layout a.history-row');
    await expect(groupRows).toHaveCount(50);
    await page.getByRole('button', { name: 'More groups', exact: true }).click();
    await expect(groupRows).toHaveCount(52);
    const targetGroup = page.getByRole('button', { name: /Target brief with many runs/ });
    await targetGroup.click();
    await expect(runRows).toHaveCount(50);
    await page.getByRole('button', { name: 'More runs', exact: true }).click();
    await expect(runRows).toHaveCount(52);

    const previousCursor = await page.locator('.run small').textContent();
    const cursor = await advanceBrowserCursor(env.f, 'groups-and-runs');
    await expect(page.locator('.run small')).toContainText(`Event ${cursor}`);
    await page.screenshot({ path: testInfo.outputPath('before-retained-prefix-assertion.png'), fullPage: true });
    writeFileSync(testInfo.outputPath('cursor-evidence.json'), JSON.stringify({ previousCursor, cursor, loadedGroups: 52, loadedRuns: 52 }, null, 2));

    // Loaded history and selection must survive a cursor-driven refresh.
    await expect(groupRows).toHaveCount(52);
    await expect(targetGroup).toHaveAttribute('aria-pressed', 'true');
    await expect(runRows).toHaveCount(52);
  } finally { await env.close(); }
});

test('run detail preserves inspected state and safely resumes delayed scoped pages after same-run refresh', async ({ page }, testInfo) => {
  const env = await fixture();
  try {
    const runId = 'run-detail-refresh';
    recordRun(env.f, env.catalog, runId, 'Retain attempt evidence');
    for (let ordinal = 1; ordinal <= 120; ordinal++) {
      env.catalog.recordAttempt({ schema: 1, id: `${runId}:${ordinal}`, runId, ordinal, sourceId: `${runId}:${ordinal}`, coverage: 'recorded' });
      env.f.runtime.record('workshop/attempt-fixture', [{ entity: 'workshopIterations', id: `${runId}:${ordinal}`, value: { id: `${runId}:${ordinal}`, sessionId: runId, ordinal } }]);
    }

    let releaseAttempts!: () => void, releaseEvents!: () => void, attemptsStarted!: () => void, eventsStarted!: () => void;
    const attemptsHeld = new Promise<void>(resolve => { releaseAttempts = resolve; });
    const eventsHeld = new Promise<void>(resolve => { releaseEvents = resolve; });
    const attemptsReady = new Promise<void>(resolve => { attemptsStarted = resolve; });
    const eventsReady = new Promise<void>(resolve => { eventsStarted = resolve; });
    await page.route(url => url.pathname.endsWith(`/api/workspace/runs/${runId}/attempts`) && url.searchParams.has('cursor'), async route => {
      const response = await route.fetch(); attemptsStarted(); await attemptsHeld; await route.fulfill({ response });
    });
    await page.route(url => url.pathname.endsWith(`/api/workspace/runs/${runId}/events`) && url.searchParams.has('cursor'), async route => {
      const response = await route.fetch(); eventsStarted(); await eventsHeld; await route.fulfill({ response });
    });

    await page.goto(`${env.origin}/history/${runId}`);
    const attemptRows = page.locator('.workspace-page .history-row').filter({ has: page.locator('button[aria-expanded]') });
    await expect(page.getByRole('button', { name: 'More attempts' })).toBeVisible();
    await page.getByRole('button', { name: 'Attempt 1 · run-detail-refresh:1', exact: true }).click();
    await expect(page.locator('.workspace-page button.event')).toHaveCount(1);
    await page.locator('.workspace-page button.event').first().click();
    await expect(page.getByRole('heading', { name: /Recorded event/ })).toBeVisible();
    await page.getByRole('button', { name: 'More attempts' }).click();
    await page.getByRole('button', { name: 'More activity' }).click();
    await Promise.all([attemptsReady, eventsReady]);

    const lateAttempts = page.waitForResponse(response => response.url().includes(`/runs/${runId}/attempts?`) && response.url().includes('cursor='));
    const lateEvents = page.waitForResponse(response => response.url().includes(`/runs/${runId}/events?`) && response.url().includes('cursor='));
    env.catalog.recordAttempt({ schema: 1, id: `${runId}:121`, runId, ordinal: 121, sourceId: `${runId}:121`, coverage: 'recorded' });
    env.f.runtime.record('workshop/attempt-fixture', [{ entity: 'workshopIterations', id: `${runId}:121`, value: { id: `${runId}:121`, sessionId: runId, ordinal: 121 } }]);
    const cursor = await advanceBrowserCursor(env.f, 'same-run-refresh');
    await expect(page.locator('.run small')).toContainText(`Event ${cursor}`);
    await expect(page.getByRole('heading', { name: /Recorded event/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Attempt 1 · run-detail-refresh:1', exact: true })).toHaveAttribute('aria-expanded', 'true');
    releaseAttempts(); releaseEvents(); await Promise.all([lateAttempts, lateEvents]);
    await expect(attemptRows).toHaveCount(100);
    await expect(page.locator('.workspace-page button.event')).toHaveCount(1);
    const ids = await page.getByRole('button', { name: /^Attempt \d+ · run-detail-refresh:/ }).allTextContents();
    expect(new Set(ids).size).toBe(ids.length);
    await expect(page.getByRole('heading', { name: /Recorded event/ })).toBeVisible();

    // The selected attempt intentionally narrows its timeline; clear the filter only after proving it survived refresh.
    await page.getByRole('button', { name: 'Attempt 1 · run-detail-refresh:1', exact: true }).click();
    await expect(page.locator('.workspace-page button.event')).toHaveCount(100);
    await page.locator('.workspace-page button.event').first().click();
    await expect(page.getByRole('heading', { name: /Recorded event/ })).toBeVisible();
    await page.getByRole('button', { name: 'More attempts' }).click();
    await expect(page.getByRole('button', { name: 'Attempt 121 · run-detail-refresh:121', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'More activity' }).click();
    await expect(page.locator('.workspace-page button.event')).toHaveCount(122);
    const eventSequences = await page.locator('.workspace-page button.event span').allTextContents();
    expect(new Set(eventSequences).size).toBe(eventSequences.length);
    await page.screenshot({ path: testInfo.outputPath('run-detail-after-refresh.png'), fullPage: true });
  } finally { await env.close(); }
});

test('a failed summary from a prior group cannot replace or reinstate the selected group result', async ({ page }) => {
  const env = await fixture();
  let releaseDelayedFailure!: () => void, delayedFailureStarted!: () => void, delayedFailureSettled!: () => void;
  const delayedFailure = new Promise<void>(resolve => { releaseDelayedFailure = resolve; });
  const delayedReady = new Promise<void>(resolve => { delayedFailureStarted = resolve; });
  const delayedSettled = new Promise<void>(resolve => { delayedFailureSettled = resolve; });
  try {
    const groupA = recordRun(env.f, env.catalog, 'summary-group-a-run', 'Summary group A').group;
    const groupB = recordRun(env.f, env.catalog, 'summary-group-b-run', 'Summary group B').group;
    let summaryAFailures = 0;
    await page.route(url => url.pathname === `/api/workspace/groups/${groupA.id}/summary`, async route => {
      summaryAFailures++;
      if (summaryAFailures === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'summary-failure-a' }) });
        return;
      }
      delayedFailureStarted();
      await delayedFailure;
      try { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'stale-summary-failure-a' }) }); }
      finally { delayedFailureSettled(); }
    });

    await page.goto(`${env.origin}/history`);
    const groupAButton = page.getByRole('button', { name: /Summary group A/ });
    if (await groupAButton.getAttribute('aria-pressed') !== 'true') await groupAButton.click();
    await expect.poll(() => summaryAFailures).toBe(1);
    await expect(page.getByRole('alert')).toContainText('summary-failure-a');

    const groupBButton = page.getByRole('button', { name: /Summary group B/ });
    const firstBResponse = page.waitForResponse(response => response.url().endsWith(`/api/workspace/groups/${groupB.id}/summary`));
    await groupBButton.click();
    await firstBResponse;
    const summary = page.locator('.history-layout > div').nth(1).locator('p.hint');
    await expect(summary).toContainText('all-recorded-runs');
    await expect(page.getByRole('alert')).toHaveCount(0);

    await groupAButton.click();
    await delayedReady;
    const secondBResponse = page.waitForResponse(response => response.url().endsWith(`/api/workspace/groups/${groupB.id}/summary`));
    await groupBButton.click();
    await secondBResponse;
    await expect(summary).toContainText('all-recorded-runs');
    releaseDelayedFailure();
    await delayedSettled;
    await expect(groupBButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(summary).toContainText('all-recorded-runs');
  } finally { releaseDelayedFailure(); await env.close(); }
});
