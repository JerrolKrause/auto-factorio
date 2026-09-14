## Why

A visible fault is insufficient if an unrepaired factory can still pass using capacity or starting buffers.

## What Changes

- S5 deterministic hidden fault variants, deadline semantics, every-start do-nothing controls and legal restoration references.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 16 only after `af-15-mining-power-bootstrap` has passed its implementation gate; see the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `fault-recovery`: S5 deterministic hidden fault variants, deadline semantics, every-start do-nothing controls and legal restoration references.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: scenarios/05-unscheduled-downtime; fault harness; recovery timing/metrics; evaluator-only records. Source basis: SCENARIOS §05, Evaluation rules, Verification timing; decision 001 finding 2. Requirement coverage: R07–R09, R15, R18; original milestone: M3.

Outside this change: Requiring a specific repair layout or exposing fault answers to gameplay. The current repository remains a documentation-only starter; earlier phases are prerequisites, not claims of existing code. This proposal is planning only.