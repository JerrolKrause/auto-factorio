import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dashboardFixture } from '../../scripts/dev/dashboard-fixture.js';
import { dashboard } from '../../apps/runtime/http.js';

test('operator watches two roles, inspects evidence, steers, controls and reopens the browser', async ({ browser }) => {
  const f = await dashboardFixture(mkdtempSync(path.join(os.tmpdir(), 'af-ui-')), true);
  const server = dashboard(f.operator); const origin = await server.listen(); const stop = f.operator.start(100);
  const context = await browser.newContext(); let page = await context.newPage();
  const url = origin + '/#cap=' + server.capability;
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
