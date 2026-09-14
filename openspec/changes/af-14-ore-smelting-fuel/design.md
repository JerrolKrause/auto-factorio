## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/ore-smelting-fuel/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: SCENARIOS §03, Required upstream evidence, Quantitative fuel supply; decision 001 finding 4. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M3, phase 14) using the smallest affected modules: scenarios/03-hot-metal; Lua burner telemetry; fuel evaluator and controls.

**Non-Goals:** Mining, steam power and S4 bootstrapping. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Reuse the stage evaluator and add furnace/burner telemetry for S3. Proposed 96×96 fixture feeds iron ore 120/minute, copper ore 60/minute and coal 120/minute; power is supplied and the common kit gains 24 stone furnaces.

2. Compute per-required-furnace-branch source/route delivery and energy consumption, including currently burning fuel and initial/final route inventories. Freeze reference-tested tolerances before agent runs. Fungible coal needs balance coverage, not per-item tags.

3. Use a legal reference plus stockpiled plates and reserve-backed insufficient fuel controls with output still above target. Keep steam/mined-coal features out of this phase so the burner evaluator is independently testable.

## Risks / Trade-offs

Burner energy/tick accounting gaps → fail coverage as invalid and improve observation. Huge coal reserves hiding a deficient route → test with explicit negative controls, not depletion-only output observation.

## Migration Plan

Prerequisite: `af-13-plate-to-science` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

S3 positive reference and smelting/shared controls pass; absent and insufficient furnace fuel delivery reliably fail despite reserves, with coverage/tolerances recorded.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.