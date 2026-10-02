# Workshop spec delta

## ADDED Requirements

### Requirement: Understandable setup and saved local draft

Workshop setup SHALL explain every selectable option through descriptive labels, units and relevant subtext or accessible help. Equipment-profile details SHALL identify actual permitted equipment/research from installed data. Instant sandbox placement and Build with a character SHALL explain their construction/supply rules. Basic settings SHALL be immediately available and advanced evaluation, model, budget, checkpoint and learning settings SHALL remain discoverable. Internal IDs SHALL remain compatible and appear in technical details rather than serving as the only labels.

The UI SHALL save the allowlisted workshop draft in versioned, workspace-scoped localStorage and restore it before applying defaults. It SHALL preserve objective, source/brief selection, profile, build mode, library access, attempt policy, model/effort selections and overrides, evaluation, budgets, checkpoints and learning settings. Restored/preset selections SHALL be validated against current options without silent substitutions. Options refresh SHALL NOT overwrite edits. Reset settings SHALL reset only the draft. Storage failure SHALL be nonfatal and visible; credentials, full evidence and authoritative execution status SHALL NOT be stored as preferences. Cross-tab edits SHALL NOT silently replace a dirty draft.

#### Scenario: Understand setup without internal vocabulary

- **WHEN** a user selects Basic assembling equipment, Instant sandbox placement or Build with a character
- **THEN** adjacent help explains the choice, allowed-equipment details reflect installed facts, normal timing/reach and supplied materials are clear, and no knowledge of `starter-assembly` or “direct workshop” is required.

#### Scenario: Restore all chosen settings

- **WHEN** the user changes basic and advanced settings, navigates away, reloads and restarts the app at its fixed local origin
- **THEN** the same valid draft is restored without automatic launch, options refresh preserves it, and Reset settings restores defaults without modifying history or an active run.

#### Scenario: Invalid saved model or unavailable storage

- **WHEN** a saved model/effort/profile is unavailable, a draft version is malformed, or localStorage is blocked/full
- **THEN** unavailable selections remain visibly invalid and prevent launch without fallback, malformed data is handled with a reset/recovery notice, storage failure allows in-memory editing with a notice, and the server revalidates every submitted configuration.

#### Scenario: Preset improve and concurrent editing

- **WHEN** the operator explicitly loads a preset or selects Improve on a library revision while another tab has saved different settings
- **THEN** the explicit action updates the draft with visible confirmation and exact source identity, no launch occurs until requested, and another tab's saved values cannot silently overwrite subsequent unsaved edits.

### Requirement: Exclusive idempotent run admission

Only one experiment SHALL own the managed game at a time. Ownership SHALL include preparing, running, paused, checkpoint, stopping, unresolved-effect, finalization and learning phases. The runtime SHALL enforce admission before asynchronous preparation or effects for workshop and ordinary experiment launch/resume entrypoints. Idle dashboard infrastructure SHALL NOT count as an active experiment. Conflicting launch actions SHALL be disabled with the owning run and reason visible; direct or racing requests SHALL return a conflict identifying that run without queuing, replacing it or starting extra inference/game work. A repeated launch request with the same identity and unchanged payload SHALL resolve to the same run, and changed payload under that identity SHALL be rejected. Browser and runtime replacement SHALL preserve admission identity and unresolved ownership until reconciliation.

#### Scenario: Two tabs launch at once

- **WHEN** two tabs or API callers submit different workshop launches while the managed game is free
- **THEN** exactly one durable run owns preparation, the other receives an ownership conflict and link, and only the accepted run can invoke models or mutate the game.

#### Scenario: Ordinary run or paused checkpoint owns the game

- **WHEN** a scenario is active/paused or a workshop awaits a checkpoint and another launch/resume is requested
- **THEN** the request is blocked with the owning experiment identified, and resuming through another entrypoint cannot bypass the same admission rule.

#### Scenario: Lost launch response and restart

- **WHEN** admission succeeds but the response is lost and the browser or runtime restarts
- **THEN** reconciliation of the original request identity finds the same preparing/active/terminal run without a second execution, and unknown effects retain ownership until their exact outcomes are established.

### Requirement: Stop throughout the entire run

Stop run SHALL be available from every page through the active-run control and from the current attempt, beginning with launch submission and continuing through preparation, inference, build, measurement, checkpoints, finalization and learning. It SHALL explicitly end the whole run and remaining attempts, preserving prior evidence. Stop intent SHALL durably close further work admission before waiting for cancellation. Late results, timers and retries SHALL NOT start another phase/attempt or publish/activate new effects after that closure. Already committed effects SHALL remain recorded. Repeated stop requests SHALL be idempotent; terminal runs SHALL remain terminal on a late stop.

The UI SHALL show Stopping immediately, then Cancelled only when active effects are acknowledged terminal or proven absent. Unconfirmed effects SHALL display Recovery required with subsystem/reason and a status/retry path, while retaining the game ownership fence. After ten seconds without confirmation the UI SHALL explain the unresolved state without implying the safety barrier has timed out. Stop before launch admission SHALL prevent that same request from later starting. Cancellation SHALL NOT erase progress, reset budgets, award incomplete measurements or stop unrelated/personal Factorio processes.

#### Scenario: Cancel before an attempt exists

- **WHEN** Stop run arrives before launch admission or during slow preparation
- **THEN** the cancellation is retained for that request, a later launch/preflight callback cannot begin inference or game mutation, and the run is shown as Cancelled after absence/terminal effects are established.

#### Scenario: Stop at each active phase

- **WHEN** Stop run is requested independently during designing, character construction, direct placement, measurement, score review, a checkpoint, finalization or learning
- **THEN** admission closes before awaiting interruption, current effects reconcile, no remaining attempt or new publication/activation begins, prior results remain visible, and all controls agree on the same run state.

#### Scenario: Unacknowledged stop across replacement

- **WHEN** game/provider cancellation or publication outcome is unknown and the runtime restarts
- **THEN** the run remains Recovery required with new launches blocked, the exact pending identities are reconciled without replay, and confirmed settlement permits cancellation/release without duplicating effects.

#### Scenario: Late stop and late effect completion

- **WHEN** a stop races with an awaited effect or reaches an already completed/cancelled/failed run
- **THEN** a late effect result is retained as evidence without authorizing new work, an already committed effect is disclosed, and a terminal run does not regress to stopping/held merely because of the late request.

### Requirement: Structured critique delivered to the next attempt

The production scorer SHALL provide a versioned critique containing a concise summary and evidence-linked findings identifying the candidate, observed shortfall, impact, suspected cause with uncertainty, concrete recommended change and next validation. Failed/invalid evidence SHALL yield at least one supported finding or an explicit evidence-gap finding. A passing candidate with no supported improvement SHALL permit an empty findings list. The exact retained critique and relevant prior candidate/measurement references SHALL be available to the next designer within bounded, visibility-authorized context. The designer SHALL return an explicit public change plan linked to the findings alongside its candidate. These explanations SHALL NOT alter independent measurement, rubric, eligibility or hidden-library boundaries. Missing/malformed feedback SHALL be labeled with its validation outcome; any correction attempt SHALL remain within pinned budgets and SHALL NOT be replaced by fabricated useful feedback.

#### Scenario: Correct a measured shortfall

- **WHEN** an attempt misses the target and available evidence supports a connection/power defect
- **THEN** critique links the measured shortfall and affected candidate, labels diagnosis certainty, recommends a concrete correction and validation, and the next designer receives that critique and records which correction it proposes.

#### Scenario: Short output is the actual output

- **WHEN** the scorer supplies only an unsupported generic sentence or malformed critique
- **THEN** the system preserves the actual public output, identifies the schema/evidence gap, uses only budgeted correction if allowed, and never presents an invented expanded instruction or generic fallback as complete actionable critique.

## MODIFIED Requirements

### Requirement: Reviewable activity and agent context

The UI SHALL expose phase/iteration status, public agent activity, score feedback, candidate comparisons, assistance, library decisions and learning decisions/diffs/validation. It SHALL support final-result-focused presentation while preserving live inspection and durable intermediate evidence. An operator context inspector SHALL expose available supplied instructions, tool catalogs, retrieved context, messages and tool calls/results with session/version lineage, bounded pagination and explicit redaction/truncation/retention gaps. Hidden reasoning SHALL NOT be promised and operator visibility SHALL NOT broaden gameplay visibility. Closing the browser SHALL NOT own or interrupt session execution.

Every activity/feedback summary SHALL be labeled as a summary or actual recorded message and link directly to its retained full record where available. For new invocations, the system SHALL record supplied application instructions including runtime-added prompt text, observations, authorized retrieved context, role/model/effort and instruction versions, public responses and available tool inputs/results, with run/attempt/invocation lineage. Capture SHALL redact credentials before persistence and distinguish content never exposed by a provider from missing local retention. An inspector SHALL state completeness for each part and paginate long bodies without presenting the first page as the whole instruction. Private comparison/operator-only content SHALL remain unavailable to gameplay retrieval even when the operator can inspect it.

#### Scenario: Return after unattended completion

- **WHEN** a person closes the browser during an unattended session and returns afterward
- **THEN** the final result and all retained scored iterations/learning outcomes are inspectable, including exact activated diffs and supplied context records, without duplicate events or fabricated missing history.

#### Scenario: Expand a live or final summary

- **WHEN** the user opens a designer/scorer activity card during execution or from a completed attempt
- **THEN** the inspector retrieves the exact retained supplied instructions/context and public response for that invocation, includes runtime prompt additions and delivered observation evidence, labels summaries separately and exposes pagination, redactions and gaps without requiring a pasted artifact ID.

#### Scenario: Large redacted legacy or private evidence

- **WHEN** a record spans several pages, contains credentials, lacks legacy capture or includes private comparison context
- **THEN** the operator sees bounded pages and explicit per-part completeness/redaction labels, credentials are absent from retained readable content, missing text is not invented, and designer/scorer retrieval cannot gain private content through inspector endpoints or references.
