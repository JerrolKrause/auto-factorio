# First Shift implementation

The public [briefing](briefing.md) describes the challenge without a reference layout. Setup, capture and reset are implemented in [the session launcher](../../scripts/dev/first-shift-session.ts); [the Lua fixture](../../mods/autofactorio/first_shift.lua) supplies authoritative installed recipe, grant, kit and mod data. Scenario readiness depends on the live acceptance gate in the [handoff](../../docs/IMPLEMENTATION_HANDOFF.md).

```powershell
corepack.cmd pnpm build
corepack.cmd pnpm scenario:launch --scenario 01-first-shift --roster team
# Or select --roster solo. The launcher prints its run directory.
# Open that directory's dashboard.json URL; the world starts safely paused.
# Ctrl+C closes the controller after acknowledging a paused world.
corepack.cmd pnpm scenario:launch --reset '<previous-run-directory>/run.json' --roster team
```

`--hold --result-file <file>` prepares the visible paused world and closes the controller connection for deterministic validation. It preserves a roster journal and shared briefing. No command in this phase starts model inference. The default host supplies the existing dashboard and pause/resume/stop controls. The original wall/game clock origins are durable; controller replacement and pause do not replenish either limit.

Reset first validates the source/game/mod fingerprint and managed checkpoint, obtains the previous journal's exclusive lock, and checks its paused neutral barrier. It closes only that profile, verifies a fresh held load, reconnects the visible builder, and reconciles to a new epoch/session and run directory. Old histories and failed evidence remain intact. A live controller lock, changed mod bytes, unknown save, mismatched world, or absent barrier refuses reset. After source or game upgrades, generate a fresh fixture.

The operator-only [reference](../../scripts/dev/first-shift-reference.ts) uses the ordinary bounded character gateway and ownership grants. Its instructions and receipts remain outside the shared briefing and gameplay archive. [The probe](../../scripts/game-first-shift-probe.ts) records explicit privileged negative-control setup separately from legal positive actions:

```powershell
corepack.cmd pnpm game:first-shift-probe --run-file '<held-run-directory>/run.json'
```

The diagnostic accelerates simulation to 4× while retaining normal character speeds, recipe timing, and exact game-tick windows. It uses no model turns. Scoring evidence includes seven exact samples (admission, settling and five window ends), actor inventory/cursor monitoring, direct inserter deliveries, machine completions, collector drains, and input/output inventory balances. Event files and reports are operator-only. See [Decision 013](../../docs/decisions/013-first-shift-reference.md) for measurement assumptions and calibration.
