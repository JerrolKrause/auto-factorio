# Tasks

Implementation acceptance is complete (20/20 tasks). Current-source software, independent review and physical evidence are recorded in `docs/IMPLEMENTATION_HANDOFF.md`; the single historical gameplay-provider exercise remains unchanged.

## 1. Durable identity and history

- [x] 1.1 Add versioned group/run/attempt identities and immutable assignment links to shared contracts and journal projections; verify unchanged-brief reruns, edited-brief lineage, settings differences, comparison-series independence and legacy unknowns with deterministic contract tests.
- [x] 1.2 Implement the project workspace catalog, current-startup registration and bounded legacy dashboard import from all three roots in design Decision 3; verify an old scenario run and a workshop hosted in its journal remain discoverable from a new ordinary startup, preserve retained fixture/version identities and explicit unknowns, and test duplicate registration, crash between intent and journal writes, restart into another dashboard directory, missing journals and rejected out-of-tree paths without modifying original journals or opening games.
- [x] 1.3 Add capability-protected paginated group/run/attempt/evidence queries and stable scoped cursors; verify the two-brief/five-run/21-attempt fixture, chronological ordering, bounded reads, unavailable evidence and cross-run/reference authorization failures.

## 2. Admission and lifecycle

- [x] 2.1 Add durable exclusive game ownership before asynchronous workshop preparation and integrate existing ordinary experiment launch/resume entrypoints; verify racing requests, paused/checkpoint owners, idle startup infrastructure, request-hash collisions and same-ID response-loss retries with no duplicate inference/mutation.
- [x] 2.2 Add idempotent stop intent, pre-admission cancellation tombstones and per-phase admission checks across awaited work; verify stop during preparation/design/build/measurement/scoring/checkpoint/finalization/learning, late callbacks/timers, committed side effects and terminal-stop no-ops with deterministic adapters.
- [x] 2.3 Reconcile workspace ownership with provider/game receipts and existing profile measurement fences across runtime replacement; verify unknown effects stay blocked, exact absence/terminal receipts release safely, spent budgets persist and no publication/activation is replayed.
- [x] 2.4 Add shared typed lifecycle/outcome projections for ordinary runs, workshop runs and attempts; verify failed versus cancelled versus held, passed attempt versus active run, completed/no-valid, partial earlier success after cancellation, independent scenario verdicts and group summaries.

## 3. Evidence and feedback

- [x] 3.1 Capture redacted artifact-backed invocation envelopes at actual provider dispatch and observation/tool delivery boundaries, and expose operator-only detail reads; verify runtime-added prompt text, exact supplied context and public output, hashes/lineage, pagination, redaction, legacy gaps and denied private-context access by gameplay roles.
- [x] 3.2 Implement versioned evidence-linked critique and designer change-plan output with bounded prior-context delivery; verify a measured failure produces a concrete linked finding, the next designer receives it, successful candidates permit no findings, and malformed/unsupported feedback remains explicit without overriding deterministic scores or budgets.

## 4. Application shell and workshop setup

- [x] 4.1 Extract shared shell, navigation, run banner/status, action feedback, form/help and evidence primitives and mount the five page routes over one event connection; verify direct links, Back/Forward/refresh, invalid IDs, responsive/keyboard navigation and continued background work across page transitions.
- [x] 4.2 Move existing scenario control-room, library/Improve and workshop learning controls to the design's destination map; verify all prior roster/task/batch/measurement/advice/intervention/pause/resume/history/export/rollback/quarantine functions remain reachable, with read-only historical scope and explicit unavailable scenario actions.
- [x] 4.3 Build dedicated workshop setup with the label/help mapping, basic/advanced sections and versioned localStorage draft; verify full restore/reset, hydrate-before-defaults, preset/Improve precedence, no refresh overwrite or model fallback, storage errors, invalid versions and dirty cross-tab edits.
- [x] 4.4 Wire immediate action feedback and launch/stop reconciliation to the shared coordinator; verify feedback before delayed responses, global launch gating, lost-response refresh, Stop run before admission, ten-second unresolved explanation, accessible announcements, reduced motion and one-time focus/scroll to new run detail.

## 5. Run history and inspection

- [x] 5.1 Build group/run history and shared run detail with expandable attempts, separate run-level activity, usage and terminal summaries; verify the exact two-brief fixture, clean new-run selection, no stale inspector/page contamination and persistent historical selection while another attempt progresses.
- [x] 5.2 Build linked evidence inspection for live and completed attempts with full recorded instructions/context, messages/tools, measurements and public critique; verify long-record paging, exact short-output labeling, redacted/missing parts and no manual artifact-ID requirement.

## 6. Acceptance and closeout

- [x] 6.1 Delegate integrated software/browser acceptance on the final source using `.agents/skills/verify-change/author-workflow.md`: run `corepack pnpm verify` and `corepack pnpm test:ui`, extend meaningful regression/browser coverage for every delta scenario and preserve existing operator/workshop flows; require a validated source-matched result with all criteria covered and no substituted compile-only pass.
- [x] 6.2 Delegate dedicated local Factorio acceptance with deterministic provider adapters: launch using the supported startup path, show a visible candidate, stop during legal-character construction and fixed-window measurement, reconcile delayed/unknown acknowledgement across replacement, prove no next attempt or second owner starts and successfully launch a subsequent run; verify inventory/placement/cancellation and relevant save/load invariants, exact profile cleanup, retained UI outcomes/history and untouched personal/other project sessions.
- [x] 6.3 Execute one explicit managed ChatGPT gameplay exercise using pinned Astra/low for designer/scorer, exactly two attempts, learning off, at most four model turns/eight tool attempts/15 minutes and existing lower per-turn caps; verify captured real input/output, evidence-linked critique delivery into attempt two and designer change-plan compatibility. Stop on the budget, report actual usage/unknowns and unmet evidence, and do not automatically rerun, change models or use paid fallback. Run under the apply milestone's recorded provider budget, not during planning.
- [x] 6.4 Update README, requirements/architecture, a decision record and implementation handoff for delivered navigation, identities, controls and evidence limits; verify links/docs, `git diff --check`, strict OpenSpec validation and truthful acceptance/commit status. Preserve `npm start`, fixed localhost:3000 and diagnostic-only advanced launch commands.
- [x] 6.5 Delegate one combined implementation/documentation review through `.agents/skills/change-audit/author-workflow.md`, validate assignment/result contracts, resolve actionable findings and obtain review of substantive fixes; require source-matched final acceptance and review evidence before marking this change implemented.

## Acceptance traceability

| Delta requirement | Implementation tasks | Integrated evidence |
| --- | --- | --- |
| Dedicated destinations with shared controls | 4.1, 4.2 | 6.1 |
| Immediate accessible action feedback | 4.1, 4.4 | 6.1 |
| Durable brief scenario run and attempt hierarchy | 1.1–1.3, 5.1 | 6.1, 6.2 |
| Run-scoped live and historical evidence | 1.3, 5.1, 5.2 | 6.1 |
| Distinct execution and target outcomes | 2.4, 5.1 | 6.1, 6.2 |
| Understandable setup and saved local draft | 4.3 | 6.1 |
| Exclusive idempotent run admission | 2.1, 2.3, 4.4 | 6.1, 6.2 |
| Stop throughout the entire run | 2.2, 2.3, 4.4 | 6.1, 6.2 |
| Structured critique delivered to the next attempt | 3.2, 5.2 | 6.1, 6.3 |
| Reviewable activity and agent context | 3.1, 5.2 | 6.1, 6.3 |

## Model routing

Recommendations follow [MODEL_SELECTION](../../../../docs/MODEL_SELECTION.md); they do not switch the current session or authorize execution. Escalation means return evidence and the unresolved decision, not silently change provider/model. Verification/review roles retain their prescribed workflows. Task 6.3's developer author manages the exercise; gameplay itself uses the separately pinned Astra/low selections above.

| Task | Role | Model | Effort | Rationale | Escalate when |
| --- | --- | --- | --- | --- | --- |
| 1.1 | author | gpt-5.6-sol | high | Cross-contract durable identities; use its contract cases | Existing IDs cannot be preserved without changing recovery semantics |
| 1.2 | author | gpt-5.6-sol | high | Catalog/journal crash consistency; use migration cases | Ownership recovery and legacy discovery conflict |
| 1.3 | author | gpt-5.6-terra | medium | Bounded query surface after schemas settle; use scoped fixtures | Pagination or visibility needs a new authority boundary |
| 2.1 | author | gpt-5.6-sol | high | Admission spans runtime/operator paths; use race cases | A legitimate entrypoint cannot share ownership |
| 2.2 | author | gpt-5.6-sol | high | Cancellation crosses all awaited effects; use phase matrix | Exact effect outcome cannot be reconciled |
| 2.3 | author | gpt-6.1-sol | high | Durable restart and fences; use replacement cases | Recovery requires speculative replay or process termination |
| 2.4 | author | gpt-6.1-sol | medium | Deterministic presentation mapping; use state table | Existing evidence cannot distinguish required terminal outcomes |
| 3.1 | author | gpt-6.1-sol | high | Actual dispatch capture and visibility; use envelope tests | Required input is not observable through supported provider access |
| 3.2 | author | gpt-6.1-sol | high | Feedback/parser/context contract integration; use delivery tests | Feedback requires unavailable observations or altered scoring |
| 4.1 | author | gpt-6.1-sol | medium | Bounded React shell extraction; use route/browser checks | Shared connection/control lifecycle cannot be preserved |
| 4.2 | author | gpt-6.1-sol | medium | Inventory-based relocation; use existing-flow checks | A moved control has unmodeled live ownership |
| 4.3 | author | gpt-6.1-sol | medium | Explicit draft and form contract; use restore/error cases | Preset migration would silently change semantic settings |
| 4.4 | author | gpt-6.1-sol | high | UI/request races and cancellation; use delayed-network checks | Lost-response recovery cannot identify a unique request |
| 5.1 | author | gpt-6.1-sol | medium | Typed history/detail UI; use hierarchy/isolation fixture | Query scope cannot prevent cross-run contamination |
| 5.2 | author | gpt-6.1-sol | medium | Artifact-backed inspector; use long/short/gap records | Evidence links lose provenance or visibility constraints |
| 6.1 | verification | gpt-6-luna | high | Prescribed software/browser acceptance workflow | Required checks fail or coverage cannot be established; return evidence |
| 6.2 | verification | gpt-6.1-sol | high | Prescribed deterministic game verification | Cancellation/replacement evidence is inconclusive; return evidence |
| 6.3 | author | gpt-6.1-sol | high | Deliberate provider exercise and interpretation | Budget exhausted or schema/feedback fails; retain evidence without auto-rerun |
| 6.4 | author | gpt-6.1-sol | medium | Evidence-backed docs closeout; use documentation checks | Delivered behavior materially differs from approved requirements |
| 6.5 | review | inherit-author | inherit-author | Fresh independent completion review | Return actionable findings or unreviewed scope within assigned budget |
