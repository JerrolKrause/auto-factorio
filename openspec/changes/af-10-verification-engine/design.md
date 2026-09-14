## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/verification-engine/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: SCENARIOS: Evaluation rules, Required upstream evidence, Verification timing; decision 001 finding 1. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M2, phase 10) using the smallest affected modules: packages/core/evaluation; Lua verification admission/telemetry; measurement contracts and fakes.

**Non-Goals:** Scenario-specific layouts, quantitative burner energy extension and model trials. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Implement the verification state machine in the deterministic core and enforce mutation policy in Lua before both new and queued actions. Admission waits for completed/cancelled outstanding character effects, then freezes scope and baselines.

2. Represent each required stage by observed production/extraction, net boundary transfers and inventory balances. Credit downstream delivery only within the evaluated chain. Use fixture-aware instrumentation rather than universal item identity tracking; ordinary mixed buffers remain valid.

3. Begin with fake traces and the existing live action sandbox for admission guards. Calibrate actual source/route coverage against S1 in phase 11 before declaring any scenario ready. Fixed default settling is 600 ticks; scoring is five 3600-tick windows. Burner energy is extended in phases 14–15.

## Risks / Trade-offs

Unobservable bypass or noisy phase accounting → mark invalid and improve instrumentation/fixture, never loosen the required fresh quantities. Global counters/topology alone → insufficient evidence.

## Migration Plan

Prerequisite: `af-09-live-control-dashboard` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

State-machine, window-boundary, missing-evidence and disconnected/recirculation controls pass deterministically; queued-action verification guard passes in the game. S1 engine measurement proof remains phase 11.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.