## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/retrospectives-branches/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: ARCHITECTURE §§7–8; SCENARIOS: Comparison and improvement; IMPLEMENTATION_HANDOFF: Milestone 4. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M4, phase 17) using the smallest affected modules: apps/dashboard comparison views; core branch orchestration; storage exports.

**Non-Goals:** Fine-tuning, automatic lesson promotion and guaranteed deterministic model replay. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Add comparison and intervention projections to the existing UI; use manifest dimensions and recorded measurements, avoiding a fabricated single cost score when usage is unknown. Treat retrospective explanations as labeled interpretations.

2. Branch through the existing disarm/save/load barrier and assign new run lineage/epoch; do not duplicate recovery logic. Export a consistent observer snapshot with NDJSON/CSV and checksummed artifact references through operator-only routes.

3. Represent instruction improvements as provenance-bearing candidates. Fresh unassisted and held-out trial procedures are documented; executing extra model trials remains deliberate and budgeted, not implicit in a UI test.

## Risks / Trade-offs

Confusing UI replay with rerunning the model → explicit modes/labels. Export pressure or parent artifact deletion → preserve snapshot completeness and references, deferring retention mechanics to phase 18.

## Migration Plan

Prerequisite: `af-16-fault-recovery` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

Comparisons expose usage/assistance differences, hints link to outcomes, exports reopen consistently, and branch isolation/restore tests pass without exposing operator data to gameplay.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.