## Why

Separate provider sessions need durable tasks, identity, scoped messages and evidence-based completion to cooperate.

## What Changes

- A deterministic dependency scheduler, foreman/engineer role definitions, solo configuration and integrated roster budget enforcement.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 07 only after `af-06-fenced-ownership` has passed its implementation gate; see the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `agent-coordination`: A deterministic dependency scheduler, foreman/engineer role definitions, solo configuration and integrated roster budget enforcement.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: packages/core/orchestration; packages/tools; agents/foreman; agents/engineer; agents/teams. Source basis: ARCHITECTURE §§3–5; REQUIREMENTS: Initial agent responsibilities. Requirement coverage: R01–R04, R12, R16–R17; original milestone: M1.

Outside this change: Domain-specific third specialist intelligence, scenario scoring and full archive retrieval. The current repository remains a documentation-only starter; earlier phases are prerequisites, not claims of existing code. This proposal is planning only.