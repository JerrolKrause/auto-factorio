## Why

There is no verified route from structured commands to legal effects in the installed Space Age game.

## What Changes

- A visible dedicated sandbox, bounded observations, deterministic calculations, character actions and reconciled asynchronous batches.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 03 only after `af-02-subscription-provider` has passed its implementation gate; see the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `character-execution`: A visible dedicated sandbox, bounded observations, deterministic calculations, character actions and reconciled asynchronous batches.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: packages/contracts; packages/factorio; packages/tools; mods/autofactorio; action integration tests. Source basis: ARCHITECTURE §§5–6, 10, 12. Requirement coverage: R01, R04–R08, R10–R11; original milestone: M0.

Outside this change: Scenario fixtures, durable ownership and general late-game mechanics. The current repository remains a documentation-only starter; earlier phases are prerequisites, not claims of existing code. This proposal is planning only.