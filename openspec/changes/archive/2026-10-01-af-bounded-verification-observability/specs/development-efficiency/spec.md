# Development Efficiency Delta

## MODIFIED Requirements

### Requirement: Attributed usage with explicit uncertainty

The development tooling SHALL report usage for a selected root session, proven descendants and explicitly mapped gameplay sessions over a specified time interval. It SHALL deduplicate responses, account for identifiable compaction, reconcile cumulative telemetry without double counting, and keep cached input and reasoning subsets correctly represented. Missing, malformed, conflicting or incomplete data SHALL be visible as coverage gaps. Unknown model costs SHALL remain unknown; optional estimates SHALL identify their rates, date and source and SHALL NOT be presented as exact subscription expenditure.

The reporter SHALL discover nested rollout directories and proven session relationships, obtain observed model/effort from supported session or turn metadata, and split usage by model and workflow phase only when telemetry supports that attribution. Cumulative-only telemetry SHALL be usable as explicitly labeled aggregate evidence without fabricating response identities; missing fine-grained attribution SHALL be separate from invalid aggregate totals. Counter resets, conflicting representations, partial records and unknown compaction accounting SHALL remain explicit. Cached input and reasoning SHALL remain subsets, never added twice.

#### Scenario: Duplicate events and compaction

- **WHEN** fixtures contain duplicate responses, cumulative snapshots and compaction usage absent from those snapshots
- **THEN** each identified response is counted once, compaction is included once, and the report explains the cumulative reconciliation without adding reasoning twice.

#### Scenario: Incomplete telemetry or unsupported rates

- **WHEN** a log is still being written, representations disagree, only cumulative counters exist, or the selected model has no known rate
- **THEN** the report labels its coverage and known subtotal, preserves the uncertainty, and does not fabricate a complete token settlement or monetary total.

#### Scenario: Unrelated sessions and private contents

- **WHEN** another session shares a directory/date or records contain transcript text and credentials
- **THEN** it is not attributed without relationship evidence and exported results contain only allowed usage metadata, never transcript bodies or credentials.

#### Scenario: Current rollout format without response identities

- **WHEN** a root and its children expose monotonic cumulative counters and turn-context model metadata but no response identity
- **THEN** the report counts each session once, reports observed models, labels cumulative aggregate coverage separately from unavailable per-response detail, and does not emit a repeated gap for every identical missing field.

#### Scenario: Mixed models and reset counters

- **WHEN** models change within a session or a cumulative counter resets without an unambiguous accounting boundary
- **THEN** attributable intervals retain their models, unresolved allocation remains unknown, and no guessed allocation or complete budget settlement is reported.


### Requirement: Aggregate development budget checkpoints

The workflow SHALL use an explicit development-session plan spanning author, workers and mapped experiment attempts, with limits/reserves in named units and a checkpoint cadence. The reporter SHALL return continue, checkpoint, stop or unknown with reasons, honoring reached known limits and exposing missing required telemetry. Allowance observations SHALL include age and window/reset identity. Checkpoints SHALL precede expensive experiments and retries; a stop SHALL end new discretionary work with a handoff. These reports SHALL disclose their advisory nature and SHALL NOT authorize inference or alter existing gameplay enforcement.

Managed verification and task-dispatch entrypoints SHALL check the plan before each new expensive check, retry or worker launch, and enforce stop by refusing new admissions while retaining time for safe cleanup and reporting. Unknown token accounting SHALL NOT mean zero usage or a clean continue: a recorded bounded decision with a known wall-time or admission-count limit is required. The tools SHALL disclose that direct commands and already-running external agent reasoning are outside admission enforcement; reaching a budget SHALL NOT turn incomplete acceptance into a pass.

#### Scenario: Retries exhaust the shared plan

- **WHEN** multiple worker sessions and experiment attempts reach a configured aggregate limit or closeout reserve
- **THEN** the report returns stop, preserves spent usage across replacements, and the workflow records remaining work instead of resetting the budget and relaunching.

#### Scenario: Stale allowance or invalid plan

- **WHEN** allowance is missing/stale, its window resets, a selected limit lacks required telemetry, or limits/reserves are invalid
- **THEN** invalid plans are rejected, unresolved observations cannot produce a clean continue, and no exact weekly balance is inferred from raw tokens.

#### Scenario: Stop or unknown at managed admission

- **WHEN** a managed entrypoint reaches its limit/reserve or lacks reliable token accounting
- **THEN** it refuses further expensive admissions for stop, requires a bounded documented alternative for unknown, and retains evidence and exact cleanup without relaunching a worker to reset the plan.


### Requirement: Task-appropriate developer models and bounded delegation

Developer guidance SHALL use explicit current-generation defaults: `gpt-6.1-sol` with medium effort for bounded implementation and high for coupled ownership/recovery work, `gpt-6-luna` with medium for exact routine verification and high for bounded adaptive verification, and `gpt-6-astra` for consequential diagnosis. Ambiguous cross-component verification SHALL use `gpt-6.1-sol` with high effort rather than requiring Luna for every check. Deterministic calculations, polling and mechanical reports SHALL require no model. Independent reviewers SHALL retain fresh author-independent contexts and inherit the author's authorized model/effort; gameplay SHALL retain configured `gpt-6-astra`/low profiles. Delegation SHALL identify boundaries, evidence, uncertainty, model/effort, escalation and shared budget. A managed capability check SHALL validate the requested model/effort and ChatGPT access before launch; unavailable models SHALL produce an explicit blocked result without fallback, API billing or global setting changes. Active developer guides, worker skills, examples and pending task recommendations SHALL migrate from GPT-5.6; archived specifications, historical records and intentionally versioned compatibility fixtures SHALL remain unchanged.

#### Scenario: Test work is delegated

- **WHEN** stable interfaces and behavioral cases allow a focused test-writing assignment
- **THEN** a fresh bounded worker owns named test files and returns executed checks/evidence or a diagnosis gap, while final review remains independent and the parent does not duplicate routine monitoring.

#### Scenario: Routine work reveals an unfamiliar race

- **WHEN** the assigned model cannot resolve a cross-component issue within the bounded task
- **THEN** it returns a compact diagnosis packet for explicit stronger-model work rather than looping or silently changing providers.

#### Scenario: Capability-appropriate verification

- **WHEN** a verification assignment requires uncertain recovery or cross-component evidence interpretation
- **THEN** its recorded route uses GPT-6.1 Sol/high, while exact scripted checks use GPT-6 Luna/medium and no model is asked to interpret every polling sample.

#### Scenario: Latest requested model unavailable

- **WHEN** GPT-6.1 Sol or the selected effort is absent from the current managed capability list
- **THEN** admission reports the unavailable selection without running GPT-5.6, silently substituting GPT-6 Sol, or switching authentication.


### Requirement: Stable verification and review cycles

The workflow SHALL define relevant risk/check coverage before new integration work, stabilize source before final checks/review, serialize conflicting heavy resources, and retain evidence only with justified unaffected dependencies. After two unchanged failures it SHALL diagnose before rerunning. Handoffs SHALL preserve current decisions, criteria, source/evidence, budget state and next bounded action. Required acceptance checks and review SHALL NOT be removed to claim efficiency.

Changes crossing more than two capabilities or four integration boundaries SHALL plan at least two production slices before execution and record independent acceptance as each slice completes. Each scenario SHALL have exactly one slice; dependent expansion SHALL wait for acceptance of its prerequisite slice. Acceptance SHALL include each effectful slice's negative/recovery cases and independent review. Focused checks and relevant production smoke SHALL precede independent review; expensive final acceptance SHALL follow corrective review, with affected checks and follow-up review after substantive fixes. Final closure SHALL require both ready source-matched acceptance and review regardless of ordering. After two unsuccessful corrections to the same invariant, even with changing symptoms, the workflow SHALL require a bounded diagnosis packet and a discriminating check before another corrective attempt. Routine closeout edits remain exempt from repeat independent review under existing rules.

#### Scenario: Failure repeats without a source change

- **WHEN** the same check fails twice with unchanged relevant source and conditions
- **THEN** the worker returns the command, failure signature, evidence and next discriminating check before another attempt, leaving acceptance incomplete.

#### Scenario: Follow-up changes affect earlier evidence

- **WHEN** fixes change a dependency of an accepted check or reviewed behavior
- **THEN** affected checks and independent follow-up review run on the new candidate, while justified unaffected evidence can be reused without reopening unrelated work.

#### Scenario: Repeated invariant failure and dependent slice

- **WHEN** two corrections leave the same ownership invariant unsatisfied or a dependent slice is proposed before its prerequisite is accepted
- **THEN** further corrective admission requires recorded diagnosis in the first case, and dependent expansion is refused in the second; neither condition waives acceptance.

#### Scenario: Stable context handoff

- **WHEN** a developer starts a fresh author context at an accepted slice boundary
- **THEN** the handoff preserves source fingerprints, invariant/finding IDs, evidence, resource ownership, plan balance and next action; automatic compaction remains available without mandatory per-check compaction or budget reset.

