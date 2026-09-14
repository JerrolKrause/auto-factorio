## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/mining-power-bootstrap/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: SCENARIOS §04 and Quantitative fuel supply. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M3, phase 15) using the smallest affected modules: scenarios/04-you-are-the-infrastructure; mining/power telemetry; fuel evaluator extensions.

**Non-Goals:** Fault injection and late-game power systems. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Extend the fuel evaluator from furnaces to actual steam-power and smelting branches. Proposed S4 site is about 160×160 with fixed patches and water; add 16 drills, 2 boilers, 4 engines, pump/pipes and 200 bootstrap coal to the documented kit.

2. Build the bootstrap sequence as an operator-only ordinary-action reference. Disable external reserve access before settling, retaining all initial internal fuel in balances. Include stored steam/thermal and burning energy so a reserve cannot hide power supply deficits.

3. Measure designated-patch extraction, net routing and each consumer branch. Extend existing stage/fuel contracts rather than introducing special success heuristics for S4.

## Risks / Trade-offs

An inaccessible resource/water route or insufficient kit → adjust and revalidate the fixture. Adequate total coal with a starved branch → branch-level replenishment rejects it.

## Migration Plan

Prerequisite: `af-14-ore-smelting-fuel` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

S4 boots legally, isolates the reserve, passes the complete fresh chain/fuel test, and stockpile, trickle, disconnected mining and deficient-branch controls fail.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.