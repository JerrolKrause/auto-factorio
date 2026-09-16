# 013 — First Shift fixture and engine measurement

Status: phase 11 implementation; acceptance evidence belongs in the [current handoff](../IMPLEMENTATION_HANDOFF.md). Requirements: R05–R09 and R18. Scope: [phase 11](../../openspec/changes/archive/2026-09-16-af-11-first-shift-reference/proposal.md).

## Fixture and authority

Generate the S1 manifest from the installed engine: recipe amounts/time, assembler speed, actual technologies, mod versions, fixed seed, common kit, terminal/collector identities and timing limits. The 64×64 Nauvis site uses ordinary-quality equipment and a visible unmodified character. Protected terminals inject at most one item per 60 ticks; a blocked terminal does not accumulate a later burst. Supplied power and the draining collector are setup exceptions. Production equipment is absent from the initial cache.

Cache a complete disarmed checkpoint by canonical fixture and Lua-source fingerprint. Reset validates both source bytes and running engine versions, retains the old journal and verifies the held world before new authority. An exclusive prior-journal lock prevents reset racing a controller. New run/epoch/session identities and clock origins are durable. Pause does not reset clocks, and wall limits remain enforceable while ticks are frozen.

The deterministic reference runs through the existing character gateway, finite inventory, reach, movement, receipt and ownership checks. It uses evaluator-owned grants and private event storage; no reference layout or receipts enter the shared briefing. Negative controls deliberately inject old inventories and disconnected equipment through operator tooling outside verification; those mutations are explicit diagnostic evidence, never claimed as legal positive construction.

## Measurement

The operator admission callback captures an immutable exact-tick baseline after game-side cancellation. The Lua adapter records settling and each window boundary inside `on_tick`, so transport polling cannot interpolate or miss a boundary merely because it arrives later. Transport failures, actor disconnection, detected edits, changed character main/cursor inventory, unsupported inventory coverage and invalid guard state invalidate the attempt. Ordinary pause retains the same frozen sample; replacement authority requires repair and a new baseline.

A directed belt/underground/inserter graph selects science machines that can reach the designated collector and their input routes. Connectivity alone earns no credit. Terminal injection counters and observed inserter hand releases into selected science machines measure fresh production and forward delivery independently. Completed crafts determine ingredient consumption; assembler inputs and active crafts form downstream inventory. Upstream counts cover route chests, belts and inserter hands. Reconciliation excludes unrelated source routes and reveals material leaving the measured chain.

A third stage reconciles science itself: completed machine production, actual collector drains and output-route inventories (including underground transport and inserter hands). This prevents matching production elsewhere or depletion of old output storage from masquerading as fresh connected delivery. The protected collector has no authorized reverse or character transfer; native inventory changes during admission invalidate coverage.

Initial frozen calibration values are zero item balance residual and at most 12 items of total buffer drawdown per stage over the five scored windows. Minima never subtract these allowances. The live positive and bypass suite must establish these values before readiness. Unsupported observations fail closed; the adapter does not implement arbitrary fluid, burner-energy, quality or productive recipes. S1 accepts only its installed deterministic two-ingredient science recipe and normal equipment.

## Engine integration corrections

Cursor placement of the second underground endpoint uses the direction facing its opening; rotating an already-linked endpoint reverses the pair. The reference reads back endpoint type, direction and neighbor before production. No privileged correction is permitted in the positive plan.

Repeated pause exposed a pre-existing lifecycle latch: a pause requested while already frozen left work for an `on_tick` callback that could only run after re-arm, immediately pausing again. Disarm now schedules that callback only when ticks are running. The live reference explicitly verifies that re-arm after repeated pauses advances ticks.

Installed Factorio 2.0.77 runtime documentation supplies the API facts. Game evidence overrides assumptions from newer online documentation. This phase makes no model performance claim; phase 12 owns deliberate subscription-backed trials.
