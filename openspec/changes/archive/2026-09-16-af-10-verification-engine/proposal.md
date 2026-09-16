## Why

Output counters alone allow manual supply, old buffers and unrelated production to masquerade as an automated factory.

## What Changes

- A deterministic verification lifecycle, measurement windows, source-to-collector flow accounting and invalid-evidence handling.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 10 only after `af-09-live-control-dashboard` has passed its implementation gate; see the [implementation guide](../../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `verification-engine`: A deterministic verification lifecycle, measurement windows, source-to-collector flow accounting and invalid-evidence handling.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: packages/core/evaluation; Lua verification admission/telemetry; measurement contracts and fakes. Source basis: SCENARIOS: Evaluation rules, Required upstream evidence, Verification timing; decision 001 finding 1. Requirement coverage: R09, R13–R14, R18; original milestone: M2.

Outside this change: Scenario-specific layouts, quantitative burner energy extension and model trials. The current repository remains a documentation-only starter; earlier phases are prerequisites, not claims of existing code. This proposal is planning only.