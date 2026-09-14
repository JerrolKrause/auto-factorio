## Why

The diagnostic stream needs a usable operator interface that remains truthful during reconnects, steering and uncertain cancellation.

## What Changes

- A local activity dashboard with resumable events, task/measurement views, persisted steering and reconciled pause/stop/resume.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 09 only after `af-08-bounded-context` has passed its implementation gate; see the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `live-control-dashboard`: A local activity dashboard with resumable events, task/measurement views, persisted steering and reconciled pause/stop/resume.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: apps/runtime HTTP/SSE; apps/dashboard; intervention storage; UI tests. Source basis: ARCHITECTURE §§2, 8–9; REQUIREMENTS: Observability definition. Requirement coverage: R10–R14, R16–R17; original milestone: M1.

Outside this change: Comparison/branch UI and remote or public hosting. The current repository remains a documentation-only starter; earlier phases are prerequisites, not claims of existing code. This proposal is planning only.