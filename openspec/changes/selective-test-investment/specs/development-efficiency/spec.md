# Development efficiency delta

## ADDED Requirements

### Requirement: Failure-driven developer test selection

Before adding a developer test, the author SHALL name the observable failure, the behavior it protects, the chosen proof layer and the coverage gap it fills in the existing task packet. An existing check that already establishes the criterion SHALL be usable without a duplicate new unit test. Coverage of meaningful accounting, calculations, ownership, cancellation, persistence and unknown outcomes SHALL remain explicit. Public behavioral assertions SHALL be preferred; implementation-specific assertions SHALL require a stated contract reason. Stable existing software checks SHALL remain in applicable acceptance gates. Required browser or native-game evidence SHALL NOT be replaced by fakes or by test counts. Test-policy guidance SHALL NOT weaken gameplay learning activation requirements, provider limits, independent review or native-game acceptance.

#### Scenario: Existing proof covers a change

- **WHEN** an author maps a change's criteria to adequate existing checks
- **THEN** the task can complete without new unit tests after applicable checks and independent review pass, with the coverage rationale retained.

#### Scenario: A meaningful failure lacks coverage

- **WHEN** an ownership, arithmetic or recovery failure has no adequate check
- **THEN** the author selects focused behavioral proof for that gap instead of omitting it to save effort or adding assertions unrelated to the failure.

#### Scenario: A fake passes for physical behavior

- **WHEN** simulated execution passes but a criterion requires actual Factorio movement, inventory, placement, cancellation or save/load
- **THEN** that criterion remains unverified until required source-matched native evidence passes.

### Requirement: Bounded test and fixture correction

Test delegation SHALL follow stable interfaces and specified behavioral cases, with named files and finite shared spending limits. New or changed fixtures SHALL compile before repeated behavioral execution. Test and fixture corrections SHALL follow the two-unsuccessful-corrections diagnosis rule of "Stable verification and review cycles". Inside a delegated worker session, which admission enforcement does not observe, the worker SHALL count and declare its corrections per invariant and, after the second unsuccessful correction, SHALL return the failure, attempts and evidence to the author instead of correcting again; this limit SHALL be documented as worker self-reporting. Diagnosis SHALL distinguish product defects, fixture/assertion defects and environment failures using evidence. The author SHALL choose a bounded product fix, fixture fix, replacement or reviewed retirement; repeated failure alone SHALL NOT justify deletion, weaker assertions, renewed budgets or an acceptance pass. Verifiers SHALL return repair needs rather than changing source or coverage.

#### Scenario: Fixture corrections fail twice

- **WHEN** two corrections leave the same test invariant failing
- **THEN** the next corrective attempt waits for a diagnosis packet and discriminating evidence, while original failures and shared spending remain recorded.

#### Scenario: Delegated worker reaches the correction limit

- **WHEN** a delegated test worker's second correction leaves the same invariant failing
- **THEN** the worker stops correcting and returns its declared attempts and evidence to the author, who owns diagnosis before any further delegation.

#### Scenario: Implementation changes during test authoring

- **WHEN** a delegated test's interface or behavior becomes unstable
- **THEN** the worker returns the mismatch to the author for a revised bounded packet before further dependent fixture work; acceptance remains incomplete.

### Requirement: Reviewed individual test retirement

Test retirement or replacement SHALL identify the exact test, its protected behavior, the maintenance problem and either retained/replacement evidence that exercises the same named failure (not merely a similarly titled check) or why the behavior is obsolete. Independent review SHALL examine that rationale and any coverage loss before completion. A required failure path SHALL remain covered, and retirement SHALL NOT reduce required acceptance. Blanket disabling, unexplained skips, timeout removal and weakened assertions SHALL NOT count as retirement evidence.

#### Scenario: Brittle duplicate assertion

- **WHEN** an implementation-specific test duplicates an executed public-behavior check
- **THEN** a scoped maintenance change can retire it after identifying the check that exercises the same named failure and passing affected checks and independent review.

#### Scenario: Costly unique recovery protection

- **WHEN** the only check for a required unknown-outcome recovery path is expensive or failing
- **THEN** the path retains a passing adequate check or remains incomplete; maintenance cost alone does not authorize its removal.

### Requirement: Observed test-policy outcomes

After activation, the workflow SHALL record one observation for each of the next three separately authorized implementation tasks in existing task evidence and closeout records, without starting extra work to obtain samples; multiple slices within one authorized task SHALL count once. Each observation SHALL distinguish first discovery by an existing test, discovery during new test development, fixture/assertion/environment repair and defects first found by review or browser/game execution. Repeated failures and log readbacks SHALL NOT be counted as distinct defects. Available execution duration, repair effort and model usage SHALL retain attribution and uncertainty; session spans SHALL NOT be equated with active work or subscription cost. After the third task, its author SHALL summarize observed benefits, costs and gaps with a keep/adjust recommendation, without automatic policy changes. Policy-rollout completion SHALL require guidance and worked examples, not completion of these future tasks.

#### Scenario: No future task has started

- **WHEN** the documentation rollout passes its checks and review but no later implementation task is authorized
- **THEN** the rollout can complete with a pending observation pointer; no benchmark or new implementation is launched.

#### Scenario: Third task closes with partial telemetry

- **WHEN** the third qualifying task closes and some effort or usage observations are unavailable
- **THEN** the summary cites the three task records, keeps unavailable values unknown, separates detection from repair, and makes no invented savings or model-quality claim.
