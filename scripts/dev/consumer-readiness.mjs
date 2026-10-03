import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readEvents, summarizeEvents } from './events.mjs';
import { createEvidenceDirectory, writeNewJson } from './safe-artifacts.mjs';
import { validateVerificationRoute } from './task.mjs';

const exec = promisify(execFile);
const unavailable = (state, reason, remediation) => ({ state, reason, remediation });

export async function interactiveEvidence(files, root = process.cwd()) {
  if (!files?.length) return unavailable('unconfigured', 'No task event streams selected', 'Pass --events with real producer streams from this task; never fabricate a tally.');
  try {
    const parsed = await readEvents(files, { root });
    if (parsed.gaps.length) return { ...unavailable('failed', 'Event stream is corrupt or incomplete', 'Inspect the named gaps; preserve the original evidence.'), gaps: parsed.gaps, metrics: null };
    if (!parsed.events.length) return { state: 'empty', metrics: null, reason: 'Configured streams contain no events; no trend can be inferred' };
    return { state: 'healthy', summary: summarizeEvents(parsed), population: 'selected local events only', trends: null };
  } catch (error) { return unavailable('failed', error.message, 'Select existing readable task-owned event streams.'); }
}

export async function consumerReadiness({ loadedRoot, loadedVersion, eventFiles = [], capability = true, executable } = {}, { root = process.cwd(), execute = exec, discover = validateVerificationRoute } = {}) {
  if (!loadedRoot || !loadedVersion) throw new Error('Provide the loaded skill root and version; do not infer them from another installation');
  const evidence = await createEvidenceDirectory(root, '.runtime/consumer-readiness', 'check');
  const report = { version: 1, checkedAt: new Date().toISOString(), mode: 'interactive', checks: {}, evidence,
    upstream: 'https://github.com/JerrolKrause/agent-graph/issues/75', inference: false };
  try {
    const loaded = await realpath(loadedRoot);
    const manifest = JSON.parse(await readFile(path.join(loaded, '.claude-plugin/plugin.json'), 'utf8'));
    const env = { ...process.env, AGENT_GRAPH_KIT_ROOT: loaded };
    const result = await execute(process.execPath, ['.claude/kit-run.mjs', '--where'], { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 15000 });
    const resolved = await realpath(result.stdout.trim());
    report.checks.resolution = manifest.version === loadedVersion && resolved === loaded
      ? { state: 'healthy', version: manifest.version, strategy: 'explicit-loaded-root', coinstalledProviderIndependent: true }
      : unavailable('failed', `Loaded ${loadedVersion}; resolved manifest ${manifest.version}; same root ${resolved === loaded}`, 'Set AGENT_GRAPH_KIT_ROOT to the root of the skill loaded in this session; reload the matching skill version.');
    try {
      await execute(process.execPath, [path.join(loaded, 'lib/check-stack-sections.mjs'), '.claude/stack.md'], { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 15000 });
      const profile = await readFile(path.join(root, '.claude/stack.md'), 'utf8');
      report.checks.profile = /replace.with|TODO|<module|<command/i.test(profile)
        ? unavailable('failed', 'Profile contains placeholder configuration', 'Fill real repository commands and boundaries.') : { state: 'healthy' };
    } catch (error) { report.checks.profile = unavailable('failed', String(error.message).slice(0, 600), 'Supply the seven required real stack-profile sections.'); }
    const resolver = await import(pathToFileURL(path.join(loaded, 'skills/learnings/scripts/resolve-scopes.mjs')).href);
    const registry = await readFile(path.join(root, '.claude/learnings/scopes.yaml'), 'utf8');
    const cases = {};
    for (const [name, bytes] of [['LF', registry.replaceAll('\r\n', '\n')], ['CRLF', registry.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')]]) {
      const file = path.join(evidence, `scopes-${name}.yaml`); await writeFile(file, bytes, 'utf8');
      const meta = resolver.parseRegistryMeta(file);
      const scopes = resolver.resolve({ registry: resolver.parseRegistry(file), meta, repo: meta.repoName, files: ['scripts/dev/contract.mjs', 'mods/autofactorio/control.lua'] }).scopes;
      cases[name] = scopes;
    }
    const lf = cases.LF.includes('development') && cases.LF.includes('game');
    const crlf = cases.CRLF.includes('development') && cases.CRLF.includes('game');
    report.checks.scopes = { state: lf && (!registry.includes('\r\n') || crlf) ? 'healthy' : 'failed', cases,
      reason: !lf ? 'Required development/game scope resolution is empty or incomplete' : !crlf ? 'Installed resolver loses CRLF mappings; current LF registry is required' : 'LF and CRLF resolve expected scopes',
      remediation: 'Keep the checked-in registry and LF attribute; update the matching kit when upstream #75 provides CRLF support. Empty LF mappings require repairing the real scope registry.',
      crlfSupported: crlf, workaround: !crlf ? 'Keep .claude/learnings/scopes.yaml LF via the existing .gitattributes rule until upstream #75 fixes parsing.' : null };
    report.checks.workerGuards = unavailable('unsupported', 'Installed Claude worker hooks do not establish Codex tool enforcement', 'Use validated repository assignments and read-only review; adopt verified Codex guards from upstream #75 when released.');
  } catch (error) { report.checks.kit = unavailable('failed', error.message, 'Select an installed kit root matching the skill loaded in this session.'); }
  report.checks.agents = capability ? await discover({ root, ...(executable ? { executable } : {}) })
    : unavailable('unconfigured', 'Managed capability discovery was explicitly skipped', 'Run without --skip-capability before dispatch.');
  report.telemetry = {
    local: await interactiveEvidence(eventFiles, root),
    graphRead: unavailable('unsupported', 'Interactive AutoFactorio has no approved graph records producer/reader integration', 'Run inside configured agent-graph orchestration to use its producer and records_command; upstream #75 owns interactive integration.'),
    graphWrite: unavailable('unsupported', 'The record sink is orchestrator-owned; interactive journaling is not a durable write', 'Retain repository contract/event evidence locally; do not set an arbitrary AGENT_GRAPH_RECORD_SINK.'),
    scoreboard: unavailable('unsupported', 'No graph producer records and citation tally are attested for this interactive population', 'Use the local selected-event report; configure real upstream producer inputs before requesting graph scoreboard metrics.'),
    usage: null,
  };
  report.ready = report.checks.resolution?.state === 'healthy' && report.checks.profile?.state === 'healthy' && report.checks.scopes?.state === 'healthy' && report.checks.agents?.state === 'ready';
  report.readyMeaning = 'Repository managed dispatch prerequisites only; unsupported guards/telemetry are not included';
  await writeNewJson(path.join(evidence, 'result.json'), report);
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2), option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  consumerReadiness({ loadedRoot: option('--loaded-root'), loadedVersion: option('--loaded-version'),
    eventFiles: args.flatMap((arg, index) => arg === '--events' ? [args[index + 1]] : []), capability: !args.includes('--skip-capability'), executable: option('--codex') })
    .then(report => { console.log(JSON.stringify(report, null, 2)); if (!report.ready) process.exitCode = 1; })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
