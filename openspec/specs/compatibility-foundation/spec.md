# compatibility-foundation Specification

## Purpose

Defines compatibility foundation for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## Requirements

### Requirement: Current prerequisite evidence

The diagnostic SHALL report the selected Node, package manager, Codex, Factorio, Space Age and mod versions, the code revision and supported/unsupported checks without treating historical observations as current evidence.

#### Scenario: Current prerequisite evidence acceptance

- **WHEN** the operator runs diagnostics after upgrading prerequisites
- **THEN** the report shows newly observed versions and specific unresolved checks; it makes no provider-access or legal-gameplay claim without execution evidence.

### Requirement: Reproducible local setup

The development setup SHALL provide a pinned dependency lockfile and documented commands that actually execute on the selected Windows runtime, including a transactional database-driver smoke check.

#### Scenario: Reproducible local setup acceptance

- **WHEN** the documented setup and validation commands run in a clean project environment
- **THEN** their actual results and driver compatibility are recorded; a failure remains a failed gate rather than a successful setup.

### Requirement: Isolated data and prerequisites

The application SHALL accept an explicit local data directory, keep credentials, personal saves and proprietary game assets out of source control, and leave global Codex settings and prerequisite upgrades under user control.

#### Scenario: Isolated data and prerequisites acceptance

- **WHEN** setup encounters an incompatible runtime or an existing personal game directory
- **THEN** it reports the prerequisite or path conflict without replacing the user's installation or overwriting personal configuration.

### Requirement: Evidence-backed reuse decision

Before reusing game mechanics, development SHALL record inspected FLE and Agentic-Factorio revisions, applicable notices, selected behaviors and benchmark adaptations, or a reasoned bounded original implementation decision.

#### Scenario: Evidence-backed reuse decision acceptance

- **WHEN** the game foundation is selected
- **THEN** the decision names the inspected sources and license evidence and excludes hidden ready-made factory layouts, accelerated character behavior and upstream agent-loop authority from benchmark defaults.