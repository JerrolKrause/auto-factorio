## Context

See [proposal.md](proposal.md) for motivation and scope. The locally retained retrospective (`docs/PHASE12_SESSION_RETROSPECTIVE.md`, part of the separate uncommitted Phase 12 work) records the expensive author/review loop. `scripts/verify.mjs` already keeps logs on disk and sequences checks; `scripts/check-agent-contract.mjs` validates version 1 contracts. The ignored `.runtime/phase12/inspect-trial.mjs` demonstrates snapshot projection but has unbounded collections. Current `tests/trial-state.test.ts`, `tests/gameplay-provider.test.ts`, `tests/trial-plan.test.ts` and `tests/provider.test.ts` cover several previously missing integration cases. These working-tree files are Phase 12 inputs to preserve, not changes to recreate.

Developer role selection is distinct from the exact gameplay provider contract. Independent reviewers currently inherit the author's authorized model; routine verifiers use Luna/medium. The [model guide](../../../../docs/MODEL_SELECTION.md) records the user-approved recommendations without changing those dispatch rules during planning.

## Goals / Non-Goals

**Goals:** Small project-local commands with stable JSON results, bounded console output, fixture-based verification and explicit coverage/uncertainty. Keep judgment about scope, evidence and unfamiliar failures with the author.

**Non-Goals:** A new agent framework, live account scraping, autonomous mid-task model switching, global configuration edits, gameplay admission changes, or a hard stop mechanism for the interactive author. No paid-in-allowance benchmark campaign is needed to accept this change.

## Decisions

### 1. Reusable commands, not another orchestration service

Add narrow Node helpers under `scripts/dev/` with entry points `dev:usage`, `dev:watch`, `dev:contract`, `dev:preflight` and `dev:task` in `package.json`. Follow the existing `.mjs` developer-helper pattern; add focused tests to the existing development-test setup. Reuse `runChecks` and exported contract validation/source checking. Generated artifacts live beneath an explicitly selected, Git-ignored `.runtime` directory; reject escaping symlinks/junctions and refuse overwriting existing evidence. Read inputs without modifying logs, game state or other work. A persistent service would add lifecycle complexity to the very workflow being simplified.

### 2. Explicit session attribution and conservative usage accounting

`dev:usage` accepts a rollout directory, root thread ID, start/cutoff timestamps and optional experiment mappings. Discover children through recorded parent IDs, including descendants. Gameplay attribution requires run/session mapping evidence, never filename proximity or working directory alone. Report unrelated/internal/unattributed records separately when included in a broader inventory; do not charge them to the selected root. Stream JSONL and select numeric/model metadata; do not export message bodies, tool arguments, encrypted reasoning or credentials.

Deduplicate per-response usage by session and response identity. Include identifiable compaction requests and reconcile with the last cumulative sample rather than summing snapshots or adding both representations. For formats without per-response usage, use the last cumulative sample within each selected session/cutoff and label its coverage. If representations disagree or per-response coverage is incomplete, retain both observations, mark the total partial/unknown and explain the discrepancy. Never silently infer a complete settlement. Reasoning is a subset of output; cache is a subset of input. An incomplete trailing record can be skipped with a coverage warning; malformed interior records, decreasing counters and missing mappings must be reported. Tests use sanitized synthetic fixtures, not checked-in personal rollouts.

For a session already active at the selected start, cumulative-only interval usage requires subtracting the last baseline at or before that start; absent baselines make the interval partial. Per-response records are filtered by timestamp. Do not subtract an interval baseline from already-filtered response sums.

Optional cost estimates take a versioned rate table containing model, units, effective date and source URL. Unknown model/tier rates produce unknown components and a known subtotal; no unknown is priced at zero. Raw usage, estimates and account allowance observations remain separate. Account telemetry includes its observed time, reset/window identity and freshness; it is shared account state, not causal attribution.

### 3. Advisory session checkpoints with explicit units

A small session plan names objective, author/worker/run mappings, start time, checkpoint cadence, numeric time/token limits and optional allowance reserve, plus a closeout reserve in the corresponding units. Validate finite nonnegative values, positive limits and reserves below their limits. Any allowance reserve requires a freshness threshold; account-window resets invalidate comparisons across windows. Optional estimated-cost limits additionally require the dated rate table. The report compares aggregate usage with the plan and returns `continue`, `checkpoint`, `stop` or `unknown` plus reasons. A reached known limit takes precedence; missing data needed for another limit prevents a clean `continue`.

Check at task start, before expensive checks/inference and retries, and at plan checkpoints. The workflow stops new discretionary work at `stop` and preserves a handoff; `unknown` requires resolving the missing evidence or recording an explicit bounded decision before experiment admission. A report never grants inference permission. This is an advisory author workflow, not a claim that a script can interrupt all app/CLI inference. Existing gameplay enforcement remains authoritative. Do not hardcode a universal weekly allowance or silently choose spending caps for the user.

### 4. One bounded observer for each run

`dev:watch` accepts a verification evidence directory or a local dashboard descriptor and emits sanitized state transitions, completion/failure and a configurable sparse heartbeat. Use field allowlists, collection limits, string limits and an overall output-byte ceiling, with counts/truncation indicators and original evidence paths. Differences are computed on the stable projection; timestamps alone do not count as progress. Snapshot polling remains deterministic and introduces no model calls. Enforce poll interval, request timeout and overall duration; disconnect/stale data are explicit outcomes, not success. Ctrl+C closes only this watcher.

For dashboard reads, restrict the descriptor to project runtime data and its origin to loopback HTTP, reject redirects, send its capability only to that origin, and never print the fragment or header. No control requests, process stops, automatic reconnect launches or replayed game actions. The watcher does not reduce existing live dashboard detail; it reduces what enters developer model context. Verification/game execution and cleanup remain owned by the assigned worker.

### 5. Generate contracts while preserving human decisions

`dev:contract` takes role, objective, criteria, exact scope, commands, resources, budgets and stop/return conditions in a small input file. Compute source fingerprints including intentional absence, create a fresh assignment ID, and produce a version 1 assignment validated by the existing checker before publication. Include snapshots when existing paths have unrelated edits. Never invent acceptance criteria, infer resource ownership, execute commands, declare semantic readiness, or convert a negative result into a pass. A result-summary mode validates an existing assignment/result pair and outputs bounded findings/coverage/source status. Keep originals unchanged. No contract schema extension is needed; implementation/test-author packets remain concise scoped instructions and are not mislabeled verification contracts.

### 6. A preflight evidence manifest with no inference

`dev:preflight` runs the existing software gate sequentially, records the required integration case coverage, and checks supplied retained game evidence against explicit source dependencies. Reuse the current tests for overlapping transport calls, pause/resume, replacement evidence, empty-thread persistence and late cancellation. Include provider refusal and aggregate budget fixtures. A manifest records criterion ID, check command/outcome, artifact, relevant source hashes and coverage limits. The author selects dependency boundaries; the helper checks them mechanically. Failed, absent, stale or incomplete evidence prevents a ready result.

Real ledger-size/recovery and physical game behavior rely on source-matched reference/probe evidence; fakes cannot establish them. The command does not launch games or providers. Missing real-game evidence is returned as a bounded verification assignment for a separately authorized milestone, not manufactured or automatically regenerated. Catalog preflight is not proof of persisted provider resume. No-inference readiness is explicitly scoped to declared criteria and cannot pass the remaining Phase 12 live-trial gate.

### 7. Routing and review discipline through concise documentation

The concise `AGENTS.md` link and proposal-skill instruction are provided with this revision. At apply time update the remaining developer workflows: Sol/medium for milestone ownership; Terra/medium for clearly bounded implementation; Astra for architecture, consequential spec decisions and unfamiliar diagnosis; Luna/medium for routine verification and focused test authorship. Keep independent review fresh/read-only and on the author's authorized model/provider. Use bounded fresh worker contexts with file paths, invariants and checks; only delegate when a distinct task justifies the overhead. Test authors receive behavioral cases and stable interfaces, not only implementation to imitate. Unavailable requested models are reported, not silently substituted.

Before implementation at a new integration boundary, record a short risk/check matrix. Before review, stabilize the candidate and batch known fixes. Serialize resource-heavy game checks with timeout-sensitive suites. After two unchanged failures, return a compact diagnosis packet before another attempt; fixes still require relevant checks and follow-up review. Preserve valid evidence only with explicit unaffected dependencies. Handoffs capture current revision, decisions, criteria, evidence, remaining budget and next bounded action. Do not add fixed token targets to every file or require a planning agent for simple changes.

### 8. Task recommendations and an explicit developer launcher

Keep routing metadata in a `## Model routing` table in the existing task artifact, using the guide's six columns and exactly one row per checkbox ID. The task body remains the authority for scope and acceptance; metadata does not duplicate checks or create new authority. Roles distinguish author work from dedicated verification/review assignments. Use explicit supported model IDs/efforts, with `inherit-author` reserved for the reviewer. Reject missing, duplicate, unknown or completed task IDs, empty rationale/escalation fields and malformed/ambiguous tables. Do not infer defaults for legacy plans with no metadata; explain what is missing.

`dev:task --change <name> --task <id>` is preview-only by default. It validates workspace-local paths/metadata and prints the bounded task, role, recommended/effective model/effort and reason. Explicit `--start` begins an author session only when the task is already authorized and current model/account checks establish supported managed ChatGPT access. Preview and discovery start no inference. `--model`/`--effort` overrides require `--reason`; record the recommendation and override separately. Verification/review tasks return their workflow references rather than launching an ordinary author or bypassing contracts. Selecting a task does not mark it complete, resume Phase 12, authorize inference experiments, or broaden an existing session's scope.

Use the installed supported Codex CLI model/effort controls and preserve visible activity, subscription authentication and configured sandbox/approval controls. Inspect/reuse `scripts/codex-terminal.ps1` for the existing Windows interactive-console path; extend its parameters only as needed during implementation. Pass validated arguments without evaluating task text as shell code. Do not edit global configuration, select another provider, enable Fast mode or silently fall back when availability/authentication checks fail. A visible interactive session must be explicitly requested by `--start`; otherwise do not launch a window. Revalidate task/metadata fingerprints before launch. Record start/failure, requested model and available observed metadata in the selected ignored evidence directory, including a session ID when exposed; unavailable observations remain unknown. Do not log raw environment/auth data or automatically retry a launch with an unknown outcome.

The first version starts a new bounded task session; resuming/replacing an active author and per-turn switching are deferred. Its prompt references the task, relevant specs, existing checks and escalation conditions. Evidence-driven escalation returns a diagnosis packet for an explicit later model choice, not an automatic restart. Missing services or dependencies alone do not trigger a model upgrade.

### 9. One ordinary-task pilot, not a benchmark campaign

Provide a compact outcome template linking task/revision, routing recommendation, requested/observed model and effort, explicit overrides/escalations with reasons, available aggregate usage across linked sessions, rework, acceptance evidence and unknowns. Verify the template/report path with synthetic data. During the next separately authorized ordinary task, collect one real outcome without rerunning the task on competing models. That task's normal checks and independent review judge acceptance. Update recommendations only from concrete findings; missing usage prevents a savings claim. Preparing the template is part of this change; a completed live pilot is not its exit gate or implicit permission to start another task.

## Risks / Trade-offs

- Local rollout schemas change → fixture parsers, version/coverage reporting, conservative unknowns, no exact billing claims.
- Smaller models can create extra rework → begin with Sol ownership, compare total usage and accepted outcomes on the next authorized ordinary change; escalate bounded diagnosis instead of endless retries.
- Advisory budgets cannot stop every inference → disclose that limit; keep existing gameplay caps and require a recorded checkpoint before experiment spending.
- Source hashes alone do not prove complete dependencies or good evidence → author selects scope and independent verification/review still judge coverage.
- Working-tree Phase 12 dependencies can move → snapshot relevant inputs, mark stale manifests and leave Phase 12 status untouched.

## Migration Plan

Implement usage/checkpoints first, then watching and contract preparation, then preflight, task routing/launcher and concise workflow links. Add focused fixtures and CLI checks at each step; run the final software gate and delegated acceptance verification on the stable source, followed by combined independent review. Use synthetic/local HTTP fixtures, a fake Codex process and retained evidence; no new game/model run is required to accept these developer tools. Launcher checks exercise preview, explicit start, overrides, unsupported/unavailable models, authentication refusal, role dispatch, source changes, argument quoting and failed/unknown launches without real inference. Missing retained evidence is an expected negative path, not a reason to restart Phase 12.

No persisted product-state migration is needed. Rolling back helper commands and their workflow links leaves existing game/provider contracts intact. Keep generated evidence ignored. Model quality comparisons remain a follow-up observation during the next user-authorized change, not a prerequisite benchmark or an automatic new task.
