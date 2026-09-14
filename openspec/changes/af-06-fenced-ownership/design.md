## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/fenced-ownership/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: ARCHITECTURE §§4–6; decision 001 finding 3. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M1, phase 06) using the smallest affected modules: packages/core/execution; packages/core/orchestration reservation port; Lua fencing; contracts.

**Non-Goals:** Task planning policy, archive retrieval and UI polish. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Represent area, item and actor reservations with monotonic generations and atomically acquired sets. Persist revoke intent before closing admission and sending an idempotent Lua control fence; only acknowledged final receipts allow reassignment.

2. Lua checks the entire grant set and task revision at admission and immediately before every effect, including per-tick continuations. Install grants/epochs through the phase 04 arm protocol. Node lease expiry is a scheduling signal, never proof that game execution stopped.

3. Keep resource ordering and fence transitions deterministic and port-based. Test arbitrary timing with fakes, then replay a narrow stale-work/revoke/restore suite in the live game. Dynamic multi-character support fits the contracts without requiring a fleet of builders.

## Risks / Trade-offs

Control disconnect or delayed revoke → hold resources unavailable. Old grant/arm request → monotonic comparison rejects regression; duplicate request IDs return consistent receipts.

## Migration Plan

Prerequisite: `af-05-durable-event-runtime` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

Conflict, delayed revocation, stale task/grant/arm, per-tick cancellation and restored cancelled-order checks pass with both deterministic failure tests and live evidence.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.