## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/character-execution/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: ARCHITECTURE §§5–6, 10, 12. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M0, phase 03) using the smallest affected modules: packages/contracts; packages/factorio; packages/tools; mods/autofactorio; action integration tests.

**Non-Goals:** Scenario fixtures, durable ownership and general late-game mechanics. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Use the selected foundation behind a TypeScript RCON adapter and a named versioned Lua remote interface. Encode a fixed wrapper; model input remains validated data. Lua owns collision/reach, per-tick movement/mining/crafting and persistent receipts; Node owns scheduling and calculations.

2. Define only exercised contracts with surface, quality, epoch, control session, task revision and reservation-generation fields from the outset. Until phase 06, use one explicitly authorized test assignment with fixed grants; this demonstrates the wire shape without claiming dynamic reassignment works.

3. Execute a small live action suite and retain an operator-visible NDJSON trace. Cap batches initially at 100 steps and expose asynchronous progress. Use local preconditions instead of rejecting work whenever the world's global tick advances.

## Risks / Trade-offs

Upstream mechanics disagree with installed Space Age → engine validation governs. Lost acknowledgements → query persistent receipts and inspect the world; no blind retry. Rich recipe forms → explicit unsupported results until needed.

## Migration Plan

Prerequisite: `af-02-subscription-provider` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

Visible movement, timing/reach, inventory accounting, placement/rotation/recipe/transfer/deconstruction, partial failure, cancellation and lost-response reconciliation pass in Factorio.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.