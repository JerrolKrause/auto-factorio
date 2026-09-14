## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/first-shift-reference/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: SCENARIOS: Shared world, Deliverable structure, Common kit, §01 and Evaluation rules. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M2, phase 11) using the smallest affected modules: scenarios/01-first-shift; Lua fixture/measurement adapters; operator-only reference tests.

**Non-Goals:** Model performance claims and plate/ore/mining scenarios. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Create the shared manifest/fixture loader only as needed for S1. Proposed fixture: 64×64 cleared site, gear and copper terminals each at 60/minute, protected power and draining collector; use the finite common kit in SCENARIOS. Record actual grants and fingerprint.

2. Generate the cached disarmed save through privileged setup, then run the hidden reference entirely through ordinary gameplay actions. Place fixture setup, reference instructions and private evaluation data outside gameplay context. Ratios come from installed recipes and assembler speed.

3. Instrument terminal-to-science and science-to-collector boundaries with engine measurements reconciled to buffer/in-process inventory. Exercise positive legal buffering and bypass factories before freezing tolerances or declaring measurement coverage adequate.

## Risks / Trade-offs

Feed geometry or kit inadequate → adjust the fixture version and rerun controls. Output-only success → cannot pass until fresh flow coverage establishes 150 gears and copper deliveries across scoring.

## Migration Plan

Prerequisite: `af-10-verification-engine` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

Live S1 legal reference passes five windows and fresh-flow balances; all specified bypass controls fail; reset uses the validated barrier and exposes a complete briefing.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.