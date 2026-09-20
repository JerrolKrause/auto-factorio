# Agent learning

## Purpose

Improve blueprint designer and scorer behavior from recorded evidence through bounded, reviewable instruction and tool changes without accumulating unbounded prompts or speculative permanent rules.

## Requirements

### Requirement: Evidence-based learning cadence and no-change outcomes

The UI SHALL configure learning after each design session, after a bounded batch or off. The learnings role SHALL inspect authorized session feedback, human interventions, measurements, interaction records and relevant library facts and record accept/refine/merge/reject/defer/no-change decisions with provenance. It SHALL check existing safeguards and previous dispositions before proposing a change. Unchanged evidence SHALL NOT repeatedly reopen rejected/deferred candidates without their recorded revisit condition. A run SHALL NOT require a new lesson or patch to count as completed.

#### Scenario: Nothing useful to change

- **WHEN** a session adds no supported generalizable lesson beyond existing tools/instructions
- **THEN** learning completes with a visible no-change decision, leaves the active bundle unchanged and does not spend further turns inventing updates.

### Requirement: Lowest effective enforcement and bounded knowledge

Learning SHALL prefer applicable existing lint/validation/configuration guards or deterministic scripts/tool fixes with tests before adding model instructions. Judgment-only lessons SHALL be concise, scoped, evidence-linked and carry review/retirement conditions. Active instructions and injected lessons SHALL obey finite operator-configured size/count budgets; candidates SHALL NOT raise those budgets. Duplicate content SHALL be consolidated, useful overflow relocated to narrower retrieval scopes, and retired/replaced/wrong lessons recorded with reasons. Retained archives SHALL NOT be automatically injected. Selection SHALL expose omissions and retain gameplay visibility rules.

#### Scenario: Repeated arithmetic mistake

- **WHEN** the designer repeatedly computes an incorrect supported recipe ratio
- **THEN** the candidate targets the deterministic calculation or its use/validation as supported by evidence, includes a regression case, and does not automatically append the same arithmetic reminder to every agent prompt.

#### Scenario: Instruction budget reached

- **WHEN** a valid candidate would exceed the active prompt or lesson budget
- **THEN** maintenance consolidates or scopes content within the cap or defers the change, preserves useful knowledge outside the prompt, and never silently increases the cap or deletes a live lesson merely for space.

### Requirement: Scoped autonomous maintenance authority

Learning SHALL support autonomous updates to registered designer/scorer instructions, scoped lessons and approved design-helper tools through an isolated maintenance interface. Ordinary gameplay roles SHALL retain their existing tool restrictions. Patch application/execution SHALL be limited to allowed staging paths and fixed validation operations, without arbitrary shell access, secrets, network access, dependency installation or edits to the live dirty checkout. Runtime permissions, provider/budget controls, objective/rubric semantics, measurement oracle/private fixtures, promotion gates and learning criteria SHALL be protected. Changes outside the allowed boundary SHALL become recorded proposals without mandatory human pauses.

#### Scenario: Attempt to improve scores by weakening the test

- **WHEN** a candidate modifies a production threshold, private control, permission check or its own activation criterion
- **THEN** it is denied activation, recorded for optional human review, and the unattended blueprint session still finalizes normally under its original rules.

#### Scenario: Isolation unavailable

- **WHEN** required execution isolation cannot be established for a tool patch
- **THEN** the patch remains inactive with a visible deferred/proposal-only result, no unsafe runner starts, and blueprint delivery does not require manual intervention.

### Requirement: Confined execution after activation

Activated helper code SHALL execute only in an OS-isolated worker, never inside the privileged runtime process. It SHALL receive only bounded caller-authorized structured inputs and return bounded validated results or action proposals. The trusted gateway SHALL independently authorize every proposed effect under current identity, ownership, revision, inventory and budget rules; helpers SHALL NOT hold dispatch credentials. Execution SHALL enforce immutable code/policy hashes, read-only code, bounded private scratch space and finite wall/CPU/memory/output limits, denying host filesystem, secrets, network, child processes and raw game/admin access. Unavailable or violated confinement, changed bytes, exhausted limits or malformed output SHALL reject the invocation without executing it unsandboxed. Failure SHALL be recorded and any previously dispatched effects reconciled normally.

#### Scenario: Activated helper attempts forbidden access

- **WHEN** a successfully activated helper in a later session tries to read a credential/host file, use the network, launch a child or bypass the game gateway
- **THEN** confinement denies the access, the worker/output is rejected with evidence, no unauthorized effect occurs, and no in-process or unsandboxed fallback runs.

#### Scenario: Worker confinement or quotas unavailable

- **WHEN** a future invocation cannot establish the pinned isolation policy or exceeds its resource/output quota
- **THEN** it fails closed within its limit, retains the failure for human inspection and preserves completed blueprint delivery without requiring human approval.

### Requirement: Bounded change and inference budgets

Maintenance SHALL have finite candidate/patch-attempt/activation/tool-catalog budgets and a reserved share of aggregate time, turn, tool and reported-token budgets. The learning role SHALL NOT expand them, recursively spawn unbounded validation runs or treat edit count/tool count as success. New tools SHALL require a recorded capability gap and preference for correction/consolidation of existing tools. Budget exhaustion SHALL retain pending evidence and defer activation rather than restarting accounting or blocking completed blueprint delivery.

#### Scenario: Repeated unsuccessful patch

- **WHEN** a candidate reaches its configured patch-attempt limit without passing checks
- **THEN** it is deferred with failed evidence, further attempts stop, aggregate usage remains charged and the final report includes the unchanged active version.

### Requirement: Independent validation before future-session activation

Autonomous changes SHALL be assembled into a final immutable bundle against a pinned incumbent hash and activation generation. Activation SHALL require the originating regression cases, relevant unrelated/interaction cases, unchanged authoritative acceptance controls, a fresh read-only independent review and successful bounded behavioral trials where behavior changes. All required checks, trials and review SHALL attest the exact combined bundle hash covering effective instructions, helpers/dependencies, retrieval/catalog configuration and execution-policy reference; individually passing patches SHALL NOT establish bundle acceptance. Instruction changes SHALL NOT be considered effective solely because text lint passes. Incumbent/bundle comparisons SHALL use equivalent assignments, profiles, rubrics and budgets and report uncertainty/tradeoffs. Changed bundle bytes or changed expected incumbent/generation SHALL invalidate activation eligibility and require revalidation/review. Activation SHALL atomically compare that incumbent/generation, verify the attested bundle and advance the active pointer/generation once under a durable operation ID. Failed/inconclusive checks, incomplete coverage or insufficient validation budget SHALL leave the bundle inactive. No human approval SHALL be required when configured checkpoints are off and all automatic gates pass.

#### Scenario: Validated tool improvement

- **WHEN** a permitted tool fix passes the originating failure, unrelated regression cases, required behavioral validation and independent review
- **THEN** the system atomically activates the exact attested bundle only against its unchanged expected incumbent/generation, records the diff/evidence and demonstrates that a later fresh session uses the new version; existing sessions retain their pinned versions.

#### Scenario: Scorer instruction regression

- **WHEN** changed scorer instructions improve one example but misclassify an unrelated reference or bypass case
- **THEN** activation is refused, both outcomes remain visible, and the incumbent's verdict semantics and previous scores remain intact.

#### Scenario: Interacting patches fail as a bundle

- **WHEN** an instruction patch and helper patch each pass against the old incumbent but fail an interaction case when combined
- **THEN** combined validation rejects activation, neither individual pass substitutes for final-bundle evidence, and the incumbent remains active.

#### Scenario: Competing activation and changed bytes

- **WHEN** two validated bundles target the same incumbent/generation and one activates, or bundle bytes change after review
- **THEN** the other or changed bundle is rejected as stale/unattested, including after rollback to an earlier hash, and activation requires new matching validation/review rather than an implicit merge; lost responses reconcile the original operation.

### Requirement: Human inspection and reversible activation

The UI SHALL present learning decisions, supporting feedback, exact instruction/tool diffs, tests/trials, independent review, effective version and activation history in one reviewable report. Optional human approval checkpoints SHALL be configurable independently of viewing this information. Operators SHALL be able to disable learning, quarantine a version or select a previous verified bundle for future sessions without mandatory participation in unattended runs. Rollback SHALL preserve evidence and SHALL NOT pretend to reverse already executed game effects.

#### Scenario: Review and revert after an unattended run

- **WHEN** a person returns after automatic activation and chooses a previous verified bundle
- **THEN** the UI exposes what changed and why, future sessions select that bundle, active sessions keep their pinned version and the original update plus rollback remains auditable.
