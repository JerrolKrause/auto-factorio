# Proposal

## Why

Agents can inspect individual recipes and submit durable build tasks, but cannot obtain a complete, calculated production chain or connect its stages to execution and measured progress. The live workshop additionally supplies the selected recipe's immediate ingredients, bypassing upstream manufacture; this prevents meaningful sulfur, processing-unit, and utility-science challenges from raw-material boundaries.

## What Changes

- Add searchable installed-game product, producer, machine, and unlock facts, shared by gameplay and workshop roles.
- Add bounded, durable production plans that expand selected routes to explicit external inputs, aggregate shared intermediates, balance deterministic item/fluid co-products, and calculate sustained rates, machine capacity, utilities, and transport demand.
- Keep exploration without a target rate available; distinguish sustained-rate sizing from finite-quantity material estimates and finite starting stock.
- Connect versioned plan stages to existing tasks, ownership, character batches, evidence, and replacement recovery. Keep layout decisions with agents and calculations/execution with deterministic code.
- Extend operational observations for supported smelting and fluid stages; compare planned demand with measured evidence without granting evaluator authority.
- Add explicit chain-mode workshop assignments with multiple recipes/machine types and only declared external supplies. Preserve existing single-recipe component behavior.
- Preserve mode and evaluation-boundary identity through library admission, comparisons and Improve; unlike supply boundaries do not share scores or inherited verification.
- Deliver in prerequisite-gated slices: facts, calculated chains, task integration, observation/workshop integration, then physical acceptance.

## Capabilities

### New Capabilities

- `production-chain-planning`: Authoritative discovery, explicit supply boundaries, material balances, sizing, and durable bounded plan retrieval.

### Modified Capabilities

- `agent-coordination`: Commit and revise production-plan stage assignments while separating construction dependencies from ongoing supply relationships.
- `operational-observations`: Supported item/fluid chain measurements and evidence-linked plan status.
- `blueprint-workshop`: Multi-recipe chain assignments, compatible equipment, and explicit external-input and co-product boundaries.
- `blueprint-library`: Boundary-equivalent comparisons and durable chain-request restoration through admission, retrieval and Improve.

## Non-goals

- **Owner-ruled:** Scenario-builder UI and map/fixture authoring are later work: "Next task after this will be a scenario builder where we put the agent in a sandbox to have it build increasingly complex factories."
- **Inferred v1 boundary:** Autonomous research, physical extraction/pumping/power generation and equipment manufacture are deferred. These are explicit supplied boundaries or unmet prerequisites; the planner never invents supplies, research, sinks or equipment.
- **Inferred v1 boundary:** Nauvis and normal-quality deterministic recipes only. Other planets, trains, quality generation, spoilage and stochastic production are unsupported. Cyclic selected routes, including recycling/catalyst loops, are rejected; ordinary refining/cracking remain supported.
- **Inferred v1 boundary:** Sizing uses base machines without module, beacon or research productivity effects; requests requiring those effects are rejected rather than calculated as if the bonuses were absent. Unsupported utility-demand facts produce incomplete sizing, not a feasibility claim.
- **Inferred v1 boundary:** Finite-quantity estimates support acyclic single-product routes. Coupled co-product integer-batch calculations return an explicit unsupported result; dependency exploration and sustained-rate oil balances remain supported. Quantity estimates do not promise completion time or sustained supply from finite stock.
- **Inferred v1 boundary:** No global factory optimization, automatic layout generator or graph editor. Nominal capacities do not prove transport connectivity or real output, and operational health does not award evaluator success. Complete calculated sulfur/blue-circuit/yellow-science plans and physical sulfur/oil probes are required; autonomous yellow-science construction and measured model-improvement claims are deferred.
- **Inferred reuse boundary:** Different supply/measurement boundaries cannot be ranked as equivalent or inherit verification. Legacy library entries with incomplete boundary provenance stay readable but need explicit new evaluation for boundary-sensitive reuse; their historical scores are not rewritten.

## Impact

Implementation paths:

- `packages/contracts/src/`, `packages/core/context/`, `packages/core/orchestration/`, `packages/core/workshop/` and new `packages/core/production/`: public contracts, planning, task linkage and shared workshop integration.
- `packages/storage/src/`, `packages/tools/src/`, `packages/factorio/src/`: durable plans, authenticated tools and game transport.
- `mods/autofactorio/`, `apps/runtime/`, `apps/dashboard/src/`: effective facts/telemetry, multi-recipe workshop resolution and operator views.
- `agents/`, `tests/`, `scripts/`: role guidance, focused software/browser checks and dedicated game probes.
- `docs/REQUIREMENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/decisions/` and `docs/IMPLEMENTATION_HANDOFF.md`: supported behavior, decisions and evidence-backed handoff.

Touches TypeScript contracts, core planning/context/coordination, storage, gameplay MCP, runtime workshop resolution, Lua recipe/machine exports and observations, relevant role prompts, and minimal plan/activity presentation. The existing blueprint and legal-character execution paths remain the execution foundation. Implementation must preserve R01-R08, R10-R18 and R19-R20 in REQUIREMENTS.

The later scenario builder consumes the public challenge/plan boundary contract but retains private evaluation and fixture ownership. Pending `af-14-ore-smelting-fuel` and `af-15-mining-power-bootstrap` retain their S3/S4 fixtures, fuel scoring, extraction, and power-bootstrap work; neither is claimed complete by this change. This proposal adds no runtime dependency by itself and authorizes no implementation or game/model run.
