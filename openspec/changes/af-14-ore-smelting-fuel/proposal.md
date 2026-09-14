## Why

Ore-to-science requires measured smelting and enough automatic furnace fuel delivery, even when reserves hide a deficit.

## What Changes

- The S3 fixture, furnace action coverage, stage balances and quantitative terminal-to-furnace fuel evaluator.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 14 only after `af-13-plate-to-science` has passed its implementation gate; see the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `ore-smelting-fuel`: The S3 fixture, furnace action coverage, stage balances and quantitative terminal-to-furnace fuel evaluator.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: scenarios/03-hot-metal; Lua burner telemetry; fuel evaluator and controls. Source basis: SCENARIOS §03, Required upstream evidence, Quantitative fuel supply; decision 001 finding 4. Requirement coverage: R06–R09, R18; original milestone: M3.

Outside this change: Mining, steam power and S4 bootstrapping. The current repository remains a documentation-only starter; earlier phases are prerequisites, not claims of existing code. This proposal is planning only.