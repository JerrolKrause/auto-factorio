# verification-engine Specification

## Purpose

Defines verification engine for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## Requirements

### Requirement: Acknowledged verification admission

Verification SHALL close production-affecting character admission and acknowledge cancellation or completion of outstanding mutations before recording the admission tick, frozen evaluated scope and inventory baselines. Settling duration SHALL be fixed in the scenario manifest before the run.

#### Scenario: Acknowledged verification admission acceptance

- **WHEN** verification is requested while a transfer or placement is queued
- **THEN** the attempt is not admitted until the queued mutation is safely resolved, and its baseline excludes subsequent character supply.

### Requirement: Observation-only verification

During settling and scoring, the gateway SHALL allow observation, messages, explanations and non-interacting walking but deny crafting, mining, transfers, placement, deconstruction, rotation, recipe changes and other production-affecting character mutations, including queued work. Repair requests SHALL abort the attempt before reopening mutations. Manual science crafting and fixture tampering SHALL be prohibited throughout benchmark runs.

#### Scenario: Observation-only verification acceptance

- **WHEN** repair is requested during settling or a human edits the measured factory during scoring
- **THEN** the attempt aborts or becomes invalid, assistance is recorded for human edits, and no affected interval contributes to a pass.

### Requirement: Five fresh output windows

Scoring SHALL require at least 30 newly machine-produced science packs and at least 30 automatically delivered packs at the draining designated collector in each of five consecutive non-overlapping 3600-game-tick windows following settling. Starting packs, manual delivery and artificial fixture output SHALL NOT count.

#### Scenario: Five fresh output windows acceptance

- **WHEN** four windows meet target but one has 29 fresh delivered packs despite sufficient total stock
- **THEN** verification fails; excess from another window or pre-existing inventory cannot make it pass.

### Requirement: Connected upstream balances

The evaluator SHALL require scenario-specific fresh source production/intake and net delivery through every required downstream boundary across the same 18000 scored ticks. It SHALL reconcile start/end inventories, belts, inserter hands and in-process materials, reject recirculation credit and bound legal buffer drawdown with versioned reference-tested tolerances.

#### Scenario: Connected upstream balances acceptance

- **WHEN** a separate upstream cell produces matching totals while science consumes old stock, or items circulate across a boundary repeatedly
- **THEN** the disconnected/recirculated quantities do not satisfy the chain; missing coverage makes the attempt invalid rather than successful.

### Requirement: Clocks and invalid evidence

Scoring and game deadlines SHALL use game.tick relative to recorded origins, excluding explicit pause; independent wall limits SHALL remain enforced. Disconnect gaps, uncertain human effects or insufficient balances SHALL invalidate affected evidence and require reconciliation and a new verification baseline.

#### Scenario: Clocks and invalid evidence acceptance

- **WHEN** telemetry is missing in the third window or the runtime hits a run deadline
- **THEN** the attempt cannot be called passed and cannot continue earning output under an expired budget.

### Requirement: Versioned reproducible evaluation

Measurements SHALL retain raw baselines, coverage, per-window output, required stage quantities, tolerances, limits and invalidation reasons. Normal legal buffering SHALL pass a positive control while preloading, character supply and unrelated production SHALL fail negative controls.

#### Scenario: Versioned reproducible evaluation acceptance

- **WHEN** the same recorded valid and bypass traces are evaluated twice
- **THEN** the deterministic verdicts and evidence match and agent prose cannot alter either result.