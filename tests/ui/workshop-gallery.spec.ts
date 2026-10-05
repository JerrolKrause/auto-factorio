import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dashboardFixture } from '../../scripts/dev/dashboard-fixture.js';
import { dashboard } from '../../apps/runtime/http.js';
import { LiveWorkshopHost } from '../../apps/runtime/workshop-live-host.js';
import type { WorkshopGame, WorkshopInference } from '../../apps/runtime/workshop-live-host.js';
import type { BlueprintDocument, WorkshopEvaluationReport } from '@autofactorio/contracts';
import { effectReceipt } from '@autofactorio/contracts';
import { WorkspaceCatalog } from '../../packages/storage/src/workspace-catalog.js';
import { snapshotFile } from '../../apps/runtime/workshop-snapshot.js';

async function waitForWorkshopOptions(page: Page) {
  await expect(page.getByLabel('Session model').locator('option[value="gpt-6-astra"]')).toHaveCount(1);
}
const inferenceResult = (text: string) => ({ text, usage: { turns: 1, tools: 1, elapsedMs: 1, tokens: 1 } });

test('live measured attempts appear in the gallery and the final build runs until Stop', async ({ browser }) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'af-ui-workshop-gallery-'));
  const f = await dashboardFixture(path.join(root, 'dashboard', 'run-fixture'), true);
  const catalog = new WorkspaceCatalog(root);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5xkAAAAASUVORK5CYII=', 'base64');
  let secondDesignStarted = false, releaseSecondDesign!: () => void;
  const secondDesignGate = new Promise<void>(resolve => { releaseSecondDesign = resolve; });
  let observeCalls = 0, stopObservationCalls = 0;
  const inference: WorkshopInference = {
    async invoke(session, role, _selection, observation) {
      if (role === 'workshop-designer') {
        if (session.activeIteration === 2) { secondDesignStarted = true; await secondDesignGate; }
        const assignment = (observation as { assignment: { ports: BlueprintDocument['ports'] } }).assignment;
        return inferenceResult(JSON.stringify({ schema: 1, label: `Gallery attempt ${session.activeIteration}`, description: 'Measured candidate', entities: [{ id: 'assembler', entityNumber: 1, name: 'assembling-machine-1', position: { x: 0, y: 0 }, direction: 0, quality: 'normal', recipe: 'electronic-circuit' }], wires: [], ports: assignment.ports, icons: [{ index: 1, name: 'electronic-circuit' }], tiles: [] }));
      }
      if (role === 'workshop-scorer') return inferenceResult(JSON.stringify({ schema: 1, summary: 'Measured production candidate', findings: [] }));
      return inferenceResult(JSON.stringify({ decision: 'no-change', reason: 'No repeated failure', evidence: ['measured-attempts'] }));
    },
    cancel: id => effectReceipt(`inference:${id}`, 'cancelled'),
    async close() {},
  };
  const game: WorkshopGame = {
    async resolveProfile(profileId, product) {
      return { gameVersion: '2.0.77', mods: { base: '2.0.77' }, profileId, profileRevision: 1, surface: 'nauvis', technologies: ['automation', 'electronics'], allowedEquipment: ['assembling-machine-1', 'transport-belt', 'inserter', 'small-electric-pole'], modules: [], beacons: [], recipe: { id: product, category: 'crafting', energy: 0.5, ingredients: [{ type: 'item', name: 'iron-plate', amount: 1 }], products: [{ type: 'item', name: product, amount: 1 }] }, machine: 'assembling-machine-1' };
    },
    async build(session) { return { id: `${session.id}-${session.activeIteration}`, generation: 1, surface: 'gallery-fixture', characterEvidence: null }; },
    async measure(session): Promise<WorkshopEvaluationReport> {
      const rule = session.assignment.throughput[0]!, port = session.assignment.ports.find(value => value.id === rule.portId)!;
      return { schema: 1, attemptId: `${session.id}:${session.activeIteration}`, valid: true, passed: true, reasons: [], ports: [{ portId: port.id, windows: Array.from({ length: rule.windows }, (_, index) => ({ index, required: { numerator: '1', denominator: '1' }, productionLower: { numerator: '60', denominator: '1' }, deliveryLower: { numerator: '60', denominator: '1' }, passed: true, reasons: [] })) }], evidence: ['gallery-measurement'] };
    },
    async screenshot(_built, token) { const file = path.join(root, `${token}.png`); writeFileSync(file, png); return { path: file, tick: 812 }; },
    async observe() { observeCalls++; return true; },
    async stopObservation() { stopObservationCalls++; },
    cancel: id => effectReceipt(`game:${id}`, 'cancelled'),
  };
  const host = Object.assign(new LiveWorkshopHost(f.runtime.directory, inference, game), { profileReader: (profileId: string) => game.resolveProfile(profileId, 'electronic-circuit') });
  const server = dashboard(f.operator, undefined, { workspaceCatalog: catalog, managedModels: [{ id: 'gpt-6-astra', displayName: 'Astra', efforts: ['low'] }], workshopHost: host });
  const origin = await server.listen(), context = await browser.newContext(), page = await context.newPage();
  try {
    await page.goto(`${origin}/workshop`);
    const panel = page.getByTestId('workshop');
    await waitForWorkshopOptions(page);
    await panel.locator('textarea').fill('Produce 60 electronic circuits per minute');
    await page.getByText('Advanced settings').click();
    await panel.getByLabel('Attempts', {exact:true}).fill('2');
    await panel.getByLabel('Stop early after a plateau').uncheck();
    await panel.getByLabel('Improvement cadence').selectOption('off');
    const firstImageResponse = page.waitForResponse(response => response.url().includes('/snapshots/1'));
    await panel.getByRole('button', { name: 'Launch workshop' }).click();
    await expect(page).toHaveURL(/\/history\//);
    const runId = new URL(page.url()).pathname.split('/').at(-1)!;

    await expect.poll(() => secondDesignStarted).toBe(true);
    await expect(page.getByRole('heading', { name: 'Build progression' })).toBeVisible();
    const image = page.getByRole('img', { name: 'Final build, attempt 1' });
    await expect(image).toBeVisible();
    await expect(page.locator('.build-gallery')).toContainText('Attempt 1');
    const imageResponse = await firstImageResponse;
    expect(imageResponse.status()).toBe(200);
    expect(imageResponse.headers()['content-type']).toContain('image/png');
    expect(await imageResponse.body()).toEqual(png);
    expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'View final build for attempt 1' }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/\/snapshots\/1$/);
    await expect(popup.locator('img')).toBeVisible();
    await popup.close();

    const reloadedImageResponse = page.waitForResponse(response => response.url().includes('/snapshots/1'));
    await page.reload();
    await expect(page.getByRole('img', { name: 'Final build, attempt 1' })).toBeVisible();
    expect((await reloadedImageResponse).status()).toBe(200);
    expect(await (await reloadedImageResponse).body()).toEqual(png);
    const missingImage = await page.request.get(`${origin}/api/workspace/runs/${encodeURIComponent(runId)}/snapshots/99`);
    expect(missingImage.status()).toBe(404);
    writeFileSync(snapshotFile(f.runtime.directory, runId, 1), Buffer.from('tampered screenshot'));
    const tamperedImage = await page.request.get(`${origin}/api/workspace/runs/${encodeURIComponent(runId)}/snapshots/1`);
    expect(tamperedImage.status()).toBe(404);

    releaseSecondDesign();
    await expect(page.getByRole('status').filter({ hasText: 'The last attempt keeps producing until you stop it' })).toBeVisible();
    expect(catalog.owner()?.id).toBe(runId);
    expect(catalog.request(runId)?.state).toBe('active');
    expect(observeCalls).toBe(1);
    await page.locator('.workspace-page').getByRole('button', { name: 'Stop run', exact: true }).click();
    await expect.poll(() => catalog.request(runId)?.state).toBe('completed');
    await expect.poll(() => f.runtime.journal.get<{ stage: string; finalOutcome: string; iterations: { score: { eligible: boolean } }[] }>(f.runtime.run, 'workshopSessions', runId)).toMatchObject({ stage: 'complete', finalOutcome: 'best-valid', iterations: [{ score: { eligible: true } }, { score: { eligible: true } }] });
    expect(catalog.owner()).toBeNull();
    expect(stopObservationCalls).toBe(1);
  } catch(error) {
    writeFileSync('.runtime/workshop-gallery/browser-diagnosis.json',JSON.stringify({dom:await page.locator('.workspace-page').innerText().catch(()=>'page closed'),sessions:f.runtime.journal.list(f.runtime.run,'workshopSessions')},null,2));
    throw error;
  } finally {
    releaseSecondDesign();
    await context.close(); await server.close(); catalog.close(); f.close();
  }
});
