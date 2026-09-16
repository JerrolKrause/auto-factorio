# Operator runtime

`durable-runtime.ts` composes storage, game execution and lifecycle. `operator.ts` adds durable admission/control state and polling; `http.ts` exposes only the loopback operator API. `dashboard-types.ts` is the browser snapshot contract. Role-specific steering lives in `packages/core/orchestration/interventions.ts` and enters the existing bounded briefing; interpretation is exposed by the authenticated coordination gateway.

Run `corepack.cmd pnpm build`, then `corepack.cmd pnpm dashboard --fixture` for a synthetic demonstration, or pass `--profile-file <dedicated-game-profile.json>` for a project game. The command reports its generated `dashboard.json`; open its `url` locally. `--directory` reopens project-scoped runtime data and its existing budget. Never run two writers on the same directory. `--port` optionally selects a loopback port. Closing the tab leaves monitoring running; stopping the host requests a held game state.

Control invariants and limitations are in [Decision 011](../../docs/decisions/011-live-control-dashboard.md). Tests: `tests/dashboard.test.ts` exercises auth, replay, advice, recovery and control failure paths; `tests/ui/dashboard.spec.ts` drives Edge; `scripts/game-dashboard-probe.ts` uses a dedicated visible Factorio profile and synthetic provider callbacks.
