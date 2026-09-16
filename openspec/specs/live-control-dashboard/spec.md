# live-control-dashboard Specification

## Purpose

Defines live dashboard and steering for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## Requirements

### Requirement: Live truthful activity

The local dashboard SHALL display role-specific public activity, explicit explanations, tool arguments/results, batch progress, task dependencies, production measurements and a correlated timeline. Status SHALL distinguish reasoning, executing, dependency/game waits, user input, usage blocking, disconnection, completion and failure.

#### Scenario: Live truthful activity acceptance

- **WHEN** the model is idle while its batch runs or an interrupt is unacknowledged
- **THEN** the UI explains executing/waiting or unconfirmed control state rather than implying that the run stopped or succeeded.

### Requirement: Durable reconnect

The browser SHALL consume resumable events with a durable cursor and recover projections after reconnect; it SHALL NOT own authoritative state or the run's lifetime.

#### Scenario: Durable reconnect acceptance

- **WHEN** the operator closes and reopens the tab while a run progresses
- **THEN** the runtime continues under its limits and the UI reconstructs history without duplicate events or lost state.

### Requirement: Persisted steering and assistance

Advice SHALL be persisted before routing with exact text, recipient, wall/game clocks, delivery acknowledgement, later interpretation and links to resulting/superseded work. Advice SHALL label the run assisted; duplicate delivery SHALL NOT duplicate assignments.

#### Scenario: Persisted steering and assistance acceptance

- **WHEN** the operator advises the engineer during a submitted batch
- **THEN** receipt and interpretation are distinct, the batch is not retroactively cancelled by ordinary advice, and related later work is traceable.

### Requirement: Reconciled control actions

Pause SHALL block new work, interrupt inference, confirm safe game cancellation/disarm and pause simulation; stop SHALL cancel work without deleting progress; resume SHALL reconcile and refresh. Explicit reprioritization SHALL fence conflicting revisions. Budget stops SHALL close scoring under that budget.

#### Scenario: Reconciled control actions acceptance

- **WHEN** stop is requested while the game is disconnected or a run already exhausted its limit
- **THEN** cancellation/checkpoint remain unconfirmed until established, and a later continuation does not silently earn output beyond the original limit.

### Requirement: Local control boundary and human edits

Host control routes SHALL bind to loopback, require a local session capability and check origin. Detected human world edits SHALL record assistance and causality where known; unknown causality SHALL be labeled honestly.

#### Scenario: Local control boundary and human edits acceptance

- **WHEN** an untrusted origin sends a control request or a human edits the game during verification
- **THEN** the request is denied, and the edit invalidates affected verification evidence and appears in the intervention history.