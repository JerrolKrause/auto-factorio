# Design

## Context

See [proposal](proposal.md). The existing implementation already has a concise check runner, a bounded watcher, scoped contracts, preflight fingerprints, a task launcher and a closeout gate. The missing connection is a default execution path with reliable observational attribution and enforceable admission decisions.

Observed on 1 October 2026: `verify --game` repeats the software chain when called after `verify`; `usage.mjs` reports four workspace sessions with unknown models and 804 missing-response-identity gaps despite usable cumulative counters and turn-context model metadata. The workspace game assignments 001-006 include port conflict, invalid deadline, readiness timeout and invalid catalog-path failures before integrated acceptance. The workshop retrospective records eight corrective rounds and 30 unique findings. These observations explain scope; they are not projected savings or evidence that every repeat was unnecessary.

Relevant source: `scripts/verify.mjs`, `scripts/dev/checks.mjs`, `usage.mjs`, `watch.mjs`, `preflight.mjs`, `contract.mjs`, `task.mjs`, `change-readiness.mjs`; `scripts/game-workspace-acceptance-probe.ts`; `docs/AGENT_CONTRACTS.md`; the verification/review author workflows. The current `change:ready` checks slice declarations at closeout, not accepted predecessor slices before expansion. Contract v1 rejects unknown fields and represents executed/skipped/blocked checks, with no first-class reused status.

## Goals / Non-Goals

**Goals:** make inexpensive execution, bounded output, useful failure classification and attributable evidence the default; preserve independent review and production checks; enable diagnosis of future waste without mining raw conversation bodies.

**Non-Goals:** a general agent scheduler, external telemetry service, product dashboard, automatic model benchmark, global Codex configuration migration, gameplay evaluator redesign, or implementation of the paused workspace change. Default game model remains GPT-6 Astra/low. No speculative engine rewrite or replacement of existing observation APIs.

## Decisions

### 1. Extend one runner with a versioned execution manifest

Add `scripts/dev/verification.mjs` as the composition layer over existing helpers and expose a `dev:verify` command. Keep `verify` as a compatibility wrapper that constructs the standard manifest; `--game` and `--pause` retain their coverage. The manifest carries change/slice/candidate IDs, criterion mappings, argv-based checks, dependencies, resource requirements, allowed effects, owner, deadlines and plan reference. Arguments are arrays passed without shell interpolation; externally supplied manifests are not execution authority. An author-approved assignment supplies the command/permission boundary.

Within a candidate, deduplicate checks by command, environment allowlist, declared input digest and required observation/assertion version. Cheap validation/docs and focused regressions run before expensive launches. The software chain is shared when game/pause modes require it. Checks retain individual exit and observation verdicts; an exit 0 without the required observation cannot satisfy a criterion. Check contracts and evidence before subsequent dependent execution.

Prefer one resource-owning process per manifest. Independent software checks can run concurrently only when explicitly declared disjoint; game/browser profile ownership is serialized. Admission locking uses exclusive local ownership records with process identity; an expired heartbeat alone cannot authorize stealing a resource from an unknown live owner. Record interrupted ownership for exact reconciliation. Cleanup runs in a finally path with a separate reserve, even after budgets are exhausted. Never stop unrelated or personal processes.

Alternative: add another orchestrating model agent. Rejected as the default because scheduling, polling, report assembly and fingerprint comparisons are deterministic.

### 2. Separate admission, execution, observation and acceptance

Preflight validates installed versions without upgrading them, ports/reuse authority, safe paths, request shape/deadline arithmetic and required fake composition evidence before launching a game. Live actor readiness is necessarily post-launch and precedes action dispatch. Probe wait helpers observe both desired state and terminal errors, using bounded deadlines and exact effect identities. No generic automatic retries for mutations or unknown outcomes.

Use existing probes and live host composition. For live acceptance of this change, exercise an existing supported production probe through the new runner on an isolated project profile with deterministic provider adapters. Demonstrate prelaunch conflict refusal, successful actor/assertion checks, terminal-error handling and exact cleanup. Do not rely on completion of the paused workspace change: if its probe is not stable, use the existing workshop character/measurement probe and shared production helpers.

Assertions return named expected/actual observations, units, surface/scope, tick/window, freshness and coverage. Raw structured snapshots and logs stay local; the model sees a capped summary and retrieves relevant details only on failure. Preserve independent raw-state oracles for game measurement calibration; do not let a summary verify itself.

### 3. Bind reusable evidence to inputs, not a whole-repository hash

A check receipt records command/args, relevant source and built-output hashes, assertion/probe version, fixture/config digests, toolchain and installed game/mod versions, criterion IDs, execution outcome, evidence content hashes and cleanup. Secret configuration contributes only an appropriate opaque identity; neither values nor reusable credential hashes appear in exported reports. A receipt is reusable only when every declared dependency is known and unchanged and the current acceptance contract requires no fresh-run property. Reuse cannot establish an explicitly fresh live trial.

Prefer explicit conservative dependency sets initially. No speculative automatic dependency inference is needed. Dependency completeness is reviewed with acceptance coverage; an unknown boundary forces a check. Validate fingerprints before and after execution and prior to closeout. Persist immutable receipts and append reuse decisions rather than editing historical results. A check interrupted after a side effect remains unknown until exact reconciliation.

Contract v1 remains readable. Introduce version 2 assignment/result support for a `reused` check linked to an original immutable receipt, with original command, coverage, evidence and dependency proof. Update the validator, contract generator and readiness gate together. Never encode a reused check as newly `executed`. Legacy v1 evidence can be imported as a reuse candidate only if all v2 dependencies and integrity/cleanup proof are independently available; otherwise rerun. Old contracts are not rewritten.

### 4. Add local correlated events and reports

Store one writer-owned JSONL event stream per run/worker beneath `.runtime/development/<change>/<run>/`, plus immutable check receipts and an atomically replaced derived summary. Merge streams deterministically by event identity and causal links, not timestamp alone. Use versioned envelopes with `eventId`, `runId`, timestamp, sequence, parent event, change/slice/candidate, phase, session/assignment/check/attempt and optional invariant/finding IDs. Unknown fields needed for future compatibility remain version-controlled; malformed/truncated tails are gaps, not successful terminal events.

Event kinds cover admission, start/end, failure, reuse, cleanup, budget checkpoint, review finding/disposition, escalation and handoff. Mechanical facts come from subprocess/runner metadata. Semantic classifications have provenance (`author`, `worker`, `rule`) and evidence; unknown is a valid category. Original reviewer JSON stays immutable; a separate ledger links adjudication and follow-up to stable finding/invariant IDs. The two-correction diagnosis rule uses that invariant lineage, not string equality of error messages.

Generate bounded `summary.json` and `report.md` with phase/role/model usage where known, uncached/cached/output/reasoning subsets, attribution gaps, tool calls/output bytes where exposed, compactions, executed/reused checks, unique defects, corrective rounds, failure classes, cleanup and later reported escaped defects. Each number links to evidence and states scope. Distinguish summed process duration from elapsed run wall time and overlapping sessions. Counts of attempts are not counts of unique defects.

Default console event cap: 4 KiB; summary cap: 64 KiB, with counts and explicit truncation plus local detail references. No raw prompt/conversation bodies, credentials, environment dumps, private evaluator fixtures or hidden reasoning in shared reports. Restrict detailed logs and session reads to explicitly selected roots/descendants/mappings. Use allowlisted projections and sentinel privacy tests. Full raw logs remain ignored and operator-local; they are not included in model packets by default.

Alternative: OpenTelemetry/external dashboards. Defer until local correlated records prove insufficient; a service adds deployment/privacy cost without fixing admission or retry behavior.

### 5. Reconcile actual usage and enforce managed admissions

Extend the existing usage parser, preserving its public report compatibility or adding an explicit report version. Discover nested date directories, join proven parent relationships, parse model/effort from turn contexts, deduplicate stable response IDs when available and reconcile cumulative counters. Use each monotonic session endpoint once for aggregate totals; do not sum repeated cumulative events. A cumulative-only aggregate can be valid while response/phase/model allocation is unavailable. Track coverage separately for aggregate, phase, model, response and compaction. Counter resets and conflicting totals require explicit boundaries or unknown coverage.

Correlate events and telemetry by session and interval. Partition only when boundary samples establish deltas; otherwise retain an unallocated bucket. Never add children twice through both rollups and explicit mappings. Missing compaction attribution is visible; no fabricated compaction cost. Rate estimates require dated explicit tables; subscription balance cannot be inferred from token totals.

At managed task/verification admissions, evaluate the shared plan with closeout reserve. Stop refuses new checks/workers but permits cleanup/reporting. Unknown tokens require a recorded alternative wall-time/admission-count bound and rationale before new expensive work. The runner cannot stop independent external author reasoning or commands that bypass it; reports label such coverage gaps. These are enforced local admissions built on advisory reports, not a claim of an account-wide hard quota.

### 6. Route current models by uncertainty

As of 1 October 2026, official [model guidance](https://learn.chatgpt.com/docs/models) identifies GPT-6.1 Sol, GPT-6 Luna and GPT-6 Astra. Use explicit IDs, never a moving `latest` alias. Active routing becomes:

| Work | Model / effort | Escalation |
| --- | --- | --- |
| Deterministic execution, hashes, polling, calculations | None | Return failed/unknown facts |
| Exact acceptance/report extraction | `gpt-6-luna` / medium | Ambiguous evidence or unplanned diagnosis |
| Bounded adaptive browser/evidence checks | `gpt-6-luna` / high | Cross-component uncertainty |
| Cross-component/recovery verification | `gpt-6.1-sol` / high | Conflicting invariants or repeated correction |
| Bounded implementation | `gpt-6.1-sol` / medium | Coupling beyond packet |
| Coupled implementation | `gpt-6.1-sol` / high | Consequential unresolved design |
| Bounded unfamiliar diagnosis | `gpt-6-astra` / medium | Return unresolved discriminating evidence |
| Independent review | Inherit authorized author model/effort | Existing review rules |
| Gameplay | Existing `gpt-6-astra` / low | Existing gameplay policy |

Validate actual managed ChatGPT model/effort capabilities before dispatch; current documentation does not prove account availability. No automatic fallback to GPT-6 Sol/5.6 or another provider. The user can explicitly choose an available alternative. Migrate active developer docs/skills/examples and pending task routing at implementation time; preserve archived history, recorded actual models and deliberate legacy-parser fixtures. Do not bulk replace every `5.6` string or mutate a running/saved gameplay selection. The current planning session is not switched.

### 7. Make acceptance incremental and review follow-ups bounded

Add a pre-execution slice-plan check and per-slice acceptance records to readiness. Each scenario belongs to one slice. Independently accepted means required production criteria, negative/recovery coverage, cleanup and fresh independent review for that slice; prerequisite expansion is refused until these records are valid. Slice counts alone no longer satisfy the gate.

Proposed lifecycle: `candidate -> smoke-verified -> reviewed-with-findings -> corrected -> reviewed-clean -> acceptance-verified -> closable`. Allow zero-findings review directly to reviewed-clean. Corrections need affected checks and review of fixes/adjacent dependencies; final acceptance may reveal a new defect and return to corrected. No terminal state is granted just because the round limit or budget is exhausted. Preserve unaffected evidence with explicit references. Update workflow instructions and readiness validation together, accepting legacy manifests only under their existing semantics, never promoting an old label to new coverage.

Keep automatic compaction defaults. At an accepted slice boundary a fresh author can receive a bounded packet of decisions, fingerprints, invariant/finding IDs, evidence, resources and remaining plan. No forced compaction cadence or global configuration edit. A new context or worker does not reset usage.

## Risks / Trade-offs

- Incomplete dependency sets can reuse invalid evidence -> conservative declared boundaries, reviewer scrutiny, integrity checks and unknown-means-rerun.
- Telemetry formats change -> sanitized real-shape fixtures plus synthetic resets, mixed models, missing IDs, nested descendants and duplicates; explicit coverage dimensions.
- Labels can hide uncertainty -> separate observed facts from attributed classifications; retain unknown and immutable original evidence.
- More tooling could recreate the overhead -> one manifest and derived reports, reuse existing contracts/helpers, no second status ledger or mandatory extra agent.
- Review-first final acceptance can find late bugs -> require early production smoke and transition tests; preserve independent final coverage after every substantive change.
- Workspace edits overlap active model/task guidance -> snapshot exact files, reconcile current content, restrict migration to routing recommendations and do not claim other changes complete.

## Migration Plan

1. Slice A: telemetry/event reports and model capability routing; accept with sanitized local fixtures and fake managed discovery, no provider inference.
2. Slice B: runner, preflight, receipts/reuse and contract v2; accept with no-inference fixtures plus one bounded existing production game probe through the runner. Limit live acceptance to two owned launches or 15 minutes, reserving cleanup; on exhaustion leave it incomplete with diagnosis, not another automatic run.
3. Slice C: slice admission, review lineage/escalation, handoffs and integrated documentation. Accept fake multi-slice/review histories and the final combined gate. A later ordinary task may supply real savings observations; it is not launched by this change.

Each slice receives independent review and criterion-level evidence before dependent expansion. Final gates include `pnpm verify`, targeted runner/contract/usage tests, strict selected OpenSpec validation and reviewed source-matched readiness; browser checks apply only if implementation touches browser behavior. No gameplay inference is required. Rollback keeps old evidence readable, disables new admission wiring and restores prior commands; never delete retained results or represent interrupted effects as safe to replay. Active workflow/model changes land together after validation; planning alone changes none of them.
