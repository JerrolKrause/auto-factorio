## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/subscription-provider/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: ARCHITECTURE §§3–4, 9, 12; REQUIREMENTS: Operating defaults. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M0, phase 02) using the smallest affected modules: packages/codex; packages/tools; minimal diagnostic console; provider fakes.

**Non-Goals:** Game connection, durable task scheduling and production dashboard. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Put pinned Codex protocol details in packages/codex behind start/resume/turn/steer/interrupt/discover/activity ports. Generate types from the installed executable when supported. Use normal MCP rather than experimental dynamic tools; one app-server per role is the bounded initial isolation choice.

2. Build the public diagnostic stream and deterministic budget controller together so long turns and concurrent exhaustion are testable before game integration. Define cancellation as an adapter callback now; wire the real fence in phase 07. Persistable counters are plain data until phase 05 provides storage.

3. Use two tiny synthetic sessions with a proposed total ceiling of 6 provider turns, two concurrent turns, 60 seconds and 12 tool attempts per turn, and 5 minutes overall; declare actual caps before execution. These are adjustable smoke-test defaults, not subscription-cost guarantees. Exercise failures with fakes instead of extra inference.

## Risks / Trade-offs

Provider protocol/tool isolation mismatch → block full compatibility and record the missing capability; evaluate the documented visible CLI fallback only as limited evidence. Delayed tokens → retain independent hard time/tool enforcement.

## Migration Plan

Prerequisite: `af-01-compatibility-foundation` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

Managed authentication, Astra discovery, two isolated histories, live activity and lifecycle are evidenced; deterministic budget/late-tool tests pass. No real game is required in this phase.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.