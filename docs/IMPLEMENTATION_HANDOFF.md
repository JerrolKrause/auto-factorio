# Implementation handoff

Status: documentation starter prepared after the phase 2 handoff audit. No application implementation has begun. Product scope and name are approved; architecture remains the proposed technical baseline. A future user request to implement a milestone authorizes work on it; no additional approval is required solely because these documents retain historical proposal wording. Preparing this package does not itself start an implementation task.

Update, 11 September 2026: the user approved all eight adversarial review fixes and requested documentation updates only. They are incorporated in the requirements, architecture, scenario specifications and milestones. [Decision 001](decisions/001-review-hardening.md) records the accepted changes. This approval has not started application implementation.

## Start here

Project: **AutoFactorio: The Factory Needs Nobody**. Repository: `https://github.com/JerrolKrause/auto-factorio`.

The project documents already reside in `C:\@Projects\AutoFactorio`, with README.md and AGENTS.md at root and design documents under docs/. Work in place; no relocation or starter copy is needed. The current task has workspace write access. The user manages Node and other prerequisite upgrades.

The user is an experienced software engineer on Windows with ChatGPT Plus and Factorio 2.0 plus Space Age. Existing subscription usage is acceptable; API charges are not. The project studies factory design, long-horizon reasoning, narrow specialized agents, coordination and recovery. Use deterministic code for routine work. Gameplay must be visible and recorded. Avoid hand-mining and chopping.

Read [REQUIREMENTS.md](REQUIREMENTS.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [SCENARIOS.md](SCENARIOS.md). Treat requirements as accepted product intent. Architecture contains proposed implementation decisions and explicit validation gates; do not describe those gates as already passed.

Recommended stack: Node 24 LTS, TypeScript/pnpm, Lua, local Codex app-server with ChatGPT authentication, scoped MCP gameplay tools, Fastify/React/Vite, SQLite and artifact files. Keep orchestration deterministic and independent of Codex session history. Start with foreman and engineer roles, one builder character, and optional solo mode.

## Intent from the planning conversation

- This is a fun engineering and agent-behavior experiment. Deliver useful incremental progress; a visible small factory is valuable well before a rocket or another planet. Do not let prospective benchmark sophistication delay the first playable result.
- The user has substantial multi-agent experience and explicitly rejected postponing multi-agent foundations to avoid later rewrites. Narrow contexts and easy specialization are intentional. Do not replace this requirement with a single global conversation and a promise to add roles later.
- The user has no personal stack preference and expects the coding agent to write and maintain the code. Favor understandable boundaries, debuggability and practical AI development over a fashionable framework.
- Space Age was selected to preserve modern game rules and room to grow, not to require full expansion gameplay in release one. Plan for multiple surfaces and quality without building speculative late-game subsystems.
- The agent should design factories. Reliable movement, arithmetic and batch execution are welcome; hidden ready-made factory solutions change what the experiment measures. Upstream starter blueprints therefore need explicit treatment.
- Autonomous play and human steering are complementary. Advice should help a run continue and remain available for later analysis. A hint must not disappear into a transcript with no connection to resulting actions.
- The dark/snarky title is intentional branding. Keep activity messages and errors precise enough to debug; humor must not obscure what the system actually did.
- The user accepts consuming their Plus allowance and may upgrade if the project is enjoyable. Do not assume an upgrade, unlimited usage, API access or a paid fallback.
- The user wants fresh-task development to avoid context overload. These files replace the need to inherit the planning conversation.

## Decision status and discovery work

Approved: product scope, project name, multi-agent foundations, five scenarios, Space Age, deterministic-first operation, visible/autonomous runs with recorded steering, and the target project location.

Also approved: end-to-end automation scoring with failing bypass controls; do-nothing controls for every S5 fault; acknowledged game-side fencing and controlled restore barriers; quantitative fuel sufficiency; authorized archive retrieval and briefings; budgets within provider turns; live pause/save/load validation before milestone 1; and correction of obsolete relocation instructions.

Proposed technical baseline: the stack and component boundaries in ARCHITECTURE. Fixture dimensions, equipment quantities, batch size, concurrency limits and run deadlines are engineering defaults to validate, not separately promised outcomes. Record justified adjustments rather than reopening settled product decisions.

Still to discover or revalidate: the selected game/runtime versions after the user's updates, working subscription authentication and Astra access in the selected client, actual tool restrictions, live game control and restore compatibility, and upstream reuse provenance. The read-only installation observations below are starting points, not passed integration gates. Inspect these during milestone 0; the planning conversation is not needed.

When the user requests development, the first action is to inspect the actual repository and environment, preserve any existing work, then execute milestone 0. Do not regenerate the whole design package, invent setup commands, or ask the user to reconfirm settled requirements.

## Observed environment

On 10 September 2026, read-only inspection found:

- Windows PowerShell environment.
- Shell Node: v20.10.0; needs a compatible runtime for the proposed stack.
- Codex CLI: 0.153.4; app-server command and TypeScript-schema generation are present. Local help labels app-server experimental.
- Git and pnpm commands are available; dependency installation/builds have not been tested.
- The shell's Codex command emitted a home-directory/PATH-alias warning. Investigate in setup; do not infer that interactive authentication will work from the help command alone.
- No Factorio installation, subscription login, running game, or model invocation was tested during design.
- A documentation starter with root README.md and AGENTS.md was created after the initial design. No application source, Git repository, runnable commands or upstream code has been added.

Initial research identified stable Factorio 2.0.77 and experimental 2.1.17. Recheck the selected installation and pin the tested game/mod combination. Current upstream documentation may be ahead of stable.

The subsequent read-only review on 10 September found Codex CLI 0.154.0 and Node 20.10.0. It located Factorio at `C:\Program Files (x86)\Steam\steamapps\common\Factorio`, with base metadata 2.0.77 and Space Age data present. Inspected recipe definitions agreed with the stated red-science ingredient ratios. No game session, subscription authentication or model-backed integration was exercised. These observations supersede the earlier CLI version and unknown installation location; recheck them before implementation.

## Milestone 0 — prove the integration

Scope this as a bounded feasibility spike with a small visible diagnostic page/console. Do not build the full dashboard first.

1. Establish a supported Node runtime and a dedicated game/mod/save configuration. Do not silently alter the user's personal saves or global Codex settings.
2. Verify managed ChatGPT sign-in, Astra availability, effective role tool restrictions, public activity streaming, cancellation and resumption with the installed Codex. No model call under API authentication.
3. Start two tiny role-specific sessions and exercise a synthetic handoff, showing separate histories. Check behavior and usage for concurrent sessions under explicit per-turn time/tool caps. Establish available usage events and interruption behavior; use fakes for exhaustive budget cases.
4. Connect to a visible Space Age sandbox. Read bounded structured state, walk a character, place an inventory-backed entity, and observe its actual state.
5. Submit a small batch, force a partial failure, cancel remaining steps, and reconcile after a simulated lost acknowledgement. No duplicate effects.
6. In the visible hosted topology, pause while RCON polling continues and verify scoring time, production, scenario timers and queued effects remain frozen. Record `game.tick`, `ticks_played`, inventories and receipts. Disarm and save with pending intents, confirm save completion, reload behind the execution barrier, reconcile and explicitly re-arm only authorized work. Include a saved order cancelled after the checkpoint: it must not execute on reload before reconciliation. Establish safe handling or rejection of an uncontrolled/native autosave, and prove the Lua lifecycle is multiplayer-safe.
7. Evaluate FLE and Agentic-Factorio's applicable game-action code. Pick a narrow reusable foundation or implement the first bounded action set. Record upstream revision and actual license notices before copying. Starter blueprints, accelerated walking and raw console access must not leak into benchmark defaults.

Exit evidence: a short compatibility report, exact versions, visible event trace, legal game effects, no billing fallback, a live pause/save/load/reconcile/re-arm trace, and an accepted decision on the game foundation. The real-game pause and restore gate must pass before building milestone 1's durable controls; if necessary, revise the adapter or hosted topology and rerun the same gate. This spike needs only a minimal checkpoint manifest, not the full branch UI. If app-server cannot satisfy the required behavior, test the visible Codex CLI plus the same MCP interface as a limited fallback and state which automated controls remain missing. Do not call that fallback equivalent to the full architecture.

## Milestone 1 — durable runtime and visible control

Implement contracts, task ownership, dependencies, acknowledged game-side reservation/fencing rules, event storage, command outbox and receipt reconciliation using milestone 0's validated lifecycle. Implement archive visibility enforcement, filtered context reconstruction and run/per-turn budgets. Build agent activity/timeline views and steering/pause/stop/resume controls. Use deterministic fake provider and game adapters for conflict, restart, stale-epoch and cancellation cases. Demonstrate adding a third synthetic specialist without editing existing role logic.

Exit evidence: a restart preserves pending tasks; delayed revocation blocks reassignment; stale grants, task revisions and restored queues cannot mutate the game; archive IDs/searches/references and new-session briefings do not leak restricted evidence; per-turn tool/time limits and run exhaustion stop active turns and reject late tools. Intervention delivery is acknowledged; UI reconnect reconstructs history; no LLM is used for polling or deterministic validation. Pair failure-path fakes with real-game fencing and restore checks.

## Milestone 2 — First Shift end to end

Build and validate scenario 1 with a deterministic reference action plan and failing preloaded-buffer, character-supply and unrelated-production controls, then run the foreman/engineer team to the red-science target under a visible usage budget. Include one assisted run and one fresh-session continuation. Keep the live dashboard useful before adding visual polish.

Exit evidence: five valid output windows plus required automated terminal-to-science flows, enforced verification mutation restrictions, traceable actions, legal inventory usage, recorded model/assistance settings, and a complete reviewable history. The positive reference passes and the bypass controls fail. A model failure is useful evidence but does not replace reference validation.

## Milestone 3 — complete the sandbox suite

Implement scenarios 2 through 5, their reference solutions and deterministic evaluators. Verify each required upstream stage, inventory balances and quantitative fuel replenishment. Require failing controls for skipped stages, reserve-backed deficient fuel delivery and every unrepaired S5 fault across all eligible verification starts; prove legal restorations pass from the same starting fixtures. Test reset, per-scenario briefings and solo/team comparisons with explicit usage/concurrency accounting. The first release is not complete until all five are ready to launch even if agent reliability varies.

## Milestone 4 — retrospectives and distribution

Add run comparison, intervention review, evidence export, checkpoint branches, disk/retention diagnostics and reliable installation/mod packaging. Verify setup and tests on Windows. Keep model-backed experiments explicit; routine CI uses fakes and deterministic tests.

## Continuity for coding tasks

Repository setup, 11 September 2026: initialized in place on `main`, with `origin` set to `https://github.com/JerrolKrause/auto-factorio`. The initial commit is titled `chore: initialize AutoFactorio documentation starter` (resolve its hash with `git rev-list --max-parents=0 HEAD`). It includes the documentation, OpenSpec configuration and skills, and ignore rules for local credentials, dependencies and generated game data. This setup does not start milestone 0 or push to GitHub. No application tests apply to this documentation-only repository; implementation and live integration checks remain unexecuted. Next bounded action remains milestone 0 when requested.

Documentation handoff, 11 September 2026: location `C:\@Projects\AutoFactorio`; no Git repository, branch or commit exists, as confirmed by `git status --short`. Completed: all eight approved design corrections and their milestone acceptance criteria. No source code, mod, scenario saves or dependency setup was added. Application tests and live-game/provider checks remain unexecuted; all implementation acceptance criteria above remain open. Next bounded action, when implementation is requested: recheck prerequisites and execute milestone 0 including the live pause/restore gate.

Executed documentation validation: a PowerShell check across all seven Markdown files passed for existing local-link targets, balanced fenced code blocks, absence of replacement characters/conflict markers, and removal of obsolete relocation instructions. Manual consistency review covered all eight findings across requirements, architecture, scenarios, milestone gates and decision 001, including S5 deadline handling and provider-turn admission versus active execution limits. No application build, lint, unit test, live-game test or provider inference was run.

Use one implementation task through a coherent milestone. Do not create a new task per file. At each milestone, update this handoff with:

- Current repository location, branch and commit.
- Completed requirements and unresolved acceptance criteria.
- Tests actually executed and their results, including live-game evidence.
- Current game/Codex/Node/mod versions.
- Architectural decisions accepted or changed and why.
- Known limitations, reproducible failures, and the next bounded objective.

Keep root `AGENTS.md` short and point to the relevant documents. A fresh task should read the current handoff and the documents relevant to its milestone; it should not need the complete planning conversation. Do not put game-agent prompts or player memory into coding-agent instructions.

## Ready-to-use next-task request

Begin development of AutoFactorio: The Factory Needs Nobody in C:\@Projects\AutoFactorio. Work in the existing directory; read root README.md and AGENTS.md, docs/IMPLEMENTATION_HANDOFF.md and the relevant design documents. Adopt the architecture with its approved review corrections as the implementation baseline and begin milestone 0. Prove the ChatGPT subscription connection, two scoped agent sessions, visible activity, a small legal action batch, and live pause/save/load/reconciliation before building durable controls. Preserve the no-API-billing requirement, use the licensed Space Age installation, and keep game state and experiment history independent of model context. Resolve routine choices and record actual compatibility findings and tests in the handoff. Do not mark untested capabilities as working.

Submitting the request above supplies the implementation authorization and adopts the baseline; it does not require a separate confirmation of old proposal wording. The next task can be fresh and need not fork the long planning history. The documentation audit itself has not submitted that request or started development.
