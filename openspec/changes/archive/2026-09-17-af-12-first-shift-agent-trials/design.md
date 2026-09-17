## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/first-shift-agent-trials/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: IMPLEMENTATION_HANDOFF: Milestone 2; REQUIREMENTS R10–R17; SCENARIOS: Comparison and improvement. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M2, phase 12) using the smallest affected modules: runtime launch composition; agents instructions; S1 experiment records and handoff.

**Non-Goals:** Guaranteed model success, exhaustive statistical claims and extra paid inference. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Compose the existing runtime, roles, S1 selector and dashboard without adding another orchestration system. Use the phase 11 reference as the evaluator control, never inject it as an agent layout.

2. Plan two bounded S1 runs: an unassisted team trial with one engineer session replacement, and a separately labeled assisted trial. Proposed caps per run: 30 provider turns total, 90 seconds/20 tools per turn, two concurrent turns, 30 game minutes and 45 wall minutes. Declare actual configurable caps and usable token telemetry before launch; do not automatically add retries.

3. Use deterministic preflight for manifests, scopes and admission before inference. Store run IDs and observations in ignored runtime data, and write only sanitized summary/evidence references to the handoff.

## Risks / Trade-offs

Stochastic failure or account limit → preserve the failed outcome; completing the planned observation is distinct from claiming model success. Software defects → fix within the phase scope and rerun only the affected checks.

## Migration Plan

Prerequisite: `af-11-first-shift-reference` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

Declared team, assisted and fresh-context exercises finish with complete evidence or explicit bounded model failure. Software/reference gates must pass; missing integration evidence is still a blocker.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.
