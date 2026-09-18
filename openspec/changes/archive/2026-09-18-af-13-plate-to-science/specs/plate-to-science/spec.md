## Purpose

Defines plate-to-science scenario for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## ADDED Requirements

### Requirement: S2 fixture and launch

S2 SHALL provide a cleared plate-feed site, protected power, finite common kit, collector, versioned briefing and disarmed reset using the shared normal-character rules. Gameplay SHALL build gear manufacture and science logistics itself.

#### Scenario: S2 fixture and launch acceptance

- **WHEN** S2 is selected in solo or team mode
- **THEN** the same fingerprinted fixture starts with plate terminals and no supplied gear-production solution.

### Requirement: Fresh gear-chain proof

S2 SHALL apply the five-window science rule and require automatic intake of 300 iron plates and 150 copper plates plus machine production and net routing of 150 gears into science over the scored period at documented recipes, recalculated from installed data.

#### Scenario: Fresh gear-chain proof acceptance

- **WHEN** science consumes pre-stocked or hand-crafted gears while an unused gear cell produces matching totals
- **THEN** the stage/delivery balance rejects the bypass despite adequate final science output.

### Requirement: Legal reference and controls

S2 SHALL have a passing ordinary-gateway reference and failing preloaded-buffer, character-supply, disconnected-upstream and skipped-gear-automation controls with legal buffering retained.

#### Scenario: Legal reference and controls acceptance

- **WHEN** the control matrix runs from the validated S2 fixture
- **THEN** the positive reference passes and every applicable bypass is rejected with actual game evidence.

### Requirement: Measured versioned scenario

S2 SHALL record equipment/rates, stage coverage, output windows, balances, costs, order failures, wall/game timing and common run/provider/intervention metadata; fixture adjustments SHALL produce a new scenario version.

#### Scenario: Measured versioned scenario acceptance

- **WHEN** reference validation needs extra equipment or a different measurement tolerance
- **THEN** the change is recorded and controls rerun before the revised version becomes ready to launch.