## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/fault-recovery/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: SCENARIOS §05, Evaluation rules, Verification timing; decision 001 finding 2. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M3, phase 16) using the smallest affected modules: scenarios/05-unscheduled-downtime; fault harness; recovery timing/metrics; evaluator-only records.

**Non-Goals:** Requiring a specific repair layout or exposing fault answers to gameplay. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Derive each S5 starting save from the validated S4 ordinary-gateway reference and record its complete buffers. Fault injection is deterministic operator/evaluator work; gameplay sees normal observations only.

2. Evaluate do-nothing evidence for every integer admission tick from fault injection through tick +36000, extending data through the last settling/scoring finish. Use deterministic prefix sums/window calculations to reuse one tick trace per fixture instead of running a model or restarting the game for every candidate.

3. Keep repair correctness outcome-based: an ordinary-action alternate route is valid. Enforce the admission deadline separately from fixed finish time and wall ceiling, and show all clocks explicitly.

## Risks / Trade-offs

A variant still passes with old buffers → change affected capacity/branch/buffers and rerun both controls; never choose only a conveniently late start. Fault metadata leaking via receipts → enforce phase 08 visibility.

## Migration Plan

Prerequisite: `af-15-mining-power-bootstrap` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

Each of the three variants fails every eligible unrepaired start and has a legal passing restoration from its identical save; deadline edges and archive restrictions pass.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.