# agent-coordination Specification

## Purpose

Defines agent coordination for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## Requirements

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

### Requirement: Authorized idempotent production-plan commitment

An authorized planning role SHALL be able to commit selected stages of a complete executable production-plan revision into existing durable tasks and assignments. Commitment SHALL preserve plan/stage/task identities and validate current facts/profile, scope, ownership, task revisions and execution support before admission. Identical retries SHALL return the same durable mapping; changed payload under an existing request identity SHALL conflict. Partial persistence or lost acknowledgement SHALL NOT duplicate tasks or effects. Engineers SHALL retain their existing assignment/execution authority, and bodyless foremen SHALL NOT gain character authority. Commitment SHALL NOT change allowed inputs, supplies, research or evaluator rules.

#### Scenario: S3-01 Commit retry and role boundaries

- **WHEN** a foreman commits a valid plan, loses the response and retries, while an engineer attempts an unauthorized commitment
- **THEN** the foreman obtains the original stage/task mapping exactly once and the engineer is rejected without mutation; no new character privileges are granted.

#### Scenario: S3-02 Reject stale or incomplete commitment

- **WHEN** a plan is incomplete/infeasible, its fingerprint or availability changed, or a referenced task revision/ownership is stale
- **THEN** commitment reports the conflicting facts and admits no new executable work until revalidation and existing ownership rules permit it.

### Requirement: Separate construction dependencies from continuous supply

Production-flow relationships SHALL be recorded separately from task execution dependencies. The scheduler SHALL permit independently buildable stages to be constructed without waiting for upstream output unless a real construction/resource dependency was declared. Stage construction completion, commissioned operation, current measured health and independent scenario verdict SHALL remain distinct. A completed command or delivered message SHALL NOT establish sustained production. Later supply loss SHALL update operational status without rewriting historical construction evidence or waking models for unchanged polling samples.

#### Scenario: S3-03 Build downstream before upstream operates

- **WHEN** a downstream assembler can legally be constructed with supplied equipment while its upstream supplier is still being built
- **THEN** construction can proceed under valid reservations, commissioning remains input-dependent, and upstream task completion alone cannot mark the downstream production target achieved.

#### Scenario: S4-01 Upstream supply fails after construction

- **WHEN** a previously operating upstream stage stops supplying material for the configured watch duration
- **THEN** downstream health exposes the measured deficit or unknown evidence, preserves completed construction, and emits a bounded meaningful transition rather than treating the supplier's completed task as ongoing supply proof.

### Requirement: Recoverable production-plan revision

Plan changes SHALL create new immutable revisions and reconcile affected tasks and batches through existing acknowledged cancellation and ownership fences. Unchanged construction/evidence SHALL be retained only when its dependencies still match. Pending or unknown effects SHALL be resolved before conflicting reassignment or resubmission. Replacement and save/load SHALL reconstruct the committed plan, task ownership, pending receipts, fresh world and existing budget before mutation; Stop SHALL close new plan-derived work as it closes existing work.

#### Scenario: S3-04 Revise around a lost build acknowledgement

- **WHEN** a plan changes after a placement may have succeeded but its acknowledgement is missing, including across restart or Stop
- **THEN** conflicting new work remains fenced, the original command outcome is reconciled, and the new plan neither repeats the placement nor resets spent budgets or historical evidence.
