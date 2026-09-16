## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/live-control-dashboard/spec.md) for behavior. This packet was originally written against planning revision `1cdff32`. At implementation entry (`c3d4add`), phases 01–08 are implemented and archived; the existing runtime, journal, coordinator, ownership and lifecycle interfaces are reused. Source reading for this phase: ARCHITECTURE §§2, 8–9; REQUIREMENTS: Observability definition. Their recorded prerequisite gates have passed. [Decision 011](../../../../docs/decisions/011-live-control-dashboard.md) records the concrete control, replay, intervention and telemetry boundaries.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M1, phase 09) using the smallest affected modules: apps/runtime HTTP/SSE; apps/dashboard; intervention storage; UI tests.

**Non-Goals:** Comparison/branch UI and remote or public hosting. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Build Fastify HTTP commands plus cursor-based SSE over stored events, with React/Vite ordinary CSS for one useful operator page. Runtime remains authoritative when the browser closes; reconstruct views from projections on reconnect.

2. Persist steering before routing and model receipt versus interpretation as separate states. Correlate observations, batches, task revisions and interventions. Reuse the established pause/stop/resume/fence operations rather than implementing control logic in browser state.

3. Bind control routes to loopback and require local session capability and origin checks. Show unknown cancellation, disconnected game and missing telemetry explicitly. Display only public provider activity and explicit explanations.

## Risks / Trade-offs

SSE gaps/duplicates → cursor reconciliation tests. Advice racing an active batch → ordinary advice affects subsequent plans while explicit reprioritization fences conflicting work.

## Migration Plan

Prerequisite: `af-08-bounded-context` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

Operator can watch two roles, inspect evidence, steer and pause/stop/resume; reconnect, duplicate steering, local-origin checks and unconfirmed-control states pass UI/integration tests.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.