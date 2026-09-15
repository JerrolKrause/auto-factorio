# Character execution

## Purpose

Defines legal character execution for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## Requirements

### Requirement: Structured authoritative game state

Observations SHALL include run epoch, game tick, surface, scope, coverage, freshness and explicit pagination/truncation. Recipe and machine facts SHALL come from the running game's complete mod fingerprint, item quantities SHALL include quality, and unsupported fluid/probabilistic/advanced calculations SHALL return explicit unsupported results.

#### Scenario: Structured authoritative game state acceptance

- **WHEN** a scoped observation is oversized or an unsupported recipe is requested
- **THEN** the response declares omissions or unsupported behavior rather than silently flattening mechanics; an ordinary deterministic ratio is derived from current game data.

### Requirement: Legal character actions

The executor SHALL enforce normal collision, pathing, reach, timing and inventory rules for movement, crafting/mining, placement, rotation, recipe changes, transfers and deconstruction. Actions SHALL name an authorized actor independent of the number of reasoning agents.

#### Scenario: Legal character actions acceptance

- **WHEN** a live batch encounters out-of-reach placement, blocked movement, insufficient inventory or an occupied tile
- **THEN** no illegal effect occurs, actual item deltas and reason codes are returned, and valid timed actions finish according to the engine.

### Requirement: Bounded asynchronous batches

The gateway SHALL accept structured data only, return an order identifier promptly, execute bounded cancellable steps deterministically and expose progress and actual completed steps. Unexpected conditions SHALL default to stopping with a partial receipt.

#### Scenario: Bounded asynchronous batches acceptance

- **WHEN** a three-step batch succeeds once then fails and is cancelled
- **THEN** the receipt identifies the first effect, the failure and unexecuted remainder without claiming atomic rollback or invoking the model per step.

### Requirement: Unknown outcome reconciliation

Command IDs and step receipts SHALL survive game saves. On lost acknowledgement, conflicting work SHALL wait for authoritative receipt/world reconciliation before a retry; advancing game time alone SHALL NOT invalidate valid local preconditions.

#### Scenario: Unknown outcome reconciliation acceptance

- **WHEN** a placement succeeds in Factorio but its response is lost
- **THEN** receipt lookup establishes the effect and the same intent is not placed twice; unresolved outcome stays visibly unknown.

### Requirement: Protected structured gateway

Gameplay SHALL use a fixed versioned structured transport and SHALL NOT submit raw Lua, console commands, setup mutations or credentials. Valid gameplay rebuilding SHALL remain autonomous inside assigned areas while fixtures and unrelated structures are protected.

#### Scenario: Protected structured gateway acceptance

- **WHEN** an agent submits an arbitrary console payload or targets protected fixture equipment
- **THEN** the gateway rejects it before a side effect and records the failed attempt.

### Requirement: Visible isolated engine evidence

The integration SHALL use the user's licensed Space Age installation in a dedicated configuration with a visible observer client and preserve observation/action/outcome traces from the first working connection.

#### Scenario: Visible isolated engine evidence acceptance

- **WHEN** the live acceptance batch moves a character, places an inventory-backed entity and forces cancellation/lost acknowledgement
- **THEN** the report records pinned versions, engine-observed effects and inventories while personal saves remain untouched.