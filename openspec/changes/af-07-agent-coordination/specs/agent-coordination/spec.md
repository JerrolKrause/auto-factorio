## Purpose

Defines agent coordination for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## ADDED Requirements

### Requirement: Extensible identities and roles

The runtime SHALL register stable agent instances with role definition, tool/observation scope, instructions, model/limits and provider-session lineage. Foreman and engineer SHALL have separate histories; the foreman SHALL NOT require a character.

#### Scenario: Extensible identities and roles acceptance

- **WHEN** a third synthetic specialist is registered using the existing contracts
- **THEN** it receives an independent assignment/history and uses existing communication and ownership mechanisms without rewriting the initial roles.

### Requirement: Deterministic task graph

The scheduler SHALL validate dependencies and reject cycles, enforce ownership/revisions and represent proposed, ready, assigned, running, verifying, succeeded, blocked, failed, cancelled and superseded tasks. Completion SHALL require the task's criterion and linked evidence rather than a prose claim.

#### Scenario: Deterministic task graph acceptance

- **WHEN** an agent reports success with no qualifying evidence or introduces a dependency cycle
- **THEN** the task does not become succeeded and the invalid dependency is rejected with an actionable result.

### Requirement: Scoped durable messaging

The runtime SHALL authenticate message senders, route recipient/task-scoped messages durably and deduplicate delivery so assistance requests and handoffs cannot duplicate assignments.

#### Scenario: Scoped durable messaging acceptance

- **WHEN** the foreman's assignment or the engineer's completion message is delivered twice around restart
- **THEN** the receiver can inspect delivery state and the task changes only once under current ownership.

### Requirement: Autonomous deterministic scheduling

Routine monitoring, arithmetic, queue progress, waiting and recovery dispatch SHALL run deterministically without model polling; models SHALL perform planning, design and unfamiliar diagnosis within admitted budgets.

#### Scenario: Autonomous deterministic scheduling acceptance

- **WHEN** a build executes while the engineer waits for a dependency
- **THEN** the UI-facing state explains the wait and steps progress without a model turn per placement or measurement.

### Requirement: Solo and shared-budget team modes

The same run contracts SHALL support solo or foreman/engineer rosters with agent count independent of actor count, default maximum two concurrent turns and persisted roster-wide budgets. Phase 02 exhaustion SHALL integrate with phase 06 acknowledged game cancellation.

#### Scenario: Solo and shared-budget team modes acceptance

- **WHEN** both team sessions are active at budget exhaustion and replacement sessions later start
- **THEN** admission closes, affected work is fenced/reconciled, and spent budgets are not reset or represented as equal inference expenditure merely because turn counts match.