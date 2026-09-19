# Bounded gameplay context

Read [Decision 010](../../../docs/decisions/010-bounded-context.md) for the archive boundary and [Decision 016](../../../docs/decisions/016-decision-focused-context.md) for operational measurements and session lifecycle. The [bounded-context](../../../openspec/specs/bounded-context/spec.md) capability remains the base contract. [Context tests](../../../tests/context.test.ts) exercise authorization, revocation, compact command/actor reads, filtered snapshots and replacement; [operational tests](../../../tests/operational-context.test.ts) cover measurement identity, watches, accounting and repeated rotations.

| Entry point | Responsibility |
| --- | --- |
| [CoordinationGateway](../../tools/src/coordination.ts) | Authenticate tool calls; finish asynchronous results before closing attempt accounting. |
| [AgentContext](service.ts) | Build bounded briefings/detail/world responses; record the exact delivered observation. |
| [ContextArchive](archive.ts) | Authorize current records before search/counts/pages; filter references and retain transitive sources. |
| [permits](authorization.ts) | Evaluate one visibility label; independent source labels must all permit access. |
| [OperationalStore](operational.ts) | Materialize scope-local samples and rates without coupling aggregates to detail pages. |
| [ObservationSnapshots](operational.ts) | Bind filtered entity continuations to identity, task revision, filter and TTL. |
| [OperationalWatches](operational.ts) | Persist game-time threshold/hysteresis transitions and bounded gap state. |
| [ContextAccounting](lifecycle.ts) | Count observable UTF-8 prompt/catalog/tool/provider delivery separately from provider usage. |
| [SessionLifecycle](lifecycle.ts) | Request safe rotation and keep mutation closed until durable reconstruction succeeds. |

When adding reference fields, update both projection filtering and provenance recognition; test access revocation after facts have been flattened into text. When changing replacement composition, retain component continuations and record only the final delivered composite. Local comments explain these constraints at the relevant branches; avoid copying the full policy into each file.

Operational metric identity includes run, epoch, stable `scopeId`, scope-local revision, surface, item, quality and kind. Equal revisions in different scopes must never share history or watch inputs. Initial live methods support normal-quality S1/S2 assemblers plus the public scenario terminals and collector. `products_finished` and installed recipe facts establish production and recipe-supported consumption; public counters establish terminal/collector delivery; scoped inventories establish stock change only. A missing interval, new epoch, membership change, counter reset or unsupported rich recipe is unknown/partial rather than zero.

Watch responsibility is resolved from the task's current owner/manager at delivery time, not the owner captured when the watch was registered. Transition acknowledgements are durable per recipient and advance only after the exact bounded conditions entry is delivered; transition sequences remain monotonic when a stable watch ID moves to a new scope revision. Overflow or a sequence discontinuity sets `gap`. Current state and bounded transitions use a versioned URI-component line encoding inside one zero-entity-cost envelope, so the maximum allowed set remains retrievable; replacement stays read-only if its final size trimming omits that required envelope.

The default sampler cadence is 60 game ticks with 120 retained materialized samples, 32 scopes/run and 5,000 entities/scope. Detail snapshots default to 32/run, 30 seconds and 4 MiB. Watches default to 8/role, 32/run, 32 pending transitions, 300-tick persistence and 5% recovery hysteresis for target-derived watches. Session rotation is requested after 8 admitted turns or 128 KiB of observable delivered JSON, whichever comes first; these are fallback policy thresholds, not tokenizer/context-window claims. Active deterministic work defers rotation, and every mutating gateway operation remains closed until a fresh credential has received replacement evidence and authorized pending effects reconcile. The replacement packet includes the unchanged run-budget snapshot; its pending count is computed only from that principal's authorized command projection and never exposes command IDs.
