## 1. Usage reporting and session checkpoints

- [x] 1.1 Implement `dev:usage` with streaming local rollout reads, explicit root/descendant/run attribution and sanitized JSON output; verify unrelated sessions and transcript/credential fields are excluded using synthetic fixtures.
- [x] 1.2 Implement response deduplication, compaction/cumulative reconciliation and interval coverage; test duplicate records, cumulative-only logs, incomplete tails, corrupt records, counter resets and missing mappings without double-counting input/cache/reasoning.
- [x] 1.3 Add optional dated model-rate estimates and account observation metadata; test unknown model/tier, absent rates, stale allowance and changed reset windows remain explicit rather than zero or exact weekly attribution.
- [x] 1.4 Add session-plan validation and aggregate continue/checkpoint/stop/unknown reports with closeout reserves; test retries/replacements share limits, invalid units/values fail, known exhaustion wins, and missing required telemetry cannot report continue.

## 2. Deterministic monitoring and contract preparation

- [x] 2.1 Implement `dev:watch` for verification artifacts and loopback dashboard snapshots with capped projections and state-change/heartbeat output; test oversized/unchanged state, partial result files, timeouts, disconnect, duration/output limits and watcher-only cancellation using local fixtures.
- [x] 2.2 Verify dashboard origin/redirect restrictions and output redaction with a fake local HTTP server; demonstrate no credentials reach another origin and no control/game/provider operations occur.
- [x] 2.3 Implement `dev:contract` preparation and result-summary modes using the existing version 1 validator; test explicit author scope, fresh IDs, snapshots/fingerprints, absent paths, escaping paths, existing evidence, malformed input and stale/finding-bearing results. Generated assignments must pass `node scripts/check-agent-contract.mjs <assignment> --check-source` without running their checks.

## 3. Preflight and evidence reuse

- [x] 3.1 Implement `dev:preflight` on the existing sequential software runner, mapping the current composition regressions to criteria and retaining exact exits/log paths; fixture tests must prove failed checks stop the chain and no game/provider command is dispatched.
- [x] 3.2 Add retained-evidence/source validation and criterion manifests for ledger/recovery and other declared game gates; verify valid fixture evidence passes its declared scope while missing/failed/incomplete/stale evidence returns non-ready with exact gaps, never a Phase 12 live-trial pass.
- [x] 3.3 Add package entry points and shared safe artifact/output handling without new runtime dependencies; run CLI fixture checks proving generated outputs stay in the selected ignored runtime directory, do not overwrite prior evidence and use bounded console output.

## 4. Workflow integration

- [x] 4.1 Reconcile the already-added model-guide link/proposal guidance and update remaining developer/verification workflows for Sol ownership, bounded Terra/Luna work, explicit escalation and unavailable-model handling; inspect final dispatch instructions for consistency with independent-review inheritance and unchanged gameplay Astra/subscription rules.
- [x] 4.2 Document short architecture-to-implementation and test-author packets, session checkpoints, preflight before experiment spending, resource serialization, two-failure diagnosis, stable review candidates and compact handoffs; provide one worked no-inference example whose commands and generated evidence are verified locally. Refresh the stale Plus plan fact to the user-confirmed Pro plan without changing product requirements.

- [x] 4.3 Implement and validate the task-routing table reader for exact task IDs, roles, models/efforts, rationale and escalation conditions; test complete coverage and rejection of missing/duplicate/unknown/completed tasks, malformed metadata and source changes, preserving OpenSpec checkbox parsing.
- [x] 4.4 Implement preview-first `dev:task` with explicit start, reasoned overrides and a visible bounded author session using supported Codex controls; use a fake process to verify subscription/auth/model refusal, permission preservation, dedicated-role refusal, safe argument passing, launch evidence and no retries for unknown outcomes. Extend the existing terminal helper only as needed; no real inference is required.
- [x] 4.5 Provide the next-task routing-pilot outcome template and a synthetic worked example linking selection, escalation, usage, rework and acceptance; verify unknown metadata is preserved and no comparative run or future task is automatically started. Defer the real pilot to the next separately authorized ordinary task.

## 5. Acceptance and handoff

- [x] 5.1 Delegate task-scoped acceptance verification using the current verification contract: run focused failure-path/CLI tests and `corepack.cmd pnpm verify` on final relevant source, inspect no-inference preflight success/non-ready fixtures, validate the returned contract and record exact results. No live game/model run is required or authorized by this change.
- [x] 5.2 Obtain one combined fresh-context independent implementation/documentation review, resolve actionable findings and review substantive fixes; validate the final result and retain coverage for all nine development-efficiency requirements.
- [x] 5.3 Run strict OpenSpec validation and documentation/whitespace checks; update README/handoff with actual completion, evidence, advisory-budget limitations and the next bounded action while preserving Phase 12's pause and incomplete criteria. Leave model quality comparisons for the next separately authorized ordinary task rather than launching a benchmark.

## Model routing

Recommendations for each task; acceptance checks remain in its checkbox above. The planned launcher handles author rows only; verification/review rows retain their dedicated workflows. Overrides require an explicit reason and cannot bypass role rules.

| Task | Role | Model | Effort | Rationale | Escalate when |
| --- | --- | --- | --- | --- | --- |
| 1.1 | author | gpt-5.6-terra | medium | Bounded streaming parser | Log identities or attribution semantics conflict |
| 1.2 | author | gpt-5.6-sol | medium | Reconcile several accounting representations | Unexplained cumulative or interval discrepancies persist |
| 1.3 | author | gpt-5.6-terra | medium | Explicit rate and freshness rules | Provider metadata semantics are unresolved |
| 1.4 | author | gpt-5.6-sol | medium | Aggregate budget and uncertainty invariants | Conflicting stop or reserve invariants emerge |
| 2.1 | author | gpt-5.6-terra | medium | Bounded read-only watcher | Progress or shutdown semantics cross runtime boundaries |
| 2.2 | author | gpt-5.6-luna | medium | Focused negative HTTP tests | Security oracle or redirect boundary is ambiguous |
| 2.3 | author | gpt-5.6-terra | medium | Reuse existing contract validation | Scope or snapshot ownership cannot be established |
| 3.1 | author | gpt-5.6-sol | medium | Compose runner and coverage guarantees | Checks cannot substantiate declared composition criteria |
| 3.2 | author | gpt-5.6-sol | medium | Evidence reuse depends on source boundaries | Dependency coverage or evidence meaning is disputed |
| 3.3 | author | gpt-5.6-terra | medium | Conventional CLI integration | Path containment or output contracts conflict |
| 4.1 | author | gpt-5.6-terra | medium | Reconcile documented role policy | Instructions conflict with existing authority boundaries |
| 4.2 | author | gpt-5.6-terra | medium | Document established workflows | Worked example exposes an unresolved workflow decision |
| 4.3 | author | gpt-5.6-terra | medium | Defined metadata format and rejection cases | Task identity or schema assumptions fail |
| 4.4 | author | gpt-5.6-sol | medium | Launch authentication and lifecycle integration | Supported controls cannot establish safe bounded launch |
| 4.5 | author | gpt-5.6-terra | medium | Small evidence template with known fields | Outcomes cannot be linked without ambiguous attribution |
| 5.1 | verification | gpt-5.6-luna | medium | Existing routine verifier workflow | Return unfamiliar failures to the author within budget |
| 5.2 | review | inherit-author | inherit-author | Independent review inherits authorized author | Return coverage gaps or scoped findings without role change |
| 5.3 | author | gpt-5.6-terra | medium | Evidence-backed closeout | Evidence does not establish a completion claim |
