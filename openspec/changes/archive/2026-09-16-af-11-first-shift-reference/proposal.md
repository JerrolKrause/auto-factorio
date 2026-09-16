## Why

The evaluator needs a real controlled scenario with legal positive execution and failing bypass controls before an agent trial is meaningful.

## What Changes

- The S1 fixture, briefing, cached disarmed reset, ordinary-gateway reference and engine-validated scoring controls.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 11 only after `af-10-verification-engine` has passed its implementation gate; see the [implementation guide](../../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `first-shift-reference`: The S1 fixture, briefing, cached disarmed reset, ordinary-gateway reference and engine-validated scoring controls.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: scenarios/01-first-shift; Lua fixture/measurement adapters; operator-only reference tests. Source basis: SCENARIOS: Shared world, Deliverable structure, Common kit, §01 and Evaluation rules. Requirement coverage: R05–R09, R18; original milestone: M2.

Outside this change: Model performance claims and plate/ore/mining scenarios. Phases 01–10 are implemented and verified; phase 11 consumes their gateway, ownership, restore, context and evaluator contracts. Implementation readiness still requires the live exit gate below the planning artifacts.
