# Working on AutoFactorio

These instructions apply to agents developing this repository. Gameplay-role prompts belong in `agents/`; do not use this file as player memory or expose private evaluator fixtures to gameplay agents.

Keep all future edits to this file as context-efficient as possible: concise rules, no repetition or background narrative; link local skills/docs for detail while preserving essential constraints.

## Begin with the current task

Before loading, announcing or using any agent-graph-kit skill, first read the repository [kit profile](.claude/stack.md), including matching-version script resolution. Repository model routing, authorization, verification and independent-review rules remain authoritative.

OpenSpec is a pinned project dev dependency. After `corepack.cmd pnpm install --frozen-lockfile`, run `corepack.cmd pnpm exec openspec <args>` on Windows (`corepack pnpm exec openspec <args>` elsewhere). Treat bare `openspec` in generated skills as shorthand for this command; do not rely on a global PATH entry.

Read the current snapshot in `docs/IMPLEMENTATION_HANDOFF.md` for progress and the next action; consult `docs/IMPLEMENTATION_HISTORY.md` only for relevant past evidence. Read `docs/REQUIREMENTS.md` before changing product behavior, then only the relevant architecture/scenario sections. Do not require the planning conversation or reread every document on every turn.

The user's current instructions govern the work. Approved product requirements are recorded in REQUIREMENTS; ARCHITECTURE is the proposed technical baseline and contains validation gates. A user request to implement a milestone authorizes that milestone: do not ask for a second approval merely because historical documents call the architecture proposed. Resolve routine reversible engineering choices, record them, and continue. Surface material conflicts with requirements or verified blockers.

- For an authorized milestone, work autonomously through implementation, project dependency installation, tests, dedicated local game runs, fixes and documentation.
- Continue through routine decisions without renewed confirmation.
- Ask only for material scope changes, spending, publishing, destructive changes to existing user data, or a blocker requiring user input, subject to enforced tool permissions.
- Keep prerequisite upgrades user-managed and use project-scoped game data.
- This standing instruction does not start a milestone by itself.

## Keep work on the acceptance path

- Name the next acceptance criterion to close, its concrete blockers and the required proof. Choose the next action from those blockers.
- Prioritize working end-to-end behavior and required failure paths. Defer optional polish, generalization, adjacent features and workflow tooling until ticket acceptance passes.
- Use existing runners and the minimum required evidence records. Avoid additional checkpoint/reporting frameworks; reuse dependency-matched results instead of rerunning unaffected checks. Preserve all required verification and independent review.
- Compile new or changed test fixtures before repeated behavioral runs. Diagnose fixture and selector failures locally; do not broaden product scope or weaken assertions to make tests pass.
- Report completed acceptance criteria and remaining blockers, not activity volume. Mark tasks when their full criteria pass. If a work session closes no criterion, explain the impediment and revise the next bounded plan.

## Preserve the project intent

- Use deterministic code for execution, calculations, measurements, scheduling and routine monitoring. Use model reasoning for planning, design and unfamiliar diagnosis.
- Support multiple narrow gameplay agents from the outset. Solo mode is a comparison configuration, not an excuse to defer identity, messaging, ownership or separate contexts.
- Use the user's ChatGPT subscription for Astra through supported Codex access. Never silently fall back to API billing, buy credits, or switch models. Record actual availability and usage limits.
- Show live activity and preserve observation/action/outcome evidence from the first working integration. Invisible final-output-only model runs do not meet the requirement.
- Use structured game state and programmatic actions. Keep screenshot vision optional and outside the initial scenarios.
- Preserve character rules, remove setup grind, and use the installed Space Age game's data as authoritative. Support richer item/surface identities without implementing every late-game feature now.
- Keep game state, tasks, history and recovery independent of any one model conversation. Verify unknown command outcomes before retrying.

## Build and verify

For user-facing startup behavior, keep `npm start` as the single supported entrypoint: it must install the pinned dependencies, build the app, use fixed `localhost:3000`, open the browser, avoid duplicate instances, and report missing prerequisites or cleanup failures in human-readable language. Keep advanced `pnpm` launch commands documented as diagnostics, not as the ordinary-user path.

Follow the [model-selection guide](docs/MODEL_SELECTION.md) for developer work. Plan bounded tasks with a recommended model/effort, rationale and escalation conditions; keep selections explicit and preserve verification, independent-review and gameplay model rules.

Use the architecture's TypeScript/Lua boundaries and a small modular application. Validate the subscription and game connection before expanding infrastructure. Inspect applicable upstream code and notices before rewriting or copying game mechanics.

Use the repository's scripts and lockfile; report only executed results. Before the first code or test edit, read the complete [development workflow](docs/DEVELOPMENT_WORKFLOW.md), not a truncated preview, and follow its maintainability guidance. Preserve non-obvious invariants in local comments and broader rationale in linked decision records.

Test important failure paths with fakes; verify legal movement, inventory accounting, placement, cancellation and save/load in Factorio itself. Keep model-backed tests deliberate and budgeted. Report exactly what ran, what passed, and what remains unverified.

Work is complete only when task acceptance criteria and required checks pass on the final relevant source and independent findings are resolved. Compilation or unit tests alone do not establish working behavior; missing required verification means incomplete work. Delegate routine milestone verification using the [verification author workflow](.agents/skills/verify-change/author-workflow.md); narrow documentation-only checks may stay with the author.

Follow [bounded slice/readiness and correction lineage](docs/DEVELOPMENT_EFFICIENCY.md): validate accepted prerequisites before expansion, retain the shared plan across replacements, diagnose after two unsuccessful corrections to one invariant, and reuse only dependency-matched evidence. Keep automatic compaction defaults and preserve a compact source/evidence/budget handoff at fresh-context boundaries.

Use the versioned [agent handoff contracts](docs/AGENT_CONTRACTS.md) for verifier/reviewer assignments and results. Validate both; a structurally valid report alone does not establish acceptance or authorize completion.

The user manages prerequisite upgrades. Recheck installed versions before treating old observations as blockers. Keep personal saves, global Codex settings, credentials, game binaries and generated run data out of source control.

## Independent review before completion

Review every new spec with `agent-graph-kit:spec-review` in a fresh-context, read-only independent agent, never in the main thread, before declaring it ready.

Before committing or declaring implementation or changes to requirements, permissions or behavior complete, load the [author workflow](.agents/skills/change-audit/author-workflow.md) and delegate one combined implementation/documentation review to a fresh-context, read-only subagent. The author must not self-review; fixes and later substantive changes require follow-up review. Routine documentation-only maintenance and faithful archive/spec sync use the workflow's author-run checks without a reviewer. Read-only/no-change tasks and reviewers are exempt.

## Leave a usable handoff

At milestone completion or a handoff, replace superseded status in IMPLEMENTATION_HANDOFF; keep the entire file within **800 whitespace-separated words and 80 lines**, enforced by `corepack.cmd pnpm check:docs`. Retain the revision/uncommitted boundary, current criteria and evidence links, active limitations/resources and one next bounded action. Preserve detailed records in task reports or IMPLEMENTATION_HISTORY, never by appending history to the snapshot. Keep requirements and README accurate; record material design changes in `docs/decisions/` when needed. Preserve working user changes.

Keep progress concise and concrete. Prioritize a visible, playable vertical slice over speculative infrastructure. Creating or publishing external repositories and starting separate user-owned tasks require the user's request; gameplay-agent support does not itself authorize those actions.
