# AutoFactorio requirements

Status: product scope approved by the user on 10 September 2026, with all eight adversarial review corrections approved on 11 September 2026. Numerical operating defaults and implementation details remain adjustable during validation; the accepted safeguards below must be preserved. See [decision 001](decisions/001-review-hardening.md).

## Purpose and user

AutoFactorio: The Factory Needs Nobody is a passion project for an experienced software engineer investigating LLM planning, factory design, task decomposition, coordination, and recovery through Factorio. The user has ChatGPT Plus, uses Astra, owns Factorio 2.0 and Space Age, and accepts consuming existing subscription usage. API charges are outside scope.

Improvement means better tools, instructions, coordination, and explicit memory, measured in repeated experiments. The project does not promise to fine-tune ChatGPT's model weights.

## Approved requirements

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| R01 | Use reasoning for judgment; deterministic operations for calculations, measurements, execution, and routine monitoring. | A queued multi-step build proceeds without a model turn per placement or wait. |
| R02 | Multiple specialized agents are supported from the outset. | Foreman and engineer have separate contexts, identities, assignments, and histories; a third specialist can be registered without rewriting existing roles. |
| R03 | Solo mode is available for comparisons. | The same scenario can run with one agent or a team; aggregate/per-turn limits, concurrency and observed usage are recorded. Equal turn counts are not presented as equal inference expenditure. |
| R04 | Agent count and physical character count are independent. | Foreman need not have a body; actions name an authorized character; no permanent global singleton character assumption. |
| R05 | Agents receive structured state and use programmatic actions. | All initial scenarios run without model image input or GUI clicking. |
| R06 | Character-based play is preferred. | Movement, reach, material consumption, crafting and mining timing are validated against the game. Scenario setup exceptions are explicit. |
| R07 | Remove early-game grunt work. | Cleared terrain and supplied construction kits make hand-mining and chopping unnecessary in all five scenarios. |
| R08 | Target modern Factorio with Space Age. | Game and mod versions are recorded; recipe and machine facts come from the running game; initial challenges use Nauvis and normal-quality equipment. |
| R09 | Provide five ready-to-launch controlled scenarios. | Each has reset support, deterministic fixtures, a briefing, finite equipment, a passing reference and failing bypass controls, and independent pass/fail scoring. Every S5 fault fails a do-nothing control across eligible verification starts. |
| R10 | Live agent activity must be visible. | User can watch role-specific activity, plans, explanations, tool inputs/results, batch progress and status alongside Factorio. |
| R11 | Preserve enough evidence for retrospectives. | Decisions link to actual observations, actions, outcomes, error details, interventions, and checkpoints. |
| R12 | Sessions run autonomously with steering. | Ordinary progress and recoverable failures do not require user approval; advice can target the foreman or a specialist. |
| R13 | Human intervention is experimental data. | Store the exact message, recipient, both clocks, interpretation, resulting work and assisted-run label. Human world edits are recorded where detected, with unknown causality labeled honestly. |
| R14 | Stop, pause, resume and restart are supported. | Game-side revocation is acknowledged before conflicting reassignment. Pause freezes scoring and production under polling. Controlled restores prevent saved orders executing before reconciliation and explicit re-arm. |
| R15 | Context remains bounded. | Role/task-specific observations have size limits and explicit truncation; authorized old histories are retrievable rather than always injected. IDs, searches, artifacts and reconstructed briefings enforce visibility and exclude evaluator-only information. |
| R16 | Durable state survives compaction and model-session replacement. | A fresh session reconstructs the objective, ownership, committed plan, pending actions and current world without duplicate placement. |
| R17 | Use existing subscription access only. | Verify ChatGPT authentication; prohibit automatic API/provider fallback or credit purchase. Enforce run/per-turn time and tool limits, use reported token ceilings where supported, and interrupt active turns on run exhaustion. Unknown allowance remains unknown. |
| R18 | Measure outcomes independently of agent claims. | Require fresh science production/delivery, the scenario's automated upstream chain, and quantitative fuel replenishment where applicable. Enforce verification-phase mutation restrictions; missing evidence invalidates scoring. Neither claims nor plans alter completion. |

## Initial agent responsibilities

- Foreman: choose and break down goals, assign work, arbitrate shared resources and space, revise strategy, and handle user steering.
- Factory engineer: inspect assigned space, design layouts, submit construction batches, diagnose faults, and report evidence of completion.
- Deterministic systems: recipe mathematics, constraints, task scheduling, action execution, monitoring, measurement, storage and ordinary reporting.

Start with two reasoning roles and one builder body. Permit solo mode. Additional specialists and builder bodies should fit the original contracts. Adding a role may need new domain tools and instructions; it should not require a new coordination mechanism.

## Observability definition

Show the provider's available public activity and reasoning summaries, plus concise explicit explanations for material decisions. Do not promise access to private internal chain-of-thought. A goal/dependency graph represents recorded commitments and revisions, not an exhaustive internal decision tree.

The UI distinguishes reasoning, executing, waiting for a dependency, waiting for the game, awaiting user input, blocked by usage, disconnected, completed, and failed. An idle model while a batch runs is normal and must be understandable.

## Scenario suite

1. First Shift: gears and copper plates to red science.
2. Some Assembly Required: iron and copper plates to red science.
3. Hot Metal: ore and coal feeds to red science.
4. You Are the Infrastructure: ore patches and supplied equipment to a self-fueling red-science factory.
5. Unscheduled Downtime: restore an operating red-science factory after a controlled fault.

All target 30 red science per game minute over five consecutive one-minute measurement windows. Scenario 5 also targets recovery within ten game minutes. Exact fixtures, test deadlines and inventory quantities are validated during implementation. See [scenario specifications](SCENARIOS.md).

Passing requires the scenario's entire required automated chain, not just the final science assemblers. Once verification is admitted, character production-affecting actions are disabled through settling and scoring; returning to building/repair aborts that attempt. Required upstream production and delivery are measured over the five scored windows with documented buffer accounting. S3 requires adequate automatic furnace fuel delivery; S4/S5 also require measured mined-coal replenishment of power and smelting consumers. Preloaded reserves cannot conceal deficient supply. Every S5 fault must fail without repair under all eligible verification start times and pass after a legal restoration. A successful S5 attempt must be admitted within ten game minutes; its fixed settling and scoring may finish afterward.

## Operating defaults

Use the latest stable release selected at setup, then pin it for a benchmark series. Initial research found stable 2.0.77 and experimental 2.1.17; recheck at implementation. Include Space Age and its applicable dependencies. Ordinary-quality starting equipment avoids introducing quality variability into first experiments.

The game continues during ordinary model reasoning. Explicit pause stops the experiment clock by pausing the controlled sandbox world. Stop cancels new work and active orders; it does not silently erase progress. Independent wall-time and game-time limits prevent indefinite runs. Values are configurable and visible before launch.

Provider turns can contain multiple model inferences and tool calls. Record turns, tool-call attempts, elapsed turn time and available token usage separately, with roster-wide accounting that survives retries and session replacement. Run exhaustion closes tool admission and interrupts already active turns as well as blocking new ones; reconcile existing game work through acknowledged cancellation. Subscription and token bounds remain approximate when telemetry is delayed or unavailable. The architecture defines per-turn recovery and run-stop behavior.

Before the durable runtime milestone, prove a real hosted-game pause under continued polling and a disarmed checkpoint/load/reconcile/re-arm cycle with pending work. Unknown or uncontrolled saves are not automatically continued unless the same pre-execution barrier can be established. Fake adapters and provider-session resumption alone do not satisfy this gate.

Development runs can contain human advice. Reports distinguish assisted and unassisted runs; accepted strategy improvements are versioned and tested in fresh trials. No automatic promotion of speculative lessons into permanent instructions.

## Deferred scope

Combat, fresh-map survival, full rocket progression, planetary expansion gameplay, public hosted services, API billing, model fine-tuning, screenshot-dependent play, and automatic use of external blueprint libraries are outside the initial release. Foundational contracts must accommodate multiple surfaces, quality, fluid products and probabilistic recipes without claiming complete support for those systems yet.

The project includes software and a mod, not redistributed Factorio binaries or expansion assets. The user supplies the licensed game installation.
