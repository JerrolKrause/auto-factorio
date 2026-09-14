## Purpose

Defines fault recovery scenario for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## ADDED Requirements

### Requirement: Hidden controlled fault fixtures

S5 SHALL use an ordinary-gateway reference-built and validated S4-chain factory, finite repair spares and a briefing that one disruption occurs. A private deterministic seed SHALL select an accessible broken ingredient belt, wrongly rotated ordinary inserter or removed branch-power pole at a fixed recorded game tick.

#### Scenario: Hidden controlled fault fixtures acceptance

- **WHEN** the fault is injected
- **THEN** the observer retains baseline and fault records, while gameplay receives ordinary symptoms and cannot retrieve the seed, reference plan or fault explanation.

### Requirement: Admission-based recovery deadline

A successful S5 verification attempt SHALL be admitted within 36000 game ticks of fault injection. Its fixed settling plus 18000 scored ticks can finish afterward, bounded by the admitted start and independent wall limit. New attempts after the deadline SHALL be rejected; failed/invalid attempts SHALL NOT establish recovery.

#### Scenario: Admission-based recovery deadline acceptance

- **WHEN** an attempt is admitted at the deadline and finishes successfully after it, or a new attempt starts one tick later
- **THEN** the admitted attempt can establish recovery if all S4 output/stage/fuel rules pass, and the later new attempt is rejected.

### Requirement: Every-start do-nothing rejection

Every fault variant SHALL fail without repair for every eligible verification admission tick from injection through the ten-minute deadline, using the same settling, output, upstream and fuel rules and exact starting buffers as agent runs. Tick-level evidence SHALL extend through the latest allowed finish.

#### Scenario: Every-start do-nothing rejection acceptance

- **WHEN** an unrepaired variant can pass at any early or late eligible start using buffered capacity
- **THEN** the fixture is not accepted; its branch/capacity/buffers are revised and both negative and legal-restoration controls are rerun.

### Requirement: Legal alternative restoration

Each frozen fault fixture SHALL have a passing repair or alternative legal restoration through the ordinary action gateway from the same starting save used by its do-nothing control. Scoring SHALL test recovered service rather than a required entity replacement.

#### Scenario: Legal alternative restoration acceptance

- **WHEN** an agent reroutes production instead of restoring the exact removed belt
- **THEN** the repair is accepted if within the admission deadline and the complete S4 chain/fuel/output requirements pass.

### Requirement: Recovery metrics and privacy

S5 SHALL record baseline, detection latency, repair latency, admission-based recovery time, first measured-output tick, final verification time, lost output and unnecessary modifications alongside common run evidence. Fault-related artifacts SHALL obey evaluator-only archive visibility.

#### Scenario: Recovery metrics and privacy acceptance

- **WHEN** the operator reviews a failed or successful recovery and a gameplay session requests its hidden cause records
- **THEN** the observer can inspect the causal report while gameplay retrieval remains restricted.