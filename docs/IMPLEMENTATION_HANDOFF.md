# Implementation handoff

## Current implementation — 16 September 2026

Phases **01–09 are complete and archived**. Phase **10**, [verification engine](../openspec/changes/archive/2026-09-16-af-10-verification-engine/proposal.md), has **8/8 tasks complete** and passes its software/live guard gate. Its capability is synced to [main specs](../openspec/specs/verification-engine/spec.md). Commit: **`Implement and archive phase 10 verification engine`** (this closeout commit, parent `9909e00`). Phases **11–18 remain unimplemented**.

**Next bounded action:** start phase 11, [First Shift reference](../openspec/changes/af-11-first-shift-reference/proposal.md), only on the user's instruction. No phase 11 work or model inference ran.

Phase 10 adds an evaluator-only immutable attempt state machine, exact settling/five-window measurements, connected stage net-flow and inventory balances, fixed tolerances and deadlines, retained invalid evidence, and incremental event storage. Lua closes mutation admission before cancelling active/native/queued effects and recording a baseline; guards run at submission and execution. Repair aborts before mutations reopen. Benchmark manual science crafting and fixture protections persist. See [module contract](../packages/core/evaluation/README.md) and [Decision 012](decisions/012-verification-engine.md).

## Verification and review

- Delegated `corepack.cmd pnpm verify --game` passed both builds, lint, **284/284 tests in 13 files**, docs (**123 files / 392 links** at that run), **9/9** fresh headless smoke checks and exact-profile cleanup. Evidence: `.runtime/verification/check-295Hh6/`; headless profile `.runtime/phase03/game-iPaAWE/`. The validated assignment/result is in `.runtime/phase10-verification-3/`.
- Evaluator coverage: **31 tests**, including an **18,601-sample** linear-event-storage regression, acknowledged admission, 29-pack windows, old stock, exact boundaries, paused/wall clocks, deadlines, missing/ambiguous coverage, human edits, disconnected/recirculated flow, drawdown and normal buffering. Rejected raw input remains evidence.
- Fresh visible `corepack.cmd pnpm game:verification-probe --profile-file .runtime/phase10-profile.json` passed **7/7** in **Factorio 2.0.77 + Space Age**. Evidence: `.runtime/phase04/game-BdtDYo/verification-probe-o9JmKg/` (source hashes, versions, events, final guard and result). Covers native crafting and queued placement cancellation before the baseline; all six mutation types denied; walking; cancelled-command replay; legal repair placement; human edit invalidation; and frozen pause/replacement clocks. The player-build edit is an explicit diagnostic injection.
- After the standard gate, only the probe's stale-command diagnostic and documentation changed. A fresh full build and probe run cover that change; core tests and Lua/headless evidence remain applicable. Final software/source-evidence checks are retained under `.runtime/phase10-verification-4/`; closeout checks/review are under `.runtime/phase10-closeout/` and `.runtime/phase10-review-3/`.
- Independent review found **1 P2 issue** (quadratic event retention); **1 fixed, 0 rejected, 0 remaining in code re-review**. Incremental events and sink-isolation regression passed. Earlier reports are in `.runtime/phase10-review-1/` and `phase10-review-2/`. Verifier requested Luna/medium; observed usage metadata was unavailable, so no savings claim is made.

## Retained failures and cleanup

The first probe queried state before Factorio's console acknowledgement and failed before mutation. A later live run exposed callback-time `require`, fixed by parse-time imports. A diagnostic console injection could not access mod-private storage; the supported delayed-command replay replaced it. Failed evidence remains in `game-bFGKIB/verification-probe-QnAfM4/`, `game-6xjjnV/verification-probe-4SynjW/`, and `game-6Jv5hZ/verification-probe-mOto8U/` under `.runtime/phase04/`. A separate software run hit an existing compiler-spawn test's five-second timeout; isolated rerun passed **16/16**, then the final full suite passed **284/284** after the visible trial was closed. No timeout was weakened.

Ordinary sandbox process inspection failed; reviewed project-scoped launches/checks/cleanup succeeded. All phase 10 visible profiles were cleaned up by exact config/process identity; the final passed world was paused and disarmed before cleanup. The pre-existing phase 03 `game-KL4Zrd` server was preserved. No personal saves, game installation, credentials or global settings were changed.

## Limits and next integration

No scenario is ready yet. This phase's real game evidence proves guards and cancellation; its factory telemetry remains explicitly unavailable. Phase 11 must implement the draining collector, source/route/inventory measurement adapter, exact tick capture and real S1 positive/bypass calibration. Fake trace tolerances are not calibrated game tolerances. Quantitative burner energy belongs to phases 14–15.

The adapter must keep manifest/scope and run clock origins durable, feed budget/disconnect/edit invalidations, poll wall limits while paused, and retain evaluator-only evidence. Gameplay has no evaluator control endpoint. Arbitrary script/inventory edits remain incompletely observable; missing coverage invalidates scoring. Invalid attempts require reconciliation and a fresh baseline. Full reports are explicit snapshots; routine event sinks retain incremental samples.

## Archive and commit closeout — 16 September 2026

User requested archive and commit. Phase 10 is archived at `openspec/changes/archive/2026-09-16-af-10-verification-engine/`, preserving `.openspec.yaml`. Its main spec preserves the delta Purpose and all six requirement/scenario blocks. README, guide, traceability, historical links and archived relative links now resolve to the archive. This closeout includes the completed phase 10 implementation; phase 11 remains unstarted.

Archive changes affect only planning and documentation. The final **284-test / 9 headless / 7 live** evidence above remains applicable; no additional game or provider run is needed. Fresh strict OpenSpec validation passed **18/18**, documentation checks passed **124 files / 398 links**, and staged whitespace checks passed. Git staging required reviewed escalation after the sandbox denied its index lock. Before-archive snapshots, spec equality checks and independent archive review are retained in `.runtime/phase10-archive-20260916/`.

## History on demand

The [phase 09 closeout and earlier evidence](IMPLEMENTATION_HISTORY.md#phase-09-closeout-retained-at-phase-10) preserve its dashboard, agent workflow and archive records.
