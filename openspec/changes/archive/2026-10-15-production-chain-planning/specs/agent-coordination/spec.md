# Production-plan coordination delta

## ADDED Requirements

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
