# Design

## Context

See [proposal](proposal.md) for motivation and scope. The inspected baseline already supplies useful boundaries:

- `packages/tools/src/coordination.ts` and `coordination-mcp.ts`: authenticated role tools for recipe queries, tasks, batches, messages, and scoped observations.
- `packages/core/context/service.ts`: recipe facts cached by mod fingerprint with separate current availability; operational demand is immediate-only.
- `packages/contracts/src/operational.ts`: item-only targets and restricted immediate ingredient calculations.
- `packages/core/orchestration/coordinator.ts`: durable task dependencies and reservations; current completion criteria are command completion or message delivery, not sustained production.
- `apps/runtime/workshop-live-host.ts`: the installed profile contains one recipe; assignment resolution supplies its ingredients. `workshop-design-plan.ts` sizes that recipe and documents nominal-capacity limits.
- `packages/core/workshop/scoring.ts`: recursive construction-cost expansion is item-only and route-selected; it is not a production-flow solver.
- `mods/autofactorio/operational.lua`: ordinary telemetry covers selected item mechanisms, not complete fluid/furnace production. Broader workshop contracts are not evidence that ordinary gameplay telemetry supports them.

The installed Space Age files change recipe categories, including sulfur and processing units. Export effective running-game facts rather than inferring compatibility from base recipe names/categories. Existing uncommitted prompt/transport work is unrelated and must be preserved.

## Goals / Non-Goals

**Goals:** one deterministic planner consumed by gameplay and workshop; bounded public context; explainable material balances; durable stage/task linkage; engine-tested sulfur execution; complete rate plans for processing units and utility science.

**Non-goals:** see proposal. The planner does not choose a physical layout, prove transport connectivity, award scenario success, unlock research, or supply undeclared materials. The first supported operating envelope is Nauvis, normal quality, deterministic recipes, base machines without module/beacon/research productivity effects; nonzero effects must be explicitly rejected for sizing rather than ignored. Existing component workshop behavior outside chain mode remains unchanged.

## Decisions

### 1. Export effective facts once and revalidate mutable availability

Lua exports bounded pages of products, producing recipes, machine categories/speeds/energy/fuel facts, collision geometry, fluid connection positions/directions/filters and temperature constraints, plus recipe unlock relationships. TypeScript builds reverse product-to-recipe and recipe-to-machine indexes. Identity includes item/fluid kind, name, quality where meaningful, and surface; fluid temperature restrictions are preserved separately. Recipe identity is never assumed equal to product identity.

Pin facts to game/mod and export-schema/content fingerprints. Current force research, allowed recipes/equipment, bonuses and scenario constraints have separate revisions/ticks and are checked at sizing and commitment. Prototype changes invalidate calculated plans; availability changes trigger explicit revalidation. Search includes known locked producers with blockers. Aliases such as blue circuits and yellow science resolve to canonical IDs; ambiguous matches return choices.

Alternative: repeated per-recipe calls would preserve current context cost and name-discovery failures. Hard-coded recipe/category tables would drift with Space Age and mods. A full catalog is stored host-side, never injected wholesale into every turn.

### 2. Make challenge boundaries a reusable public contract

Introduce a versioned public production request containing target product, mode (`explore`, `rate`, or `quantity`), rate/unit or quantity when required, profile/fingerprint, surface, permitted external inputs, finite initial stock, supplied utilities, permitted co-product sinks, and route/machine choices. External sources declare rate limits or explicitly unlimited configured supply. Missing limits remain unknown. Construction equipment is a separate allowance; its bill of materials is not process feedstock.

For this change, raw boundary presets use iron/copper ore, coal, crude oil, water, supplied electricity and supplied construction equipment only as needed by the selected chain. They do not spawn fixtures. Extraction/power-generation requests produce unmet prerequisites until a later capability provides them. Sulfur from basic refining requires crude oil and water; ores are relevant only to equipment/infrastructure outside that process boundary.

The future scenario builder supplies this contract and owns map generation, stock, resets, and private evaluators. The planner cannot add boundary inputs, unlocks or sinks to make a plan pass. Existing component mode is an explicit boundary preset at the immediate ingredients; chain mode uses the operator's deeper boundary.

### 3. Separate route selection from deterministic flow calculation

Represent a production network with product nodes, recipe stages, and typed consumption/production edges. Co-products belong to one shared recipe stage, not duplicated trees. Distinct selected recipes producing the same product retain separate stage IDs. Aggregate downstream demand before machine sizing.

Discovery returns eligible alternatives and a deterministic suggested route with its policy recorded (prefer allowed ordinary Nauvis production, no recycling, then stable recipe ID); the agent can select/override routes. The selected route set and policy version are pinned. Missing/locked/unsupported producers remain visible blockers; branch/depth caps yield incomplete results, not new leaves. Reject cyclic selected routes with the cycle path in v1, including recycling/catalyst loops; ordinary oil refining and cracking are acyclic and required.

For rate mode, solve the bounded selected-route material-balance problem using rational quantities: production plus allowed external supply equals consumption plus target delivery plus explicitly allowed surplus disposal. All flows are nonnegative; source/sink capacities constrain them. Minimize total recipe executions for this fixed route set, then use stable recipe-ID lexicographic tie-breaking. This is a reproducible feasible balance, not global route, footprint, or resource optimization. Unselected alternate routes never appear silently. Infeasible output identifies violated balances/bounds; exhausted computation returns unknown, never feasible.

Keep exact rates through calculations. Machine count is ceiling(crafts/second * recipe seconds / effective machine speed). Report nominal capacity and configured headroom separately from target demand; headroom is applied once to the target and rebalanced, not compounded at every depth. Belt lane/trunk requirements and fluid port compatibility are constraints, not connectivity or inserter/pipe throughput proofs.

Machine utilities participate in feasibility, not just reporting. Pin a compatible permitted fuel per burner stage (the initial raw-boundary presets explicitly select coal); a missing fuel/source is an unmet prerequisite, and ambiguous choices require a recorded selection. Add fuel consumption to recipe consumption of that same product under ONE source capacity, including internally produced fuel and any supported fuel residue as balance edges. Electricity similarly draws from the declared power allowance, never an invented generator. Derive working-load demand from the selected recipe rate and installed speed/energy/fuel-efficiency facts, including supported idle drain; separately report the rounded installed machine count's full-duty upper bound. When only bounds are known, sufficient supply for the validated upper bound proves conservative utility feasibility, insufficient supply for a validated lower bound proves infeasibility, and supply between bounds yields incomplete utility sizing. Unknown energy, drain, fuel-value or residue behavior prevents a feasible claim. Headroom reruns these combined constraints once. Full-duty estimates are never mislabeled as exact operating consumption, and quantity mode reports unknown utility totals if its operating duration is not established.

Quantity mode rounds crafts and reports leftovers for supported acyclic single-product routes, explicitly separates starting stock from required production, and makes no sustained-throughput or completion-time claim. Coupled co-product integer-batch sizing returns `unsupported_quantity_balance` in v1, while exploration and rate mode remain available. This avoids quietly using fractional batches as a craftable finite plan.

Alternative: a recursive bill of materials is sufficient for some item quantities but double-counts shared oil processing and hides output blockage. Global mixed-integer factory optimization would expand scope without establishing physical buildability. A small deterministic solver may be a project dependency only after dependency/license and bounded-execution checks; the behavioral balance and tie-break rules do not depend on a particular library.

### 4. Durable plans with a small role-aware tool surface

Store immutable plan revisions and source references through the existing journal/artifact mechanisms. Plan ID/revision, stable stages, request hash, facts/profile revisions, assumptions, route decisions, balances, blockers, and evidence survive provider replacement. Preserve unchanged stage identity across revisions; changed stage meaning creates a new version and invalidates dependent evidence. Read-only exploration/calculation may persist artifacts but never create gameplay tasks or game effects.

| Tool | Inputs and response |
| --- | --- |
| `production_search` | Query/product filters and continuation; bounded canonical products, producers, machines, unlock blockers. |
| `production_plan` | Public request or prior plan plus explicit edits; immutable plan reference, status, summary, assumptions and blockers. |
| `production_inspect` | Plan revision, stage/subgraph selector and cursor; bounded exact detail and evidence references. |
| `production_commit` | Idempotency key, expected plan revision and selected stage/task assignments; durable commitment or actionable conflict. |
| `production_status` | Plan revision, authorized stage selection and window; planned/observed/unknown facts and evidence-linked exceptions. |

Use the existing role tool groups: foreman/solo plan authority can commit; engineer can inspect authorized assigned stages and submit existing legal batches, without gaining foreman rights. Workshop uses the same calculation service through its own authenticated assignment context. Pin limits for request size, products/recipes/stages/edges, solver time/iterations, response bytes, pages, and artifact retention. Defaults must fit all three acceptance chains; cap exhaustion and expired/stale continuations are explicit. Authorization is reapplied on delivery, cache hits, counts, evidence retrieval and continuations.

### 5. Bind stages to tasks without conflating flow and scheduling

A plan commit atomically records the selected stage-to-task mapping and existing task proposals. Repeated identical requests return the same mapping; changed payload under one idempotency key conflicts. Preflight validates current profile, authority, task revisions, scope, reservations, supported execution and unresolved effects before admitting work. An incomplete/infeasible plan cannot be committed as executable.

Construction dependencies remain the existing acyclic scheduler dependencies. Continuous material-flow edges are a separate relation used for commissioning and monitoring: building an assembler need not await production from its supplier. A stage has distinct design/build, commissioned-operating and observed-health states. Existing command/message criteria can close construction work; they cannot establish ongoing output or independent scenario success.

Plan edits create a new revision and reconcile affected assignments/batches under existing cancellation fences. Completed unaffected construction can be retained with matching identity/evidence; unknown effects prevent conflicting replacement. Restart reconstructs committed plan, ownership, pending receipts and fresh world before further mutation. No new execution queue or second ownership system is introduced.

### 6. Extend observations and workshop only to declared chain support

Ordinary telemetry adds supported furnace/chemical/refinery item and fluid production, consumption, relevant stocks and selected boundary delivery. Include actual effective productivity or reject unsupported mechanisms; finished-count estimates cannot be labeled complete if they omit game effects. Fluid quantities use calibrated precision and conservative bounds, with tick intervals, scope/membership/epoch identity and evidence. Recipe changes, resets, missing samples and restore boundaries invalidate affected windows. Never substitute force-wide counters for stage-local measurements.

`production_status` joins authorized stage scopes to plan rates. It distinguishes nominal capacity deficits, measured input shortfalls, output blockage, utility symptoms and unknown coverage. It does not subtract guessed flows or infer a root cause solely from idle state. Existing durable watches wake roles only on meaningful sustained transitions. Operator activity and stage summaries expose plan/revision, current stage tasks, blockers and evidence; a large interactive graph editor is deferred.

Workshop chain mode resolves the union of selected recipes and compatible machines, creates sources only for external boundary inputs/utilities, and declares all target/co-product sinks. The designer receives a bounded shared plan, stage interfaces and relevant equipment facts. Blueprint validation checks every stage recipe/machine against that profile. Existing direct and character reconstruction remain the build paths. Physical evaluation requires fresh target production/delivery plus declared intermediate-chain evidence, with no internal fixture feeds or preload credit. Finite storage of unwanted oil cannot pass as a permanent sink. Component-mode saved assignments and measured histories retain their original meaning.

Library finalization, search, evidence retrieval, Improve and ordinary reuse must carry the same boundary. Add a versioned canonical evaluation-boundary hash covering component/chain mode, product/target rates, external source identities/capacities, finite-stock policy, utility/fuel allowance, co-product sinks, surface/quality, profile/bonuses, construction/evaluation conditions and measurement windows/error rules. Compare scores only when this identity, installed compatibility and rubric match; a plan ID itself is provenance, not an equivalence key. Retain the normalized public request and immutable plan/evaluation reference in evidence keyed by blueprint content plus boundary identity, so identical native blueprint bytes measured under two boundaries can retain separate attestations without overwriting either or changing the portable content hash. Library lists and comparison queries expose/filter this identity.

Matching-boundary Improve restores the exact public request and plan provenance, revalidates current facts and creates a new run/plan revision under the same boundary. Changing a boundary is an explicit new evaluation, not an inherited Improve score or production-verification claim. Legacy component records keep their original content and scores; derive a boundary only from complete retained authoritative assignment evidence, otherwise label it unknown and exclude it from boundary-sensitive ranking/verified reuse until a new evaluation. Ordinary character reconstruction still validates actual inventory and interfaces; neither a stored chain plan nor its library attestation authorizes sandbox inputs in gameplay. Cover UI Improve and direct runtime submissions, not only library list rendering.

### 7. Acceptance and slice boundaries

Tasks assign every delta scenario to one slice. Each slice must have current source-matched verification and independent review before dependent expansion, following [development efficiency](../../../docs/DEVELOPMENT_EFFICIENCY.md). No scenario-builder implementation is a prerequisite.

- S1: live facts/search and bounded identity-aware retrieval.
- S2: complete calculated rate plans for sulfur, processing units and utility science; explicit route and boundary failures, co-products, combined recipe/fuel source capacities, uncertain utility bounds, quantity semantics, and persistence.
- S3: authorized stage commitments through production MCP/task entrypoints, restart/revision/cancellation, and continuous supply versus construction state.
- S4: production observations, multi-recipe workshop resolution, minimal activity UI, boundary-aware library admission/comparison/Improve and compatibility behavior.
- S5: physical sulfur chain at 1 item/game-second from crude oil and water, supplied power/equipment and allowed research, no modules/bonuses. Use basic refining to avoid a gratuitous disposal fixture. Validate through both workshop construction modes and a legal-character ordinary gameplay task/tool path. Require five consecutive 60-game-second windows of fresh production and delivery at >=60 sulfur each, with upstream production/consumption evidence and no undeclared source. Separately probe advanced refining/cracking under declared heavy/light/petroleum demands in Factorio to verify co-product behavior and fluid configuration; full yellow-science layout is not required.

Physical references are deterministic engineering fixtures, not autonomous model success claims. A scripted client exercising the production MCP catalog and task/plan contracts proves delivery without inference. A future separately budgeted gameplay comparison can measure reasoning improvement; no provider inference is required for this change's acceptance. Negative probes remove a required supply, block a required oil output, and attempt preload/undeclared-intermediate credit. Restore and lost-response cases establish no duplicate task/build effects.

## Risks / Trade-offs

- Coupled balances can be mathematically feasible but physically blocked -> preserve layout/transport uncertainty and require engine commissioning.
- Space Age category and temperature differences can invalidate base assumptions -> use effective installed facts and machine-fluid compatibility; test changed fingerprints.
- Broad recipe catalogs include cycles and alternative planets -> constrain by profile/surface and reject unsupported selected cycles explicitly.
- Telemetry can overstate production across recipe changes or bonuses -> invalidate discontinuities and unsupported mechanisms; calibrate fluid bounds.
- Durable stage revisions touch recovery authority -> reuse task/ownership fences and test lost acknowledgements before game expansion.
- Large context or expensive route search -> index host-side, use bounded selected routes and page stage detail; cap exhaustion remains incomplete.
- New observation support overlaps pending S3/S4 work -> share mechanism telemetry, but keep their fuel/bootstrap scoring and fixtures in their existing changes.

## Migration Plan

Add versioned schemas/tables and opt-in chain mode; treat existing workshop assignments as component mode without changing their sources, hashes, scores or evidence. Add boundary-keyed evaluation attestations alongside immutable blueprint revisions; do not overwrite an older attestation when identical content is evaluated in another environment. Legacy boundary identity follows Decision 6's complete-evidence/unknown rule. Existing `recipe`, task and build calls remain compatible. New tool capabilities appear only for authorized roles after installed-data readiness. Older records remain readable with explicit absence of plan links; do not fabricate plans for historical runs.

Before deployment, run final software, browser and relevant dedicated-game checks on matching source and update role guidance, REQUIREMENTS/README and implementation handoff with actual supported scope. Rollback disables new plan/chain admission after existing work is stopped and effects reconciled; retain immutable plan/history records and do not restore an old runtime over unresolved commands. No destructive journal migration or personal-save changes are needed.
