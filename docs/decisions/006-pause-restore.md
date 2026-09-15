# 006: Measured pause and managed checkpoint restore

Status: phase 04 implementation. Actual gate results and retained trials are in the [handoff](../IMPLEMENTATION_HANDOFF.md). Requirements R14, R16 and R17 remain unchanged.

## Boundaries

Keep the phase 03 dedicated server plus visible Steam client. Add a small operator lifecycle adapter and file-backed checkpoint manifest; the database, task scheduler, general reservation protocol and branch UI remain later phases. Gameplay cannot invoke operator control methods. No model inference is needed for this gate.

New sandbox executors start disarmed. Cancellation now carries an epoch/session, and batches use the current diagnostic grant generation. Existing diagnostic scripts explicitly reconcile and arm, maintain heartbeats and pause before their final save. Existing phase 03 generated profiles retain their original mod copies; legacy saves without the new control state are not automatic recovery sources.

## Pause and loss of control

Close Node admission before requesting Lua disarm. Lua stops the executor, retains remaining intent as data, cancels native crafting with normal refunds and clears movement/mining controls. The engine applies walking changes on an update: freezing in the same RPC left the reported character walking state non-neutral in the first live trial. The corrected protocol polls until the disarmed executor observes neutral controls, then sets `game.tick_paused = true` and `ticks_to_run = 0`. A freeze is acknowledged only after that state is observed. Effects before this acknowledgment remain part of normal running time.

The watchdog uses `ticks_played` for its 180-update heartbeat interval, independently of the experiment clock. It disarms and neutralizes timed activity after missing heartbeats; reconnect cannot arm. Simulation time uses only `game.tick`. Diagnostic scenario elapsed time and once-per-60-tick injection counters run through the same pause guard; these counters are gate fixtures, not the future scenario evaluators. A protected, fueled furnace supplies real production evidence.

Interrupted work has a `suspended` receipt, an interrupted-step inventory delta and separate remaining intents. Reconciliation cancels all suspended intents. Any desired continuation requires an explicitly authorized new batch and command ID. This avoids restarting partially completed crafting or movement as if nothing happened. The world is not rolled back by pause.

## Capture and restore

A restorable capture requires a neutral, disarmed, paused world. Use a unique save name, a new engine log completion record, a complete ZIP central directory and SHA-256, then verify unchanged world/control state. Publish the manifest only after those checks. The minimal manifest includes the saved ledger, pending intents, world snapshot, event cursor, epoch/session/generation and mod source fingerprint. An interrupted or mismatched capture is rejected; an orphan ZIP or `.pending` file is not a managed checkpoint.

Managed load validates and copies the checksum-matched bytes into a fresh project directory. It uses a fresh RCON password, closes the prior transport and creates a new controller. The saved executor is already disarmed and the engine already paused before network control or a player joins. No `on_load` handler mutates storage or changes local execution eligibility. This removes the earlier process-local `loaded` flag, which could differ between multiplayer peers.

Factorio hides an offline player's character until that player rejoins. Before join, verify the saved control state, ledger, production and non-character entities. After the visible client rejoins, require the complete saved character, inventory and entity snapshot before reconciling. Missing character evidence is not counted as full verification.

Reconciliation uses the restored ledger as world fact, reports post-checkpoint commands absent from that world, and applies current cancellation intent without assuming later effects survived. Install new random epoch/session identifiers, advance the diagnostic grant generation, and consume a revision-bound explicit arm. Old-session gameplay and old arm messages are rejected. Old runtime credentials cannot authenticate to the restored server.

Native/armed autosaves have no managed manifest and are refused for automatic continuation. User-opened arbitrary saves are outside this guarantee. Operator-only diagnostics retain the old quiescent save command specifically so the gate can produce an unsafe-source negative control; it never publishes a managed manifest.

## Sources and validation

Inspected the official [Lua game control reference](https://lua-api.factorio.com/latest/classes/LuaGameScript.html), [control-state reference](https://lua-api.factorio.com/latest/classes/LuaControl.html) and [load lifecycle](https://lua-api.factorio.com/latest/auxiliary/data-lifecycle.html). Their current pages describe 2.1; archived 2.0.77 pages were unavailable through browsing. Installed Factorio 2.0.77 engine observations, not those newer docs alone, determine compatibility. No upstream implementation was copied.

Fakes cover incomplete save publication, checksum/source/manifest mismatches, stale/rejected controls, delayed neutralization, rollback facts and admission closure. The real-game gate records movement, crafting, furnace output/progress, both tick counters, diagnostic timers, inventories and receipts through pause, capture, load, post-checkpoint cancellation, re-arm and heartbeat loss. See the handoff for exact successes, failures, commands and limits.
