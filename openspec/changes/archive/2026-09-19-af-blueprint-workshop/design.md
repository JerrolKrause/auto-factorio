# Blueprint workshop design

## Context

See [proposal](proposal.md) for motivation. Phase 13 supplies working S1/S2 scenarios, a legal character executor, evaluator-owned measurements, isolated engineer/foreman contexts and a local React dashboard. `packages/contracts/src/game.ts` currently covers walk/place/rotate/mine/recipe/transfer/craft; it does not provide a blueprint compiler or complete entity configuration. `packages/core/evaluation` and the Lua measurement adapter are science-specific, not a generic factory oracle. `apps/runtime/http.ts` already owns authenticated loopback control, and the journal owns durable history independently of browser sessions.

Decision-focused context is implemented and archived; integrate with its [operational observations](../../../specs/operational-observations/spec.md), [bounded context](../../../specs/bounded-context/spec.md) and [Decision 016](../../../../docs/decisions/016-decision-focused-context.md). Reuse scoped metrics/inspection, role briefings, durable watches, delivery accounting and the mutation gate during session reconstruction. Retained live coverage is normal-quality S1/S2 assemblers and public terminal/collector/inventory boundaries; fluids, arbitrary late-game machines and theoretical capacity are not established by that implementation. Serialized byte/call improvements do not establish token savings or gameplay quality. Phase 17 still plans retrospectives excluding automatic lesson promotion; this workshop adds the bounded tested maintenance workflow below. No Phase 14-18 implementation is implicitly started.

## Goals / Non-Goals

**Goals:** One reusable blueprint representation, independently measured results, three narrow reasoning roles, unattended operation, optional human checkpoints, and bounded autonomous maintenance with auditable activation.

**Non-goals:** See the proposal. Rich identities remain in contracts, but unsupported production mechanics or blueprint fields are rejected before simulation/construction, never silently discarded. Ordinary-run reuse supplies neither infinite inventory nor workshop placement privileges.

## Decisions

### 1. UI launch and durable session contract

Add Workshop and Library views to the existing dashboard. A user can start from a natural-language brief, a saved assignment preset, or Improve on a selected library revision. The runtime resolves the brief into a structured assignment; an optional confirmation checkpoint lets a person adjust it, while unattended mode records the resolved assumptions and proceeds only when the objective is valid. Missing required meaning produces a bounded `needs-input` outcome, not an invented target or an endless wait. A future foreman submits the same versioned assignment through its authorized interface.

The manifest freezes objective, product identities, input/output ports and supply rates, utilities, byproduct handling, target units, footprint limits, technology profile, rubric/weights, library policy, construction mode, iteration policy, measurement windows, per-port every-window acceptance and its quantization/error/stock rules (section 5), human checkpoints and all budgets. Numeric fields override ambiguous prose; unresolved contradictions fail preflight. Requests such as 60 science/minute normalize to game-time units.

Proposed initial defaults, adjustable in the UI and pinned per run:

| Setting | Default / behavior |
| --- | --- |
| Library access | Enabled; improving a chosen revision requires access |
| Model and reasoning effort | OpenAI Astra/low session default when available; optional designer/scorer/learnings overrides; validate every selection, with no automatic substitution |
| Construction | Direct placement; character mode selectable |
| Iterations | Maximum 5 design-and-score attempts, including the first design |
| Early stop | Enabled for objective met or two consecutive valid rounds with no material improvement; disable to request exactly N attempts |
| Human checkpoints | All off: brief confirmation, after each scored round, library admission, learning activation |
| Checkpoint timeout | 10 wall minutes, then finish with `review-timeout`; UI can choose skip-and-continue where the checkpoint is advisory |
| Evaluation | Requested 10x speed, 600 settling ticks then five 3600-tick windows; record achieved speed |
| Sandbox | Cleared 512 x 512 build area, expand in 256-tile increments up to a displayed configurable resource cap |
| Learning cadence | Evaluate after session; alternatives off or after a configured batch of sessions |

Exactly N attempts remains subordinate to stop, invalid state and execution budgets. No-improvement comparisons use rubric-versioned materiality tolerances; invalid measurements do not count as successful plateau evidence. Reaching the maximum with a good earlier candidate preserves the best eligible revision rather than assuming the last is best. No valid candidate is a supported final result. Turning off checkpoints cannot bypass validation or authority boundaries.

**Model options:** Store a provider-qualified selection `{ provider, modelId, reasoningEffort }` as a session default with optional per-role overrides. Initially accept only `openai` through managed ChatGPT/Codex subscription access. Display friendly model labels (for example Astra, Sol and Terra), resolve them to concrete IDs through the managed-provider catalog, and offer only supported efforts for that model (for example low, medium and high). Do not hardcode those examples as the complete catalog or assume account availability. Reject unavailable defaults, unknown providers/models and unsupported efforts before inference or game mutation; require an explicit valid choice without provider/model/effort/billing fallback. Keeping provider separate from model/effort allows later provider adapters without enabling them now.

Persist requested options and fully resolved role selections in the manifest, presets and reports. Pin them for all iterations, retries, replacement and save/load; recheck availability before new inference and expose a blocked availability outcome if a pinned choice disappears. Record the effective configuration for each invocation separately from provider-reported model/effort, which remains unknown when absent. Both scorer contexts use the scorer selection; learning behavioral trials use the target-role selection, and fresh independent learning review inherits the learnings selection. Incumbent/candidate trials hold these selections equal. Learning cannot edit operator-owned model options. User selection changes start a new session/comparison series. Ordinary gameplay defaults and developer model-routing rules are unchanged.

### 2. Deterministic orchestration and distinct roles

The core owns this persisted sequence:

```text
configure -> preflight -> design/build -> freeze/export -> measure -> score
                              ^                              |
                              +------ next iteration --------+
                                                             |
                        optional human checkpoint / finalize
                                                             |
                  library decision -> learning evaluation -> report
```

Every boundary records session, iteration, candidate hash, assignment revision, tool/instruction bundle and evidence IDs. Retries and replacement sessions reuse durable identity and spent budgets. Late scorer messages cannot modify another candidate. Objective/profile changes fork a new comparison series; advice within the existing objective records assistance. Configuration applies at acknowledged safe boundaries.

Designer is an engineer specialization with its own profile/context, shared engineering knowledge and construction primitives. Scorer critiques an immutable candidate, ordinary interaction history and measurements; library comparisons use a separate scoped invocation when the designer is blind (section 7). Neither scorer invocation can mutate the candidate, measurement logic or objective. Learnings is a separate maintenance role, activated after the session/batch, using bounded evidence queries and patch proposals through scoped tools. It is not an ordinary gameplay role with unrestricted filesystem access. Workshop roles use the pinned model/effort selections from section 1 and existing managed subscription admission; no silent model changes or fourth permanent orchestrator agent. A fresh independent review invocation is used for learning patches, not an additional always-running gameplay role.

### 3. Capability profiles and supported mechanics

Profiles resolve installed research prerequisites, enabled recipes, research levels, entity/item/module/beacon allowlists, quality and target surface properties. Profile versions and the complete game/mod fingerprint are immutable run inputs. Persist unlocked manufacturing technology separately from allowed placement inventory: supplied EM plants need not imply local production of their off-world ingredients. Prototype/recipe availability and surface legality still must hold.

Ship editable presets: starter assembly (normal quality, basic machines/yellow belts, no modules/beacons); advanced assembly (faster transport/machines with specified modules/beacons); electromagnetic production (EM plants and their applicable research/bonuses). Resolve exact technology IDs against the installed game instead of hardcoding an assumed science-pack cutoff. Custom profiles and a compatible current-run research snapshot use the same validation.

Initial coverage includes deterministic solid and fluid recipes, assemblers, furnaces, chemical/oil-processing machines, EM plants and foundries where allowed, belts/undergrounds/splitters, inserters with filters, chests, pipes/pumps, poles, lamps, modules and beacons. Require explicit deterministic byproduct disposal and fluid temperature conditions. Normal quality only initially. Power is an external utility for production components; dedicated generation/mining designs, trains, platforms, combinator programs, spoilage/quality generation and stochastic recipes return explicit unsupported scope. Basic power wiring and supported entity settings must survive export/rebuild; unsupported circuit settings are rejected, not stripped.

The sandbox uses an isolated game profile and a separate force/surface with recorded Nauvis-compatible properties. No enemies, obstacles or water placement constraints inside the cleared plot. Expansion never erases the candidate; cap exhaustion reports the required extent. Unlimited build supplies are provisioned only through workshop-owned setup services; character mode receives replenished inventory but still walks and obeys collision, reach and timing. Unlimited process supplies enter only declared fixture ports at the configured rates. Infinite supply does not mean infinite interface throughput.

### 4. One blueprint artifact, two execution paths

Use a canonical normalized blueprint document with stable entity identities, relative coordinates, directions, recipes, modules, supported settings, wires and explicit external port metadata. Native Factorio blueprint content is the interchange representation; metadata adds assignment, compatibility, interfaces and evidence. Keep layout content hashes separate from display labels and transient entity unit numbers.

The sandbox materializer validates then directly creates/configures the artifact within a workshop grant. The character compiler expands the same artifact into ordered, bounded legal actions, including work positions, recipes, modules and wire/configuration operations. New actions preserve reach, inventory, ownership, idempotent receipt and partial-failure invariants. Port labels live in blueprint descriptions and coordinate diagrams; do not add a dependency on a labeling mod.

Character construction is a real planning/execution boundary: reserve the full footprint and necessary approach area, diagnose inaccessible work positions, place in a reachable order, validate underground connections and preserve safe access. Before work, reject unsupported settings, incompatible technology, conflicts or missing material with a structured reason. Rotation/translation support uses tested coordinate/direction/wire transformations; mirroring is initially unsupported. Interrupted work resumes from receipts plus actual world state, never a blind replay. Retain distinct statuses for export-valid, production-verified and character-build-verified.

### 5. Independent hotbox measurement

Evaluate a clean reconstruction of the exported artifact, not only the designer's potentially contaminated world. Remove process inventory, recreate supported configuration and use only evaluator-owned sources/sinks at declared ports. Supplied modules/fuel are declared; preload credits, manual output, alternate hidden supply and fixture entities cannot count toward production. Freeze all production-affecting mutations and capture exact game-tick boundaries in Lua so acceleration cannot skip windows between host polls. Missing coverage invalidates an attempt.

The hotbox uses the dedicated workshop game process; game speed is process-wide and must not accelerate unrelated sessions or personal saves. Pause/stop/load reuse disarm/reconcile barriers and restore the configured speed on resume. Report requested acceleration, achieved UPS and wall time without promising hardware-independent acceleration. Character demonstration speed is configurable separately from measurement speed.

Derive output, consumed inputs, inventories/in-process stock, energy and internal stages from installed recipes and measured flow. Empty-start reconstruction, stock reconciliation and fixture isolation must pass positive and bypass controls. Support fluid identities/temperature and deterministic byproducts with explicit coverage; do not reuse the science oracle unchanged. Ratios and upper bounds are deterministic calculations, while the game remains the authority for sustained throughput.

**Sustained acceptance:** every required output port must pass every scored window; averages and excess in another window or port cannot compensate. Freeze rate `r` in units/game-second, duration `d` in game ticks, quantity quantum `q`, nonnegative calibrated absolute measurement error `e`, and per-component stock/residual limits before admission. Windows use `(startTick, endTick]` consistently. For each port/window, let `P` be fresh causal production assigned to that port and `D` net delivery at its sink; allocation must not credit the same production to multiple ports or disconnected cells. Compute lower bounds `Plo = max(0, q * floor((P - eP) / q))` and `Dlo` likewise. Required quantity is `T = q * ceil((r * d / 60) / q)`; pass only if `min(Plo, Dlo) >= T` and all stock/coverage/contamination gates pass. Use exact rational arithmetic for manifest rates/thresholds; discrete items use `q=1` and exact counters (`e=0`), while fluid quantum/error are pinned to the calibrated measurement method. Display rounding never affects verdicts. Error bounds reduce credited observations; reconciliation tolerances never lower `T` or turn a proven deficit into success.

Capture production/delivery baselines and stock, including settled output and in-process material, at the first scored tick. Settling production is excluded from `P`; opening stock cannot substitute for the per-window fresh-production minimum. Normal pipeline buffering can remain, but per-component drawdown and balance residuals must stay within separately calibrated pinned limits, never offset by stock growth in an unrelated component. A 60/minute target over five one-minute windows rejects `300,0,0,0,0` and accepts `60,60,60,60,60` only when both fresh production and delivery plus all other gates qualify. Item output 59 fails at target 60; target 60.1 requires 61. These controls and fluid values immediately below/at/above a quantized lower-bound threshold are mandatory acceptance cases.

### 6. Score vector and library value

Hard gates precede preference scores: supported/compatible artifact, complete measurement, target and interface compliance. Record every candidate, including failures; only eligible ones enter the default reusable library. The UI can inspect/export drafts with clear unverified labels.

| Dimension | Evidence and interpretation |
| --- | --- |
| Throughput | Per-port sustained items or fluid units per game second/minute; belt lane capacity and achieved saturation from installed data |
| Expandability | Declared repeat vector/upgrade stages; measured 1x/2x/3x/4x where claimed, connection changes and removed/replaced entities; untested claims labeled unverified |
| Space | Bounding rectangle, occupied tiles and required access/interface clearance, plus output per area |
| Resource efficiency | Fresh input per useful output, byproducts, productivity/research and energy; compare equivalent boundaries |
| Connectability | Port coordinates, directions, lanes/fluid constraints, required clearance and external crossing burden; qualitative explanation plus connection tests |
| Construction cost | Itemized bill of materials, modules and wiring; raw-resource vector under a versioned acquisition recipe model, plus numeric aggregate only with declared weights |
| Aesthetics | Minor optional weight; structural alignment/symmetry/lamp heuristics and labeled subjective judgment, no mandatory screenshot vision |
| Interaction quality | Separate report on rejected calls, unnecessary rebuilds, unknown-outcome handling and token/tool usage; does not alter measured factory output |

Score weights, tolerances and the target are frozen before iteration. Throughput beyond target need not outweigh extra cost; the assignment defines that preference. Keep Pareto-useful alternatives across cost, footprint, compatibility and expansion. A dominated variant can still be retained for a documented distinct interface or purpose; reject duplicates without deleting history. Novelty is not a guaranteed inference about everything ever built.

Raw cost is a vector, not a universal ore price: alternative recipes, off-world acquisition and productivity can make a unique scalar misleading. Record selected recipe route and bonus assumptions; unavailable conversion stays unknown, never zero. Keep construction material cost separate from operating input efficiency. Compare different technology profiles only with those differences explicit.

### 7. Library structure and human portability

Store local versioned data outside tracked source by default, with a configurable project-local library root. SQLite indexes immutable documents; disk records can rebuild the index. Suggested layout:

```text
<library>/components/electronic-circuit/<family-id>/<variant-id>/
  manifest.json
  revisions/<revision-hash>/blueprint.json
  revisions/<revision-hash>/blueprint.txt
  revisions/<revision-hash>/metadata.json
  revisions/<revision-hash>/evidence.json
<library>/books/<book-id>/manifest.json
```

Use installed product IDs for folders, stable IDs for identity, and editable human labels such as `Green circuits | starter | 15/s | tileable`. Variant slugs can summarize machine/transport/module differences but labels never determine identity or compatibility. Tags/search cover product, recipe, technology, machine, rate, quality, surface, footprint and status. Revisions record parent/fork lineage and provenance; admission is transactional and concurrent promotions cannot overwrite each other.

Exports include native blueprint strings or blueprint books, descriptions with requirements/ports, and an optional portable metadata/evidence summary bundle. Export excludes provider transcripts, credentials, temporary fixtures and Factorio binaries. Verify reimport and operation in a clean compatible game without the AutoFactorio mod. Local export is in scope; publishing externally is not.

For library-disabled sessions, create two isolated scorer invocations under the same role definition: designer-facing critique sees only the assignment, candidate, authorized interactions, measurements and library-independent knowledge; private comparison sees compatible library layouts but writes only to the operator/admission channel. They have separate provider sessions, credentials, history/search scopes and replacement briefings. No free-form comparison text, summary, suggested patch or admission rationale is delivered to the critique invocation or designer. Private comparison cannot steer design iteration/early stopping; those use the blind critique and deterministic candidate metrics. Perform private admission comparison at finalization. This boundary prevents paraphrased layout suggestions as well as literal blueprint leakage; keyword redaction or asking a library-informed model to sanitize itself is insufficient.

Provenance restrictions also apply to learned instructions/helper bundles and retrieved lessons: anything derived from hidden comparison/layout evidence is unavailable to blind sessions. General lessons can be reused when their entire supplied-context lineage is library-independent, or regenerated in a clean context from independent evidence without private hints. The runtime routes by provenance, not a model's claim that text is generic. Reconstructed sessions retain the same restrictions. Private results remain fully inspectable by the operator. This is controlled library isolation, not a claim of model pretraining novelty.

### 8. Learning authority and bounded growth

Reference reviewed: `C:/_Projects/agent-graph/kit/skills/learnings/SKILL.md`. Adapt its durability ladder, probation, provenance, deduplication, scoped retrieval, recorded rejection and retirement. Do not copy its Claude-specific paths, external PR flow or its recommend-only code policy. Inspect applicable notices before copying any scripts; the initial implementation can implement the small data contracts independently.

Use the lowest-cost reliable enforcement layer: existing validator/lint/config guard, deterministic script/tool behavior with regression tests, scoped retrieved lesson, then concise role instructions when judgment is required. A code bug earns a tested correction, not a permanent reminder to compensate for it. A lesson stores an ID, concise check, evidence, affected scope, review/retire condition and validation state. Incident narratives remain in history.

The learning role can propose patches only to a registered set of designer/scorer instruction modules, scoped lessons and production-design helper modules. A maintenance service applies them in an isolated staging copy using allowlisted patch and test operations; no shell strings, arbitrary execution tools, dependency installation, network access, secrets or edits to the user's dirty checkout. Tool implementation tests execute through a fixed runner in an OS-enforced environment with only the staging area writable. Unavailable isolation makes code updates proposal-only for that run; it does not block blueprint delivery or request mandatory human action.

**Activated execution uses the same confinement contract.** Never import learned executable modules into the privileged runtime process. Each invocation runs the pinned immutable helper bundle in an OS-isolated worker with read-only code, private bounded scratch space and no host filesystem, inherited credentials/environment secrets, network, child-process creation or raw game/admin access. Inputs are size-limited schema-validated snapshots already authorized for the caller; outputs are bounded schema-validated results or proposed action plans. The trusted gateway, outside the worker, checks caller identity, grants, current revision, inventory and remaining budget before submitting any proposed action through the existing executor. Helpers receive no gateway credentials and cannot directly authorize or dispatch effects. Invocation wall/CPU/memory/scratch/output quotas are finite, operator-owned and frozen in the execution policy. Runtime checks the code/policy hashes and confinement before launch; policy loss, timeout, malformed output or forbidden access terminates the worker, rejects its output and records a failure without an unsandboxed fallback. Already dispatched gateway actions still reconcile through ordinary receipts. Test forbidden access after successful activation in a later session, not just in staging; unavailable confinement leaves the helper unusable without forcing human approval or invalidating an already completed blueprint.

Protected surfaces are the objective/rubric semantics, measurement oracle and private control fixtures, permission/budget/provider boundaries, activation/review gates and the learnings role's own criteria. Scorer diagnostic reasoning can improve, but target lowering or altered pass semantics cannot be activated by learning. Protected proposals are recorded for optional later human action and never pause unattended runs. Tool catalog additions require a demonstrated capability gap and a catalog budget check; prefer correcting/consolidating existing tools. Existing core gateways are not writable merely because a helper calls them.

Default maintenance budgets: at most three candidate changes and one activation bundle per session/batch; at most two patch attempts per candidate; ten active role-method lessons per role; 16 KiB of UTF-8 role-specific instructions plus injected learnings per briefing, alongside existing overall context limits. These are versioned operator settings, not writable by the learning role. Record token estimates separately from bytes. Repeated no-change or rejected candidates are deduplicated with a revisit condition, not re-proposed every session. Maintenance has its own reserved share of the aggregate run/batch inference budget and cannot create unlimited nested trials.

Knowledge volume and prompt volume differ. At caps, merge duplicates or move still-valid specific knowledge to narrower retrieval scopes; record retirements only for obsolescence, wrong advice or replacement by a stronger guard. Do not delete a useful lesson merely to free space. Deterministic retrieval prioritizes applicable evidence, reports omissions, and never bypasses the prompt cap. No-change/defer/reject is normal; growth and number of edits are not success metrics.

Activation sequence: evidence-backed candidates -> assemble final immutable bundle -> deterministic checks against an unchanged baseline suite -> bounded representative behavior trials if required -> fresh read-only independent review -> atomic version activation for future sessions. A bundle manifest hashes every effective instruction, helper and dependency, retrieval/catalog configuration and execution-policy reference. Every check, trial and review attests the exact resulting bundle hash, expected incumbent hash/generation, control-suite and environment versions. Individual patch passes are diagnostic only: all required gates run on the final combined bundle, including interactions between instruction and helper changes. Any edit after validation invalidates its attestations. Keep the originating failures and at least one unrelated representative case; behavior-changing instructions require fresh bounded provider trials, not lint alone. Compare incumbent and final bundle under the same assignments, profile, rubric and budget. Validation scripts and held-out fixtures are not editable by the candidate. Failed/inconclusive checks or insufficient reserved budget defer activation. Retain tradeoffs and uncertainty; one trial does not establish a broad capability gain.

Activation atomically compares the current incumbent hash and monotonic activation generation with the attested values, verifies the final bundle bytes/policy, then advances the generation and pointer once under a durable operation ID. A competing activation or rollback changes that generation, so stale attestations cannot activate even if the old hash later reappears. Rebase/reassemble and repeat validation/review against the new incumbent; never silently merge passing patches. A lost acknowledgement reconciles the existing activation record before retry. Acceptance includes two individually passing patches whose combined behavior fails, post-review byte changes, and two contenders with the same expected incumbent.

Active sessions pin their bundles. Rollback or disablement selects an earlier verified version for subsequent sessions; it never hot-swaps an in-flight tool or undoes already built factories. A cumulative regression across later sessions can quarantine the new version. The UI shows evidence, diff, tests, review, activation and rollback together. Optional human approval is another configurable checkpoint, off by default; all automatic validity gates remain mandatory.

### 9. Observability, usage and recovery

Extend the existing event projections, not a second polling model. Show current phase/iteration, role activity, score vector and feedback, candidate diffs, best eligible result, learning decisions/diffs, validation/review, library admission and usage. Final-result-only presentation suppresses optional intermediate UI expansion/notifications, not recording or access to live activity. Closing the browser cannot halt the run. Replay is an inspection feature, not a promise of deterministic model replay.

The context inspector links exact supplied instructions, selected lessons/library IDs, messages, tool schemas/calls/results and provider-visible activity with session/replacement lineage. Label available content, truncation, redaction and retention gaps; it is not an exact view of hidden model cognition. Operator visibility does not grant that visibility to other gameplay roles. Redact credentials; evaluator-private cases never enter gameplay briefings or shareable blueprint bundles.

Deduplicate provider usage by source event/session; distinguish cumulative counters from increments. Account per role, iteration, design session and learning batch, including failed/retried/replaced sessions and validation/review invocations. Each invocation belongs to exactly one accounting owner; batch learning exposes references to contributing design sessions without charging every session the full batch. Preserve input/output/cache detail only when provided; missing remains unknown. Subscription allowance is not inferred from tokens. Show monetary cost as unavailable without actual billing evidence; any optional user-priced estimate is labeled with its basis and never implies API billing.

Pause, stop, disconnection and save/load use existing acknowledged fences; checkpoints freeze game production and inference while independent wall deadlines continue. On stop/exhaustion, finalize partial evidence and defer unfinished learning. Recovery reconciles pending placement, evaluation, library admission and bundle activation with durable operation IDs before retrying. A stopped run does not silently resume to spend additional inference.

## Risks / Trade-offs

- Generic flow measurement is more complex than S1/S2 -> implement typed coverage and live bypass controls before allowing supported recipes to pass.
- Exported settings can differ from a designer world -> reconstruct and round-trip the actual artifact; fail unsupported fields before construction.
- Automatic learning can optimize the scorer instead of the factory -> fixed objectives/oracle, immutable controls, independent review and incumbent comparisons.
- Strict library blindness conflicts with detailed competitor feedback -> retain full comparisons for the operator/scorer, deliver candidate-local critique to the designer.
- Unlimited supplies can hide illegal character construction -> separate setup provisioning from normal executor receipts, then prove reuse with finite inventory.
- Expansive supported mechanics -> staged tasks with explicit acceptance gates; no full completion claim from the first solid-item example.
- Automatic patch execution is a new trust boundary -> scoped service and OS isolation; fail closed to deferred changes when unavailable.

## Migration Plan

Implement as an opt-in workshop mode, with versioned manifests and rebuildable local library indexes. Update REQUIREMENTS/README and Phase 17 overlap notes during implementation to record the approved scope without rewriting prior benchmark acceptance. No external blueprint import or user-library migration is required for this feature.

Deliver in bounded slices: contracts/profiles; library/serialization; sandbox and both construction paths; measurement/scoring; UI and durable loop; staged learning and activation; final character-reuse and unattended acceptance. Existing runtime safeguards are dependencies, but unrelated unimplemented scenario milestones are not prerequisites. Disable workshop admission to roll back the feature; preserve artifacts and journals, return future learning sessions to the prior bundle, and never delete user data or alter personal saves.

## Validation and completion

Task-level acceptance is in [tasks](tasks.md) and the three delta specs. Required final evidence includes software and browser checks, real-game direct and legal character builds, native export without the mod, modules/fluids/EM or foundry profile cases, expansion and bypass controls, in-flight pause/save/load recovery, and a budgeted visible managed-provider workshop exercise. Demonstrate a five-attempt unattended loop with early stop disabled and a separate checkpoint-enabled case. Demonstrate both a no-change learning result and a beneficial validated update consumed by a later fresh session; an unproven update stays inactive. Dedicated developer verification and independent review remain required. Planning validation does not establish any of these implementation outcomes.
