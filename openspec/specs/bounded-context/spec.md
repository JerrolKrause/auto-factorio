# bounded-context Specification

## Purpose

Defines bounded authorized context for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## Requirements

### Requirement: Bounded three-level memory

Gameplay context SHALL consist of a task-local briefing, scoped detail and authorized archive retrieval, with configurable byte/entity limits, pagination and explicit omissions. Canonical memory SHALL derive from durable task/game evidence.

#### Scenario: Bounded three-level memory acceptance

- **WHEN** an engineer is assigned a new area after a long run
- **THEN** the briefing contains its objective, reservations, recent outcomes and unresolved steering within bounds; the full map and foreman transcript are not injected automatically.

### Requirement: Authorization across retrieval surfaces

Missing visibility SHALL deny gameplay access. Current authenticated authorization SHALL apply to direct IDs, queries, counts/snippets, pagination, payload downloads and transitive references for shared, role/task/agent-restricted and evaluator/operator-only data.

#### Scenario: Authorization across retrieval surfaces acceptance

- **WHEN** an agent guesses an evaluator artifact ID or uses a permitted event to follow a restricted payload link
- **THEN** no restricted content, search metadata or payload is disclosed.

### Requirement: Derived and replacement context restrictions

Summaries, derived artifacts and replacement-session briefings SHALL preserve source restrictions, using explicit sanitized projections when allowed facts are released. A new role assignment SHALL NOT grant hidden evaluator access.

#### Scenario: Derived and replacement context restrictions acceptance

- **WHEN** a replacement session requests a summary combining permitted outcomes and a private fault-injection receipt
- **THEN** only the authorized projection is provided and the fault cause/reference plan remains inaccessible.

### Requirement: Exact observation provenance

The archive SHALL preserve the exact observation returned to an agent separately from richer telemetry, and recipe caching SHALL use the complete game/mod fingerprint with dynamic availability queried separately.

#### Scenario: Exact observation provenance acceptance

- **WHEN** an operator investigates a bad decision after a mod fingerprint or research availability changed
- **THEN** the original bounded observation is inspectable and cached/static recipe facts cannot silently substitute for current availability.

### Requirement: Private evaluator artifacts

Reference construction, seeds, fault injection events and detailed receipts SHALL remain evaluator/operator-only even through the ordinary action gateway. Raw saves and full observer exports SHALL be excluded from gameplay retrieval while normal world symptoms remain observable.

#### Scenario: Private evaluator artifacts acceptance

- **WHEN** gameplay searches for a hidden reference layout or inspects the affected factory normally
- **THEN** archive access denies the solution, while authorized structured world observations still expose ordinary entities and symptoms.