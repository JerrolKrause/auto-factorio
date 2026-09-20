# Working on AutoFactorio

These instructions apply to agents developing this repository. Gameplay-role prompts belong in `agents/`; do not use this file as player memory or expose private evaluator fixtures to gameplay agents.

Keep all future edits to this file as context-efficient as possible: concise rules, no repetition or background narrative; link local skills/docs for detail while preserving essential constraints.

## Begin with the current task

Read the current implementation entry in `docs/IMPLEMENTATION_HANDOFF.md` for progress and the next milestone; consult historical entries only when relevant. Read `docs/REQUIREMENTS.md` before changing product behavior, then only the relevant architecture/scenario sections. Do not require the planning conversation or reread every document on every turn.

The user's current instructions govern the work. Approved product requirements are recorded in REQUIREMENTS; ARCHITECTURE is the proposed technical baseline and contains validation gates. A user request to implement a milestone authorizes that milestone: do not ask for a second approval merely because historical documents call the architecture proposed. Resolve routine reversible engineering choices, record them, and continue. Surface material conflicts with requirements or verified blockers.

For an authorized milestone, work autonomously through implementation, project dependency installation, tests, dedicated local game runs, fixes and documentation. Continue through routine decisions without renewed confirmation. Ask only for material scope changes, spending, publishing, destructive changes to existing user data, or a blocker requiring user input, subject to enforced tool permissions. Keep prerequisite upgrades user-managed and use project-scoped game data. This standing instruction does not start a milestone by itself.

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

Use the repository's scripts and lockfile; report only executed results. Before editing code, read and follow the [development workflow](docs/DEVELOPMENT_WORKFLOW.md), including its maintainability guidance. Preserve non-obvious invariants in local comments and broader rationale in linked decision records.

Test important failure paths with fakes; verify legal movement, inventory accounting, placement, cancellation and save/load in Factorio itself. Keep model-backed tests deliberate and budgeted. Report exactly what ran, what passed, and what remains unverified.

Work is complete only when task acceptance criteria and required checks pass on the final relevant source and independent findings are resolved. Compilation or unit tests alone do not establish working behavior; missing required verification means incomplete work. Delegate routine milestone verification using the [verification author workflow](.agents/skills/verify-change/author-workflow.md); narrow documentation-only checks may stay with the author.

Use the versioned [agent handoff contracts](docs/AGENT_CONTRACTS.md) for verifier/reviewer assignments and results. Validate both; a structurally valid report alone does not establish acceptance or authorize completion.

The user manages prerequisite upgrades. Recheck installed versions before treating old observations as blockers. Keep personal saves, global Codex settings, credentials, game binaries and generated run data out of source control.

## Independent review before completion

Before committing or declaring implementation or changes to requirements, permissions or behavior complete, load the [author workflow](.agents/skills/change-audit/author-workflow.md) and delegate one combined implementation/documentation review to a fresh-context, read-only subagent. The author must not self-review; fixes and later substantive changes require follow-up review. Routine documentation-only maintenance and faithful archive/spec sync use the workflow's author-run checks without a reviewer. Read-only/no-change tasks and reviewers are exempt.

## Leave a usable handoff

At milestone completion or a handoff, update IMPLEMENTATION_HANDOFF with the commit, completed criteria, executed tests, remaining limitations and next bounded action. Keep requirements and README accurate; record material design changes in `docs/decisions/` when needed. Preserve working user changes.

Keep progress concise and concrete. Prioritize a visible, playable vertical slice over speculative infrastructure. Creating or publishing external repositories and starting separate user-owned tasks require the user's request; gameplay-agent support does not itself authorize those actions.
