## Why

Fresh model sessions need relevant durable context without receiving hidden evaluator plans or another role's restricted history.

## What Changes

- Bounded observations and three-level memory with authorization across IDs, queries, references, summaries and replacement briefings.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 08 only after `af-07-agent-coordination` has passed its implementation gate; see the [implementation guide](../../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `bounded-context`: Bounded observations and three-level memory with authorization across IDs, queries, references, summaries and replacement briefings.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: packages/core/context; storage queries; scoped MCP history tools. Source basis: ARCHITECTURE §7; decision 001 finding 5. Requirement coverage: R05, R11, R15–R16; original milestone: M1.

Outside this change: Unrestricted observer exports and automatic promotion of speculative lessons. The current repository remains a documentation-only starter; earlier phases are prerequisites, not claims of existing code. This proposal is planning only.