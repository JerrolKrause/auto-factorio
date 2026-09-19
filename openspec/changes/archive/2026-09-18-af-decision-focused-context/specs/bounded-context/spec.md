# Spec Delta

## MODIFIED Requirements

### Requirement: Bounded three-level memory

Gameplay context SHALL consist of a task-local briefing, scoped detail and authorized archive retrieval, with configurable byte/entity limits, pagination and explicit omissions. Canonical memory SHALL derive from durable task/game evidence. Briefings SHALL prioritize compact decision and execution facts over bulk detail, and provide bounded authorized continuations for omitted material. A full detail page SHALL NOT silently remove access to the agent's current actor state or the known/unknown outcome of a command.

#### Scenario: Bounded three-level memory acceptance

- **WHEN** an engineer is assigned a new area after a long run
- **THEN** the briefing contains its objective, reservations, recent outcomes and unresolved steering within bounds; the full map and foreman transcript are not injected automatically.

#### Scenario: Large command outcome remains usable

- **WHEN** a 61-step command partially completes but its full steps and receipts exceed response limits
- **THEN** compact command retrieval preserves command ID, revision, known/unknown status, completed and remaining counts, available failure reason and detail reference without requiring the agent to reconstruct a chunked payload to learn its outcome.

#### Scenario: Actor facts survive full world pages

- **WHEN** the engineer inspects an area with 300 belts and carries eight inventory stacks
- **THEN** its position, activity and inventory remain available through a bounded dedicated actor response or an explicitly retained actor section, independently of entity-page fullness.

## ADDED Requirements

### Requirement: Context delivery accounting

The runtime SHALL record per-role/session delivered input and tool-result bytes, tool-call counts, explicit omissions and repeated-observation indicators, and preserve available provider input/output/cache usage separately from cumulative run totals. Estimates SHALL identify their method and scope and SHALL NOT be represented as exact provider context occupancy or subscription allowance. Accounting SHALL cover non-context tools and model-generated tool arguments when observable rather than assuming world responses are the only context cost.

#### Scenario: Repeated queries and missing provider telemetry

- **WHEN** a role repeatedly receives the same observation and provider context occupancy is unavailable
- **THEN** delivery metrics expose repetition and serialized volume, occupancy remains unknown or explicitly estimated, and cumulative token usage is not presented as resident context size.

### Requirement: Safe bounded session lifecycle

Each role SHALL have a configurable, recorded context-lifecycle policy using observable thresholds and a deterministic fallback when exact provider context size is unavailable. At an eligible turn boundary the runtime SHALL reconstruct a fresh session from authorized durable goals, committed plan, dependencies, ownership, unresolved steering, pending or uncertain command outcomes, operational conditions and fresh scoped world evidence. Replacement SHALL preserve role identity, spent run budgets and pending command identity; retire previous session credentials; and require reconciliation before further mutations. If safe reconstruction or bounded required context cannot be established, mutation admission SHALL remain closed with an explicit reason. Provider transcript resumption or model-generated summaries SHALL NOT be the sole canonical memory.

#### Scenario: Threshold reached while a batch is active

- **WHEN** context policy schedules replacement while an admitted batch is running or has an unknown acknowledgement
- **THEN** the runtime defers replacement to a safe boundary or performs acknowledged interruption and reconciliation, never duplicates the command, and never resets spent budgets.

#### Scenario: Fresh context preserves unresolved work

- **WHEN** a replacement starts after accumulated context reaches its configured limit
- **THEN** it receives compact current work and fresh evidence, can retrieve authorized details, cannot use old credentials, and cannot mutate until required reconstruction and reconciliation succeed.

#### Scenario: Unknown context occupancy

- **WHEN** provider occupancy or compaction telemetry is unavailable
- **THEN** the recorded fallback policy still bounds ordinary session reuse using observable delivery volume or admitted-turn count, without claiming an exact context-window cutoff or resetting the run allowance.
