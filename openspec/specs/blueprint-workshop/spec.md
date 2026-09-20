# Blueprint workshop

## Purpose

Let humans and orchestrators commission reusable factory components through observable, bounded design-and-score sessions with optional human participation.

## Requirements

### Requirement: UI-configured design session

The system SHALL allow starting a workshop from the UI using a brief, preset or existing blueprint revision. It SHALL record a resolved assignment covering component inputs/outputs, utilities/byproducts, target rate in game-time units, technology profile, scoring priorities, footprint, library access, build mode, evaluation speed, iteration count/early-stop policy, human checkpoints and execution/learning budgets before work starts. Contradictory or incomplete required fields SHALL produce an actionable preflight outcome. An authorized orchestrator SHALL be able to submit the same assignment contract.

#### Scenario: Start a constrained circuit design

- **WHEN** a person requests circuits from plates, selects a starter profile, direct placement and five attempts
- **THEN** the UI shows the normalized target, allowed equipment, input/utility assumptions, scoring priorities and effective limits, and starts a durable session from that manifest.

#### Scenario: Incompatible configuration

- **WHEN** a person selects Improve on a library revision while disabling access to that revision, or the brief conflicts with an explicit numeric target
- **THEN** preflight identifies the conflict before any inference or game mutation and does not silently choose one interpretation.

### Requirement: Configurable model and reasoning effort

Workshop options SHALL include a session-default provider, model and reasoning effort, with optional overrides for designer, scorer and learnings roles. The initial provider SHALL be OpenAI through supported managed ChatGPT/Codex subscription access; other providers and API billing SHALL remain unsupported. Provider identity SHALL be stored separately from the provider-specific model ID and effort so future providers can extend the contract. The UI SHALL offer available OpenAI models with friendly names such as Astra, Sol and Terra, and only the efforts supported by the selected model, such as low, medium and high. These examples SHALL NOT be treated as an exhaustive catalog or a guarantee of account availability. Astra/low SHALL remain the visible default when available; an unavailable default SHALL require an explicit supported selection rather than substitution.

Preflight SHALL resolve friendly names to concrete model IDs, validate provider/model/effort combinations against managed-provider capabilities and record effective selections for every role before inference or game mutation. Unsupported, unavailable or unresolvable choices SHALL produce actionable configuration errors without silent provider, model, effort or billing fallback. Both scorer contexts SHALL use the scorer selection; learning behavioral trials SHALL use the relevant target-role selection, and independent learning review SHALL inherit the learnings role selection in a fresh read-only context. Developer verification/review routing SHALL remain separate.

The manifest, presets and reports SHALL retain requested and resolved selections; each invocation SHALL record its effective configuration and provider-reported model/effort when exposed, otherwise explicitly unknown. Retries, replacement and save/load SHALL preserve pinned selections and spent budgets, rechecking availability before new inference. A user-requested selection change SHALL start a new session/comparison series; active sessions SHALL NOT silently change settings. Learning SHALL NOT modify these operator-owned options.

#### Scenario: Select models and effort by role

- **WHEN** a user selects OpenAI Sol/medium as the session default and Astra/high for the designer, and both combinations are available
- **THEN** launch shows and pins the resolved choices, scorer and learnings inherit Sol/medium, and histories identify the effective configuration for each invocation.

#### Scenario: Unsupported selection or unavailable default

- **WHEN** a preset requests another provider, an unavailable model, an unsupported effort, or a default that cannot be resolved
- **THEN** preflight rejects the configuration before inference or game mutation, identifies the invalid option and requires an explicit supported choice without fallback.

#### Scenario: Recover a pinned model selection

- **WHEN** a workshop is restored or a role session is replaced after its selected model becomes unavailable
- **THEN** its manifest and spent budgets remain unchanged, new inference is blocked with a visible availability reason, and any user-selected alternative starts a new session/comparison series.

### Requirement: Optional human participation and bounded iterations

Brief confirmation, feedback after scoring, library admission approval and learning activation approval SHALL be independently configurable in the UI and disabled by default. With all checkpoints disabled, a valid session SHALL require no human interaction after launch. Iteration count SHALL include the initial design/score attempt; the UI SHALL distinguish a maximum with early stopping from exactly N requested attempts. Execution limits and stop/failure handling SHALL still apply. Checkpoints SHALL have visible timeout behavior and persist through reconnect. Protected or deferred learning proposals SHALL NOT introduce mandatory pauses.

#### Scenario: Five unattended attempts

- **WHEN** five attempts are requested with early stopping and all human checkpoints disabled, sufficient budget and valid game/provider connectivity
- **THEN** the system performs five design/measure/score attempts, finalizes the best eligible result or explicit no-valid-result, evaluates learning according to cadence, and produces a final report without waiting for a person.

#### Scenario: Optional feedback and timeout

- **WHEN** an enabled post-score checkpoint is reached
- **THEN** production and inference pause at an acknowledged safe boundary, the UI presents the revision and score, feedback is recorded as assistance, and the configured timeout continues or ends the session without an unbounded wait.

### Requirement: Explicit technology and compatibility profiles

Profiles SHALL version the installed game/mod fingerprint, research and bonus levels, available recipes, permitted machines/transport/modules/beacons, quality and target surface conditions. Unlimited inventory SHALL NOT bypass these restrictions. The system SHALL provide editable starter, advanced-assembly and electromagnetic-production presets, custom profiles and compatible current-run snapshots. It SHALL distinguish equipment permitted for use from equipment manufacturable locally, and record each artifact's actual minimum requirements.

#### Scenario: Early and late circuit variants

- **WHEN** the same circuit assignment is run under starter and electromagnetic profiles
- **THEN** prohibited machines/modules are rejected in the starter run, the electromagnetic run uses only allowed bonuses/equipment, and the results retain different compatibility requirements instead of treating either as universally superior.

### Requirement: Large isolated sandbox and unlimited allowed supplies

The workshop SHALL provide a cleared isolated build area initially at least 512 by 512 tiles, configurable expansion without erasing the build, and a visible resource cap. It SHALL provide unlimited profile-allowed construction materials and declared process inputs/utilities. Input rates, power assumptions and byproduct sinks SHALL be explicit evaluation conditions; unlimited stock SHALL NOT imply unlimited transport throughput. Personal saves and unrelated games SHALL remain untouched.

#### Scenario: Expand a large design

- **WHEN** a supported design exceeds the initial area but fits the configured expansion cap
- **THEN** the area expands, prior entities and evidence remain intact, and updated reservations define the buildable extent; exceeding the cap reports required space explicitly.

### Requirement: Two scoped construction modes

The designer SHALL support direct placement and legal character construction of the same supported blueprint content. Direct placement SHALL be restricted to workshop-authorized regions and disabled in ordinary runs. Character mode SHALL provision unlimited allowed supplies through recorded setup operations while preserving normal movement, collision, reach, timing, inventory accounting and action receipts. Both modes SHALL preserve recipes, directions, modules, supported settings and wires and SHALL reject unsupported content before mutation. Neither mode SHALL use construction bots.

#### Scenario: Equivalent artifact through both modes

- **WHEN** the same supported module-equipped artifact is built directly and through a character
- **THEN** normalized final configurations match, character receipts show legal actions and provisioning, and neither mode silently loses configuration or receives a production pass solely for placing entities.

#### Scenario: Sandbox privilege escape

- **WHEN** an ordinary engineer or an out-of-region workshop request attempts direct placement or unlimited provisioning
- **THEN** the request is rejected without a side effect, including after session replacement.

### Requirement: Supported production scope and honest rejection

The initial workshop SHALL support normal-quality deterministic solid/fluid production with assemblers, furnaces, chemical/oil-processing machines, EM plants and foundries where profile/surface rules allow them; transport, inserter filters, pipes/pumps, chests, power poles, lamps, modules and beacons SHALL retain required configuration. Fluid temperatures and byproduct disposal SHALL be explicit. Unsupported quality generation, stochastic/spoilage behavior, advanced circuit programs, trains, platforms and dedicated mining/power-generation designs SHALL return a supported-scope explanation before admission rather than an incomplete passing result.

#### Scenario: Fluid and byproduct component

- **WHEN** a supported recipe consumes fluid and emits a secondary product
- **THEN** the assignment records fluid/temperature constraints and all output sinks, reconstruction preserves them, and measurement accounts for both products and relevant inventory.

### Requirement: Independent accelerated reconstruction measurement

Production eligibility SHALL require clean reconstruction of the exported candidate, evaluator-owned declared sources/sinks, inventory/flow reconciliation, frozen mutations and complete fixed game-tick measurement windows. Starting stock, manual supply/output, hidden supplies and fixture entities SHALL NOT create production credit. Requested speed and achieved acceleration SHALL be recorded separately; acceleration SHALL affect only the dedicated workshop process. Missing coverage, interference, disconnection or unresolved effects SHALL invalidate affected measurements. Deterministic code SHALL perform measurement, arithmetic and routine monitoring.

#### Scenario: Hotbox and normal-speed equivalence

- **WHEN** a deterministic reference is evaluated at normal and accelerated speed with identical simulated windows
- **THEN** both report equivalent sustained output within declared engine-based tolerances, retain exact tick coverage and report their distinct wall times.

#### Scenario: Preload and interference controls

- **WHEN** apparent target output depends on a preload, undeclared input, manual intervention or missed window boundary
- **THEN** the candidate fails or has invalid evidence with the specific reason and cannot enter the production-verified library.

### Requirement: Every-window sustained throughput predicate

The assignment SHALL freeze every required port's target rate, fixed game-tick windows, quantity quantum, calibrated absolute measurement errors, stock/residual limits and rounding rules before admission. Every port SHALL meet its target in every scored window using both fresh causal production assigned without duplicate port credit and net sink delivery; averages, other ports and surplus in earlier windows SHALL NOT compensate for a deficient window. For rate `r` per game second, duration `d` ticks and quantum `q`, the required quantity SHALL be `q * ceil((r * d / 60) / q)`. Each production/delivery observation `x` with nonnegative error bound `e` SHALL contribute the conservative lower bound `max(0, q * floor((x - e) / q))`; both lower bounds SHALL reach the required quantity. Item counts SHALL use quantum one and exact counters, fluid precision/error SHALL be calibrated and pinned, and threshold arithmetic SHALL preserve exact manifest rates. Display rounding and stock reconciliation tolerances SHALL NOT relax output targets. Windows SHALL use the same `(startTick, endTick]` convention. Scoring-start baselines SHALL exclude settling production and record output/in-process stock; opening stock SHALL NOT replace the fresh-production minimum, and per-component drawdown/residual limits SHALL not be offset by unrelated stock accumulation.

#### Scenario: Burst followed by starvation

- **WHEN** a 60-items/minute assignment uses five one-minute windows and fresh production or delivery is `300,0,0,0,0`
- **THEN** sustained acceptance fails despite a 60/minute overall average, whereas `60,60,60,60,60` for both measures passes only if all other gates pass; settling stock cannot fill a missing fresh-production minimum.

#### Scenario: Threshold precision and tolerance

- **WHEN** one window delivers only 59 items against target 60, a fractional item target is 60.1 per window, or a fluid lower bound lies just below/at/above its quantized threshold
- **THEN** 59 fails even with positive reconciliation tolerance, 60.1 requires 61 items, and fluid acceptance follows the pinned conservative lower bound with no display rounding or post-hoc epsilon change.

### Requirement: Multi-dimensional independent scoring

The scorer SHALL receive an immutable candidate and measured evidence, apply a rubric fixed before iteration, and provide actionable revision-linked feedback. The report SHALL include sustained throughput/belt saturation, expandability, space and clearance, operating resource efficiency, connection interfaces, itemized and raw-resource construction cost, and a minor configurable aesthetic dimension. Unknown measurements SHALL remain unknown; inferred/subjective judgments SHALL be labeled. Claimed expansion rates SHALL distinguish tested scales from unverified claims. Game/tool interaction critique SHALL be separately visible from factory metrics. The scorer SHALL NOT mutate the candidate or authoritative measurements.

#### Scenario: Useful alternative rather than universal winner

- **WHEN** one compatible circuit layout is smaller but another costs less or expands with less teardown
- **THEN** the report preserves that tradeoff, compares equivalent boundaries and profiles, and supports retention of both useful variants rather than silently using one universal score.

#### Scenario: Cost and expansion evidence

- **WHEN** a design uses underground belts and claims repeatable doubling
- **THEN** construction cost includes their selected raw-material recipe costs, separately records unknown conversions, and doubling is verified through a reconstruction/connection test or explicitly marked unverified.

### Requirement: Scoped roles and library isolation

Designer, scorer and learnings SHALL have distinct identities, contexts, tools and histories. The designer SHALL specialize the existing engineer capabilities; deterministic orchestration SHALL own scheduling. When library access is disabled, designer-facing critique SHALL originate in a scorer context that has never received hidden layouts or derived comparison content. Private library comparison SHALL use a separate provider session, credentials and history/reconstruction scope and write only to operator/admission channels at finalization, without steering iteration/early stopping. No private free-form feedback, summaries, suggested patches or admission rationale SHALL enter the blind scorer or designer through messages, tools, history or replacement. Instructions, helper bundles and retrieved lessons derived from hidden layout/comparison inputs SHALL also be excluded through recorded context lineage; generic-looking text or model-claimed sanitization SHALL NOT remove that restriction. General engineering knowledge with library-independent lineage SHALL remain available. The system SHALL NOT claim that this excludes knowledge from model pretraining.

#### Scenario: Blind session after replacement

- **WHEN** a library-disabled designer is replaced after a scorer compares its work with a stored design
- **THEN** the new context retains only authorized assignment/work and critique from a library-blind context, and private comparison content or derived artifacts remain inaccessible.

#### Scenario: Paraphrased hidden layout advice

- **WHEN** private comparison emits a useful arrangement suggestion without IDs, blueprint strings or competitor coordinates
- **THEN** that suggestion and any summary/lesson/helper derived from it remain restricted regardless of wording, and designer-facing feedback is generated independently from candidate-only authorized evidence in the blind scorer context.

### Requirement: Reviewable activity and agent context

The UI SHALL expose phase/iteration status, public agent activity, score feedback, candidate comparisons, assistance, library decisions and learning decisions/diffs/validation. It SHALL support final-result-focused presentation while preserving live inspection and durable intermediate evidence. An operator context inspector SHALL expose available supplied instructions, tool catalogs, retrieved context, messages and tool calls/results with session/version lineage, bounded pagination and explicit redaction/truncation/retention gaps. Hidden reasoning SHALL NOT be promised and operator visibility SHALL NOT broaden gameplay visibility. Closing the browser SHALL NOT own or interrupt session execution.

#### Scenario: Return after unattended completion

- **WHEN** a person closes the browser during an unattended session and returns afterward
- **THEN** the final result and all retained scored iterations/learning outcomes are inspectable, including exact activated diffs and supplied context records, without duplicate events or fabricated missing history.

### Requirement: Honest usage and durable recovery

Session, iteration, role and learning-batch reports SHALL retain reported token detail, tool attempts, turns and elapsed times, deduplicating cumulative/incremental usage and preserving spent limits across retries and replacement. Learning validation and review inference SHALL be included in aggregate budgets with one accounting owner per invocation. Missing tokens, subscription allowance and unavailable monetary cost SHALL remain unknown; estimates SHALL state their basis. Supported subscription access and configured OpenAI model/effort selections SHALL have no automatic paid fallback. Pause/stop/save/load SHALL reconcile pending builds, scoring and publication/activation before retry, with no duplicate effect or budget reset.

#### Scenario: Usage and recovery after a lost response

- **WHEN** a placement or promotion succeeds but its response is lost, provider usage repeats, and the session is restored
- **THEN** durable operation evidence resolves the prior effect before retry, repeated usage is counted once, spent budgets remain, and the UI distinguishes any still-unknown outcome.
