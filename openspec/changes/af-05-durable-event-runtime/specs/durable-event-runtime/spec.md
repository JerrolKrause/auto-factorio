## Purpose

Defines durable event runtime for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## ADDED Requirements

### Requirement: Transactional evidence and projections

The runtime SHALL persist versioned append-only events with monotonic sequence, run/epoch, clocks, actor/task, causation/correlation and explicit visibility, together with transactional projections for runs, agents, tasks, messages, observations, commands, measurements, interventions and checkpoints.

#### Scenario: Transactional evidence and projections acceptance

- **WHEN** a crash occurs while an event and its projection are being committed
- **THEN** restart observes either the complete transaction or neither, and rebuild produces the same authoritative projection.

### Requirement: Intent before dispatch

Command intent and an outbox entry SHALL be committed before dispatch. After restart, dispatch state SHALL be reconciled against game receipts and the appropriate checkpoint epoch before retrying; unknown effects SHALL block conflicting work.

#### Scenario: Intent before dispatch acceptance

- **WHEN** the process crashes after the game performed a placement but before the outbox was acknowledged
- **THEN** recovery queries the receipt and retains a single effect rather than replaying the placement blindly.

### Requirement: Artifact integrity and visibility

Large observations, public transcripts and saves SHALL have checksums, visibility and database references. Exact agent-returned observations SHALL be retained separately from richer operator telemetry, with credentials redacted and missing evidence explicit.

#### Scenario: Artifact integrity and visibility acceptance

- **WHEN** an artifact is missing or checksum-invalid during recovery
- **THEN** the runtime reports unavailable evidence and does not fabricate content or treat the affected verification as complete.

### Requirement: Consistent local persistence

The database SHALL use a local single-writer transactional store; live backups SHALL use a consistent backup mechanism covering active write-ahead state. The checkpoint record SHALL retain the previously validated game barrier.

#### Scenario: Consistent local persistence acceptance

- **WHEN** a backup is taken while events are being appended and then opened
- **THEN** its projections and artifact manifest describe a consistent recorded point; copying the live main database alone is not accepted.

### Requirement: Model-independent recovery

Run objectives, task ownership, committed plans, pending actions and budget expenditure SHALL survive process and provider-session replacement independently of a conversation transcript.

#### Scenario: Model-independent recovery acceptance

- **WHEN** the process restarts without the previous model transcript
- **THEN** durable state identifies pending work and remaining budgets, and game reconciliation completes before work resumes.