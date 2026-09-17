## Why

The Phase 12 retrospective found repeated large-context author requests, manual monitoring and bookkeeping, and late integration failures consuming the user's subscription. The user approved Sol for normal milestone work, Terra for bounded implementation, Astra for difficult design/diagnosis, and cheaper routine verification; development tooling should make that allocation practical without weakening acceptance checks.

## What Changes

- Add a local, read-only usage reporter aggregating explicitly associated author, child and gameplay sessions, including compaction and unknown telemetry, with optional dated cost estimates.
- Add a development-session budget record and checkpoint report spanning attempts and roles; clearly distinguish advisory reporting from existing gameplay enforcement.
- Add bounded, deterministic run watching and verification/review contract preparation using existing runtime projections, check runner and contract validator.
- Assemble a no-inference integration preflight and evidence manifest from existing tests and retained source-matched evidence, with explicit gaps before live experiments.
- Record per-task model/effort recommendations, rationale and escalation conditions; add a preview-first developer launcher with explicit start and logged overrides. Preserve dedicated verification/review dispatch.
- Document bounded test-author delegation, stable review candidates, resource serialization, failure escalation and compact handoffs. The model guide, concise agent rule and proposal-skill guidance accompany this planning revision; remaining workflow integration is an apply task.
- Prepare a small routing-outcome record for a pilot on the next authorized ordinary task; acceptance uses fixtures and does not require a live benchmark.

## Capabilities

### New Capabilities

- `development-efficiency`: Subscription-conscious developer tooling and workflow, including usage attribution, session checkpoints, bounded monitoring, contract generation, preflight evidence and role allocation.

### Modified Capabilities

None. The existing `subscription-provider` spec governs gameplay authentication, exact Astra selection and run enforcement; this change adds developer tooling without changing that contract.

## Impact

Planned implementation touches `scripts/`, focused developer-tool tests, `package.json`, development documentation and the relevant developer-agent workflow instructions. Reuse `scripts/verify.mjs`, `scripts/check-agent-contract.mjs`, runtime snapshot projections and the current Phase 12 regression tests. No new runtime dependency is expected.

This is a maintenance change outside the numbered gameplay phases. Phase 12 remains paused and its uncommitted source/evidence must be preserved. Planning or applying this change does not authorize gameplay inference, resuming Phase 12, global Codex configuration changes, API billing, credit purchases or prerequisite upgrades. Task-based model selection at explicit developer-session launch is in scope. Hard enforcement over the interactive author process, autonomous mid-task switching, broad benchmark campaigns and changes to gameplay scoring/context policy remain out of scope.
