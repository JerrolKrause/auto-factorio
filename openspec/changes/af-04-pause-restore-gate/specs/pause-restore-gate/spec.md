## Purpose

Defines real-game pause and restore gate for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## ADDED Requirements

### Requirement: Pause under continued polling

Explicit pause SHALL freeze simulation-based scoring, production, queued effects and scenario timers while structured polling continues. The evidence SHALL record game.tick, ticks_played, experiment clock, receipts and inventories before, during and after pause.

#### Scenario: Pause under continued polling acceptance

- **WHEN** the visible hosted sandbox is paused with pending movement and repeated RCON observations
- **THEN** no scoring/production/action/injection progress occurs during pause and resume advances only after control reconciliation.

### Requirement: Restorable disarmed checkpoint

A restorable checkpoint SHALL close admission, acknowledge executor disarm, neutralize character controls and suspend/cancel timed actions, pause the world and confirm a completed save with checksum plus command ledger/event position. Incomplete saves SHALL NOT be published as restorable.

#### Scenario: Restorable disarmed checkpoint acceptance

- **WHEN** saving is interrupted before completion or checksum verification
- **THEN** the capture is unusable for automatic recovery; pending intents remain data and cannot execute.

### Requirement: Pre-execution restore barrier

Managed load SHALL hold simulation and execution before any saved order acts, validate the save/manifest pair, reconcile the checkpoint's world and ledger, install a new epoch/control session and current generations, and explicitly arm only authorized work. The lifecycle SHALL be multiplayer-safe and SHALL NOT mutate persistent state in Lua on_load.

#### Scenario: Pre-execution restore barrier acceptance

- **WHEN** an order saved as pending was cancelled after the checkpoint and the older save is loaded with delayed old traffic
- **THEN** it produces no effect before reconciliation or afterward unless newly authorized; old-session messages are rejected and post-checkpoint completed states are not assumed present in the restored world.

### Requirement: Control loss and uncontrolled saves

A heartbeat watchdog SHALL disarm character execution on control loss, and returning heartbeats SHALL NOT re-arm it. Native/autosaves and user-opened saves SHALL be refused for automatic continuation unless the same pre-execution barrier is proven.

#### Scenario: Control loss and uncontrolled saves acceptance

- **WHEN** control disappears during a timed action and later reconnects, or an armed unknown save is presented
- **THEN** execution remains disarmed pending reconciliation and explicit authorization; unsafe continuation is rejected with a diagnostic.

### Requirement: Mandatory live milestone gate

Durable runtime implementation SHALL require a passed real-game hosted pause/save/load/reconcile/re-arm trace with pending work and post-checkpoint cancellation, plus the provider and action evidence from phases 01–03. Fake adapters or provider resumption alone SHALL NOT satisfy this gate.

#### Scenario: Mandatory live milestone gate acceptance

- **WHEN** the current hosting topology cannot freeze polling or prevent saved work from executing
- **THEN** the integration report records a failed gate and the adapter/topology is revised and retested before phase 05 proceeds.