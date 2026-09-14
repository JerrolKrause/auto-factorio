## Purpose

Defines mining and power bootstrap scenario for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## ADDED Requirements

### Requirement: S4 bootstrap fixture

S4 SHALL provide accessible iron/copper/coal patches and water, cleared routes, finite expanded equipment and a labeled bootstrap coal reserve, with no supplied generated power or material feeds. Normal game movement and timed construction SHALL apply.

#### Scenario: S4 bootstrap fixture acceptance

- **WHEN** the legal S4 reference bootstraps from the fixture
- **THEN** it establishes steam power and mining without hand-mining, chopping or fabricating extra construction equipment.

### Requirement: Fresh extraction and full chain

S4 SHALL require the shared science windows, machine extraction/net routing of at least 300 iron ore and 150 copper ore from designated patches, the S3 smelting/gear chain and quantitative mined-coal replenishment over the scored period, recalculated from installed recipes.

#### Scenario: Fresh extraction and full chain acceptance

- **WHEN** a science cell draws stock while mining feeds an unused chest or a required smelting/mining stage is bypassed
- **THEN** the evaluator rejects the disconnected or skipped chain.

### Requirement: Bootstrap reserve isolation

Before settling, access to the labeled external bootstrap reserve SHALL be disconnected and kept inaccessible through verification. Coal already inside the factory SHALL remain recorded in starting inventories rather than assumed removed.

#### Scenario: Bootstrap reserve isolation acceptance

- **WHEN** verification is requested while the reserve can still supply the factory
- **THEN** admission fails until isolation is established; internal preloaded coal cannot substitute for fresh replenishment.

### Requirement: Power and smelting fuel balance

S4 SHALL measure fresh coal extraction, automatic source/route delivery and replenishment of each actual power and smelting consumer branch against measured consumption. Balances SHALL include coal in inventories/belts/hands/burners, remaining burning energy and stored steam/thermal energy that can mask demand.

#### Scenario: Power and smelting fuel balance acceptance

- **WHEN** coal mining is ample but a burner branch is undersupplied while stored fuel or steam sustains output
- **THEN** verification fails the deficient branch; excess supply to another branch cannot offset it.

### Requirement: Live mining-power controls

S4 SHALL have a legal passing reference plus failing stockpile-only, missing mining/smelting, unrelated upstream, character-supply, absent fuel route, fresh-coal trickle and adequate-mining/deficient-delivery controls, including reserves sufficient to conceal defects from science counters.

#### Scenario: Live mining-power controls acceptance

- **WHEN** the complete control matrix executes with fixed tolerances
- **THEN** valid buffered automation passes, every reserve-backed supply deficit fails and missing measurement coverage is invalid.