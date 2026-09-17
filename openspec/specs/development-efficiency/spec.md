# Development Efficiency Specification

## Purpose

Reduce developer-session inference expenditure through measurable usage, bounded deterministic tooling and explicit model responsibilities while preserving AutoFactorio's verification, privacy and gameplay contracts.

## Requirements

### Requirement: Attributed usage with explicit uncertainty

The development tooling SHALL report usage for a selected root session, proven descendants and explicitly mapped gameplay sessions over a specified time interval. It SHALL deduplicate responses, account for identifiable compaction, reconcile cumulative telemetry without double counting, and keep cached input and reasoning subsets correctly represented. Missing, malformed, conflicting or incomplete data SHALL be visible as coverage gaps. Unknown model costs SHALL remain unknown; optional estimates SHALL identify their rates, date and source and SHALL NOT be presented as exact subscription expenditure.

#### Scenario: Duplicate events and compaction

- **WHEN** fixtures contain duplicate responses, cumulative snapshots and compaction usage absent from those snapshots
- **THEN** each identified response is counted once, compaction is included once, and the report explains the cumulative reconciliation without adding reasoning twice.

#### Scenario: Incomplete telemetry or unsupported rates

- **WHEN** a log is still being written, representations disagree, only cumulative counters exist, or the selected model has no known rate
- **THEN** the report labels its coverage and known subtotal, preserves the uncertainty, and does not fabricate a complete token settlement or monetary total.

#### Scenario: Unrelated sessions and private contents

- **WHEN** another session shares a directory/date or records contain transcript text and credentials
- **THEN** it is not attributed without relationship evidence and exported results contain only allowed usage metadata, never transcript bodies or credentials.

### Requirement: Aggregate development budget checkpoints

The workflow SHALL use an explicit development-session plan spanning author, workers and mapped experiment attempts, with limits/reserves in named units and a checkpoint cadence. The reporter SHALL return continue, checkpoint, stop or unknown with reasons, honoring reached known limits and exposing missing required telemetry. Allowance observations SHALL include age and window/reset identity. Checkpoints SHALL precede expensive experiments and retries; a stop SHALL end new discretionary work with a handoff. These reports SHALL disclose their advisory nature and SHALL NOT authorize inference or alter existing gameplay enforcement.

#### Scenario: Retries exhaust the shared plan

- **WHEN** multiple worker sessions and experiment attempts reach a configured aggregate limit or closeout reserve
- **THEN** the report returns stop, preserves spent usage across replacements, and the workflow records remaining work instead of resetting the budget and relaunching.

#### Scenario: Stale allowance or invalid plan

- **WHEN** allowance is missing/stale, its window resets, a selected limit lacks required telemetry, or limits/reserves are invalid
- **THEN** invalid plans are rejected, unresolved observations cannot produce a clean continue, and no exact weekly balance is inferred from raw tokens.

### Requirement: Bounded deterministic monitoring

A local watcher SHALL observe verification results or authorized local dashboard state without inference or control mutations. It SHALL emit capped, sanitized projections on meaningful changes plus bounded heartbeats, retain evidence paths and truncation counts, and terminate within configured request and overall deadlines. It SHALL identify disconnect, stale data and incomplete results without claiming success. Dashboard credentials SHALL only be sent to the validated loopback origin, with redirects rejected and secrets excluded from output.

#### Scenario: Long unchanged run and large state

- **WHEN** many polls return unchanged or oversized state
- **THEN** the watcher suppresses redundant detail, respects collection/string/output limits, emits only scheduled heartbeats and requires no model turn per poll.

#### Scenario: Unreachable or unsafe dashboard

- **WHEN** the endpoint fails, redirects away, uses a non-loopback origin or never responds
- **THEN** the watcher reports a bounded failure/unknown outcome, does not leak its capability, and neither starts processes nor retries game effects.

### Requirement: Deterministic contract preparation

The tooling SHALL generate existing-version verification/review assignments from explicit author-provided criteria, scope, checks, ownership and budgets, using fresh identities and observed source fingerprints. It SHALL validate before publishing, preserve unrelated edits and prior evidence, and reject unsafe paths or ambiguous input. Result summaries SHALL preserve original findings, source status and coverage; structural validity SHALL NOT be represented as semantic acceptance.

#### Scenario: Valid scoped assignment

- **WHEN** an author supplies a complete scope and explicit check/resource decisions
- **THEN** the helper produces an assignment accepted by the existing validator, without executing the checks or choosing additional authority.

#### Scenario: Stale or negative result

- **WHEN** a returned result has findings, missing coverage, changed source or an invalid contract
- **THEN** the summary exposes those conditions and does not overwrite the report or label the task ready.

### Requirement: Pre-inference evidence gate

The tooling SHALL provide a no-inference, no-game-launch preflight using existing deterministic checks and explicitly supplied retained evidence. Its manifest SHALL map declared criteria to actual commands/outcomes, evidence, relevant source identities and coverage gaps. Missing, failed, stale or incomplete required evidence SHALL prevent readiness. Readiness SHALL be limited to the declared preflight scope and SHALL NOT establish a live gameplay acceptance result or authorize trial resumption.

#### Scenario: Composition checks precede experiment spending

- **WHEN** the developer prepares an integration candidate
- **THEN** preflight accounts for transport overlap, pause/resume, cancellation ownership, provider persistence/refusal, replacement evidence and realistic ledger/recovery coverage, distinguishing fake tests from retained game evidence.

#### Scenario: A reference becomes stale

- **WHEN** a required dependency fingerprint changes or required game evidence is absent
- **THEN** preflight reports the specific uncovered criterion and exits non-ready without launching another game or provider trial.

### Requirement: Task-appropriate developer models and bounded delegation

Developer guidance SHALL recommend Sol/medium for milestone ownership, Terra/medium for bounded implementation, Astra for consequential design and unfamiliar diagnosis, and Luna/medium for routine verification and focused test authorship. It SHALL preserve configured gameplay models, independent review rules and subscription-only access. Delegated work SHALL have explicit boundaries, stable inputs, expected results and a budget; test authors SHALL receive behavioral acceptance cases. Unavailable requested models SHALL be reported without silent substitution or API fallback.

#### Scenario: Test work is delegated

- **WHEN** stable interfaces and behavioral cases allow a focused test-writing assignment
- **THEN** a fresh bounded worker owns named test files and returns executed checks/evidence or a diagnosis gap, while final review remains independent and the parent does not duplicate routine monitoring.

#### Scenario: Routine work reveals an unfamiliar race

- **WHEN** the assigned model cannot resolve a cross-component issue within the bounded task
- **THEN** it returns a compact diagnosis packet for explicit stronger-model work rather than looping or silently changing providers.

### Requirement: Explicit task model selection

Each planned implementation task SHALL have a model/effort recommendation, role, brief rationale and evidence-based escalation conditions linked to its existing acceptance checks. The developer launcher SHALL validate task metadata, preview selection without inference, and start only an already-authorized author task on explicit start. It SHALL support reasoned explicit overrides, record recommended/requested/available observed models separately, preserve subscription and permission settings, and reject unavailable models or unsupported authentication without fallback. Dedicated verification/review SHALL retain their workflows. Selection SHALL NOT complete tasks, switch an active session automatically, or authorize gameplay/other work.

#### Scenario: Preview and explicit override

- **WHEN** an author selects a valid task and optionally overrides its recommended model/effort with a reason
- **THEN** preview shows the effective selection without inference, and explicit start records the selection/reason before launching only that bounded authorized author task.

#### Scenario: Missing metadata or constrained role

- **WHEN** routing metadata is missing/ambiguous/stale, a task is unknown/completed, authentication/model checks fail, or the selected task belongs to verification/review
- **THEN** no ordinary author session starts; the result identifies the failure or required dedicated workflow without choosing a silent fallback.

#### Scenario: Failed or uncertain launch

- **WHEN** a launch fails or its outcome cannot be established
- **THEN** the attempt and uncertainty remain visible, no success is invented, and the launcher does not automatically retry or reset spent accounting.

### Requirement: Evidence-based routing pilot

The workflow SHALL provide a compact outcome record for the next separately authorized ordinary task, linking the recommendation, actual available model metadata, escalations/reasons, aggregate usage, rework and acceptance evidence. It SHALL preserve unknowns and SHALL NOT require comparative reruns or claim measured savings from a model label. The efficiency change SHALL be verifiable with synthetic outcomes without executing the future pilot.

#### Scenario: Pilot task completes or escalates

- **WHEN** the next authorized ordinary task supplies its actual outcome
- **THEN** the record preserves linked sessions and acceptance/rework evidence, supports a bounded guidance correction, and distinguishes unmeasured savings from observations without launching another task.

### Requirement: Stable verification and review cycles

The workflow SHALL define relevant risk/check coverage before new integration work, stabilize source before final checks/review, serialize conflicting heavy resources, and retain evidence only with justified unaffected dependencies. After two unchanged failures it SHALL diagnose before rerunning. Handoffs SHALL preserve current decisions, criteria, source/evidence, budget state and next bounded action. Required acceptance checks and review SHALL NOT be removed to claim efficiency.

#### Scenario: Failure repeats without a source change

- **WHEN** the same check fails twice with unchanged relevant source and conditions
- **THEN** the worker returns the command, failure signature, evidence and next discriminating check before another attempt, leaving acceptance incomplete.

#### Scenario: Follow-up changes affect earlier evidence

- **WHEN** fixes change a dependency of an accepted check or reviewed behavior
- **THEN** affected checks and independent follow-up review run on the new candidate, while justified unaffected evidence can be reused without reopening unrelated work.
