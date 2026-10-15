# Tasks

Deferred: do not begin until the current in-flight effort is complete and the user explicitly starts this change. This is one documentation rollout; no tests, runners, product code or gameplay policies change. The three future observations (one per separately authorized implementation task) are follow-up work, not prerequisites for closing this rollout. Activation deferral and the no-test-change rule are rollout constraints recorded in design D1/D4, not synced requirements.

## 1. Activation and policy

- [ ] 1.1 Confirm explicit start and the completed in-flight boundary, reread current guidance and snapshot the Impact documents; verify the task report records completion evidence, authorization, current differences and a finite rollout budget without changing older assignments.
- [ ] 1.2 Update AGENTS, DEVELOPMENT_WORKFLOW, DEVELOPMENT_EFFICIENCY, MODEL_SELECTION and the kit profile with failure-driven selection, retained gates, stable-interface delegation, existing correction limits and the in-worker self-reported correction limit with return-to-author; in the kit profile, state that the kit `fix-defect` Guard step's regression test follows failure-driven layer selection (native/browser proof where the failure is physical or interactive); verify every rule in the first two delta requirements maps to named guidance and no runner or test file changed.
- [ ] 1.3 Align verifier author/worker and independent-review author/worker instructions (`.agents/skills/change-audit/author-workflow.md` and `SKILL.md`) with the coverage-rationale check and the individual retirement procedure; verify author/verifier/reviewer ownership, required retained proof and the no-acceptance-reduction rule agree across all Impact documents and preserve R21/native/provider controls.

## 2. Acceptance and closeout

- [ ] 2.1 Add compact worked examples to DEVELOPMENT_WORKFLOW and outcome guidance to DEVELOPMENT_EFFICIENCY covering all four delta requirements plus the D1 deferred-activation constraint: deferred activation, reuse without new tests, a meaningful uncovered failure, fake-only physical evidence, two failed corrections (review-backed admission, pre-review author-managed diagnosis and in-worker return), valid duplicate retirement, invalid unique-recovery retirement, and 0/3 plus partial-telemetry 3/3 observations (including routing-record reuse, failed/abandoned closeouts, and out-of-order closure with a reserved pending task and explicit summary ownership); verify each example has the specified allowed or incomplete outcome without executing future tasks or creating telemetry infrastructure.
- [ ] 2.2 Validate the complete documentation candidate: run `corepack.cmd pnpm check:docs`, `corepack.cmd pnpm exec openspec validate selective-test-investment --strict`, `git diff --check` and staged whitespace checks as applicable; manually trace every delta scenario to the worked examples and confirm unchanged tests, runner configuration and product behavior. Narrow documentation checks may remain with the author under the existing workflow.
- [ ] 2.3 Obtain a fresh-context combined independent review of all changed policy documents and examples using the repository contract; resolve findings and obtain follow-up review for substantive fixes, with a valid source-matched clean result before marking complete.
- [ ] 2.4 Sync the accepted delta and update the bounded handoff/history with activation evidence, checks/review and the 0/3 future-observation pointer; verify faithful spec sync, strict OpenSpec/docs/whitespace checks and the 800-word/80-line handoff limit. Preserve older evidence and state that no tests were retired by this rollout.

## Model routing

| Task | Role | Model | Effort | Rationale | Escalate when |
| --- | --- | --- | --- | --- | --- |
| 1.1 | author | gpt-6.1-sol | medium | Bounded activation and document reconciliation | Completion or authority conflicts with current work |
| 1.2 | author | gpt-6.1-sol | medium | Coherent policy wording across existing guides | Required acceptance appears to weaken |
| 1.3 | author | gpt-6.1-sol | medium | Preserve explicit role and retirement boundaries | Existing role contracts conflict |
| 2.1 | author | gpt-6.1-sol | medium | Small manual examples and observation instructions | A scenario lacks an unambiguous outcome |
| 2.2 | author | gpt-6.1-sol | medium | Author-run narrow documentation checks; commands are deterministic | Validation or scenario mapping fails |
| 2.3 | review | inherit-author | inherit-author | Required independent policy review | Findings or coverage gaps remain |
| 2.4 | author | gpt-6.1-sol | medium | Faithful sync and compact evidence handoff | Sync changes semantics or source evidence is stale |
