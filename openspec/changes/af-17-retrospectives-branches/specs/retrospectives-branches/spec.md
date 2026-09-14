## Purpose

Defines retrospectives and checkpoint branches for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## ADDED Requirements

### Requirement: Comparable trial metadata

Run comparison SHALL expose scenario fingerprint, assistance, toolkit, model/effort/instruction versions, roster/concurrency, aggregate/per-turn caps, tool attempts, available tokens and both clocks. It SHALL distinguish equal aggregate-budget comparisons from equal elapsed-time comparisons and SHALL NOT equate turn counts with inference expenditure.

#### Scenario: Comparable trial metadata acceptance

- **WHEN** solo and team trials differ in concurrency or token telemetry is absent
- **THEN** the comparison displays the difference and unknowns rather than a misleading equal-cost ranking.

### Requirement: Intervention and evidence review

The operator SHALL navigate from exact advice to acknowledgement, interpretation, related observations, actions/outcomes and superseded work, distinguishing recorded causation from retrospective inference.

#### Scenario: Intervention and evidence review acceptance

- **WHEN** a reviewer inspects an assisted success
- **THEN** the report shows the hint and relevant evidence without claiming an unobserved causal link or unassisted performance.

### Requirement: Controlled checkpoint branches

Branch creation SHALL preserve a parent checkpoint reference and original history, restore through the proven pre-execution barrier and reconcile a new run epoch before arming authorized work.

#### Scenario: Controlled checkpoint branches acceptance

- **WHEN** two experiments branch from one disarmed checkpoint
- **THEN** their histories, budgets and outcomes remain distinct and stale parent traffic cannot affect either branch.

### Requirement: Portable observer export

The operator SHALL export consistent metadata and recorded evidence in portable NDJSON/CSV plus checksummed artifact references with credentials redacted; full exports and raw saves SHALL remain outside gameplay retrieval.

#### Scenario: Portable observer export acceptance

- **WHEN** an export is made during activity and later inspected independently
- **THEN** its snapshot/cursor and completeness are explicit, linked evidence is resolvable or labeled missing and it does not expose credentials.

### Requirement: Replay and lesson provenance

Historical UI replay, deterministic reference replay and fresh stochastic model trials SHALL be labeled distinctly. Suggested lessons SHALL retain source evidence, assistance status and instruction version and SHALL require fresh unassisted/held-out validation before deliberate promotion.

#### Scenario: Replay and lesson provenance acceptance

- **WHEN** a lesson from one assisted success is proposed
- **THEN** it remains a candidate and does not automatically enter gameplay instructions or imply fine-tuned model weights.