# Milestone 0 integration gate

Observed 15 September 2026 on Windows. Phase 04's live gate passed in `.runtime/phase04/game-9FyIug/pause-probe-ckC8t8/result.json`: 14 checks, exit 0. This report consolidates the distinct prerequisite trials; it does not describe them as one provider-driven gameplay run. The [handoff](IMPLEMENTATION_HANDOFF.md) contains revision, review status, failed trials and remaining limits.

| M0 criterion | Executed evidence |
| --- | --- |
| Compatible project runtime, isolated data, SQLite and provenance | Phase 01 report at `.runtime/local/diagnostic-1pMoKG/compatibility.json`; archived foundation gate and [compatibility report](COMPATIBILITY_REPORT.md). Original adapter; no upstream mechanics/assets copied. |
| Subscription-only Astra, narrow roles, public activity, separate histories, steering, cancellation and resume | Phase 02 `.runtime/phase02/probe-5Buw16/{events.jsonl,result.json}`: 4 turns, 7 gateway attempts, 68,386 reported tokens, exact Astra/low, two isolated histories, synthetic handoff/cancellation, confirmed interruption and both role resumes. Earlier failed/unknown usage remains in the handoff. No phase 04 provider inference. |
| Installed game facts and legal deterministic character effects | Phase 03 `.runtime/phase03/game-KL4Zrd/evidence/probe-MKDBNf/integrated-result.json`: 21 action checks, 18 saved receipts, exact placement/transfer/refund audits; receipt-readback `result.json`: 18/18 exact matches. Phase 04's updated mod also passes 9 fresh headless smoke checks in `.runtime/phase03/game-2JewTr`. |
| Live pause under polling | Phase 04 `events.jsonl`: pending walking and native crafting, furnace output/progress, diagnostic timer/injection counters, inventory, entities and receipts remain unchanged after acknowledged pause. `game.tick` freezes while `ticks_played` advances. |
| Complete checkpoint | `checkpoints/checkpoint-*.json` with SHA-256 of completed ZIP, saved ledger/intents, observed world, event cursor, session/generation and mod source hashes. Capture waits for the engine's completed-save log and verifies stable state before publication. |
| Pre-execution load barrier and multiplayer lifecycle | `managed-load/process.log`, its observer log and probe events: held saved simulation, disarmed executor, neutral controls, unchanged ledger/production before join; full world/character/inventory equality after visible join. No `on_load` mutation or peer-local eligibility flag. |
| Cancellation after checkpoint, rollback and stale traffic | `reconciliation-plan.json` and trace: the saved crafting order is cancelled later in the original world; its later chest placement is absent after rollback. Saved work stays inert, reconciliation cancels its intent, stale sessions/arm are rejected, and only a fresh authorized batch places one chest. A fresh RCON credential also rejects the old runtime's authentication. |
| Loss of control and unsafe sources | Real heartbeat disconnect during native crafting disarms/neutralizes it and suspends its following placement. Returning heartbeats do not arm. Explicit reconcile/arm plus a fresh movement command succeeds. An armed native save lacking a managed manifest is refused before load. |
| Deterministic failure paths | Build/lint pass; 94 tests: 22 lifecycle, 17 game, 44 provider and 11 foundation. Includes interrupted capture, checksum/source/manifest mismatch, rollback facts, stale/unconfirmed controls and delayed neutralization. |

## Exact freeze samples

All values below come from the passing trace; inventories, receipts and production details are retained alongside them.

| Interval | `game.tick` before/after | `ticks_played` before/after | Diagnostic timer before/after | Injection counter before/after | Furnace finished before/after |
| --- | --- | --- | --- | --- | --- |
| Moving character paused | 7010 / 7010 | 7037 / 7172 | 7010 / 7010 | 116 / 116 | 1 / 1 |
| Native crafting paused | 7082 / 7082 | 7283 / 7419 | 7082 / 7082 | 118 / 118 | 2 / 2 |
| Loaded checkpoint before visible join | 7082 / 7082 | 7433 / 7543 | 7082 / 7082 | 118 / 118 | 2 / 2 |
| Delayed saved-order replay | 7082 / 7082 | 7549 / 7592 | 7082 / 7082 | 118 / 118 | 2 / 2 |

## Boundaries

Pinned Factorio 2.0.77 build 84539 with base/Space Age/quality/elevated-rails 2.0.77; original mod 0.1.0 plus exact source hashes. Node 24.21.0, pnpm 12.4.1, Codex CLI 0.154.0. Provider allowance observations are historical trial measurements, not current guaranteed availability.

This proves the hosted lifecycle using a minimal file-backed diagnostic, one builder and the existing fixed test grant with advancing generations. It does not implement the phase 05 database/outbox, phase 06 general fencing/ownership, scenario evaluation, branch UI or a provider-driven factory. Diagnostic timer/injection counters are explicit fixtures; they do not claim completed scenario scoring. Interrupted work needs a fresh command; arbitrary user-opened saves have no automatic-continuation guarantee. Full source-matched replay and additional platforms are unverified. These limits preserve the phase boundary rather than replacing a missing live gate.

Phase 05 requires this report and the completed phase 04 handoff, and starts only when separately requested. See [decision 006](decisions/006-pause-restore.md) for protocol details.
