## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/pause-restore-gate/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: ARCHITECTURE §§6, 8, 12; decision 001 findings 3 and 7. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M0, phase 04) using the smallest affected modules: game lifecycle adapter; Lua executor/watchdog; minimal checkpoint manifest; compatibility report.

**Non-Goals:** Full database, checkpoint branch UI and alternative hosting platforms beyond what the gate requires. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Use the dedicated visible hosted topology first. Prove game.tick_paused with ticks_to_run = 0 under continued RCON polling and explicitly gate Lua-driven mutations. Keep both tick counters in evidence; only game.tick defines simulation deadlines.

2. Build a minimal file-backed checkpoint manifest before the database: confirmed save checksum, executor ledger, event cursor and epoch. Disarm and neutralize controls before capture. Hold load/execution, reconcile current authorization, install a new session/epoch and explicitly re-arm. Never repair the barrier by mutating storage in on_load.

3. Use the same saved pending order for the critical rollback test: capture disarmed, cancel afterward, load the checkpoint and prove no action occurs before reconciliation or re-arm. Reject arbitrary armed autosaves unless a barrier is separately proven. A managed server plus visible client is a contingency only if the initial topology fails.

## Risks / Trade-offs

Hosted pause/load semantics unproven → this phase is an executable feasibility gate, not a promised result. Record failure, revise topology within the same requirement and rerun before durable runtime work.

## Migration Plan

Prerequisite: `af-03-character-execution` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

Real hosted pause under polling and disarmed capture/load/reconcile/re-arm pass, including timed activity, control loss, stale traffic, pending work and post-checkpoint cancellation; M0 evidence is consolidated.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.