## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/plate-to-science/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: SCENARIOS §02 and Required upstream evidence. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M3, phase 13) using the smallest affected modules: scenarios/02-some-assembly-required; stage measurement configuration; scenario selector.

**Non-Goals:** Smelting, mining and additional model-backed trials. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Reuse S1 manifest/reset and shared evaluation machinery. Proposed S2 site is 80×80 with iron plates at 120/minute and copper at 60/minute, supplied power and common kit. Extend the stage graph by exactly gear manufacture.

2. Configure measured plate admission, gear production and net gear-to-science delivery. Use installed recipes for 300 iron/150 copper/150 gears over five windows at ordinary recipes. Do not build a new scenario engine.

3. Add hidden reference and negative variants for hand-crafted/pre-stocked gears, disconnected gear production and shared manual/buffer bypasses. No additional live model trial is required for this phase.

## Risks / Trade-offs

Buffer balances appear correct without gear delivery → verify downstream net transfer rather than independent counters. Changed kit/rates → version fixture and controls together.

## Migration Plan

Prerequisite: `af-12-first-shift-agent-trials` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

S2 launches/reset safely, the legal reference passes and every gear-chain/shared bypass is rejected with game evidence.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.