#!/usr/bin/env node
/**
 * agent-graph-kit shim — the ONE file a consumer repo keeps in `.claude/` after the cutover.
 *
 *   node .claude/kit-run.mjs <script-relative-to-plugin-root> [args…]
 *   e.g.  node .claude/kit-run.mjs skills/pr/scripts/pr.mjs --quick
 *         node .claude/kit-run.mjs run-log/runlog.mjs journal --skill fix-issue --outcome pass --surface issue-42
 *   node .claude/kit-run.mjs --where [path]      print the plugin root (or the absolute path of `path` in it)
 *         — prose in consumer repos writes `$KIT/skills/learnings/SKILL.md`; this is how `$KIT` resolves.
 *
 * It resolves the installed plugin root and execs the script there with the caller's cwd and stdio,
 * so every dependent that used to say `node .claude/skills/<x>/scripts/<y>.mjs` (pr.config.json gates,
 * package.json scripts, settings.json hooks, skill prose) says this instead. Inside the plugin's own
 * hooks and skills `${CLAUDE_PLUGIN_ROOT}` is substituted by Claude Code and the shim is unnecessary.
 *
 * Resolution order (first hit wins; each candidate must contain a plugin manifest —
 * .claude-plugin/plugin.json or .codex-plugin/plugin.json — naming `agent-graph-kit`, so another
 * plugin's root is never mistaken for ours). The kit must resolve from a session of ANY supported
 * tool (kit-plugin spec "Kit addressing works from any supported tool's session"):
 *   1. $AGENT_GRAPH_KIT_ROOT        dev override — a checkout of agent-graph/kit
 *   2. $CLAUDE_PLUGIN_ROOT          set while a Claude plugin hook/skill turn is running
 *   3. $AGENT_GRAPH_KIT_CHECKOUT    set by the agent-graph runner for graph-spawned workers of
 *                                   every provider (the agent-graph repo checkout; its kit/ is the root)
 *   4. ~/.claude/plugins/installed_plugins.json → plugins["agent-graph-kit@<marketplace>"][*].installPath
 *   5. ~/.codex/plugins/cache/<marketplace>/agent-graph-kit/<version>/   the Codex plugin cache
 * Zero dependencies (node: builtins only). Copy verbatim; never edit the consumer copy — fix it here.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PLUGIN = 'agent-graph-kit';

export function isKitRoot(dir) {
  for (const manifest of ['.claude-plugin', '.codex-plugin']) {
    try {
      if (JSON.parse(readFileSync(join(dir, manifest, 'plugin.json'), 'utf8')).name === PLUGIN) return true;
    } catch {
      /* try the next manifest */
    }
  }
  return false;
}

function* codexCacheCandidates(home) {
  const cache = join(home, '.codex', 'plugins', 'cache');
  let marketplaces;
  try {
    marketplaces = readdirSync(cache, { withFileTypes: true });
  } catch {
    return;
  }
  for (const m of marketplaces) {
    if (!m.isDirectory()) continue;
    const pluginDir = join(cache, m.name, PLUGIN);
    let versions;
    try {
      versions = readdirSync(pluginDir, { withFileTypes: true });
    } catch {
      continue;
    }
    // newest version first, so a stale cache entry never shadows the current install
    const names = versions.filter((v) => v.isDirectory()).map((v) => v.name);
    names.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const name of names) yield join(pluginDir, name);
  }
}

export function resolveKitRoot({ env = process.env, home = homedir() } = {}) {
  for (const key of ['AGENT_GRAPH_KIT_ROOT', 'CLAUDE_PLUGIN_ROOT']) {
    if (env[key] && isKitRoot(env[key])) return resolve(env[key]);
  }
  // the runner exports the agent-graph REPO checkout; the kit source tree is its kit/ dir
  const checkout = env.AGENT_GRAPH_KIT_CHECKOUT;
  if (checkout) {
    for (const cand of [join(checkout, 'kit'), checkout]) {
      if (isKitRoot(cand)) return resolve(cand);
    }
  }
  try {
    const plugins = JSON.parse(readFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')).plugins ?? {};
    for (const [key, entries] of Object.entries(plugins)) {
      if (key.split('@')[0] !== PLUGIN) continue;
      for (const e of Array.isArray(entries) ? entries : [entries]) {
        if (e?.installPath && isKitRoot(e.installPath)) return resolve(e.installPath);
      }
    }
  } catch {
    /* no Claude registry → maybe a Codex-only machine */
  }
  for (const cand of codexCacheCandidates(home)) {
    if (isKitRoot(cand)) return resolve(cand);
  }
  return null;
}

export function main(argv = process.argv.slice(2), { env = process.env } = {}) {
  const [script, ...rest] = argv;
  if (script === '--where') {
    const root = resolveKitRoot({ env });
    if (!root) {
      process.stderr.write(`kit-run: ${PLUGIN} is not installed\n`);
      return 127;
    }
    process.stdout.write(`${rest[0] ? join(root, rest[0]) : root}\n`);
    return 0;
  }
  if (!script || script.startsWith('-')) {
    process.stderr.write('usage: node .claude/kit-run.mjs <script-relative-to-plugin-root> [args…]\n');
    return 2;
  }
  const root = resolveKitRoot({ env });
  if (!root) {
    process.stderr.write(`kit-run: ${PLUGIN} is not installed (claude plugin install ${PLUGIN}@portx) and neither $AGENT_GRAPH_KIT_ROOT nor $CLAUDE_PLUGIN_ROOT points at a checkout\n`);
    return 127;
  }
  const target = join(root, script);
  if (!existsSync(target)) {
    process.stderr.write(`kit-run: no such kit script: ${script} (looked in ${root})\n`);
    return 127;
  }
  const r = spawnSync(process.execPath, [target, ...rest], { stdio: 'inherit', env: { ...env, CLAUDE_PLUGIN_ROOT: root } });
  if (r.error) {
    process.stderr.write(`kit-run: ${r.error.message}\n`);
    return 1;
  }
  return r.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
