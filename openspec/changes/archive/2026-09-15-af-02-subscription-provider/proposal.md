## Why

Subscription access, effective gameplay tool isolation and visible activity are untested; the project cannot safely assume provider capability.

## What Changes

- A supported ChatGPT-only provider adapter, two scoped synthetic sessions, public activity and deterministic execution budgets.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 02 only after `af-01-compatibility-foundation` has passed its implementation gate; see the [implementation guide](../../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `subscription-provider`: A supported ChatGPT-only provider adapter, two scoped synthetic sessions, public activity and deterministic execution budgets.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: packages/codex; packages/tools; minimal diagnostic console; provider fakes. Source basis: ARCHITECTURE §§3–4, 9, 12; REQUIREMENTS: Operating defaults. Requirement coverage: R02, R10, R17; original milestone: M0.

Outside this change: Game connection, durable task scheduling and production dashboard. The current repository remains a documentation-only starter; earlier phases are prerequisites, not claims of existing code. This proposal is planning only.