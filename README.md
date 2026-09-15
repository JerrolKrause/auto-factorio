# AutoFactorio

**The factory must grow. Without humans.**

A local Factorio Space Age experimentation environment where specialized AI agents design, build and repair factories while you watch, steer them, and inspect what happened afterward.

## Current status

Phase 01 compatibility foundation is implemented and verified on Windows: a strict TypeScript/pnpm workspace, local diagnostic and SQLite transaction/backup probe. Phase 02 now has a pinned subscription provider, authenticated synthetic MCP gateway and deterministic budget tests; its live two-role handoff, interruption and resume gate passed on 15 September 2026. Phase 03 now passes live legal character actions, cancellation, protected fixtures, lost-response reconciliation and saved receipt readback. Scenarios and the dashboard remain future phases. See the [compatibility report](docs/COMPATIBILITY_REPORT.md) and [handoff](docs/IMPLEMENTATION_HANDOFF.md) for exact evidence and limitations.

All eight adversarial review fixes were approved and incorporated on 11 September 2026, covering scoring, fault controls, execution fencing, archive access, budgets and integration gates. The [accepted decision](docs/decisions/001-review-hardening.md) records the changes and required validation.

## Phased implementation

The [implementation guide](docs/IMPLEMENTATION_GUIDE.md) provides **18 bounded OpenSpec phases**, each with a proposal, capability spec, design, task checklist and a copyable Codex launch prompt. Start one phase per fresh conversation and follow the recorded prerequisite gates. The [coverage map](docs/SPEC_TRACEABILITY.md) connects the plan to every approved requirement and review correction.

Phase 03 is complete and archived with its character-execution capability synced to main specs. The next bounded implementation phase is the pause/restore gate:

```text
$openspec-apply-change af-04-pause-restore-gate
Follow phase 04 of docs/IMPLEMENTATION_GUIDE.md, implement only that change, verify its exit gate and update docs/IMPLEMENTATION_HANDOFF.md.
```

Phase 01 is complete and archived; its compatibility capability is synced to main specs. Phase 02 passed all eight tasks and is archived with its subscription-provider capability synced to main specs. Phase 03 passed all eight tasks and is archived; phases 04-18 remain planned and their integration gates remain open.

## Planned first release

- A foreman and factory engineer with separate contexts, task ownership and visible histories; additional specialists can be added later.
- Five red-science sandboxes, progressing from supplied ingredients to automated mining, power, production and fault recovery.
- Structured observations and deterministic character actions, with no required screenshot interpretation, hand-mining or tree chopping.
- A live dashboard with agent activity, task dependencies, production measurements, human steering and pause/stop/resume controls.
- Persistent experiment history, checkpoints and assisted/unassisted comparisons.
- Supported Codex access through the user's ChatGPT subscription, with no automatic API billing fallback.

## Design and development

| Document | Purpose |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Concise instructions for coding agents |
| [Implementation handoff](docs/IMPLEMENTATION_HANDOFF.md) | Project context, current state, first action and milestone gates |
| [Requirements](docs/REQUIREMENTS.md) | Approved scope and acceptance evidence |
| [Architecture](docs/ARCHITECTURE.md) | Proposed stack, boundaries, contracts and repository structure |
| [Scenarios](docs/SCENARIOS.md) | Five sandbox specifications and measurement rules |

The planned full stack is Node 24 LTS, TypeScript, Lua, Codex app-server, MCP, React/Vite, Fastify and SQLite. The foundation and bounded provider/gateway modules exist today; the live provider gate has passed.

## Verified local commands

Use Node 24 LTS and Corepack; this Windows host was tested with Node 24.21.0 and Corepack 0.36.0. A global `pnpm` shim is unnecessary: Corepack runs the version pinned in `package.json`. Prerequisite upgrades stay user-managed. Dependency installation may invoke existing native build tools; this host had Python 3.12.1 and VS2019 BuildTools. See [decision 003](docs/decisions/003-compatibility-foundation.md).

```powershell
Set-Location -LiteralPath 'C:\@Projects\AutoFactorio'
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm lint
corepack pnpm test
corepack pnpm check:docs
corepack pnpm diagnose --data-dir 'C:/@Projects/AutoFactorio/.runtime/local' --factorio-dir 'C:/Program Files (x86)/Steam/steamapps/common/Factorio'
```

`diagnose` prints live check results and writes a new `diagnostic-*/compatibility.json` plus fresh SQLite probe/backup files under the explicit data directory. It observes installed versions and code revision, without starting a game session or model inference. A passing foundation report still lists the later provider, gameplay and pause/restore checks as unverified. Unsupported checks exit 1; missing arguments and unsafe data paths also exit 1. Build before running the diagnostic after source changes.

Choose an absolute empty/new directory or one previously initialized by this diagnostic. Existing personal data directories are rejected. In-repository data must be Git-ignored; `.runtime/` is the local default location shown above. Credentials, generated saves, database files, game binaries and designated game-asset directories are excluded from Git. Dependencies and data remain local; no Factorio binaries/assets are shipped.

## Provider diagnostic (phase 02)

Build first, then supply the absolute installed Codex executable. The adapter currently pins Codex 0.154.0; it will not upgrade prerequisites or substitute a model.

```powershell
corepack pnpm provider:probe --codex 'C:/Users/Jerrol/AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'
```

The default performs managed-auth/model discovery, creates two empty role sessions and verifies their effective profiles/catalogs without inference. It writes a new `.runtime/phase02/probe-*` directory with incremental public `events.jsonl` and a final `result.json`. Codex manages its own credentials and session storage; no credential copy or global setting edit occurs. Only the synthetic gateway's tools are approved automatically.

Adding `--live` consumes existing ChatGPT subscription usage and runs the synthetic two-role handoff/steer/interrupt/resume checks. Defaults are 6 turns, 2 concurrent turns, 60 seconds/12 gateway attempts per turn, 5 minutes/run and 30,000 reported tokens. `--turn-cap <positive integer>` and `--token-cap <positive integer>` declare a different trial budget. Token events can arrive late; total tokens include cached input and do not measure remaining subscription allowance. An exhausted trial stops; no automatic paid usage, credit reset, model substitution or restart is implemented. Treat a rerun as a separately authorized experiment and preserve the previous evidence and aggregate usage.

The corrected live gate passed with four provider turns, 68,386 reported tokens, two separate resumed histories, a synthetic handoff, public activity, acknowledged steering, confirmed interruption and synthetic cancellation. The gateway rejected forbidden role and identity calls. A transient empty-rollout metadata read is retried with tools closed; the accepted turn is never resubmitted. Earlier failed trials remain recorded. See the [handoff](docs/IMPLEMENTATION_HANDOFF.md) for exact commands, budgets and limitations and [decision 004](docs/decisions/004-subscription-provider.md) for the isolation boundary. `provider:probe` is a synthetic diagnostic; real game validation starts in phase 03.

## Character diagnostic (phase 03)

Build first. These commands create fresh ignored project-only game profiles using the installed Steam Factorio 2.0.77 executable:

```powershell
corepack pnpm build
corepack pnpm game:launch --headless
corepack pnpm game:smoke
```

The headless smoke verifies real bounded observations, inventories, mod versions, recipe facts and malformed-request rejection. It does not verify character actions or a visible client. The launcher prints its directory and process ID; only stop the corresponding dedicated process when finished. It uses game port 34199/RCON 27019 for headless checks and 34198/27018 for the visible-client server.

```powershell
corepack pnpm game:launch
corepack pnpm game:probe
corepack pnpm game:load-probe
```

The normal launch starts a local dedicated server and a visible Steam client attached with `--mp-connect`; graphical `--host` did not expose RCON in the tested build. The client launch may require accepting Steam's launch-options dialog and entering a local player name. Wait until the hosted map is visible before running `game:probe`. Each launch also writes `launch.ps1` (server) and `launch-observer.ps1` (visible client) in its generated directory; `--prepare-only` creates the profile/script without opening the game. The live action checks passed: the probe tests normal character timing, reach, collision, inventory, protected fixtures, partial batches, cancellation and lost acknowledgments, and requests a quiescent save. `game:load-probe` opens that save on a separate temporary server, compares persisted receipts, verifies the loaded-world admission block, and stops its temporary server. A failed probe's state/evidence must be inspected before choosing a fresh test map. Source changes require copying/relaunching a fresh profile; running games do not hot-reload the mod.

RCON credentials and game data stay in ignored `.runtime/phase03/`; do not publish `launch.json` or `launch.ps1`. The diagnostic acknowledges Factorio's console-achievement notice in its disposable map. See [decision 005](docs/decisions/005-character-execution.md) and the [current handoff](docs/IMPLEMENTATION_HANDOFF.md) for tested behavior and open gates.

## Local setup context

The initial target is Windows with a user-supplied licensed Factorio installation and Space Age enabled. The selected project directory is `C:\@Projects\AutoFactorio`. The user is handling Node and prerequisite updates. Pin the verified game/mod versions for each experiment series.

The documents are already in `C:\@Projects\AutoFactorio`; no relocation or starter copy is needed. Begin a coding task in this directory when ready to implement milestone 0. No prior chat transcript is required.

## Prior art

[Factorio Learning Environment](https://github.com/JackHopkins/factorio-learning-environment) and [Agentic-Factorio](https://github.com/matteomekhail/Agentic-Factorio) inform the design. No upstream game code has been copied. The [provenance inventory](third_party/README.md) pins inspected revisions and notices; [decision 003](docs/decisions/003-compatibility-foundation.md) selects a bounded original adapter for phase 03. No project license has been selected yet.
