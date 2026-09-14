## Why

S3 supplies power and raw materials, leaving mining, steam bootstrapping and self-fueling untested.

## What Changes

- The S4 patches/water fixture, bootstrap reserve isolation and branch-wise mined-coal/energy replenishment checks.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 15 only after `af-14-ore-smelting-fuel` has passed its implementation gate; see the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `mining-power-bootstrap`: The S4 patches/water fixture, bootstrap reserve isolation and branch-wise mined-coal/energy replenishment checks.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: scenarios/04-you-are-the-infrastructure; mining/power telemetry; fuel evaluator extensions. Source basis: SCENARIOS §04 and Quantitative fuel supply. Requirement coverage: R06–R09, R18; original milestone: M3.

Outside this change: Fault injection and late-game power systems. The current repository remains a documentation-only starter; earlier phases are prerequisites, not claims of existing code. This proposal is planning only.