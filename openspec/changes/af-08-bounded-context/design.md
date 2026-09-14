## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/bounded-context/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: ARCHITECTURE §7; decision 001 finding 5. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M1, phase 08) using the smallest affected modules: packages/core/context; storage queries; scoped MCP history tools.

**Non-Goals:** Unrestricted observer exports and automatic promotion of speculative lessons. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Build a single authorization service applied before retrieval/projection, not just separate tool catalogs. Default missing labels to deny, and propagate visibility into derived summaries and reference traversal.

2. Use three explicit context levels: compact task briefing, bounded detail and authorized archive. Rebuild replacement briefings from tasks, reservations, pending commands and unresolved steering, then refresh scoped world state. Provider transcript resumption is optional.

3. Separate exact delivered observations from richer telemetry; cache prototypes by complete game/mod fingerprint and query dynamic availability. Keep evaluator records in protected storage and release only purpose-built sanitized projections.

## Risks / Trade-offs

Indirect leaks through counts, pagination, filenames or derived payloads → attack-oriented fake retrieval fixtures covering each surface. Oversized context → explicit truncation and continuation rather than silent dropping.

## Migration Plan

Prerequisite: `af-07-agent-coordination` implementation gate recorded passed in the handoff. Read the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

Direct-ID/search/reference/cross-role/summary/replacement tests deny hidden evidence, and a fresh briefing reconstructs useful authorized work within configured bounds.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.