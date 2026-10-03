import { writeFile } from 'node:fs/promises';

/** Vitest's JSON reporter omits unhandled errors; its public reporter hook supplies them. */
export default class MutationRuntimeReporter {
  async onTestRunEnd(modules, unhandledErrors, reason) {
    const suites = node => node.type === 'test' ? 0 : node.errors().length + [...node.children].reduce((sum, child) => sum + suites(child), 0);
    await writeFile(process.env.AF_MUTATION_RUNTIME_REPORT, JSON.stringify({
      runtimeErrors: unhandledErrors.length + modules.reduce((sum, module) => sum + suites(module), 0), reason,
    }), 'utf8');
  }
}
