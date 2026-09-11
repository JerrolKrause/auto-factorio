# 001: Close the adversarial design review findings

Status: accepted by the user on 11 September 2026. Scope: documentation changes only; no implementation or integration test is claimed complete.

## Context

The pre-implementation review found eight gaps in the design. The user approved all eight corrections. They strengthen the existing five-scenario, deterministic-first, subscription-only product rather than introducing a new release scope. Numerical limits and fixture geometry remain subject to live reference validation.

## Decisions and acceptance evidence

| Review finding | Accepted correction | Required implementation evidence |
| --- | --- | --- |
| 1. Final science output can bypass upstream automation | Freeze production-affecting character actions during verification; measure the scenario's required upstream production, delivery and inventory balances. | Positive references pass; preloaded buffers, character supply, skipped stages and unrelated upstream production fail. |
| 2. S5 can pass without repair | Validate each fault using a do-nothing control across every eligible verification start and a legal restoration from the same fixture. | No unrepaired variant passes, including with starting buffers; legal repairs or alternative restorations pass. |
| 3. Runtime leases alone do not fence game queues | Require acknowledged Lua-side revocation before reassignment and before replacement work; use disarmed saves and a controlled restore/reconcile/re-arm barrier. | Delayed revocation, stale grants/task revisions, disconnection and restored cancelled orders cannot authorize further effects. Uncontrolled saves are refused unless the same barrier is proven. |
| 4. A little fresh coal does not establish sufficient fuel supply | Measure source, route and consumer replenishment against actual fuel/energy consumption, accounting for initial reserves and bounded tolerances. | Reserve-backed factories with inadequate delivery fail despite temporarily sufficient science output; adequately supplied references pass. |
| 5. History retrieval can leak evaluator information | Label events/artifacts by visibility and enforce authorization for IDs, queries, references, derived summaries and replacement-session briefings. | Hidden reference/fault information and restricted role evidence cannot be retrieved through authorized gameplay tools. |
| 6. Provider turns are not units of inference consumption | Add per-turn time/tool caps and available usage ceilings, with roster-wide accounting and interruption of active turns on run exhaustion. | One long tool-heavy turn, missing/duplicate usage updates, concurrent exhaustion and late tool calls are handled by deterministic tests. |
| 7. Pause and save/load assumptions need early engine proof | Add a minimal real-game pause-under-polling and disarmed save/load/reconcile/re-arm test to milestone 0. | Recorded clocks, production, receipts and inventories establish the required behavior before milestone 1's durable controls are built. |
| 8. Relocation instructions are obsolete | Treat `C:\@Projects\AutoFactorio` as the existing workspace. | README and handoff consistently direct work in place. |

## Boundaries and consequences

- [REQUIREMENTS](../REQUIREMENTS.md) records the accepted product safeguards; [ARCHITECTURE](../ARCHITECTURE.md) owns control, authorization and budget protocols; [SCENARIOS](../SCENARIOS.md) owns measurement and negative controls; [IMPLEMENTATION_HANDOFF](../IMPLEMENTATION_HANDOFF.md) owns milestone ordering and actual progress.
- Reference and negative-control execution uses the normal legal gameplay gateway. The operator/evaluator can retain privileged evidence without exposing those records to playing roles. Automated world observations still expose ordinary visible symptoms and factory state.
- Verification is an observation period. Repairs remain autonomous during building/repair phases; requesting a repair during verification first aborts that attempt. Buffers remain legal when required fresh flows are demonstrated and balances are observable.
- Automatic recovery supports validated disarmed saves. Native autosaves are not implicitly safe recovery sources. Establish a multiplayer-safe engine lifecycle in the feasibility spike; a prompt, elapsed lease or late reconciliation is not an execution barrier.
- Additional counters and control cases are deterministic. They do not authorize extra model-backed experiments, API charges, global configuration edits or a separate implementation task. Unknown telemetry and unverified mechanics remain explicit limitations.
- Minimal checkpoint capture belongs in milestone 0; full persistence belongs in milestone 1, and branch/comparison UI remains in milestone 4. This avoids moving the full dashboard into the feasibility spike.

## Validation status

The accepted changes specify future executable gates. Documentation consistency and local-link checks are recorded in the handoff. No application tests, live Factorio runs or provider inference were performed for this documentation update.
