## Why

S1 supplies gears, so it does not yet test automated gear manufacture or upstream/downstream interfaces.

## What Changes

- The S2 plate-feed fixture, gear-chain measurements, legal reference and stage-bypass controls.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 13 only after `af-12-first-shift-agent-trials` has passed its implementation gate; see the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `plate-to-science`: The S2 plate-feed fixture, gear-chain measurements, legal reference and stage-bypass controls.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: scenarios/02-some-assembly-required; stage measurement configuration; scenario selector. Source basis: SCENARIOS §02 and Required upstream evidence. Requirement coverage: R07–R09, R18; original milestone: M3.

Outside this change: Smelting, mining and additional model-backed trials. The current repository remains a documentation-only starter; earlier phases are prerequisites, not claims of existing code. This proposal is planning only.