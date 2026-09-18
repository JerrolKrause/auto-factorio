# Some Assembly Required

S2 starts from a fingerprinted, disarmed 80×80 fixture with iron plates at 120/minute, copper plates at 60/minute, protected power, a draining science collector and a finite normal-quality kit. It supplies no gear production. Solo and team launches use the same fixture and briefing.

```powershell
corepack.cmd pnpm build
corepack.cmd pnpm scenario:launch --scenario 02-some-assembly-required --roster team
# --roster solo uses the same fixture. Reset only a held matching S2 run:
corepack.cmd pnpm scenario:launch --scenario 02-some-assembly-required --roster solo --reset '<run>/run.json'
```

`s2-v6` freezes 12 assembling machines, 300 belts, 60 inserters, 12 long-handed inserters, 14 underground belts, 6 splitters, 24 small poles and 8 wooden chests. The two additional underground belts relative to S1 support the calibrated seven-science-assembler legal reference. Installed Factorio recipes determine the required five-window totals: 300 iron plates into connected gear machines, 150 connected gears into science, 150 copper plates into science, and 150 freshly produced/collected automation science packs. `s2-measurement-v5` records complete inventory totals plus admission-stable components joined by active transport links. `s2-calibration-v5` sums component decreases, so ordinary movement within one active route is not drawdown while growth in an inactive branch cannot cancel depletion of a separate preloaded branch. Gear-stage reconciliation allows a four-item in-flight residual and 16 items of drawdown; all other balance tolerances are zero and other stages permit at most 12 items of drawdown.

The operator-only probe consumes no model usage:

```powershell
corepack.cmd pnpm scenario:launch --scenario 02-some-assembly-required --roster solo --hold --result-file '.runtime/s2-launch.json'
corepack.cmd pnpm game:plate-to-science-probe --run-file '<run>/run.json'
```

It builds the hidden reference through 506 ordinary character-gateway steps, scores five exact windows, then runs an unchanged 100-gear connected-side-buffer pass plus preloaded/hand-supply, character-mutation, and partially routed producer/shared-buffer failures. The partial-route control produces at least as many gears as it delivers in aggregate but fails because accumulation in its inactive component cannot cancel preload depletion in the active route. Privileged control setup is labeled evaluator-only evidence. Unknown command outcomes are not retried in place. The final profile is held and previous failures remain retained.

See [decision 015](../../docs/decisions/015-plate-to-science.md) and the [current handoff](../../docs/IMPLEMENTATION_HANDOFF.md).
