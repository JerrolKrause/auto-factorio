# Production-chain observations delta

## ADDED Requirements

### Requirement: Supported item and fluid stage observations

For the declared normal-quality deterministic chain envelope, ordinary observations SHALL support furnace, chemical and refining item/fluid production, consumption, relevant stock and selected boundary delivery with units, game-tick windows, scope identity, coverage and evidence. Fluid precision/error bounds SHALL be calibrated and declared. Unsupported mechanisms, changed recipes, missing samples, membership changes or restore discontinuities SHALL yield explicit partial/unknown affected measurements. Whole-force totals or net stock differences SHALL NOT replace scoped gross production/delivery, and unsupported bonuses SHALL NOT be silently omitted. All evidence SHALL come from authorized ordinary state or public instrumentation, never private evaluator/reference data.

#### Scenario: S4-02 Measure mixed stages with honest coverage

- **WHEN** an agent observes a smelting/refining/chemical chain and a recipe change or restore interrupts one stage's measurement window
- **THEN** supported uninterrupted item/fluid stages retain their scoped measurements and calibrated bounds, while the affected window is partial/unknown with its reason; force-wide counters and stable tank stock do not manufacture missing production evidence.

### Requirement: Evidence-linked production-plan status

Agents and operators SHALL be able to inspect a plan revision's stage/task progress, target and required input rates, nominal capacity, observed rates/stocks, sustained exceptions and linked evidence within authorized bounded views. Status SHALL distinguish measured shortages/blockage/utility symptoms, deterministic capacity constraints, suspected causes and unknowns. It SHALL NOT claim root cause solely from idle status, treat construction completion as output, or award scenario success. Existing watches SHALL coalesce unchanged samples and preserve pause, Stop, scope and budget rules.

#### Scenario: S4-03 Diagnose without inventing causality

- **WHEN** a target falls short and one stage has a measured input deficit while another has insufficient observation coverage
- **THEN** status identifies the first deficit with its interval/evidence, labels the second unknown, separates any diagnosis hypothesis, and leaves independent verification status unchanged.

#### Scenario: S4-04 Inspect live and restored progress

- **WHEN** an operator opens live activity or an authorized agent replaces its session during chain construction
- **THEN** both can recover the relevant plan revision, stage/task links and blockers with bounded drill-down, and neither view reveals evaluator-only evidence or presents missing measurements as zero.

### Requirement: Engine evidence for production-chain support

Acceptance SHALL establish supported facts, calculation delivery, construction and observation through production tool/runtime entrypoints in dedicated Factorio runs. Sulfur at 1 item per game second from crude oil and water with declared power/equipment/research SHALL be built through legal-character gameplay tasks and both workshop construction modes. Five consecutive 60-game-second windows SHALL each show at least 60 fresh sulfur produced and delivered, with sufficient upstream refining/chemical evidence and no undeclared intermediate source or stock-only credit. Advanced refining/cracking SHALL receive a separate physical co-product/connection check. Scripted references SHALL be labeled deterministic evidence rather than autonomous model success. Missing required live evidence SHALL leave acceptance incomplete.

#### Scenario: S5-01 Sulfur through production tools

- **WHEN** deterministic references use the production planning tools and existing task/build interfaces for ordinary character gameplay and both workshop modes
- **THEN** each sulfur chain meets every fresh production/delivery window with declared boundary and upstream evidence, and character paths preserve reach, timing, inventory accounting and command receipts.

#### Scenario: S5-02 Fluid co-products and false success controls

- **WHEN** a real refining/cracking reference is tested with declared product demands, then a required supply is removed or a required co-product outlet is blocked, and preload/undeclared-intermediate bypasses are attempted
- **THEN** the valid reference operates with accounted outputs, negative controls produce the corresponding deficit/blockage or invalid evidence, and none earns a fresh-chain success from stored or injected intermediates.

#### Scenario: S5-03 Physical cancellation and restore

- **WHEN** legal chain construction is cancelled or restored with a lost placement acknowledgement and later resumed through reconciliation
- **THEN** receipts/world evidence establish completed effects, no duplicate placement or inventory consumption occurs, and post-restore measurement windows start with explicit new coverage.
