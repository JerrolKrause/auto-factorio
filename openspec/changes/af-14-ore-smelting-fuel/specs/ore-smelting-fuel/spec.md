## Purpose

Defines ore smelting and fuel scenario for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## ADDED Requirements

### Requirement: S3 ore fixture

S3 SHALL provide cleared terrain, finite common equipment plus furnaces, iron/copper ore and coal terminals, protected power and a collector under shared normal-character and safe-reset policies.

#### Scenario: S3 ore fixture acceptance

- **WHEN** the scenario starts from its validated disarmed save
- **THEN** building requires no manual resource gathering and the manifest records actual inputs, grants, rates and kit.

### Requirement: Fresh smelting-chain proof

S3 SHALL require the shared science windows plus intake of 300 iron ore and 150 copper ore, machine smelting/net routing of 300 iron plates and 150 copper plates, and machine production/routing of 150 gears over the scored period at documented recipes, recalculated from installed data.

#### Scenario: Fresh smelting-chain proof acceptance

- **WHEN** science draws old plates while the required furnaces are absent, unused or disconnected
- **THEN** verification fails the stage/route balances despite sufficient collector output.

### Requirement: Quantitative furnace fuel

S3 SHALL measure coal admission from its terminal and automated delivery to actual working furnace branches, with each required branch replenished sufficiently to cover measured fuel energy consumption within fixed reference-tested tolerances. Coal in all route inventories and remaining burning energy SHALL be included in balances.

#### Scenario: Quantitative furnace fuel acceptance

- **WHEN** large preloaded reserves keep science output above target but automatic fuel delivery is absent or deficient
- **THEN** the fuel test fails even if a trickle of fresh coal arrives or enough coal accumulates in an unrelated chest.

### Requirement: Coverage and legal fuel buffering

Fuel balances SHALL permit documented short-period buffering without allowing sustained depletion of starting reserves; absent source/route/consumer or energy coverage SHALL invalidate verification.

#### Scenario: Coverage and legal fuel buffering acceptance

- **WHEN** a normal positive reference crosses an item-burning boundary or required burner telemetry is missing
- **THEN** declared tested phase tolerances handle the valid reference, while insufficient coverage returns invalid rather than success.

### Requirement: Live S3 control matrix

S3 SHALL pass a legal reference and reject preloaded ingredients, character supply, unrelated production, skipped smelting, no fuel automation and reserve-backed deficient furnace delivery controls.

#### Scenario: Live S3 control matrix acceptance

- **WHEN** the frozen S3 evaluator executes every positive and negative case in the installed game
- **THEN** the report preserves stage/fuel/output evidence and does not infer adequate delivery from theoretical machine capacity.