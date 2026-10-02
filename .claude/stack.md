# AutoFactorio kit profile

Repository facts for agent-graph-kit skills. The `.claude` directory name is the kit's shared convention for both Codex and Claude Code. Follow [AGENTS.md](../AGENTS.md), [development workflow](../docs/DEVELOPMENT_WORKFLOW.md) and [model selection](../docs/MODEL_SELECTION.md). This profile records existing commands and authority; it does not authorize inference, publishing, commits or prerequisite upgrades.

## Commands

Run from the repository root in PowerShell. On other platforms use `corepack pnpm` instead of `corepack.cmd pnpm`.

- install: `corepack.cmd pnpm install --frozen-lockfile` (Node 24, pinned pnpm in `package.json`).
- build/typecheck: `corepack.cmd pnpm build` (TypeScript project build and dashboard Vite build; no separate typecheck script).
- lint: `corepack.cmd pnpm lint`.
- unit tests: `corepack.cmd pnpm exec vitest run`.
- one unit file: `corepack.cmd pnpm exec vitest run tests/workshop.test.ts` (choose an existing task-specific file).
- browser tests: `corepack.cmd pnpm test:ui`.
- documentation: `corepack.cmd pnpm check:docs`.
- standard verification: `corepack.cmd pnpm verify --plan <task-owned-session-plan.json>`; use the existing bounded admission workflow, not an expired previous task's plan or unbounded direct gates.
- whitespace: `git diff --check` (also `git diff --cached --check` for staged changes).
- ordinary startup: `npm start`; diagnostic launchers are listed in `package.json`.
- OpenSpec: `corepack.cmd pnpm exec openspec <args>`.
- lockfile: `pnpm-lock.yaml`; resolve package manifests first, then `corepack.cmd pnpm install --lockfile-only` and frozen install. Never replace the pinned package manager or upgrade prerequisites implicitly.

Kit scripts use [kit-run.mjs](kit-run.mjs), copied unchanged from agent-graph-kit 0.13.0. Before invoking it, set `AGENT_GRAPH_KIT_ROOT` to the absolute plugin root of the kit skill **loaded in this session** (derive it from that skill's reported location). Set it in the same shell invocation as every kit command; tool shells need not retain environment changes. The launcher prioritizes this supported override. Confirm `node .claude/kit-run.mjs --where` prints that same root before running scripts. Do not use its unqualified fallback in Codex: it can select an older Claude installation ([upstream issue 75](https://github.com/JerrolKrause/agent-graph/issues/75)). Do not hard-code one developer's cache path into tracked configuration or alter global settings.

With that override set, profile validation is `node .claude/kit-run.mjs lib/check-stack-sections.mjs .claude/stack.md`, and scope resolution is `node .claude/kit-run.mjs skills/learnings/scripts/resolve-scopes.mjs --files <repo-relative-paths>`. Scope metadata lives in [scopes.yaml](learnings/scopes.yaml); read only returned shard files that actually exist. No captured shard or method store exists initially. Keep the registry LF-normalized as required by `.gitattributes`: the current upstream scope parser silently drops CRLF path entries. Refresh the unchanged launcher from the selected official kit when upgrading; verify its source and resolution again.

## Module layout

The module under enforcement is this repository, not a sibling project. `apps/dashboard/` is the React interface; `apps/runtime/` owns HTTP and runtime integration. `packages/core/` owns deterministic coordination/workshop logic; `contracts/`, `storage/`, `factorio/`, `codex/`, and `tools/` beneath `packages/` own their respective boundaries. `mods/autofactorio/` contains the Lua game mod. `scripts/` owns startup, diagnostics, game probes and developer checks. Tests are in `tests/` and `tests/ui/`, not colocated.

The current [implementation handoff](../docs/IMPLEMENTATION_HANDOFF.md) is project memory; there is no module `MEMORY.md`. Read [requirements](../docs/REQUIREMENTS.md) before product behavior changes and only the relevant architecture/scenario sections. Gameplay role instructions under `agents/` are not developer memory. Preserve user changes. Never edit dependency/build trees, plugin caches, personal saves, global settings or game binaries. Keep generated evidence under `.runtime/`.

## Gates

| layer | command | catches | lives in | harden it by |
| --- | --- | --- | --- | --- |
| types/build | `corepack.cmd pnpm build` | TypeScript contracts and dashboard build failures | `package.json`, `tsconfig.json` | explicit types and boundary validation |
| lint | `corepack.cmd pnpm lint` | static defects | `eslint.config.mjs` | relevant lint rules |
| unit/integration | `corepack.cmd pnpm exec vitest run` | deterministic behavior and simulated failures | `vitest.config.ts`, `tests/` | focused behavioral regressions and discriminating fakes |
| browser | `corepack.cmd pnpm test:ui` | rendered flows and operator interaction | `playwright.config.ts`, `tests/ui/` | exercise the actual UI trigger and observable outcome |
| real game | task-selected `game:*` probe from `package.json` | real Factorio API, movement, inventory, placement, cancellation and save/load behavior | `scripts/game-*.ts`, `mods/autofactorio/` | add the relevant real-game negative and recovery case |
| documentation | `corepack.cmd pnpm check:docs` | broken local links, conflict markers, encoding and fences | `scripts/check-docs.mjs` | link required setup files and check instructions against actual commands |
| independent review | repository review assignment and result validation | coupled implementation/instruction defects and acceptance gaps | `.agents/skills/change-audit/author-workflow.md` | fresh-context review of implementation and documentation together |

Coverage threshold: no configured numeric coverage threshold or coverage command. Acceptance requires task-specific failure paths and the applicable real browser/game checks; unit success alone is insufficient. PR gate config: n/a - `.claude/pr.config.json` is not configured here. Do not invoke the kit's commit/PR pipeline as though that integration exists. Commit/publish only when requested, using a separately validated workflow.

Delegate test writing after behavioral cases stabilize. Use the repository's [verification author workflow](../.agents/skills/verify-change/author-workflow.md) and [review author workflow](../.agents/skills/change-audit/author-workflow.md) for verification and independent review, including their contracts and model routes. Do not replace fresh-context review with inline self-review or assume Claude-only agent shells exist. A kit skill's role description can guide work; repository workflows govern dispatch and acceptance.

Weak gates: fakes cannot prove Factorio entity-specific API validity or physical execution; browser fixtures cannot prove live game/provider behavior. Managed model authentication, availability, limits and live output need deliberate checks. Screenshot vision is optional. Unknown game effects must be reconciled before retrying. Follow the task budget and scoped cleanup rules in the development workflow.

## Dev server and auth

Ordinary startup is `npm start`, fixed at `http://localhost:3000`; it installs pinned dependencies, builds, opens the browser and manages a project-owned game. Reuse a running healthy instance; do not start another or select another ordinary-user port. Follow the supplied server log and run/profile identity. The dashboard is local; there is no separate dashboard test-account login. Provider access uses supported managed ChatGPT authentication, never API keys or silent billing/model fallback. Game/RCON credentials are generated in project-owned runtime files; never print them.

Automated Playwright fixtures create their own local server via `scripts/dev/dashboard-fixture.ts` and runtime helpers, use the returned origin and close their resources. These isolated test listeners are not replacements for ordinary startup or evidence of a live model/game run. Do not attach fixtures to or mutate the user's held workshop. If a required server/browser is unavailable, report that coverage gap.

## Test runners

Vitest: `tests/**/*.test.{ts,mjs}` in `vitest.config.ts`; use `corepack.cmd pnpm exec vitest run <file>` for targeted work. Avoid `pnpm test -- <file>`: that forwarding form previously ran the full suite. Confirm the reported file/test counts.

Playwright: `tests/ui/`, one worker, installed Microsoft Edge channel `msedge`, headless by default. Run `corepack.cmd pnpm exec playwright test tests/ui/dashboard.spec.ts` for that file. Fixtures own startup/cleanup; build required assets before browser checks. Evidence is under `.runtime/ui-results` and `.runtime/ui-results.json`. Installing or upgrading missing system prerequisites stays user-managed. There is no separate component-test runner.

Real-game probes are TypeScript scripts built to `dist/scripts/`; choose commands from `package.json` based on the changed behavior. Do not launch stale emitted JavaScript after a failed build. Provider inference is not implied by a game probe or a verification command; budget it explicitly.

## Issue labels

n/a - no repository-required issue-label vocabulary is configured. Do not mutate graph control labels or infer a lane workflow from a globally installed plugin.

## Filing side-bugs

Report unrelated defects with reproduction, affected paths and actual check evidence. External issue creation or messages require the user's explicit request; do not infer authorization from kit availability. Fix related blockers within the authorized task and preserve unrelated user changes. The agent-graph Codex integration findings are already tracked in issue 75; that upstream task does not include AutoFactorio gameplay fixes.
