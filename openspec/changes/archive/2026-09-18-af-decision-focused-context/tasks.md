# Tasks

Implementation begins only on a subsequent apply request. See [design](design.md) for chosen boundaries/defaults and the [operational](specs/operational-observations/spec.md) and [context](specs/bounded-context/spec.md) acceptance contracts. Phase 13 supplies the S1/S2 baseline; this change does not start later scenario phases. Every checkbox includes its acceptance evidence; all remain unexecuted at proposal time.

## 1. Contracts and decision cases

- [x] 1.1 Define versioned observation envelopes, metric kinds/coverage, optional validated production targets, stable scope IDs with scope-local revisions and manifest limits. Specify required-fact oracles for supply deficit, idle machine, partial command and replacement cases; verify contract rejection of ambiguous units/scope/targets and compatibility with tasks lacking new fields.

## 2. Deterministic extraction and measurements

- [x] 2.1 Implement compact command outcomes and independent actor inspection before bulk pagination; verify the 61-step partial command and 300-belt/eight-stack actor regressions, unknown outcomes, bodyless roles, large inventories and too-small response configuration.
- [x] 2.2 Add authorized subarea/type/name filters, field selection and bounded snapshot continuations to world/machine inspection. Verify filter-before-count/page behavior, machine status/input/output/power fields, scope changes during reads, stale/evicted cursors and denied transitive evidence without widening execution rights.
- [x] 2.3 Implement ordinary Lua operational sampling for the S1/S2 assemblers and public terminal/collector boundaries. Inspect installed API and notices before adapting mechanics; verify deterministic adapter cases for membership/recipe changes, counter resets, missing samples, pause and restored epochs, and record supported methods for subsequent game calibration.
- [x] 2.4 Implement scoped rates, stock trends and recipe-derived target requirements from sampled evidence, with bounded history/registrations. Verify stable stock with nonzero flow, configured versus measured supply, actual consumption versus target demand, item/quality/surface separation, unsupported mechanics, overlapping scopes and aggregate independence from detail pages. Verify two distinct scopes with identical revision/item/quality/surface/kind retain separate readings, histories and watch inputs, and a membership change independently invalidates only the affected scope's coverage.

## 3. Gameplay views and notifications

- [x] 3.1 Compose bounded foreman/engineer/solo briefings and typed metrics/inspect tools in the existing MCP gateway; preserve legacy calls. Verify current manager/owner authorization, bodyless foreman access, priority facts, section continuations, exact delivered-observation archival, role catalogs and rejection of evaluator/private cache/reference access.
- [x] 3.2 Integrate bounded durable operational watches with existing wake scheduling. Verify threshold duration/hysteresis in game time, repeated-state coalescing, recovery transitions, pause/stop and active-batch behavior, overflow gap reconciliation, restart and target/scope revocation without model polling.

## 4. Context accounting and lifecycle

- [x] 4.1 Record per-role/session observable prompt/catalog/tool-argument/result bytes, omissions and repetition plus available provider usage in operator telemetry. Verify all tool categories are counted once, missing occupancy remains unknown, and estimated context volume is not confused with cumulative tokens or subscription balance.
- [x] 4.2 Implement recorded rotation thresholds/fallbacks, safe boundary selection and a persisted reconstruction/mutation gate. Verify fresh identity lineage with old credentials revoked, pending/unknown command reconciliation, failed/oversized reconstruction, active work deferral, preserved budgets/steering/plan and no duplicate effects across at least 100 fake role turns with forced rotations.

## 5. Acceptance and closeout

- [x] 5.1 Build a reproducible no-inference comparison harness for the four decision cases and 30/300/3,000-entity scaling inputs. Verify every required fact, one-response 4 KiB limits for bounded two-item metric and single-command cases, the bounded-fixture briefing target, unchanged unrelated-scope content and a report of baseline/new bytes, calls, omissions and timing without invented token savings.
- [x] 5.2 Build and author-run dedicated project-scoped S1/S2 operational probes. Establish terminal intake, assembler production/recipe-supported consumption, collector delivery and stock trend against independent known-flow evidence; test starvation, output blockage, power loss, stable stock with flow, pause and save/load/reconstruction with exact cleanup. Record calibration/tolerances and fail unsupported required coverage rather than marking unknown as a passing measurement.
- [x] 5.3 Update context module guidance, role/tool instructions, README and implementation documentation for supported measurements, scope, uncertainty and lifecycle defaults; verify local documentation links and avoid claims of model/gameplay improvement without a comparison.
- [x] 5.4 Delegate routine final verification using the repository's verification author workflow and versioned contracts. Require final-source software checks (`corepack.cmd pnpm verify`), applicable game smoke (`corepack.cmd pnpm verify --game`), the comparison harness and S1/S2 operational/recovery probes; validate source-matched coverage and cleanup. Reuse prior unchanged-source game evidence only with an explicit justified boundary.
- [x] 5.5 Obtain a fresh-context read-only combined implementation/documentation review under the change-audit author workflow, resolve actionable findings and re-review substantive fixes; verify the final contract is valid, ready and source-matched with no remaining actionable findings.
- [x] 5.6 Record exact executed checks, supported/unknown measurements, review disposition and next bounded action in the handoff; run strict OpenSpec and documentation/whitespace checks and leave a ready implementation handoff. Do not archive, commit, publish or start another phase without the applicable user request.

## Optional model comparison

No provider comparison is required or authorized by this proposal-generation request. After deterministic acceptance, a separately requested comparison must declare fixtures, assistance, managed Astra/low profiles, turn/tool/time/token limits and stop conditions before inference. Report outcome and usage independently; absence of that comparison leaves reasoning quality and gameplay improvement unverified without weakening the required software/game gates above.

## Model routing

Recommendations follow [model selection](../../../../docs/MODEL_SELECTION.md); they do not switch sessions or authorize provider calls. Escalation is a recorded recommendation, not an automatic model/provider fallback. Verification and review retain their dedicated workflows; gameplay stays on configured Astra/low.

| Task | Role | Model | Effort | Rationale | Escalate when |
| --- | --- | --- | --- | --- | --- |
| 1.1 | author | gpt-5.6-sol | medium | Typed cross-layer contracts and explicit fact oracles | Scope or measurement semantics conflict with requirements; recommend Astra/high |
| 2.1 | author | gpt-5.6-terra | medium | Bounded projections with reproduced regressions | Outcome certainty or ownership semantics require redesign; recommend Sol/high |
| 2.2 | author | gpt-5.6-sol | medium | Pagination, snapshot and authorization coupling | Revocation or consistency invariant is unresolved; recommend Astra/high |
| 2.3 | author | gpt-5.6-sol | high | Game API sampling and reset/membership correctness | Installed counters cannot establish required coverage; recommend Astra/high |
| 2.4 | author | gpt-5.6-sol | medium | Deterministic aggregation and units across scopes | Causal attribution or recipe semantics remain ambiguous; recommend Astra/high |
| 3.1 | author | gpt-5.6-sol | medium | Gateway, identity and role-context integration | Projection could reveal restricted information; recommend Astra/high |
| 3.2 | author | gpt-5.6-sol | medium | Durable scheduling and restart semantics | Transition loss/replay or admission conflicts persist; recommend Astra/high |
| 4.1 | author | gpt-5.6-terra | medium | Bounded accounting with known event contracts | Provider events cannot be deduplicated reliably; recommend Sol/high |
| 4.2 | author | gpt-5.6-sol | high | Session, budget and mutation-fencing integration | Recovery safety conflicts or repeated unexplained failures; recommend Astra/high |
| 5.1 | author | gpt-5.6-sol | medium | Cross-component comparison with explicit fact oracles | Baseline cannot isolate the claimed benefit; recommend Astra/high |
| 5.2 | author | gpt-5.6-sol | high | Independent game calibration and recovery probe authoring | Counter/flow mismatch or restore safety needs diagnosis; recommend Astra/high |
| 5.3 | author | gpt-5.6-terra | medium | Document verified behavior and limits | Evidence contradicts supported-behavior claims; return to responsible author task |
| 5.4 | verification | gpt-5.6-luna | medium | Execute prescribed gates and report evidence | Coverage is blocked or failure needs diagnosis; return evidence to author |
| 5.5 | review | inherit-author | inherit-author | Fresh independent combined review | Scope/source changes or required evidence is missing; return gaps to author |
| 5.6 | author | gpt-5.6-sol | medium | Reconcile acceptance, findings and handoff | A required gate remains incomplete; retain incomplete status |
