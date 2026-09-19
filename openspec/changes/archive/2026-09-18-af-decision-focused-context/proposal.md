# Proposal

## Why

Gameplay agents currently receive authorized, bounded records, but must reconstruct operational answers from low-level pages and can lose essential actor or command status to truncation. Before larger production scenarios, provide decision-relevant observations computed deterministically and control accumulated conversation history independently of individual response limits.

## What Changes

- Add a deterministic operational observation layer behind the existing role-scoped MCP gateway: measured rates, stock trends, target-derived requirements, machine symptoms, actor state and compact command outcomes.
- Give foremen a compact production/dependency overview and engineers task-local execution/diagnostic briefings, with targeted drill-down instead of routine full-area enumeration.
- Preserve essential execution facts when details exceed limits; add filtered, field-selected world retrieval and evidence continuations with explicit freshness and coverage.
- Add bounded, durable operational change notifications to existing deterministic scheduling, with debounce and reconciliation rather than model polling.
- Account separately for delivered context, available provider usage and cumulative run expenditure; rotate role sessions at configured boundaries using durable reconstruction without resetting budgets or retrying unknown effects.
- Verify information sufficiency and size with deterministic comparison cases and dedicated local game checks. A separately budgeted model comparison may assess gameplay benefit; no success-rate improvement is assumed.

## Capabilities

### New Capabilities

- `operational-observations`: Authorized deterministic measurements, decision-oriented role views, targeted diagnostics and meaningful-change notifications for implemented scenarios.

### Modified Capabilities

- `bounded-context`: Essential facts survive detail truncation; scoped retrieval supports selective detail; context accounting and safe session reconstruction control history growth.

## Impact

Extends `packages/core/context`, gameplay contracts, the Lua observation adapter, `packages/tools`, orchestration/provider composition, durable measurements and operator telemetry. Reuses the current MCP server, identity/ownership boundaries and observation archive; no new service, general-purpose gameplay scripting, vector database or paid provider is required.

Initial live coverage is S1/S2 on the installed pinned game, with extensible item/quality/surface identities. This change does not implement Phases 14-18, change evaluator success criteria, expose evaluator internals, or claim an exact minimum sufficient context. Main specifications and approved requirements remain unchanged until implementation and sync. This request authorizes proposal artifacts only.
