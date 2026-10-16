# Workshop core boundaries

The workshop resolves profiles from installed data and pins the full game/mod fingerprint. Allowed placement inventory is separate from locally manufacturable equipment. A profile name alone never establishes compatibility after the fingerprint changes.

The initial compatibility adapter accepts normal-quality deterministic recipes for assemblers, furnaces, chemical/oil machines, electromagnetic plants and foundries, plus belts, inserters, containers, pipes, pumps, poles, lamps, modules and beacons. It preserves recipe, direction, filters, modules, supported connections and inventory-bar settings. It rejects unsupported quality, stochastic or spoilage recipes, trains, platforms, circuit programs, and dedicated mining or power designs before mutation.

The bounded installed-data sample in [`tests/fixtures/workshop-installed-sample.json`](../../../tests/fixtures/workshop-installed-sample.json) was recorded from Factorio 2.0.77 build 84539 on 19 September 2026. Its source hashes pin the installed runtime/prototype API and Space Age entity/technology definitions. The sample confirms the Lua surface/entity/inventory/force access required by the adapter, the foundry and electromagnetic-plant categories/module slots, and the actual electromagnetic-plant technology prerequisite/unlocks. The sample records availability only; later live workshop probes establish behavior.

The adapter deliberately does not infer late-game measurement coverage from the earlier decision-context sampler. Workshop admission requires its own clean reconstruction and typed flow/stock coverage.

Production-chain workshop integration is in progress. [`production.ts`](production.ts)
uses the shared rate planner with an exact selected profile, zero initial process
stock, explicit electricity and finite construction allowances. Its derived ports
contain declared external sources and target/co-product destinations; its stage
manifest includes every selected recipe and compatible machine. Both construction
paths must call its blueprint validation before provisioning or placement.

[`installed-chain.ts`](installed-chain.ts) and `WorkshopControl.installedChainProfile`
resolve read-only installed presets with complete recipe/equipment permissions,
technology prerequisite closure and shared production facts. The separate
`production-chain` preset permits refining/chemistry; assembly presets cannot
silently acquire a refinery. Preset availability is independent of player research
and pins zero productivity and current Nauvis surface properties.

`LiveWorkshopHost.resolve` now derives the chain assignment from the exact installed
context and shared calculator, and stores an immutable `chain-resolved.json` before
inference. Repeating the same resolution preserves that record; changing its
assignment or installed plan under the same session identity is rejected. Caller
ports cannot add internal feeds or replace the calculated boundary.
Publication writes and closes a private temporary record, then atomically links
the complete bytes without replacing an existing pin. A failed write cannot leave
partial JSON at the permanent path; unpublished temporary records are cleaned up.

Diagnostic chain construction now validates the immutable host plan and current
installed profile before setup, provisioning or placement in both build modes.
The shared adapter rejects missing/unplanned stages, altered ports, bonuses,
unsupported settings/tiles and excess equipment. Legal-character work positions
use installed collision boxes; setup retries must match the pinned construction
boundary. Chain fixtures supply only declared external inputs, limit item/fluid
sinks to their declared rates and use the explicit electricity allowance (converted
from watts to joules per engine tick, with at most one tick of stored energy).
Component fixtures retain their existing supply/measurement behavior.

Diagnostic host measurement now consumes an immutable construction manifest,
binds every stage to exact reconstructed unit identities and samples local
completed-craft stage-flow estimates with one in-flight craft per machine in
input bounds; fluid endpoints use the calibrated rounding allowance. Boundary
production deducts started-craft internal consumption before allocating fresh delivery.
Builder inventories are outside process stock; furnace inventories use their
entity-specific IDs. Recipe, bonus,
membership, counter, epoch and load discontinuities invalidate the interval.
Candidate and sink process stock must start empty before settling. Target and
declared co-product sinks require fresh production/delivery; unresolved net
co-product accumulation fails eligibility. Burner bindings pin the plan's selected
fuel. Supported normal burners measure remaining fuel plus stored heat every tick,
include that energy's fuel equivalent in process stock, and add actual consumption
once to recipe inputs. Unsupported effectivity/residue/refill bounds and energy
preloads fail before admission; wrong fuel or missing samples invalidate stage and
energy coverage. See [burner accounting](../../../docs/decisions/production-chain-burner-measurement.md).

Ordinary component and chain runs use installed, pinned assignments. Library
comparisons require the canonical boundary in `boundary.ts`, installed compatibility
and the frozen rubric. Portable content hashes remain unchanged; separate immutable
attestation IDs retain evaluations under different boundaries. Evidence includes
the full assignment, normalized chain request, exact plan and evaluation reference.
Improve restores that authority, revalidates installed facts and starts a new plan
and evaluation. Changing the boundary requires clearing the source and starting a
new evaluation. Unknown legacy boundaries remain readable and cannot inherit
verified comparison or Improve claims. None of these records supplies gameplay
inventory or authorizes sandbox inputs. The dedicated
`scripts/game-workshop-chain-construction-probe.ts` checks disconnected
reconstruction and fixture limits through the host without provider inference;
it cannot establish fresh production or chain scoring.
