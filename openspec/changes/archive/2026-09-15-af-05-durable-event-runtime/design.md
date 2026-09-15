## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/durable-event-runtime/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: ARCHITECTURE §§2, 5, 8; IMPLEMENTATION_HANDOFF: Milestone 1. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M1, phase 05) using the smallest affected modules: packages/storage; packages/core/execution; apps/runtime composition.

**Non-Goals:** Rich dashboard, agent scheduler and new recovery semantics. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Use the Windows-tested SQLite driver with WAL and one runtime writer. Add migrations, append-only events and transactional projections only for current contracts. Core ports remain independent of the database driver and Fastify.

2. Commit intent/outbox before transport dispatch and reconcile after restart using phase 03 receipts and phase 04 checkpoint epochs. A process-memory deduplication cache is insufficient after save rollback; preserve unknown state until the engine establishes outcomes.

3. Store large payloads in checksummed files with explicit visibility, retaining exact agent responses separately from observer telemetry. Use the driver's consistent backup operation. Do not expand into branch management or a new event-sourcing framework.

## Risks / Trade-offs

Crash between effects and acknowledgement → deterministic outbox crash-point tests plus real receipt reconciliation. Missing/corrupt payloads → expose missing evidence and prevent invalid recovery/scoring claims.

## Migration Plan

Prerequisite: `af-04-pause-restore-gate` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

Crash/restart preserves pending intents, projections, budgets and references without duplicate effects; backup and artifact integrity checks pass against the validated engine lifecycle.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.