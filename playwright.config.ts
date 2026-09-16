import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests/ui', outputDir: '.runtime/ui-results', workers: 1, use: { channel: 'msedge', headless: true, viewport: { width: 1440, height: 1100 } }, reporter: [['list'], ['json', { outputFile: '.runtime/ui-results.json' }]] });
