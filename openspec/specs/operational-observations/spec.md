# operational-observations Specification

## Purpose

Provide gameplay agents with authorized, decision-relevant operational facts computed from game evidence, so planning and diagnosis do not require routine reconstruction of raw entity pages.

## Requirements

### Requirement: Deterministic operational measurements

The system SHALL provide bounded item production, consumption, boundary delivery and stock-change measurements for explicitly identified authorized scopes. Each metric SHALL distinguish measured throughput, configured supply, nominal capacity and target-derived demand; include item/quality/surface identity, units, game-tick interval, coverage, freshness and evidence; and report unsupported or insufficient observations as unknown with a reason. Inventory differences SHALL NOT substitute for gross production or delivery. Aggregates SHALL cover their declared scope independently of detail pagination and SHALL NOT silently substitute whole-force statistics for task-local observations.

#### Scenario: Foreman compares iron and copper supply

- **WHEN** the foreman requests iron and copper metrics for a managed production scope over a completed game-time window
- **THEN** deterministic results contain those requested items' supported measurements and coverage, without requiring entity enumeration, and separate S2's configured terminal supply from observed intake and machine production.

#### Scenario: Stable stock with active flow

- **WHEN** input and output balance over a window while stock stays constant
- **THEN** the result reports zero net stock change separately from nonzero measured production, consumption or delivery rather than describing the factory as idle.

#### Scenario: Distinct scopes share a revision number

- **WHEN** two authorized production scopes have the same revision number and measure the same item, quality, surface and metric kind
- **THEN** their readings, histories and watch inputs remain distinguished by stable scope identity, and changing one scope's membership invalidates only that scope's affected coverage.

#### Scenario: Incomplete or discontinuous sampling

- **WHEN** a window spans missing samples, a restored epoch, a scope-membership change or an unsupported production mechanism
- **THEN** affected full-window metrics are unknown or explicitly partial, partial results identify their actual covered interval, and neither an assumed zero nor extrapolated complete coverage is presented as measured fact.

### Requirement: Decision-oriented role briefings

Default observations SHALL use deterministic role/task views. A foreman view SHALL prioritize goals, target requirements, measured supply and stock trends, dependency blockers and operational exceptions. An engineer view SHALL prioritize the assigned objective, ownership, own actor state, unresolved command outcomes and relevant local symptoms. Solo mode SHALL combine these views within the same response limits. Detailed entity lists, full command steps and another role's transcript SHALL require authorized drill-down rather than default inclusion. Known deterministic facts SHALL remain distinguishable from agent hypotheses and unknowns.

#### Scenario: Unrelated factory growth

- **WHEN** unrelated entities are added outside an agent's authorized task scope
- **THEN** its task view and critical facts do not grow with or reveal those entities.

#### Scenario: Low consumption is not low required demand

- **WHEN** an input-starved line consumes little but its committed output target requires a higher input rate
- **THEN** the briefing distinguishes observed consumption from deterministic recipe-derived requirements and exposes the shortfall when coverage supports it.

### Requirement: Targeted operational diagnostics

Agents SHALL be able to retrieve compact actor state, command outcomes and selected machine symptoms without scanning an entire area. Entity queries SHALL support authorized subareas, supported entity filters and field selection applied before pagination. Machine diagnostics SHALL expose observed operating status, recipe, relevant inventory shortages or output blockage, and power symptoms where supported, with explicit unknowns otherwise. Queries SHALL NOT execute arbitrary agent-supplied code or expose administrative controls.

#### Scenario: Engineer investigates an idle assembler

- **WHEN** the engineer selects an authorized assembler
- **THEN** a bounded response identifies observed recipe, input/output and power/status symptoms with tick and evidence, without returning every belt or asserting an unobserved root cause.

#### Scenario: Filtered pagination remains scoped

- **WHEN** an agent requests only assemblers and their status within an assigned subarea
- **THEN** filtering precedes counts and pagination, omitted fields stay absent, and continuation either preserves the same snapshot/filter/scope revision or explicitly requires a fresh query.

### Requirement: Authorized operational evidence

Operational queries, summaries, caches, counts, continuations and notifications SHALL enforce current role/task/agent authorization and transitive source restrictions. A bodyless manager SHALL be able to read operational facts for tasks it currently manages without acquiring character execution rights. Measurements SHALL originate from ordinary observable gameplay state or explicitly sanitized public instrumentation, never private reference layouts, fault causes or evaluator receipts. The exact delivered observation SHALL be archived separately from richer operator telemetry. Operational health SHALL NOT establish evaluator success.

#### Scenario: Revoked access and private sources

- **WHEN** a task is reassigned, an in-flight query completes after access revocation, or an agent follows an old metric/evidence reference
- **THEN** current authorization is reapplied before releasing content or metadata, and inaccessible or evaluator-only facts are not disclosed.

#### Scenario: Manager observes without a body

- **WHEN** a foreman requests metrics for its managed task
- **THEN** authorized operational facts are returned without adding an actor or granting build authority, while an unrelated role's task remains inaccessible.

### Requirement: Bounded meaningful-change notifications

The system SHALL evaluate configured operational watches deterministically in game time, emit durable scoped condition transitions and coalesce repeated unchanged samples. Thresholds, persistence duration, hysteresis, watch limits and pending-notification limits SHALL be declared before use. Reconnect or missed-event recovery SHALL rebuild current conditions from a bounded snapshot with an explicit gap indicator; unchanged conditions SHALL NOT produce model polling turns. Notification admission SHALL respect pause, stop, ownership and existing run budgets.

#### Scenario: Sustained supply shortfall

- **WHEN** an authorized watched rate stays below its threshold for the configured duration
- **THEN** one durable active-condition notification makes the responsible role eligible to wake, repeated low samples do not repeatedly wake it, and a later qualifying recovery produces a distinct transition.

#### Scenario: Restart or notification overflow

- **WHEN** a watcher restarts or its bounded pending set overflows
- **THEN** the next admitted briefing reconciles current conditions and marks the gap instead of silently losing relevant conditions or replaying an unbounded event history.

### Requirement: Measured observation sufficiency

Acceptance SHALL compare baseline and decision-oriented observations on fixed supply-deficit, idle-machine, partial-command and fresh-session cases, recording required fact coverage, bytes, calls, omissions and timing. Scaling cases SHALL test increasing irrelevant detail without losing essential facts. Real-game verification SHALL establish the supported S1/S2 measurements and diagnostics. Provider token counts, current-context estimates and cumulative expenditure SHALL be labeled separately; missing telemetry SHALL remain unknown. Reduced bytes alone SHALL NOT establish improved reasoning or gameplay success.

#### Scenario: Compact but incomplete response

- **WHEN** a candidate response is smaller but omits a required command outcome or actor fact in a comparison case
- **THEN** the case fails information sufficiency regardless of its byte reduction.

#### Scenario: No model comparison evidence

- **WHEN** deterministic and game checks pass without a separately declared bounded model comparison
- **THEN** the report establishes observation correctness and efficiency only, and leaves model decision-quality and success-rate improvement unverified.
