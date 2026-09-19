# Design

## Context

See [proposal](proposal.md) for motivation and the deltas for [operational observations](specs/operational-observations/spec.md) and [bounded context](specs/bounded-context/spec.md). Phase 13 is complete; S1/S2 are available, while S3-S5 remain future work. This is a separately selectable change, not automatic permission to start Phase 14.

The existing `CoordinationMcp` already isolates role catalogs. `AgentContext` supplies briefings, authorized world pages and archive retrieval. `DEFAULT_LIMITS` is 16,384 UTF-8 bytes and 30 aggregate array entries. `world` removes actor detail before trimming entities. Briefings pass recent command records through `paginate`; a large steps array can replace an entire outcome with an omission marker. `GameplayProvider.prepare` ordinarily resumes each role's thread. Runtime token enforcement consumes cumulative usage, not current context occupancy.

A read-only discovery experiment executed those source functions with fake adapters: 300 belts needed 10 pages / 49,924 serialized bytes and dropped the eight-stack actor from every page; 300 stocked assemblers needed 43 pages / 128,017 bytes. A 61-step partial command lost its receipt in the real briefing projection path. These are synthetic shape/size observations, not engine or model benchmarks. Raw historical trial logs were unavailable in this checkout; the documented 624,141-token trial total does not prove context overflow or its cause.

## Goals / Non-Goals

**Goals:**
- Make information sufficient for named planning/diagnostic decisions before optimizing its size.
- Keep arithmetic, sampling, aggregation, notifications and ordinary monitoring deterministic; use reasoning for priorities, plans and unfamiliar diagnosis.
- Preserve authorization, exact delivered evidence, character semantics, independent evaluation and cumulative budgets across all new views and session transitions.
- Establish executable fake and real-game coverage without making stochastic gameplay success the software acceptance gate.

**Non-Goals:**
- Prove an exact minimum sufficient context for every unexpected problem, or choose strategies deterministically on the model's behalf.
- Add a second MCP server, a general SQL/code-execution tool, vector search, model-written canonical summaries or screenshot input.
- Implement smelting/mining/planetary progression or import evaluator measurements into gameplay as a shortcut.
- Claim exact tokenizer counts from bytes, impose a hard provider context ceiling without telemetry, or launch a comparative inference campaign during proposal creation.

## Decisions

### 1. Small role views plus typed drill-down

Extend `packages/core/context` with an operational service and typed contracts, keeping Lua extraction in the mod and gateway authentication in `packages/tools`. Preserve existing tools and authorization; add a small `metrics` tool and an `inspect` tool with explicit `actor`, `command` and `machines` views. Extend world retrieval with optional filters/fields and authorized subarea selection while retaining the old argument form. Tool descriptions state units, coverage limits and when to use each view. No general scripting authority is introduced.

| Decision | Default facts | Drill-down |
| --- | --- | --- |
| Foreman prioritizes a shortage | Goal/target, recipe-derived input requirements, measured supply, stock trend, exceptions and dependencies | Selected item/window metrics and supporting observations |
| Engineer diagnoses idle machinery | Assigned work, own actor, unresolved receipts, local exception counts | Selected machines' status, recipe, inventory and power symptoms |
| Engineer continues a partial build | Command identity/revision, status certainty, progress, reason and ownership | Failed step and bounded receipts; full steps only on request |

Views use current tasks and explicit committed targets, not inference over arbitrary task prose. Add an optional validated production target to task contracts (item/quality/surface, output rate and recipe choice). If absent or ambiguous, demand remains unknown with an actionable reason. Use installed recipe facts and existing deterministic recipe arithmetic; separate ideal target inputs from actual consumption and capacity. Changing a target is a recorded plan revision, not an observation side effect.

Foreman read scopes derive from current managed tasks; engineer scopes from current assignments; solo combines both. Read scope never grants execution ownership. Detail authorization checks precede filtering, aggregate counts, cache access and continuation. Recheck after asynchronous game reads.

### 2. Measure the question, not the size of the record

Initial metric identity is `(run, epoch, scopeId, scopeRevision, surface, item, quality, metric kind)`. Each registered scope has a stable ID unique within its run; revisions are local to that ID and can coincide across scopes. Scope names resolve to authorized area/entity membership or registered public flow boundaries. Measurement history, coverage invalidation and watch inputs retain both scope ID and revision, so changing one scope cannot invalidate or overwrite another scope's measurements merely because their revision numbers match. Rates return counted quantity, start/end ticks, units per game second, sample age, coverage, source references and method version. Configured terminal rates, theoretical capacity, target requirements, measured production/consumption and measured boundary delivery are separate fields.

Implement ordinary gameplay samplers rather than reusing private evaluator traces. For S1/S2, support normal-quality assemblers and public terminal/collector boundaries; use installed production counters/recipe facts and explicit public boundary counters where needed. Stock is scoped inventory, with membership and reset detection. Stable inventory alone cannot establish gross flow. Scope-local assembler production cannot be replaced by force-wide statistics. S2 iron terminal intake is a delivery metric, not iron smelting production.

Inspection of installed engine API and calibration against controlled known flow is an explicit implementation check, not permission to approximate missing measurements. Recipe changes, new/removed entities, transfers without covered boundaries, counter resets, missing samples and restore epochs invalidate affected full-window measurements. Report a partial interval only under a distinct partial coverage label; do not extrapolate it. Unsupported mechanics remain unknown. At minimum, live S1/S2 acceptance must establish terminal intake, assembler output, recipe-supported consumption, collector delivery and stock trend for their supported stages; returning unknown for these throughout a healthy covered run cannot pass.

Default sampling is every 60 game ticks, with 10- and 60-game-second windows and a bounded rolling history of at least 60 complete samples. Make cadence/retention configurable and record them in the manifest. Pause produces no elapsed-game-time samples; reset/load installs a new epoch baseline. Querying a metric reads the materialized measurements, not another model-driven sampling loop. Cap monitored entities and scopes (proposed defaults: 5,000 unique entities and 32 scopes/run); reject additional registrations explicitly instead of producing deceptively complete partial aggregates. Deduplicate shared sampler work without broadening access.

### 3. Preserve essential execution facts and recoverable detail

Project command summaries before pagination: ID, task/revision, state/receipt certainty, completed/unexecuted counts, available failed-step index/reason and evidence/detail references. Unknown outcomes remain unknown even if the model claims success. An individual compact command response never includes the full batch by default. Give actor inspection its own budget; default engineer briefings retain actor position/activity and an inventory summary plus its continuation.

Briefings prioritize unresolved execution, ownership/steering and actionable conditions over settled history. Use compact summaries, explicit omitted-section counts and section continuations. If configured limits cannot fit the minimal execution envelope, reject that configuration or close mutation admission with an actionable context-insufficient result; do not silently drop safety-critical facts. Large sets remain paginated and mutations require the relevant command/ownership reconstruction, not that every historical page be read.

For filtered world/diagnostic enumeration, create bounded observation snapshots and opaque continuations bound to identity, task revision, filter and snapshot. Revalidate live authorization on every page; expiration yields an explicit refresh response. Snapshot tick and live staleness remain visible, and action fencing still uses current task/ownership state. Keep a bounded cache (proposed 32 snapshots/run, 30 wall-second TTL, configured byte ceiling); expiration or eviction never means an empty successful result. Aggregates cover registered scope independently of these detail pages.

### 4. Deterministic watches extend existing scheduling

Register watches only for supported authorized metrics/diagnostics and validated task targets. Persist condition state and acknowledged transition sequence separately from provider sessions. Start with versioned defaults: at most 8 watches/role, 32/run and 32 pending transitions/role; threshold persistence 300 game ticks; recovery above a configured hysteresis threshold for the same duration. Target shortfall recovery defaults to 105% of the entry threshold; zero targets do not create ratio watches. Allow explicit absolute thresholds where that ratio is unsuitable.

Coalesce unchanged states. A new transition contributes a reason to existing wake keys; it does not override admission, paused/stopped state, active-batch waiting or the run allowance. Overflow retains a gap marker and current-condition reconciliation rather than silently dropping events. On restart, reconcile cached conditions against fresh samples before delivery. Revoke or recompute watches after scope/target revisions. Healthy periodic sampling never requires an agent turn.

### 5. Bound session reuse separately from tool output

Instrument the provider/gateway boundary for prompts, tool catalogs, observable tool arguments/results, omissions, repeated observation fingerprints and public output volume. Label this delivered-byte accounting, not exact model occupancy. Preserve available per-inference input/output/cache/context usage separately from cumulative run usage. If provider events do not expose a measure, keep it unknown; do not infer subscription balance or compaction savings.

Use a configurable role session policy recorded in the run manifest. Proposed conservative fallback: request rotation after 8 admitted turns or 128 KiB of observed serialized conversation delivery since reconstruction, whichever comes first; do not assume those numbers correspond to a tokenizer/window size. A verified provider occupancy signal can also request rotation at a declared threshold. The trigger is advisory within an active bounded turn; it is not a hard cutoff on provider-internal context. Existing time/tool/run limits remain authoritative.

Rotate between turns, normally after deterministic work is settled. If work is still active, defer while deterministic monitoring continues; if the applicable stop/time policy interrupts it, use the existing acknowledged cancellation/reconciliation path. Do not cancel useful work solely to meet an approximate byte threshold. Do not start another ordinary resumed reasoning turn after the trigger: either reconstruct safely or show a waiting/blocked reason. Revoke old credentials and retain role identity, command IDs and all spent budgets.

Build the replacement packet from current durable state and fresh observations, with a persisted reconstruction gate. The packet includes committed plan, unresolved hypotheses as labeled agent claims, ownership, pending/uncertain effects, steering and active conditions. The runtime verifies required reconstruction and reconciliation before enabling mutation; a prompt asking the agent to call `replacement` is insufficient enforcement. The existing bounded-context privacy checks apply to every component and evidence reference. A failed or oversized required reconstruction stays read-only and cannot silently resume the old session.

### 6. Alternatives and evidence gates

| Alternative | Advantage | Reason not to use alone |
| --- | --- | --- |
| Only richer MCP queries | Flexible investigation | Agents still need to discover questions and accumulate old answers |
| Only fixed role summaries | Cheap common decisions | Unexpected diagnoses require detail |
| Only event/delta delivery | Avoids repeated unchanged state | Missing baselines and gaps require snapshot reconciliation |
| Only fresh contexts | Limits historical baggage | Cannot repair missing or poorly selected observations |
| Read-only query language or sandboxed code | Arbitrary aggregation | Adds execution/authorization complexity before typed tools have proved insufficient |

Choose summaries plus typed queries, durable notifications and safe rotation. This extends the existing modular architecture and leaves complex diagnosis with the model.

Deterministic acceptance uses four decision cases with an explicit required-fact oracle, not string matching to a preferred response: supply prioritization, idle-machine symptoms, 61-step partial command, and replacement with unresolved work. Compare baseline and proposed byte/call counts on fixed fixtures; include 30/300/3,000-entity stress inputs, role separation, revocation during queries and partial coverage. A two-item metric or single-command query must fit 4 KiB and one response under the default 16 KiB cap; a task briefing target is 4 KiB for these bounded fixtures. Essential facts must remain present. Large authorized result sets still paginate. Do not demand one small response for arbitrarily many tasks.

Run dedicated local S1/S2 probes with known input/output, supply starvation, output blockage, lost power, stable stock with flow, pause and save/load. Capture exact delivered evidence and compare covered values against independent engine counters/controlled transfers, with declared sampling tolerance. Verify that gameplay cannot reach evaluator causes or reference artifacts. Add a no-inference long-run/replacement fake exercising at least 100 role turns; report both maximum packet size and preservation of pending effects/budgets.

A model comparison is optional and separately authorized/budgeted: use the existing managed Astra/low profiles, identical fixtures and recorded assistance, and report decisions and spend independently. It is not needed to establish deterministic software correctness, and no stochastic benefit is claimed without it.

## Risks / Trade-offs

- Incomplete measurement mistaken for zero -> explicit per-metric coverage, epoch/membership invalidation and live calibration.
- Concise summaries hide unexpected causes -> bounded drill-down and source references; symptoms remain distinct from causal hypotheses.
- Operational instrumentation leaks evaluator information -> public observations have separate provenance and tests cover references, caches, counts and revocation.
- Frequent rotation loses reasoning or interrupts work -> durable committed plans, labeled hypotheses and turn-boundary reconstruction with safe waiting.
- Snapshot/sampler overhead grows despite small output -> bounded registrations/cache/history, deduplicated sampling and operator timing/coverage telemetry.
- Alert storms consume the subscription -> persistence/hysteresis, coalescing, gap reconciliation and unchanged admission limits.

## Migration Plan

Implement typed facts and compact outcomes first, then role views, diagnostics, watches and lifecycle integration. Preserve old world/tool calls with defaults, existing archive IDs and old run readability; absent new metadata means unknown, never fabricated historical metrics. Version observation methods and new manifest policy. Validate stricter minimal context configurations before run admission.

Use project-scoped profiles and existing lockfile/scripts. On implementation completion update context module guidance, README and handoff with supported measurements and exact evidence. Rollback disables new watches/rotation and selects the legacy observation policy for a new run; never erase durable history or bypass reconciliation in an existing run. Do not alter main specs until normal sync/archive.

## Open Questions

- Calibrate sampler tolerances and default notification/rotation thresholds during the prescribed fake and local-game checks; record changes before any model comparison. These tune the same coverage and lifecycle contracts.
- Record which additional provider usage fields the installed client exposes. The deterministic fallback is required regardless, so this does not block the design on speculative provider features.
