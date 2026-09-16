## Why

A Node lease expiry cannot prevent already queued Lua work from acting after ownership changes.

## What Changes

- Atomic reservation sets and acknowledged game-side revocation, task revision fences and safe reassignment.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 06 only after `af-05-durable-event-runtime` has passed its implementation gate; see the [implementation guide](../../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `fenced-ownership`: Atomic reservation sets and acknowledged game-side revocation, task revision fences and safe reassignment.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: packages/core/execution; packages/core/orchestration reservation port; Lua fencing; contracts. Source basis: ARCHITECTURE §§4–6; decision 001 finding 3. Requirement coverage: R02, R04, R14, R16; original milestone: M1.

Outside this change: Task planning policy, archive retrieval and UI polish. The current repository remains a documentation-only starter; earlier phases are prerequisites, not claims of existing code. This proposal is planning only.