# Five early-game sandboxes

Status: approved scenario scope, proposed implementation fixtures. These are specifications, not playable saves yet. Validate equipment and geometry with reference runs before declaring them ready to launch.

Scoring and negative-control requirements incorporate the review corrections approved on 11 September 2026. Numerical fixtures remain subject to reference validation; the safeguards below are acceptance requirements.

## Shared world and assistance settings

- Use the pinned stable Factorio installation with Space Age and its applicable dependencies enabled. Record the complete mod list and versions.
- Use Nauvis, normal-quality items and no modules, beacons or productivity bonuses in these early trials.
- Disable biters and cliffs. Clear trees, rocks and obstructing terrain from the construction site and needed resource routes during setup.
- Grant only the technologies required by the scenario's allowed equipment and recipes. Export the actual grants into its manifest.
- Use a visible character with normal movement speed, inventory, reach and timed interactions. Scenario setup alone may create entities and inventories freely.
- Provide construction equipment up front. No hand-mining, chopping or manufacturing a construction toolkit is required.
- Allow deterministic ratio calculations, legal movement, placement checks, inventory transfers and batched construction during building and repair. The stricter verification-phase policy below applies once verification is admitted. Disable starter blueprint provisioning and access to reference layouts in benchmark mode.
- Allow ordinary rebuilding within the assigned construction area. Protect supply fixtures, evaluator equipment, map boundaries and unrelated human structures.
- Base all feed rates and simulation timers on `game.tick` relative to recorded origins, excluding explicitly paused time; wall-time ceilings are independent. Initial maps are fixed and fully revealed within the bounded scenario area; exploration is not being tested.

## Deliverable structure for each scenario

Each scenario contains a versioned manifest, player briefing, seeded fixture specification, allowed actions/recipes, construction kit, evaluator definition, passing reference action plan and failing bypass controls. Reference plans and hidden control details are accessible only to validation/operator tooling; their ordinary-gateway events inherit that restriction. Generate a disarmed save in the user's licensed game installation and cache it by scenario/game/mod fingerprint. Load it through the architecture's reconciliation barrier. Do not distribute proprietary game data as part of the repository.

Selecting a scenario and roster should be sufficient to start a run after installation setup. Reset creates a new run and world epoch from the same validated fixture. Preserve the previous history.

## Proposed common kit

Use generous equipment initially so layout and integration dominate performance. Suggested common kit: 12 assembling machines 1, 300 yellow belts, 60 ordinary inserters, 12 long-handed inserters, 12 underground-belt items, 6 splitters, 24 small electric poles and 8 wooden chests. All are normal quality. Adjust only if reference runs show a need; record adjustments as scenario revisions.

S3 adds 24 stone furnaces. S4 adds those furnaces plus 16 electric mining drills, 2 boilers, 4 steam engines, 1 offshore pump, 80 pipes, 12 pipe-to-ground items and 200 coal for bootstrapping. Extra fuel reserves must not substitute for demonstrated automated fuel delivery at completion.

The inventories are deliberately not minimum-cost solutions. Resource efficiency is reported as a secondary metric, not an initial pass condition.

## 01 — First Shift

**Goal:** build automated red-science production at 30 packs per minute.

**Given:** a cleared 64-by-64-tile site; two labeled incoming yellow-belt terminals, supplying gears at 60/minute and copper plates at 60/minute; a protected power connection with ample capacity; common construction kit; labeled automated output collector.

**Build:** ingredient routing, red-science assemblers, inserters, local electrical distribution and output transport. No completed production cell is supplied.

**Exercises:** spatial layout, direction, recipe configuration, distribution, batch execution and verification. The foreman can assign a complete cell; the engineer decides its arrangement.

**Reference check:** without bonuses, each pack needs one gear and one copper plate. The reference solver uses installed recipe and assembler data to determine capacity. The reference layout is hidden from gameplay agents.

## 02 — Some Assembly Required

**Goal:** the same 30/minute output, beginning with plates.

**Given:** cleared 80-by-80 site; iron plates at 120/minute; copper plates at 60/minute; supplied power; common kit and output collector.

**Build:** gear manufacture, integration with red science, input routing and output collection.

**Exercises:** dependency decomposition, upstream/downstream capacity and interfaces between subtasks. An optional third logistics specialist should fit the same contracts without changing the scenario.

**Reference check:** standard recipes require 60 iron plates and 30 copper plates per minute at the target, before any nonstandard bonuses. Supplied rates provide headroom. Derive and verify these values from game data at setup.

## 03 — Hot Metal

**Goal:** the same output, beginning with supplied raw materials.

**Given:** cleared 96-by-96 site; iron ore at 120/minute, copper ore at 60/minute, coal at 120/minute; power; common kit plus stone furnaces; output collector.

**Build:** coal distribution, iron and copper smelting, gear manufacturing, red-science assembly and all internal logistics.

**Exercises:** balancing a longer chain, burner operation, competing fuel/material routes and diagnosing whether a shortage originates upstream.

**Reference check:** source rates must exceed the verified target demand. Test delivery to furnaces as well as theoretical smelting capacity; a diagram or machine count cannot pass the scenario.

## 04 — You Are the Infrastructure

**Goal:** a functioning 30/minute red-science factory with automated mining and sustained power/fuel supply.

**Given:** cleared site approximately 160-by-160 tiles, fixed accessible iron/copper/coal patches, accessible water edge, expanded construction kit and a labeled bootstrap coal reserve. No material belts or generated power are supplied.

**Build:** steam power, electric mining, automatic coal delivery to burners, smelting, gears, science and output collection.

**Exercises:** bootstrap ordering, circular dependencies such as coal mining requiring power, coordination across subsystems, and end-to-end diagnosis. The challenge is factory construction; all necessary buildings are already supplied.

**Additional scoring condition:** disconnect access to the labeled external bootstrap reserve before settling and keep it inaccessible through verification. Apply the quantitative fuel test below to the actual power and smelting consumers. Initial fuel already in the factory is recorded, not assumed to disappear when the reserve is disconnected. Some freshly mined coal arriving is insufficient: the automated route must demonstrate replenishment adequate for measured consumption. Missing fuel-flow coverage invalidates the attempt.

**Reference check:** prove bootstrapping works without hand-mining or fabricating extra equipment. Confirm that resource placement, water access and reachable building space are adequate. A stockpile-only factory and a factory with generous preloaded fuel but an insufficient automated delivery rate must both fail the quantitative fuel test.

## 05 — Unscheduled Downtime

**Goal:** restore a working factory after a fault, then sustain 30/minute again.

**Given:** a reference-built factory using the S4 chain, generous spare equipment, no need to rebuild its whole infrastructure, and a briefing that one disruption will occur. Use the reference plan through the ordinary execution interface to construct and validate the starting factory.

**Variants:** break one accessible ingredient-belt segment; rotate one ordinary inserter incorrectly; remove a pole that disconnects a production branch. Choose the fault deterministically from an evaluator-only seed. Initial variants must each be repairable with supplied spares.

**Timing:** record baseline production, inject the fault at a fixed game tick, and begin the ten-game-minute recovery deadline at injection. Observer history records the fault; the playing agent sees symptoms through normal observations, not a hidden answer field.

**Exercises:** notice degradation, inspect causal evidence, avoid irrelevant rebuilding, coordinate repair and verify recovery.

**Reference check:** every fault must have a passing legal repair or alternative restoration and a failing do-nothing control from the exact same starting save, including its buffers. A detectable drop that still meets the pass threshold is not an acceptable fault. Record detection latency, repair latency, lost output and unnecessary modifications in addition to pass/fail.

The do-nothing control leaves the injected fault in place and performs no repair, character supply or world mutation. From the fault tick through the latest permissible verification finish, retain enough tick-level evidence to evaluate every eligible verification start under the same settling, output, upstream and fuel rules used for agents. No start admitted within the ten-minute deadline may yield a pass. Do not test only one conveniently late start after buffers empty. If an unrepaired variant passes, revise its affected branch, capacity or starting buffers and rerun both controls before freezing that scenario version. Agents may restore service through any legal design; scoring does not require replacing the exact faulted entity.

## Evaluation rules

Once the agent requests verification, close construction/transfer admission and acknowledge cancellation or completion of outstanding character mutations before accepting the attempt. Record that admission tick, freeze the evaluated factory scope and take inventory baselines. Use a fixed settling interval recorded in the manifest, then start five consecutive non-overlapping windows of 3,600 game ticks each with fresh measurement baselines. Initial proposed settling interval: 600 ticks. It can be calibrated with reference runs before the scenario version is frozen.

During settling and scoring, allow observations, explanations, messages and non-interacting walking, but no character crafting, mining, transfers, placement, deconstruction, rotation, recipe changes or other production-affecting mutations. Enforce this in the game gateway for queued as well as new work. A request to resume repairs aborts verification before reopening mutation admission. Detected human world edits also invalidate the attempt and mark assistance; unclear effects invalidate affected evidence. Ordinary automated inserter, belt, mining and crafting activity continues. Setup protections and the prohibition on manual science crafting apply throughout a benchmark run.

For every window, require at least 30 new machine-produced packs and at least 30 automatically delivered packs at the designated collector. The collector drains output so it cannot back up. No manual insertion into the collector is accepted. Prevent manual science crafting during scored runs through the gameplay tool policy, and distinguish player interventions from autonomous production. Validate counters against engine observations, not agent self-reports.

Do not count starting packs, manually delivered inventory, artificial fixture output, or science merely claimed in a message. If evidence is missing after a disconnect, mark that interval invalid and restart verification after reconciliation. Do not treat a large pre-existing stockpile as proof of ongoing production.

### Required upstream evidence

Each scenario must demonstrate its required source-to-collector chain operating during the same five scored windows. Beyond the per-minute science conditions, require the following minimum fresh quantities over the full 18,000-tick measurement period, derived again from the installed recipes at setup:

| Scenario | Required measured chain and minimum quantities at the current ordinary recipes |
| --- | --- |
| S1 | Automated intake from the supplied terminals of 150 gears and 150 copper plates into the science production chain. |
| S2 | Automated intake of 300 iron plates and 150 copper plates; machine production and automated routing of 150 gears into science. |
| S3 | Automated intake of 300 iron ore and 150 copper ore; smelting and automated routing of 300 iron plates and 150 copper plates; machine production and routing of 150 gears; adequate automated furnace fuel supply from the coal terminal. |
| S4 | Machine extraction and automated routing of at least 300 iron ore and 150 copper ore from the designated patches; the S3 smelting/gear chain; quantitative mined-coal supply for power and smelting. |
| S5 | The S4 chain and fuel conditions after restoration, plus the recovery deadline and validated fault controls. |

Apply upstream totals over the five-window period so ordinary batch timing and buffers do not require every stage to run in every minute. Require observed transfers through each necessary link to the downstream production system; summing unrelated machines' production, filling an unused chest or observing a possible connection cannot establish delivery. A factory whose science cell consumes old stock while a separate upstream cell merely produces matching quantities must fail.

The evaluator records machine production/extraction, net transfers at the required stage boundaries, and starting/ending material inventories, including belts, inserter hands and in-process items where relevant. Opposing transfers and recirculation cannot multiply delivery credit. Reconcile those balances with consumption in the evaluated chain. Bound permitted buffer drawdown and phase/measurement tolerances in the versioned evaluator; tolerances may cover documented in-flight effects but cannot substitute for a required stage's minimum fresh production and delivery. Normal mixed buffers are allowed without inventing per-item identity. If available observations cannot distinguish a bypass from a valid chain, verification is invalid until the evaluator gains sufficient measurement coverage or the validated fixture is adjusted.

Every scenario needs negative controls for preloaded ingredient buffers, character supply attempts during verification, and disconnected or unused upstream production. S2 additionally tests hand-crafted/pre-stocked gears replacing gear automation; S3/S4 test missing smelting/mining stages as applicable. Positive references must still pass with ordinary legal buffering. These controls are evaluator tests, not extra factories or solutions exposed to gameplay agents.

### Quantitative fuel supply

For S3, measure automated coal delivery from the supplied terminal to the working furnaces. For S4/S5, measure fresh coal extraction, delivery along the working automatic route, and replenishment of the actual power and smelting consumers. Over the scored period, source admission and downstream delivery must each cover the fuel energy consumed by those consumers, subject only to declared, reference-tested item/phase tolerances. Mining enough coal into an isolated chest does not count as fuel delivery.

Inventory balances include initial and final coal in chests, belts, inserter hands and burner inventories, plus remaining energy in currently burning fuel. Record stored steam/thermal energy where it can mask power-fuel demand. Check each required consumer branch so excess supply to one branch cannot hide depletion in another. Account for permitted short-period buffering, but reject a sustained fuel/energy deficit concealed by drawing down initial reserves. Tolerances are fixed before the run, reported with measurements, and must be small enough that the validated deficient-delivery controls fail. Do not require arbitrary identity tags on fungible coal; establish replenishment through observed source/route/consumer balances. If balances or energy coverage are insufficient, report invalid verification rather than success.

The positive fuel reference must replenish working consumers at target output. Negative controls include no fuel automation, a trickle of freshly mined coal with insufficient delivery, and adequate coal mining whose delivery to a required burner branch is insufficient; run these with enough preloaded reserves to conceal the defect from science-output counters alone.

### Verification timing and run limits

S5 must have a successful verification attempt admitted within ten game minutes of fault injection; its fixed settling interval and five-minute measurement may finish afterward. Reject new attempts after that admission deadline and allow only an already admitted attempt to finish. Its allowed finish is bounded by the admitted start plus the fixed settling and measurement durations, and by the independent wall-time ceiling. Report the admission-based recovery time, first measured-output tick and final verification time explicitly. A failed or invalid attempt does not establish recovery.

Run limits are configurable. Initial proposals: 30 game minutes for S1/S2, 45 for S3, and 60 for S4, including their settling/scoring periods; S5 uses the separate admission and finish deadlines above. An additional 90-minute real-time ceiling prevents hanging sessions. Calibrate these defaults using reference execution and a small number of model runs; do not encode untested latency assumptions as scientific conclusions.

Every run records completion, throughput windows, upstream/fuel balances and coverage, verification invalidations, materials used/recovered, peak power demand where available, failed/partial orders, provider turns, gateway tool-call attempts, per-turn elapsed time, reported token usage when available, elapsed wall/game time, roster, model/instruction versions and intervention count. Record applied budget limits and their actual stopping reasons as specified in ARCHITECTURE.

## Comparison and improvement

Run solo and team variants on the same scenario fingerprint with matched limits. Repeat trials; a single successful attempt does not establish reliability. Keep assistance level, supplied toolkit, model, and scenario constant when comparing a coordination change. Test selected improvements on held-out fixture variants so success is not simply memorization of one layout.

State whether a comparison measures performance under equal aggregate usage limits or under equal elapsed-time limits with different concurrency. Record run-wide and per-turn caps, tool-call counts, observed token usage and permitted concurrency; matching provider-turn counts alone does not establish equal inference expenditure. Missing subscription telemetry remains unknown, not an estimated balance derived from turn counts.

Human hints make a run assisted. Preserve the exact hint and its causal links; test proposed lessons on a fresh unassisted run before promoting them into the agent instructions. Distinguish historical UI replay, deterministic reference replay, and a fresh stochastic model run.

## Sources for initial mechanics

The ordinary red-science recipe and assembler-speed calculation are supported by the [Factorio red-science page](https://wiki.factorio.com/Automation_science_pack) and [assembling machine 1 page](https://wiki.factorio.com/Assembling_machine_1). Installed game data overrides documentation if they differ. Use the [official version index](https://lua-api.factorio.com/) to select the pinned API documentation rather than assuming `/latest/` refers to stable.
