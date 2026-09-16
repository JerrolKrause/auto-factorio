# fenced-ownership Specification

## Purpose

Defines acknowledged ownership fences for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## Requirements

### Requirement: Atomic multi-resource reservations

Work SHALL acquire the required construction-area, item-allocation and character reservation set atomically in a consistent order; physical actors SHALL NOT be a global singleton tied to the agent roster.

#### Scenario: Atomic multi-resource reservations acceptance

- **WHEN** two assignments request overlapping sets in opposite input order
- **THEN** at most one conflicting grant becomes active and no partial grant or deadlock admits conflicting effects.

### Requirement: Acknowledged revocation before reassignment

Revocation SHALL persist intent and close admission, advance affected game-side generations, stop active execution at a bounded safe boundary, cancel queued steps and return final receipts plus effective tick. Replacement ownership SHALL activate only after acknowledgement and reconciliation.

#### Scenario: Acknowledged revocation before reassignment acceptance

- **WHEN** a lease expires while the game is disconnected or revocation acknowledgement is delayed
- **THEN** the reservation remains unavailable and replacement work cannot start despite the Node timeout.

### Requirement: Fences at every side effect

Batches SHALL carry run epoch, control session, task/revision and all affected reservation generations. The game SHALL validate these at admission and before every side effect, including continuing movement, mining and crafting.

#### Scenario: Fences at every side effect acceptance

- **WHEN** an old task revision or area generation reaches a per-tick continuation after revocation
- **THEN** that continuation cannot produce an effect, even if its character generation is otherwise current.

### Requirement: Monotonic idempotent controls

Revocation retries SHALL reuse the request ID and grant/arm controls SHALL NOT lower installed generations. Acknowledgement SHALL mean no future effects from the revoked scope, not merely removal from an ingress queue.

#### Scenario: Monotonic idempotent controls acceptance

- **WHEN** duplicate revoke, delayed old grant and stale arm requests arrive around reassignment
- **THEN** receipts remain consistent, generations do not regress and obsolete work remains unable to execute.

### Requirement: Restore and cancellation integration

Durable ownership reconciliation SHALL preserve the phase 04 pre-execution barrier across rollback, and late results from the same agent SHALL NOT revive superseded plans.

#### Scenario: Restore and cancellation integration acceptance

- **WHEN** a checkpoint contains queued work for a task subsequently cancelled or reprioritized
- **THEN** controlled restore installs current authorization before re-arm and neither saved queues nor late provider output execute the obsolete task.