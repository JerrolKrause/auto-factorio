# Production-chain planning

## Purpose

Give gameplay and workshop agents authoritative, bounded production networks and deterministic calculations that connect a target to explicitly permitted supplies and can survive session replacement.

## ADDED Requirements

### Requirement: Searchable installed production facts

The system SHALL expose bounded product search, producing-recipe discovery, compatible-machine facts, and research/permission blockers from the effective installed game. Results SHALL distinguish product identity from recipe identity, items from fluids, surface and quality, fluid constraints, immutable prototype facts and current force availability. Machine facts SHALL include the geometry and fluid connection information required to design supported stages. Aliases SHALL resolve to canonical products or explicit alternatives; ambiguous aliases SHALL NOT silently choose a product. Game/mod and fact-schema/content identity SHALL accompany facts and calculated plans.

#### Scenario: S1-01 Discover products without recipe IDs

- **WHEN** an agent searches for blue circuits, yellow science, or petroleum gas without supplying a recipe ID
- **THEN** results identify canonical products, their available or blocked producing routes, compatible machines and relevant unlock requirements, without assuming a recipe shares the product's name.

#### Scenario: S1-02 Effective facts and changed availability

- **WHEN** Space Age changes a recipe category, research changes availability, or the installed fact fingerprint changes
- **THEN** the system uses effective categories and fluid connections, refreshes mutable availability separately, and identifies affected calculated plans as requiring revalidation rather than reusing stale compatibility.

### Requirement: Explicit production boundaries and completeness

A production request SHALL declare its target, surface/profile, permitted external supplies and capacities, finite stock, utilities, construction allowance and permitted co-product destinations. The system SHALL expand every required internal product to a selected producer or an explicit unresolved prerequisite, aggregate shared intermediates, expose eligible alternatives and record route decisions. It SHALL NOT invent sources, sinks, research, or equipment. Missing producer knowledge, unsupported cycles/mechanics, and expansion limits SHALL remain visible and prevent a complete executable result. Supplied extraction/electricity/equipment SHALL remain distinct from manufacturing those capabilities.

#### Scenario: S2-01 Complete acceptance chains

- **WHEN** sulfur, processing units and utility science are separately planned at 1 item per game second with compatible unlocked ordinary Nauvis routes, normal quality, no bonuses, supplied construction equipment/electricity, and permitted raw inputs drawn from iron ore, copper ore, coal, crude oil and water
- **THEN** each plan includes every required internal recipe to its used boundary inputs, aggregates shared intermediate demand, identifies all needed machines/utilities, and contains no unexplained manufactured leaf or unaccounted co-product.

#### Scenario: S2-02 Unknown locked and cyclic producers

- **WHEN** a required route is unknown, research-locked, profile-denied, stochastic, spoilage-dependent, or part of an unsupported selected cycle
- **THEN** the plan identifies the affected stage and prerequisite or cycle path, remains non-executable, and neither imports the product nor chooses an unrecorded alternative.

#### Scenario: S2-03 Process and infrastructure boundaries

- **WHEN** sulfur is planned from supplied crude oil and water, and a second request instead requires extracting those resources or manufacturing its construction equipment
- **THEN** the first plan does not add ore-processing stages merely for supplied equipment, while the second reports the unsupported extraction/equipment prerequisites rather than pretending they are supplied.

### Requirement: Deterministic balanced sizing

Rate plans SHALL account for all selected recipe inputs and outputs, shared demand, external source/sink limits, and target delivery using consistent exact units. Coupled deterministic refining and cracking SHALL be supported. Every co-product SHALL have a balanced internal use or an explicitly permitted destination with adequate capacity; finite accumulation SHALL NOT establish sustained feasibility. Equivalent requests and pinned facts SHALL yield reproducible route decisions and balances. The output SHALL expose assumptions, selected routes, per-stage rates, compatible machine counts, nominal capacity, utility/fuel estimates, transport requirements and unresolved physical constraints. Nominal capacity SHALL NOT imply measured throughput, connectivity or a valid layout. Unsupported bonuses SHALL NOT be ignored. Missing facts or computation exhaustion SHALL return incomplete/unknown results, not feasible results.

#### Scenario: S2-04 Shared oil and circuit demand

- **WHEN** a utility-science rate plan shares circuit production and consumes both heavy-oil-derived lubricant and petroleum-derived products
- **THEN** shared recipe executions and co-products are counted once, combined downstream demands are satisfied, cracking and declared surplus destinations are included where selected, and the reported material balances reconcile without duplicate production credit.

#### Scenario: S2-05 Insufficient supply and blocked surplus

- **WHEN** a source cannot meet the requested sustained rate or a selected refining route has surplus without an allowed adequate destination
- **THEN** the result identifies the limiting balance/capacity and is infeasible; increasing machine counts or adding a finite tank does not make it feasible.

#### Scenario: S2-06 Machine rounding and planning assumptions

- **WHEN** a supported rate requires fractional machine capacity or optional headroom, or requests an unsupported productivity bonus
- **THEN** counts round up, target demand and headroom demand remain distinct with headroom applied once, fuel/power and transport estimates state their basis, and unsupported bonuses block affected sizing rather than being treated as zero.

### Requirement: Utilities share declared supply constraints

Machine fuel SHALL be selected from permitted compatible fuels and included with recipe consumption of the same product in one combined source-capacity constraint. Power SHALL be checked against the declared utility allowance. Missing fuel/supply or unsupported utility behavior SHALL prevent a feasible claim. Calculated operating demand SHALL remain distinct from rounded-machine full-duty bounds. When utility demand is bounded rather than known exactly, supply meeting a validated upper bound SHALL support conservative feasibility, supply below a validated lower bound SHALL be infeasible, and unresolved cases between bounds SHALL remain incomplete. Utility calculations SHALL NOT manufacture a generator, fuel source or disposal route.

#### Scenario: S2-09 Coal used by recipes and furnaces

- **WHEN** a selected chain uses coal for plastic and furnace fuel, with a source cap sufficient for the recipe alone but below combined validated operating demand, or the burner has no permitted fuel
- **THEN** the first plan is infeasible under the combined coal constraint and the second reports a fuel prerequisite; neither becomes executable from recipe-only arithmetic.

#### Scenario: S2-10 Uncertain utility demand

- **WHEN** only validated utility-demand bounds are available and supply is between them, below the lower bound, or at least the upper bound
- **THEN** results respectively report incomplete, infeasible, or conservatively feasible utility sizing, and preserve the distinction between operating demand and full-duty estimates.

### Requirement: Distinct exploration quantity and rate modes

Agents SHALL be able to explore dependencies without a quantity/rate. Sized results SHALL require an explicit mode and positive finite target with units. Finite-quantity estimates SHALL use whole crafts and disclose leftovers and initial-stock assumptions for supported routes; unsupported coupled quantity calculations SHALL return an explicit unsupported result. Neither quantity mode nor finite initial stock SHALL establish a sustained supply rate, elapsed completion time or successful physical production.

#### Scenario: S2-07 Exploration and finite stock

- **WHEN** an agent explores a target without a rate, estimates a supported finite batch, or substitutes finite stocked plates for an ongoing plate source
- **THEN** exploration has no claimed sizing, quantity estimates round crafts and report leftovers, and finite stock cannot satisfy the steady-state supply requirement; coupled co-product quantity requests are explicitly unsupported in the initial version.

### Requirement: Durable authorized bounded plan access

Plans SHALL have immutable revisions, stable stage identities, source/profile references, recorded assumptions and evidence links. Agents SHALL receive compact summaries and authorized bounded subgraph/detail retrieval instead of a full catalog dump. Search, computation, response and retention limits SHALL be declared; partial output SHALL disclose omissions and never represent a complete plan. Access checks SHALL apply to metadata, caches, continuation pages and transitive evidence as well as bodies. Read-only planning SHALL NOT create tasks or game effects. Provider replacement SHALL preserve the exact recorded plan and its limitations; changed meaning SHALL invalidate dependent evidence.

#### Scenario: S1-03 Bounded and revoked retrieval

- **WHEN** search or detail exceeds a response limit, a continuation expires, or an agent loses scope authorization before delivery
- **THEN** omissions/continuation status are explicit, expired queries require refresh, and revoked content, counts and evidence are not delivered.

#### Scenario: S2-08 Restore or cap a calculated plan

- **WHEN** a provider session is replaced, a plan is revised, or expansion/solver limits are reached
- **THEN** the exact stored revision and unchanged stage identities remain retrievable, changed stages invalidate dependent evidence, and capped results remain incomplete with no gameplay tasks or effects created.
