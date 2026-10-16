# Design

## Context

See [proposal](proposal.md). This is a developer workflow change, not product behavior. The current handoff identifies `production-chain-planning` as unfinished and a separate Backpass repair; neither is resumed or modified by this proposal. The user's instruction is to implement after the current effort is done. Explicit later start is the activation signal, not automatic scheduling behind every backlog item.

The October 15 local audit indexed 691 session files. Its 52 successful standard-test receipts have a 9.74-second median; that passing-only sample cannot establish failure rate. Twenty selected production-chain test-worker sessions reported 449,240 output tokens and 294 summed minutes of session spans, including authoring, repairs, waiting and overlap; these are not measured waste, elapsed delay or subscription consumption. The selected workers used Luna, so no Sol-specific causal conclusion follows. One traced new runtime integration test caught an unused `cellDesign` prompt argument followed by a production fix. A reliable pre-existing-unit-test prevention rate was not established.

Local evidence: `.runtime/test-value-audit/summary.json`, `case-ledger.json`, `standard-test-runs.json` and `test-workers.json`. These ignored artifacts are optional supporting evidence, not portable prerequisites. Durable supporting examples are in [implementation history](../../../docs/IMPLEMENTATION_HISTORY.md): measurement test budget overrun, prerequisite VM/timeout test-only repairs, execution prompt correction, and S4C review findings after software gates. This summary preserves the decision rationale if local logs disappear; it is not an exhaustive ROI estimate.

Existing instructions already require stable interfaces, compile-first fixtures, bounded diagnosis, source-matched evidence and independent review. `vitest.config.ts` selects both `.test.ts` and `.test.mjs`; the suite includes real runtime/journal integration with scripted adapters, not only isolated unit tests. The standard runner is retained.

No repository rule mandates a new unit test per change. The "automatic new test" expectation comes from practice and kit defaults, notably the kit `fix-defect` Guard step ("ONE regression test asserting the specific wrong value"). The repository steers kit skills through `.claude/stack.md`, so the kit profile is where that default is subordinated to failure-driven layer selection. Independent reviewers read `.agents/skills/change-audit/SKILL.md`, not the author workflow, so the coverage-rationale and retirement checks must appear there.

## Goals / Non-Goals

**Goals:** make a test earn new authoring effort through a named failure; keep acceptance intact; stop fixture loops; support reviewed individual retirement; assess outcomes through existing records.

**Non-Goals:** bulk deletion or suite reclassification, runtime or runner changes, new metrics infrastructure, numeric coverage targets, a model benchmark, changes to R21 gameplay learning controls, and altering current in-flight assignments. The rollout itself deletes no tests.

## Decisions

### D1: One documentation rollout after explicit activation

Use one bounded documentation slice. At application time, reread the handoff and record evidence that the current effort is finished plus the user's start instruction. A pause or planning-complete status alone is not completion. Reconcile changes made in the interim and preserve unrelated edits. If the user starts this while work remains unfinished, surface the scheduling conflict rather than silently weakening that work's gates.

Only this proposal directory is written during planning. Future implementation updates the paths enumerated in Impact and syncs this delta. It records activation and the follow-up pointer in the normal handoff/history; it does not create another queue. All older required criteria remain authoritative. There is no dependency on finishing unrelated future backlog proposals.

### D2: Put the decision in the existing task packet

In `DEVELOPMENT_WORKFLOW.md`, define a short rationale: criterion/failure, existing coverage, selected layer, and add/reuse/no-new-test decision. A few lines suffice; no schema or required standalone report. Prefer exact arithmetic tests for calculations, runtime integration for persistence/ownership, browser checks for user interaction and native probes for physical game behavior. Layers can complement each other; simulation does not prove game mechanics. Existing test counts are execution facts, not acceptance criteria or quality targets.

Link this guidance concisely from AGENTS, the kit profile, model guidance and verifier/reviewer author and worker instructions (including `.agents/skills/change-audit/SKILL.md`). Conditional delegation means a dedicated test writer is used only when new test work is justified and the interface is stable. Existing model and authorization routes remain unchanged. The verifier executes assigned checks and reports gaps; the author owns fixes and coverage decisions; independent review assesses them.

Alternative rejected: disabling Vitest wholesale would remove cheap stable checks and demonstrated integration value. Equally, retaining an automatic new-unit-test expectation keeps the observed maintenance burden without a coverage rationale.

### D3: Reuse correction lineage and spending rules

Use the current two-unsuccessful-corrections rule (live requirement "Stable verification and review cycles") and its existing ledger/admission mechanism for author-level corrective admissions; do not introduce a second retry counter. That mechanism does not see direct shell commands, which is where delegated test workers' edit-and-rerun loops run. Inside a worker session the worker counts its own corrections per invariant and declares them in its result; after the second unsuccessful correction it stops and returns the failure, attempts and evidence to the author, matching the existing return-to-author pattern. This in-worker limit is unenforced self-reporting and is documented as such. Diagnose product, fixture/assertion or environment causes and execute the smallest discriminating check. Compile changed fixtures before repeated behavioral execution. Enforce the packet's finite spending even before two corrections; a diagnosis does not renew the budget. Stable source and task scope precede renewed delegation.

### D4: Define retirement now; make removals later

The procedure records exact test identity, original protection, observed maintenance issue, adequate current replacement/retained proof or obsolete behavior, and review disposition in the existing task report. A replacement must exercise the named failure, not merely have a similar title. Required recovery/accounting evidence cannot vanish, and retirement never reduces required acceptance. Changing approved acceptance is a requirements/scope change governed by the user under AGENTS, not part of this procedure. Repairing a fixture or setting a justified finite timeout remains possible without weakening behavior assertions.

Candidate categories for later maintenance are VM/source-copy tests, exact incidental error wording and fixtures encoding obsolete interim gates. These are inspection candidates, not a deletion list. Subsequent ordinary authorized maintenance can use the policy; no separate automatic cleanup campaign is created. This is consistent with the live prohibition on removing required acceptance to claim efficiency: the obligation remains, while redundant mechanisms can change after review.

### D5: Three future observations, no rollout dependency on future work

The main author of each of the next three separately authorized implementation tasks adds one short observation to that task's existing report; multiple slices within one authorized task count once. Exclude documentation-only closeouts, this policy rollout and repeated corrections of one task from the count. When that task is also the routing-pilot task (`docs/DEVELOPMENT_EFFICIENCY.md`, routing-outcome template), add the test fields to that same routing-outcome record rather than a separate one. Record task identity and source, test choice, discovery category, fixture repair attempts, available execution duration/effort/usage and limitations. Distinguish first-discovery categories; uncertain causality remains unknown. Reuse existing usage tools where attribution is supported; do not mine entire histories again or require new telemetry.

At rollout closeout, place a compact pointer in the handoff to the history/report entry with `0/3` observations. Each qualifying task updates the count and evidence references. The third task's closeout author compares observations with the dated baseline, notes scope differences and recommends keep/adjust; no savings target or statistical/model-quality conclusion is required. Missing samples remain pending without launching work. Rollout acceptance checks worked examples of these records, not the future experiment itself.

Activation deferral (D1) and the rollout's no-test-change rule are one-time rollout constraints recorded here and in tasks, not canonical requirements: they would be unfalsifiable after sync.

## Risks / Trade-offs

- Selectivity could become an excuse to omit failures -> require criterion-to-proof mapping and independent review; gaps remain incomplete.
- A failing test could be called redundant to get green -> require exact replacement evidence or obsolete-behavior rationale and review before retirement.
- Documentation may not change behavior -> exercise selection and diagnosis examples at rollout; observe three future tasks without new machinery.
- Deferred documents may drift -> rebase policy wording onto current instructions at activation and review substantive changes; preserve historic criteria.

## Migration Plan

1. Confirm explicit deferred start and completed in-flight boundary; snapshot affected documents.
2. Update the named guidance consistently and add compact worked examples for reuse, a meaningful new test, a physical proof gap, repeated fixture correction, valid/invalid retirement and future observations.
3. Run docs, strict OpenSpec and whitespace checks; independently review policy semantics and examples. No game, provider inference or software-suite run is needed for documentation-only implementation.
4. Sync the delta and record activation plus `0/3` follow-up pointer. Restore prior guidance through an independently reviewed scoped documentation change if the policy causes coverage loss; preserve all observations. Do not automatically roll back tests or historic evidence.
