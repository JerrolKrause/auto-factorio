# AutoFactorio

**The factory must grow. Without humans.**

A local Factorio Space Age experimentation environment where specialized AI agents design, build and repair factories while you watch, steer them, and inspect what happened afterward.

## Current status

Phases 01–12 are complete and archived; Phase 13's plate-to-science implementation and live gate are complete pending archive. The project now includes subscription access, legal character execution, pause/restore, durable coordination, the local dashboard, verification engine, bounded First Shift trials, and game-verified S1/S2 references and bypass controls. See the [handoff](docs/IMPLEMENTATION_HANDOFF.md), [S2 guide](scenarios/02-some-assembly-required/README.md), [trial report](docs/FIRST_SHIFT_AGENT_TRIAL_REPORT.md), [compatibility report](docs/COMPATIBILITY_REPORT.md) and [accepted safeguards](docs/decisions/001-review-hardening.md).

## Phased implementation

The [implementation guide](docs/IMPLEMENTATION_GUIDE.md) defines 18 bounded phases and their acceptance gates; the [coverage map](docs/SPEC_TRACEABILITY.md) connects them to requirements. After Phase 13 is archived, the next implementation phase, only on instruction, is:

```text
$openspec-apply-change af-14-ore-smelting-fuel
Follow phase 14 of docs/IMPLEMENTATION_GUIDE.md, verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md, implement only that change, and stop before phase 15.
```

Phase 13's legal S2 reference and all required negative controls passed in Factorio without model inference. Phases 14–18 remain planned.

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
| [Model selection](docs/MODEL_SELECTION.md) | When to use Astra, Sol, Terra, Luna or deterministic scripts |
| [Development efficiency](docs/DEVELOPMENT_EFFICIENCY.md) | Usage, watching, preflight, contracts, task routing and bounded handoffs |
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
corepack pnpm dev:preflight --input docs/examples/development-preflight.example.json
corepack pnpm dev:task --change <change-name> --task <task-id> # preview only unless --start is explicit
corepack pnpm diagnose --data-dir 'C:/@Projects/AutoFactorio/.runtime/local' --factorio-dir 'C:/Program Files (x86)/Steam/steamapps/common/Factorio'
```

`diagnose` prints live check results and writes a new `diagnostic-*/compatibility.json` plus fresh SQLite probe/backup files under the explicit data directory. It observes installed versions and code revision, without starting a game session or model inference. A passing foundation report still lists the later provider, gameplay and pause/restore checks as unverified. Unsupported checks exit 1; missing arguments and unsafe data paths also exit 1. Build before running the diagnostic after source changes.

Choose an absolute empty/new directory or one previously initialized by this diagnostic. Existing personal data directories are rejected. In-repository data must be Git-ignored; `.runtime/` is the local default location shown above. Credentials, generated saves, database files, game binaries and designated game-asset directories are excluded from Git. Dependencies and data remain local; no Factorio binaries/assets are shipped.

## Development verification and recovery

```powershell
corepack pnpm verify          # build, lint, tests, docs; stop on the first failure
corepack pnpm verify --game   # then fresh headless smoke and exact-profile cleanup
corepack pnpm game:processes  # sanitized project process inventory; build first
```

Run the inexpensive chain before a visible game trial. Full per-command logs and exact exit/skipped-step results are retained under `.runtime/verification/check-*/`; `summary.json` includes cleanup and any visible trial. `corepack pnpm verify --pause` adds the visible phase 04 trial after a passing smoke, when its ports and observer slot are free. TypeScript emits no new code for a failed project; never run older `dist` files to bypass a failed build.

The [development workflow](docs/DEVELOPMENT_WORKFLOW.md) covers contextual UTF-8 edits, bounded tool output, the reviewed Windows sandbox fallback, safe process cleanup and stage-based probe recovery. Profile management records the actual graphical process separately from Steam's launcher. Instructions in this workflow do not start another phase or model trial.

## Local control dashboard (phase 09)

```powershell
corepack.cmd pnpm build
corepack.cmd pnpm dashboard --fixture
# Or attach the operator host to an existing dedicated project game:
corepack.cmd pnpm dashboard --profile-file '.runtime/phase09-reviewed-profile.json'
corepack.cmd pnpm test:ui
```

The launcher reports the path of its `dashboard.json`. Open that file's `url` in a browser: its fragment grants access to this local operator session. `--fixture` is a synthetic demonstration with two roles and example tasks. The game option registers the two roles and starts safely paused; it does not start model inference. The page shows role states, dependencies, evidence, production coverage, batch progress, assistance and budgets. Advice is a durable role inbox; interpretation is acknowledged separately through the coordination gateway. Ordinary advice preserves active batches; explicit reprioritization records a human intervention and fences the old revision.

Pause/stop close new admission, interrupt bound sessions and establish acknowledged game cancellation. Resume reconciles and refreshes authority; old task revisions need new plans/grants. Unknown controls and missing telemetry remain explicit. Closing/reopening the tab does not stop the host or reset budgets. `--directory <project .runtime path>` reopens existing run data; the SQLite writer lock rejects concurrent owners. Press Ctrl+C in the host terminal to request a held game state and shut down.

Browser tests use the installed Microsoft Edge. `game:dashboard-probe --profile-file <fresh-visible-profile.json>` tests the HTTP controls in Factorio using synthetic role callbacks, without model inference. Read [Decision 011](docs/decisions/011-live-control-dashboard.md) for security, event replay, edit-detection coverage and the later provider/scenario composition boundary.

## First Shift (phase 11)

```powershell
corepack.cmd pnpm build
corepack.cmd pnpm scenario:launch --scenario 01-first-shift --roster team
# --roster solo uses the same fixture and rules.
# After closing the previous controller with Ctrl+C:
corepack.cmd pnpm scenario:launch --reset '<previous-run-directory>/run.json' --roster team
```

The launcher opens a dedicated visible world, records its finite kit, grants and installed recipes, and prints the new run directory. Open that directory's `dashboard.json` URL for pause/resume/stop controls. It starts safely paused with the selected roster and a shared briefing; it does not start model inference. Reset validates the cached disarmed fixture, preserves previous histories, and creates a new run/epoch. Close the previous controller before resetting. Source/game changes require a fresh fixture.

For deterministic operator validation, add `--hold --result-file <file>` to leave the initial world paused and release the controller, then run `corepack.cmd pnpm game:first-shift-probe --run-file '<run-directory>/run.json'`. This consumes no model usage. It records a legal reference, exact five-window input/output balances and explicit bypass controls in private evidence under that profile. See the [scenario guide](scenarios/01-first-shift/README.md) and [measurement decision](docs/decisions/013-first-shift-reference.md).

## Some Assembly Required (phase 13)

```powershell
corepack.cmd pnpm scenario:launch --scenario 02-some-assembly-required --roster team
# A held deterministic run consumes no model usage:
corepack.cmd pnpm scenario:launch --scenario 02-some-assembly-required --roster solo --hold --result-file '.runtime/s2-launch.json'
corepack.cmd pnpm game:plate-to-science-probe --run-file '<run-directory>/run.json'
```

S2 uses the same loader, reset barrier and evaluator with an 80×80 plate-fed fixture and explicit gear stage. Its `s2-v6` manifest, installed-recipe component-inventory calibration, legal reference and bypass matrix are frozen in the [scenario guide](scenarios/02-some-assembly-required/README.md) and [decision 015](docs/decisions/015-plate-to-science.md).

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

## Pause and restore diagnostic (phase 04)

```powershell
corepack pnpm build
corepack pnpm game:launch --phase04
corepack pnpm game:pause-probe
```

The fresh initial server uses game/RCON ports 34204/27024; managed restore uses 34205/27025 and a fresh RCON credential. Wait for or allow the probe to wait for the visible client. Steam may require launch-dialog confirmation. The probe captures a neutral disarmed checkpoint, cancels saved work afterward, verifies the held reload, replaces only its original project observer, then tests explicit re-arm and heartbeat loss. It leaves the restored visible world paused and disarmed. Stop only the project processes identified by their generated config paths when finished; ports must be free before launching another profile.

Each trial retains incremental `.runtime/phase04/game-*/pause-probe-*/events.jsonl`, a result, completed checkpoint manifests/ZIPs, reconciliation evidence and source hashes. Interrupted or mismatched saves and native saves without a managed manifest are rejected. Remaining intent is data; resuming execution requires reconciliation and fresh authorization. The operator control port is not a gameplay tool. Generated launch files contain private RCON credentials and remain ignored.

A restore-only continuation is available as `corepack pnpm game:pause-probe --continue <prior-evidence-directory>` when its atomic stage journal contains `restore-ready`. That stage records the validated checkpoint, cancellation/rollback evidence, and mod/probe source fingerprints. The original server need not run. Inspect and stop only that trial's obsolete held-load processes before continuing. `--stop-after restore-ready` deliberately records this boundary with `passed: false`; it does not pass the gate. Completed probes, mismatched sources/checksums and older trials without journals are refused. Continuation preserves the earlier checks as inherited evidence and records new checks separately.

See the [M0 integration report](docs/INTEGRATION_GATE_REPORT.md), [decision 006](docs/decisions/006-pause-restore.md) and [handoff](docs/IMPLEMENTATION_HANDOFF.md). The phase 03 action diagnostic now performs explicit lifecycle reconciliation/arm and heartbeats; its legacy quiescent save remains a receipt-readback test, not a managed recovery checkpoint.

## Durable runtime diagnostic (phase 05)

```powershell
corepack pnpm verify --game
corepack pnpm game:launch --phase04 --result-file .runtime/phase05-visible-profile.json
corepack pnpm game:durable-probe --profile-file .runtime/phase05-visible-profile.json
```

Use a fresh profile with initial game/RCON ports 34204/27024 free and no existing project observer. The probe uses the phase 04 launcher/lifecycle and restores on separate ports 34206/27026. It deliberately exits a child runtime with code 73 after a legal placement and before SQLite acknowledgement; the parent verifies receipt recovery without a duplicate entity or inventory debit. It also verifies durable task/budget reconstruction, exact observation artifacts, a consistent backup, and managed checkpoint rollback. The final visible world is paused and disarmed. No provider inference is used; budget telemetry in this diagnostic is synthetic.

Evidence stays under `.runtime/phase04/game-*/durable-probe-*/`: incremental event logs, source hashes, the worker's effect-before-crash record, SQLite/WAL and checksummed artifacts, backup manifest, checkpoint pair, recovered state and aggregate result. Failed trials remain separate; this probe has no staged continuation mode. Do not rerun it against a world already changed by an earlier trial. Stop only profile-identified project processes. [Decision 007](docs/decisions/007-durable-event-runtime.md) describes the persistence and recovery boundaries; the [handoff](docs/IMPLEMENTATION_HANDOFF.md) records the actual gate.

## Ownership diagnostic (phase 06)

```powershell
corepack pnpm verify --game
corepack pnpm game:launch --phase04 --result-file .runtime/phase06-visible-profile.json
corepack pnpm game:ownership-probe --profile-file .runtime/phase06-visible-profile.json
```

Use a fresh visible profile with game/RCON ports 34204/27024 free; the managed restore uses 34207/27027. The probe verifies conflicting reservation sets, stale task/area/grant/arm rejection, lost revoke acknowledgements, native movement/mining/crafting cancellation, an unreserved path gap, and restoration of a task cancelled after its checkpoint. It stops only its initial profile before loading the checkpoint and leaves the final visible world paused and disarmed. Inspect existing project processes first; do not interrupt a personal client.

Evidence is retained under `.runtime/phase04/game-*/ownership-probe-*/`, including source hashes, exact control/game traffic, the durable journal, checkpoint, recovered state and result. Failed trials require a fresh profile. No model inference is consumed. [Decision 008](docs/decisions/008-fenced-ownership.md) documents exclusive inventory allocation, conservative area coverage, acknowledgement/retry and restore boundaries; the [handoff](docs/IMPLEMENTATION_HANDOFF.md) records executed checks and remaining limitations.

## Coordination diagnostic (phase 07)

```powershell
corepack pnpm verify --game
corepack pnpm game:launch --phase04 --result-file .runtime/phase07-visible-profile.json
corepack pnpm game:coordination-probe --profile-file .runtime/phase07-visible-profile.json
```

Use a fresh visible profile with game/RCON ports 34204/27024 free. Inspect project processes before launching. The probe uses synthetic provider sessions, durable team handoff, a third bodyless specialist, legal placement, dependency scheduling, and real crafting cancellation at a synthetic reported-token ceiling. It reconstructs the runtime and verifies the spent budget remains closed. It consumes no model inference and leaves the world paused, neutral and disarmed. Failed probes require a fresh profile; preserve their evidence.

Evidence lives under `.runtime/phase04/game-*/coordination-probe-*/`: exact game/control events, source hashes, SQLite history, recovered state and results. [Decision 009](docs/decisions/009-agent-coordination.md) describes the programmatic gateway and scheduler, receipt/message criteria and remaining context/provider integration limits. Solo restart and failure paths use deterministic tests; this phase does not claim provider-backed gameplay or scenario scoring.

## Verification guard diagnostic (phase 10)

```powershell
corepack pnpm verify --game
corepack pnpm game:launch --phase04 --result-file .runtime/phase10-profile.json
corepack pnpm game:verification-probe --profile-file .runtime/phase10-profile.json
```

Use a fresh dedicated visible profile, free game/RCON ports 34204/27024 and no existing project observer. The probe checks admission cancellation before the baseline, submitted and stale queued mutation guards, legal walking, explicit repair, benchmark science/fixture restrictions, human edit invalidation and pause/replacement clocks. It leaves its world held; stop only the exact profile's server and observer with `game:processes --stop-profile`. Failed trials need fresh profiles.

Evidence stays in `.runtime/phase04/game-*/verification-probe-*/` with source hashes, versions, raw control/game events and results. Delayed command replay and the diagnostic player-build event are explicit. No model inference runs. [The evaluator](packages/core/evaluation/README.md) also receives the calibrated S1 engine samples implemented in phase 11; see the handoff for live acceptance evidence.

## Local setup context

The initial target is Windows with a user-supplied licensed Factorio installation and Space Age enabled. The selected project directory is `C:\@Projects\AutoFactorio`. The user is handling Node and prerequisite updates. Pin the verified game/mod versions for each experiment series.

The documents are already in `C:\@Projects\AutoFactorio`; no relocation or starter copy is needed. Begin a coding task in this directory when ready to implement milestone 0. No prior chat transcript is required.

## Prior art

[Factorio Learning Environment](https://github.com/JackHopkins/factorio-learning-environment) and [Agentic-Factorio](https://github.com/matteomekhail/Agentic-Factorio) inform the design. No upstream game code has been copied. The [provenance inventory](third_party/README.md) pins inspected revisions and notices; [decision 003](docs/decisions/003-compatibility-foundation.md) selects a bounded original adapter for phase 03. No project license has been selected yet.
