## Why

Durable recovery would be built on an unverified assumption unless the hosted game can pause under polling and restore behind an execution barrier.

## What Changes

- A measured pause/disarm/save/load/reconcile/re-arm demonstration with pending work and a compatibility gate report.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 04 only after `af-03-character-execution` has passed its implementation gate; see the [implementation guide](../../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `pause-restore-gate`: A measured pause/disarm/save/load/reconcile/re-arm demonstration with pending work and a compatibility gate report.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: game lifecycle adapter; Lua executor/watchdog; minimal checkpoint manifest; compatibility report. Source basis: ARCHITECTURE §§6, 8, 12; decision 001 findings 3 and 7. Requirement coverage: R14, R16–R17; original milestone: M0.

Outside this change: Full database, checkpoint branch UI and alternative hosting platforms beyond what the gate requires. The current repository remains a documentation-only starter; earlier phases are prerequisites, not claims of existing code. This proposal is planning only.