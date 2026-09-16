## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/agent-coordination/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: ARCHITECTURE §§3–5; REQUIREMENTS: Initial agent responsibilities. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M1, phase 07) using the smallest affected modules: packages/core/orchestration; packages/tools; agents/foreman; agents/engineer; agents/teams.

**Non-Goals:** Domain-specific third specialist intelligence, scenario scoring and full archive retrieval. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Use a small deterministic task graph in packages/core rather than a conversation-owned framework. Foreman proposes work; runtime validates dependency cycles, ownership and success evidence; engineer designs and executes. Task reports remain claims until verified.

2. Register role definitions and instances separately from actor identities and provider sessions. Use durable scoped messages for decomposition, help and completion. Add a synthetic third definition to validate extensibility without creating a new coordination path.

3. Wire phase 02 budgets to phase 05 persisted accounting and phase 06 fences. Default to two concurrent turns shared across the roster. Use deterministic events for queue progress and waits, reserving reasoning turns for decisions.

## Risks / Trade-offs

Duplicate messages or late provider results → deduplicate and enforce current task revision. Scheduler crash → rebuild from projections and reconcile ownership before dispatch.

## Migration Plan

Prerequisite: `af-06-fenced-ownership` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

Two roles hand off durable work, a third synthetic role registers without rewriting coordination, solo uses the same contracts and concurrent budget exhaustion safely cancels game work.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.