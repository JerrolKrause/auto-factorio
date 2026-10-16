# Production-chain planning and acceptance

Implemented against baseline `f14c8b932b247d9608d29b4e02f6c3149619e8fa`; the implementation and archive are included in the commit containing this decision. This decision records the accepted [change](../../openspec/changes/archive/2026-10-15-production-chain-planning/proposal.md); the user requested archival on 15 October 2026. Its [tasks](../../openspec/changes/archive/2026-10-15-production-chain-planning/tasks.md) map 29 scenarios to seven prerequisite-gated slices.

## Boundaries and consequences

Gameplay and workshop share installed-game facts, explicit production requests, selected-route balances and durable plans. The planner does not choose layouts or create supplies, unlocks, equipment, sinks or gameplay tasks. Commitment uses existing task ownership and receipt fences. Construction completion, commissioning, observed health and independent success remain distinct. Bounded views exclude evaluator-only data and label missing coverage unknown.

Rate planning supports deterministic normal-quality Nauvis chains, including shared intermediates, refining/cracking, compatible burner fuel, electricity allowances and explicit surplus destinations. Selected cycles and unsupported bonuses/mechanics block sizing. Operating utility demand and rounded-machine full-duty bounds remain distinct; unresolved bounds prevent feasibility. Quantity mode supports whole crafts for acyclic single-product routes, not coupled co-product batches or duration guarantees.

Component assignments retain immediate-input sources and historical evidence. Chain mode supplies only declared external process inputs, utilities and construction equipment, with no internal fixture feeds. Both direct and legal-character construction use the existing build paths. Target/co-product destinations and stage coverage are part of the frozen evaluation boundary. Library attestations key evidence by content plus boundary; only matching compatibility, boundary and rubric permit comparison. Improve restores provenance and revalidates it for a fresh run; legacy unknown boundaries receive no inherited verification.

The [fluid destination decision](production-chain-fluid-destinations.md) explains full-duty destination capacity and chain preset revision 2. The [burner measurement decision](production-chain-burner-measurement.md) explains native fuel coverage. These do not grant ordinary gameplay sandbox supply privileges.

## Executed evidence

The task 7.4 acceptance record is `.runtime/production-chain-implementation/S5/final/reconciliation/accepted-task-7.4.json`; its immutable verification/review contracts cover all 29 scenarios. The software gate passed 1,236 tests in 75 files plus TypeScript/dashboard builds, lint and documentation checks; five browser cases passed. Installed facts, three complete calculated 1-item/game-second chains, observations, both construction paths and measurement failure paths have dedicated production-entrypoint evidence. See [history](../IMPLEMENTATION_HISTORY.md) and the [current handoff](../IMPLEMENTATION_HANDOFF.md) for exact source/evidence boundaries and subsequent closeout checks.

- Ordinary sulfur: five contiguous 3,600-tick windows, each 108 produced and delivered, stock delta zero, with complete upstream evidence.
- Workshop direct and character sulfur: five windows each, every window 72 produced, 60 delivered and stock delta +12, residual zero with complete stage coverage.
- Oil controls: five positive windows each with 1,020 petroleum and 300 heavy oil produced/delivered; missing crude and blocked heavy outlet each yielded five complete zero-flow windows and failed target evaluation. Native preload and undeclared-port attempts were rejected. The multi-trial wrapper has a bounded 2,100-second timeout; other named cases retain 900 seconds.
- Recovery: genuine lost placement acknowledgement, fenced conflicting work, receipt reconciliation, cancellation and checksum-verified restore into a new server/epoch. Two prefix entities retained identity; 451 suffix steps completed without duplicate effects, 220 unique planned/native entities and exact finite-kit accounting. A new post-restore attempt passed five complete sulfur windows.

Calibration's configuration-only `productionAcceptance:false` is not throughput proof. The physical references supply that proof. Owned game resources were cleaned; transient browser PIDs were not sampled, with fixture teardown and clear profile inventories recorded instead. Installed executable hashes and loaded game/mod versions were captured; the entire installed prototype tree was not separately hashed. Historical partial runs and environment failures remain preserved; later evidence does not rewrite them.

## Limits and next action

These references used Factorio/API 2.0.77 with Space Age and zero task-initiated provider inference. They establish deterministic tool/build/measurement behavior, not autonomous sulfur, processing-unit or utility-science model performance, nor measured gameplay improvement. No full utility-science layout or global optimization is claimed. Extraction/pumping, power generation, equipment manufacture, autonomous research, non-Nauvis/quality/stochastic production and coupled finite-batch oil sizing remain outside this envelope. The pending smelting/fuel and mining/power scenario milestones retain their own fixture and scoring gates.

The next separately requested work is a bounded scenario-builder specification: one sandbox challenge using the public production request, finite equipment and explicit supplies, deterministic reset, private independent scoring and a passing reference plus bypass controls. Define its acceptance boundary before implementation; this change does not authorize that next task, archive, commit or publication.
