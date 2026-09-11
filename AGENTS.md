# Working on AutoFactorio

These instructions apply to agents developing this repository. Gameplay-role prompts belong in `agents/`; do not use this file as player memory or expose private evaluator fixtures to gameplay agents.

## Begin with the current task

Read `docs/IMPLEMENTATION_HANDOFF.md` for actual progress and the next milestone. Read `docs/REQUIREMENTS.md` before changing product behavior, then only the relevant architecture/scenario sections. Do not require the planning conversation or reread every document on every turn.

The user's current instructions govern the work. Approved product requirements are recorded in REQUIREMENTS; ARCHITECTURE is the proposed technical baseline and contains validation gates. A user request to implement a milestone authorizes that milestone: do not ask for a second approval merely because historical documents call the architecture proposed. Resolve routine reversible engineering choices, record them, and continue. Surface material conflicts with requirements or verified blockers.

## Preserve the project intent

- Use deterministic code for execution, calculations, measurements, scheduling and routine monitoring. Use model reasoning for planning, design and unfamiliar diagnosis.
- Support multiple narrow gameplay agents from the outset. Solo mode is a comparison configuration, not an excuse to defer identity, messaging, ownership or separate contexts.
- Use the user's ChatGPT subscription for Astra through supported Codex access. Never silently fall back to API billing, buy credits, or switch models. Record actual availability and usage limits.
- Show live activity and preserve observation/action/outcome evidence from the first working integration. Invisible final-output-only model runs do not meet the requirement.
- Use structured game state and programmatic actions. Keep screenshot vision optional and outside the initial scenarios.
- Preserve character rules, remove setup grind, and use the installed Space Age game's data as authoritative. Support richer item/surface identities without implementing every late-game feature now.
- Keep game state, tasks, history and recovery independent of any one model conversation. Verify unknown command outcomes before retrying.

## Build and verify

Use the architecture's TypeScript/Lua boundaries and a small modular application. Validate the subscription and game connection before expanding infrastructure. Inspect applicable upstream code and notices before rewriting or copying game mechanics.

Use the repository's actual scripts and lockfile once created. No install, build, lint or test commands exist in this documentation-only starter yet; do not invent successful commands or results. Add accurate commands to README as implementation lands.

Test important failure paths with fakes; verify legal movement, inventory accounting, placement, cancellation and save/load in Factorio itself. Keep model-backed tests deliberate and budgeted. Report exactly what ran, what passed, and what remains unverified.

The user manages prerequisite upgrades. Recheck installed versions before treating old observations as blockers. Keep personal saves, global Codex settings, credentials, game binaries and generated run data out of source control.

## Leave a usable handoff

At milestone completion or a handoff, update IMPLEMENTATION_HANDOFF with the commit, completed criteria, executed tests, remaining limitations and next bounded action. Keep requirements and README accurate; record material design changes in `docs/decisions/` when needed. Preserve working user changes.

Keep progress concise and concrete. Prioritize a visible, playable vertical slice over speculative infrastructure. Creating or publishing external repositories and starting separate user-owned tasks require the user's request; gameplay-agent support does not itself authorize those actions.
