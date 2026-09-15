## Why

Passing integration probes do not yet preserve tasks, command intent and evidence across a runtime crash.

## What Changes

- Transactional event storage and projections, command outbox, receipt reconciliation and consistent artifact/checkpoint records.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 05 only after `af-04-pause-restore-gate` has passed its implementation gate; see the [implementation guide](../../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `durable-event-runtime`: Transactional event storage and projections, command outbox, receipt reconciliation and consistent artifact/checkpoint records.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: packages/storage; packages/core/execution; apps/runtime composition. Source basis: ARCHITECTURE §§2, 5, 8; IMPLEMENTATION_HANDOFF: Milestone 1. Requirement coverage: R11, R14, R16; original milestone: M1.

Outside this change: Rich dashboard, agent scheduler and new recovery semantics. The current repository remains a documentation-only starter; earlier phases are prerequisites, not claims of existing code. This proposal is planning only.