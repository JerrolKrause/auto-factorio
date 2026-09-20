# Workshop core boundaries

The workshop resolves profiles from installed data and pins the full game/mod fingerprint. Allowed placement inventory is separate from locally manufacturable equipment. A profile name alone never establishes compatibility after the fingerprint changes.

The initial compatibility adapter accepts normal-quality deterministic recipes for assemblers, furnaces, chemical/oil machines, electromagnetic plants and foundries, plus belts, inserters, containers, pipes, pumps, poles, lamps, modules and beacons. It preserves recipe, direction, filters, modules, supported connections and inventory-bar settings. It rejects unsupported quality, stochastic or spoilage recipes, trains, platforms, circuit programs, and dedicated mining or power designs before mutation.

The bounded installed-data sample in [`tests/fixtures/workshop-installed-sample.json`](../../../tests/fixtures/workshop-installed-sample.json) was recorded from Factorio 2.0.77 build 84539 on 19 September 2026. Its source hashes pin the installed runtime/prototype API and Space Age entity/technology definitions. The sample confirms the Lua surface/entity/inventory/force access required by the adapter, the foundry and electromagnetic-plant categories/module slots, and the actual electromagnetic-plant technology prerequisite/unlocks. The sample records availability only; later live workshop probes establish behavior.

The adapter deliberately does not infer late-game measurement coverage from the earlier decision-context sampler. Workshop admission requires its own clean reconstruction and typed flow/stock coverage.
