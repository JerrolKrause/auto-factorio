# Verification Orchestration Delta

## Purpose

Provide observable, bounded developer verification that reduces model coordination while preserving production acceptance, independent review and trustworthy evidence.

## ADDED Requirements

### Requirement: Manifest-driven check execution

The developer runner SHALL execute an explicitly authorized manifest of criteria, checks, dependencies, budgets and resource owners. It SHALL validate the manifest before effects, deduplicate successful reusable checks per unchanged dependency identity within a candidate, except when acceptance explicitly requires a fresh run, and generate mechanical result fields from observed execution. Combined software/game execution SHALL NOT rerun the software prerequisite chain unnecessarily. Ordinary `verify`, `verify --game` and `verify --pause` semantics SHALL retain their required coverage and fail-closed exits. Models SHALL remain responsible for coverage selection and unfamiliar diagnosis; a generated contract SHALL NOT imply independent review or semantic acceptance.

#### Scenario: Shared software prerequisites

- **WHEN** a candidate requests both software and game acceptance with identical shared prerequisites
- **THEN** each shared check executes once, downstream checks reference its evidence, and no model turn is required between successful mechanical steps.

#### Scenario: Invalid manifest or failed prerequisite

- **WHEN** authorization, a check dependency, criterion mapping or resource declaration is missing, or a prerequisite fails
- **THEN** dependent effects do not start, skipped criteria remain unverified, and the report identifies the blocking check without claiming a partial pass as completion.

### Requirement: Probe preflight and resource ownership

Before a live game/browser check the runner SHALL verify required installed prerequisites, available or explicitly reusable project resources, ports, confined evidence/catalog paths, valid request/deadline configuration and relevant fake composition checks. Actor readiness SHALL be established after owned game launch and before dependent actions. Resource ownership SHALL span admission, launch, execution and cleanup. Terminal failure SHALL end a wait promptly; timeout, unknown effect and failed cleanup SHALL remain distinct. Only the exact resources owned by the assignment SHALL be cleaned; personal and other project sessions SHALL remain untouched.

#### Scenario: Invalid probe setup

- **WHEN** a required port is occupied without explicit reuse authority, a runtime path escapes its permitted root or a request deadline is invalid
- **THEN** preflight reports the concrete failure before game launch and consumes no provider turn.

#### Scenario: Terminal failure while awaiting success

- **WHEN** an admitted probe reports a terminal error while a readiness or completion condition is pending
- **THEN** the wait returns that error before its overall success timeout, records cleanup evidence and does not retry an unknown effect.

### Requirement: Dependency-aware retained evidence

Reuse SHALL require a passing completed check, complete criterion coverage, intact evidence, resolved cleanup and matching declared dependencies including relevant source, built inputs, command arguments, configuration, fixtures, tools and game/mod versions. Unknown or changed dependencies SHALL invalidate reuse with a recorded reason. Changing a reporting-only file SHALL NOT invalidate unrelated game evidence when an explicit dependency boundary establishes independence. Source changes during a check SHALL invalidate its result for acceptance. An interrupted effectful check SHALL require reconciliation and SHALL NOT be resumed by blind replay. Versioned developer contracts SHALL distinguish retained evidence from newly executed checks, keep v1 records readable without rewriting them, and validate dependency/integrity proof before accepting reused coverage.

#### Scenario: Relevant and irrelevant changes

- **WHEN** a game check's Lua dependency changes but another candidate changes only an independent report renderer
- **THEN** the first candidate reruns affected game coverage and the second can retain the prior game evidence with a recorded dependency comparison.

#### Scenario: Corrupt or interrupted evidence

- **WHEN** evidence is missing, its content hash differs, cleanup is unresolved or a check was interrupted
- **THEN** reuse is refused, affected criteria remain unverified and no automatic effect replay occurs.

### Requirement: Correlated local execution observations

The workflow SHALL retain versioned local events connecting change, slice, candidate, root/worker session, assignment, check, attempt, invariant and finding identities where applicable. Events SHALL capture phase transitions, requested and observed model/effort, timestamps/durations, exit and expected/actual outcome, source/evidence identities, budget decisions, reuse decisions, cleanup and retry reasons. Failure classes SHALL distinguish product, harness/setup, infrastructure, coverage gap, stale evidence, report format and unknown. Reruns SHALL identify their predecessor and whether they address a new defect, incomplete fix, introduced regression, environment repair, coverage expansion or justified repeat. Human/model classifications SHALL record their author and evidence, and remain unknown when unsupported.

#### Scenario: Repair lineage survives replacement

- **WHEN** a worker is replaced after a failed check and a fix is attempted
- **THEN** its next assignment links the predecessor and invariant, preserves spent usage, and exposes the distinct failure and repair reasons without overwriting earlier outcomes.

#### Scenario: Interrupted event writer

- **WHEN** a writer crashes, an event is duplicated or a record is partially written
- **THEN** reports deduplicate by event identity, expose gaps or incomplete attempts, and never synthesize completion from missing events.

### Requirement: Bounded diagnostic reports and privacy

The runner SHALL emit bounded status changes and scheduled heartbeats without model inference, retain full logs locally, and produce JSON and human-readable summaries with criterion-level outcomes and evidence links. Game assertions SHALL include expected/actual values, scope/surface identity, tick/window and coverage where relevant; missing state SHALL be unknown, not zero. Shared reports SHALL exclude credentials, raw command environments, private evaluator facts, prompt bodies and hidden reasoning. Omitted/truncated data SHALL be labeled; detailed authorized diagnostics SHALL remain retrievable from confined evidence paths.

#### Scenario: Large unchanged game state

- **WHEN** many polls yield unchanged or oversized state
- **THEN** reports emit only bounded changes/heartbeats and named assertion results, preserve evidence references and use no inference for polling.

#### Scenario: Sensitive or incomplete evidence

- **WHEN** logs contain credentials/private fixtures or an assertion lacks a complete observation window
- **THEN** exported reports omit restricted content, mark omitted detail and unknown assertion coverage, and cannot report that assertion as passed.

### Requirement: Review convergence and final acceptance

The workflow SHALL retain immutable original findings and an adjudication ledger linking follow-up findings to stable invariant/finding identities. Follow-up review SHALL cover fixes and affected dependencies, with prior unaffected coverage explicitly referenced; it SHALL not require unrelated rediscovery or a minimum finding count. Corrective review and affected checks SHALL precede final acceptance; later substantive changes SHALL invalidate affected coverage. Final closure SHALL require all declared criteria, resolved actionable findings, independent review and cleanup on the final relevant source, irrespective of the number of rounds or available budget.

#### Scenario: Same issue refined on follow-up

- **WHEN** follow-up review finds an incomplete fix to an existing invariant
- **THEN** the report preserves the new evidence but links the original finding, counts it once as a unique defect and triggers the repeated-invariant diagnosis rule when applicable.

#### Scenario: Budget ends with unresolved work

- **WHEN** the plan reserve is reached while a finding or required acceptance check remains unresolved
- **THEN** the run ends with a truthful incomplete handoff and safe cleanup rather than approving the candidate or automatically starting another model session.

### Requirement: Measurable efficiency outcomes

Reports SHALL show time and available usage by authoring, diagnosis, verification, review and gameplay phases; requested/observed routes; check executions/reuse; failure classes; correction rounds; unique findings and later observed escapes. Token totals SHALL separate uncached input, cached input, output and reasoning subsets and report attribution coverage. Unknown or overlapping intervals SHALL not be silently allocated or double-counted. A deterministic fixture comparison SHALL demonstrate reduced duplicate execution and bounded output with identical required coverage. Real usage savings SHALL remain unproven until an ordinary authorized task supplies comparable observations; this capability SHALL not start model benchmark campaigns.

#### Scenario: No-inference acceptance comparison

- **WHEN** equivalent baseline and candidate manifests contain shared checks, a setup failure and a dependency change
- **THEN** the report proves each expected execution/reuse decision, identical required criterion coverage and output caps using exact counts, while labeling real model savings unmeasured.

#### Scenario: Incomplete phase attribution

- **WHEN** aggregate cumulative tokens are known but phase boundaries or model-change intervals are not
- **THEN** totals remain visible, unavailable breakdowns remain unknown, and reports neither sum overlapping intervals nor convert raw tokens into exact subscription consumption.
