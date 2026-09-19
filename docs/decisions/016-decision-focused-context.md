# Decision 016: decision-focused operational context

Status: implemented for deterministic and S1/S2 validation under `af-decision-focused-context`; model decision-quality remains unverified.

## Decision

Keep one authenticated gameplay MCP gateway and add small role views plus typed `metrics` and `inspect` drill-down. Preserve legacy world/archive calls. Apply entity filters and field selection before bounded snapshot pagination; bind continuations to current identity, task revision, exact filter and a short TTL. Actor state and compact command outcomes have independent responses, so bulk entity or receipt detail cannot remove safety-critical execution facts.

Sample ordinary S1/S2 state in Lua every 60 game ticks. Scope identity is `(run, epoch, scopeId, scopeRevision, surface, item, quality, kind)`; revisions are local to stable scope IDs. Supported methods are assembler `products_finished`, installed recipe ingredient/product facts, public terminal/collector counters and scoped inventory stock. They respectively establish production, recipe-supported consumption, boundary delivery and net stock change. Configured supply, nominal capacity, target demand and measured flow remain separate. Epoch/membership changes, missed samples, counter reset and unsupported mechanics invalidate affected coverage.

Persist game-time threshold/hysteresis watches and feed transitions into existing deterministic scheduling. Unchanged state never starts a model turn. Bound scopes, samples, snapshots, watches and pending transitions; overflow produces a gap indicator and current-state reconciliation.

Resolve watch delivery from the task's current owner/manager. Persist per-recipient transition acknowledgements, retain monotonic sequences across scope revisions and advance them only after the exact conditions entry is delivered. Encode the bounded current state and transition set as versioned URI-component lines in one zero-entity-cost envelope; replacement acknowledges only an envelope that survives its final bounded composition and otherwise remains read-only. This preserves overflow/restart gaps without pinning delivery to an obsolete assignee or creating an unretrievable oversized record.

Count delivered prompt, catalog, tool-argument, tool-result and public provider-output UTF-8 bytes separately from available provider token usage. Missing provider occupancy and subscription allowance remain unknown. Request role-session rotation after 8 admitted turns or 128 KiB of observed delivery by default. Defer while deterministic work is active. A new provider credential enters a durable reconstruction gate; every mutating gateway operation stays closed until current durable work, fresh authorized world evidence and uncertain command effects reconcile. The packet carries the existing run-budget snapshot. Pending effects are counted through the principal's authorized command archive and are not identified in gate errors. Rotation preserves role identity, command IDs and the roster budget.

## Consequences

- Deterministic comparison may establish fact coverage, byte/call volume and timing; it does not establish tokenizer savings, better reasoning or gameplay success.
- Initial live coverage is S1/S2 normal-quality assemblers and public scenario boundaries, not arbitrary machines, fluids, mining or evaluator health.
- Operational observations remain gameplay evidence, never evaluator success or access to reference/fault traces.
- Rolling projections are bounded, while the append-only operator journal retains auditable transitions according to run retention policy.

## Evidence

The no-inference harness is `scripts/decision-context-comparison.ts`; it invokes the production context/archive paths and derives bytes, calls, omissions and facts from their actual return values. Focused regressions are in `tests/context.test.ts` and `tests/operational-context.test.ts`. The dedicated live probe is `scripts/game-operational-probe.ts`; its operator-only calibration source reads raw engine/scenario counters and independently enumerated scoped inventories without consulting operational samples, then checks flow quantities, stock deltas and interval-normalized rates with a declared two-cadence tolerance. Exact executed results and remaining limits belong in the [implementation handoff](../IMPLEMENTATION_HANDOFF.md).
