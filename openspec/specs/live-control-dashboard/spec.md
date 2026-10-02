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

### Requirement: Dedicated destinations with shared controls

The dashboard SHALL provide persistent main navigation for Overview, Blueprint Workshop, Scenarios, Run History and Blueprint Library. Workshop setup SHALL have a dedicated page. Run detail and evidence inspection SHALL be reachable by stable links from relevant pages. Page navigation, Back/Forward and refresh SHALL preserve the selected destination and identity without starting, stopping or duplicating execution. Shared navigation, active-run status, applicable controls, forms, asynchronous feedback and evidence components SHALL provide consistent behavior across pages. Existing roster, task, batch, measurement, steering, intervention, library and learning controls SHALL remain reachable. Unsupported scenario execution SHALL be labeled unavailable without implying that deferred scenarios are implemented.

#### Scenario: Navigate during a workshop run

- **WHEN** a workshop is measuring and the operator visits Library, History and a scenario's control room, then uses Back and refresh
- **THEN** each destination displays its own content, the single active-run banner remains visible with Stop run and a live-detail link, the selected route is restored, and execution continues without a second subscription or launch.

#### Scenario: Reach existing controls and inspect a historical run

- **WHEN** the operator opens a scenario's detail or an old workshop run
- **THEN** scenario roster/tasks/batches/measurements/steering/interventions and workshop library/learning decisions remain accessible in their designated views, the old run is labeled historical, and its evidence cannot be confused with the separately identified active run.

### Requirement: Immediate accessible action feedback

Each asynchronous user action SHALL expose its pending state in the next UI render before the network result, using text plus a spinner or equivalent. It SHALL prevent duplicate submission for that action, announce success or failure accessibly and retain relevant input on failure. Known progress SHALL use observed counts; unknown progress SHALL remain indeterminate. On launch acceptance, the UI SHALL select the new run and focus/scroll its heading into view once. Subsequent events SHALL NOT steal focus or repeatedly scroll. Loading, empty, unavailable and error states SHALL be distinguishable. Controls and help SHALL work with keyboard and touch, respect reduced motion and use text rather than color alone.

#### Scenario: Slow action, rejection and retry

- **WHEN** a launch, stop, preset save, library query/export, checkpoint decision or history/evidence fetch is delayed and then fails
- **THEN** its pending indicator appears before completion, repeated activation does not duplicate it, an accessible error identifies the failed action with a relevant retry/recovery option, input is retained, and unrelated navigation remains usable.

#### Scenario: Launch from below the fold

- **WHEN** the user launches after editing advanced settings near the bottom of the workshop page
- **THEN** immediate pending feedback is visible at the initiating control and acceptance navigates to a focused new run heading; later activity updates do not move the user's reading position.

### Requirement: Durable brief scenario run and attempt hierarchy

The system SHALL retain explicit immutable identities for a brief or versioned scenario, each execution run, and each recorded attempt within that run. Repeating a selected unchanged brief SHALL create another run in its group; changing the objective beyond outer whitespace SHALL create a new linked group without rewriting prior runs. Settings changes SHALL be captured in each immutable run configuration and SHALL NOT imply comparable scores. Presets and comparison-series identities SHALL remain distinct from history grouping. History SHALL survive browser closure and ordinary application restart, use bounded pagination and provide stable drilldown from group to run to attempt to evidence. Legacy grouping, absent attempt identity and missing evidence SHALL be explicitly labeled without fabricated associations.

#### Scenario: Two briefs and five executions

- **WHEN** a retained fixture has three runs of five attempts for “make 15 red science per minute” and two runs of three attempts for “make 15 green science per minute”
- **THEN** History shows two distinct brief groups with respectively three and two runs and 15 and six correctly parented attempts, with their original settings and outcomes, before and after browser and application restart.

#### Scenario: Rerun versus changed brief

- **WHEN** the operator reruns a selected brief with another model/profile and then edits its objective
- **THEN** the rerun stays in the original group with its own pinned settings and comparison identity, the edited objective creates a linked new group, and earlier labels, evidence and settings are unchanged.

#### Scenario: Legacy or unavailable history

- **WHEN** a legacy journal lacks group/attempt metadata or a registered source journal is unavailable
- **THEN** History retains discoverable legacy or unavailable entries with explicit coverage/retrieval reasons, never silently drops them or infers their completion, and never reads paths outside registered project-owned data.

#### Scenario: Discover prior scenario dashboard history

- **WHEN** an ordinary application startup imports retained project history containing an older scenario dashboard journal with both a scenario execution and a workshop session
- **THEN** both executions are discoverable in History with their own run/evidence associations, retained scenario fixture/version identity is preserved with missing identity explicitly unknown, repeated import does not duplicate them, and discovery neither opens a game nor modifies the original journal.

### Requirement: Run-scoped live and historical evidence

Selecting or launching a run SHALL scope its outcome, attempt list, activity, usage, inspector selection and pagination to that run. A new run SHALL begin with its own empty or preparing state; clearing the current view SHALL NOT delete previous evidence. Attempts SHALL have independently expandable sections or equivalent navigation with ordinal, phase, candidate/result and timestamps. Current attempt selection SHALL be distinct from historical browsing. Run-level preparation/finalization/learning activity SHALL remain separate from attempt events. Stable event identity SHALL prevent duplication and cross-run mixing after reconnect or delayed responses.

#### Scenario: Late events from the previous run

- **WHEN** run B is selected after A and a delayed event, evidence response or history page for A arrives
- **THEN** B's visible evidence and inspector remain scoped to B, A's retained history can update under A, and no A event appears in B's attempts.

#### Scenario: Inspect an earlier attempt while another progresses

- **WHEN** attempt three runs while the user expands attempt one
- **THEN** attempt one's evidence stays selected, attempt three's progress and Stop run remain visible, and its new events neither change the selection nor enter attempt one's list.

### Requirement: Distinct execution and target outcomes

The UI SHALL distinguish execution completion, independently measured goal success, no valid result, cancellation, failure and unresolved effects. A finished attempt SHALL NOT imply a finished run; a stopped or held operation SHALL NOT imply successful cancellation or goal completion. Terminal run summaries SHALL include the result/reason, attempt counts, best eligible result when any, elapsed time and retained evidence links, with unknowns labeled. Scenarios SHALL show their authoritative pass/fail/invalid outcome independently of run-control status. Brief/scenario groups SHALL summarize active and finished runs and achieved/not-yet-achieved/unknown target state without preventing further runs. Completion observed while browsing elsewhere SHALL be announced without changing the selected page.

#### Scenario: Completed execution without a passing blueprint

- **WHEN** all workshop attempts finish but none has eligible target-passing measurements
- **THEN** the run displays Completed — No valid result with failed/invalid attempt reasons and no success badge or best-valid blueprint.

#### Scenario: Passing candidate with work remaining

- **WHEN** one attempt passes while later attempts, finalization or learning remain
- **THEN** that attempt displays Passed, the run remains visibly active in its actual phase, and Stop run remains available until the run settles.

#### Scenario: Cancelled run and completed scenario

- **WHEN** a run is cancelled after an earlier passing attempt, or a controlled scenario finishes independent verification
- **THEN** the former displays Cancelled with the earlier result explicitly retained as partial evidence, and the latter displays its terminal run status and authoritative scenario verdict without deriving success from an idle agent or paused game.
