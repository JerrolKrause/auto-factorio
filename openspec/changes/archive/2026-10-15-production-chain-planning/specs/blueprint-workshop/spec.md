# Production-chain workshop delta

## ADDED Requirements

### Requirement: Explicit component and production-chain assignments

Workshop setup SHALL distinguish existing component mode from production-chain mode. Chain assignments SHALL pin a public production request and plan revision, resolve every selected stage's permitted recipe/machine and fluid configuration, and provision only declared external process inputs, utilities and construction equipment. Target and co-product destinations SHALL be explicit. Internal intermediates SHALL NOT become fixture sources. The designer SHALL receive bounded plan/stage interfaces and relevant installed facts from the shared planning service. Unsupported/incomplete plans or incompatible profiles SHALL fail preflight before inference or game effects. Existing single-recipe assignments/history SHALL retain their original boundaries and scores without implicit migration into chain claims.

#### Scenario: S4-05 Resolve a multi-recipe chain

- **WHEN** a sulfur chain assignment declares crude oil and water inputs, supplied electricity/equipment and compatible research
- **THEN** resolution includes refining and sulfur recipes with compatible machines/fluid interfaces, exposes only the declared external sources and output sink, and supplies no petroleum gas internally.

#### Scenario: S4-06 Preserve component mode and reject incompatibility

- **WHEN** an existing component assignment is loaded or a chain request needs a refinery excluded by its profile
- **THEN** the component keeps its original immediate-input boundary and evidence, while the incompatible chain receives a machine/profile blocker before model or game work rather than an automatically broadened profile.

### Requirement: Whole-chain reconstruction and evaluation boundaries

Both workshop build modes SHALL preserve supported multi-recipe configuration and obey their existing direct-placement or legal-character rules. Chain eligibility SHALL require fresh target production/delivery and the declared internal chain's production/consumption evidence under pinned measurement windows and boundaries. Undeclared inputs, preloads, hidden intermediate supplies, missing stage coverage and unresolved co-product accumulation SHALL NOT establish chain success. Mathematical feasibility and agent claims SHALL remain separate from measured eligibility. The planner SHALL NOT access private scorer state or modify evaluation to fit a candidate.

#### Scenario: S4-07 Validate chain configuration and evidence requirements

- **WHEN** a chain blueprint includes several recipe/machine types or its evaluation request omits an internal-stage evidence requirement
- **THEN** preflight validates every selected stage and preserved fluid configuration, and refuses an incomplete evaluation manifest rather than scoring only its last assembler; both construction modes use the same pinned chain boundary.
