# First Shift Reference Specification

## Purpose

Defines first shift reference for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## Requirements

### Requirement: Controlled S1 fixture

S1 SHALL launch a versioned cleared Nauvis site with normal-quality finite construction equipment, no biters/cliffs or necessary hand-mining/chopping, only needed technology grants, labeled gear/copper terminals, protected power and a draining output collector. No completed production cell or reference layout SHALL be provided to gameplay.

#### Scenario: Controlled S1 fixture acceptance

- **WHEN** the operator selects S1 and a roster after installation
- **THEN** a visible character starts with the recorded kit and normal mechanics, and the briefing explains the goal and supplied interfaces without a solution.

### Requirement: Manifest and safe reset

Each S1 fixture SHALL record seed, game/mod fingerprint, actual technology grants, kit, rates, allowed actions/recipes, settling/timing limits and evaluator version. Cached scenario saves SHALL be disarmed and loaded through the restore barrier; reset SHALL create a new run/epoch while preserving prior history.

#### Scenario: Manifest and safe reset acceptance

- **WHEN** the same validated fixture is reset twice
- **THEN** fixture fingerprints and intended setup match, histories remain separate and saved orders do not execute during load.

### Requirement: S1 end-to-end acceptance

S1 SHALL apply the shared five-window rule and require automatic terminal intake into the science chain of at least 150 gears and 150 copper plates over the scored period at the currently documented recipes, recalculated from installed data. All required net flow and inventory evidence SHALL be present.

#### Scenario: S1 end-to-end acceptance acceptance

- **WHEN** a legal machine-built factory routes sufficient fresh ingredients and produces/delivers 30 packs in each window
- **THEN** the evaluator passes it with stage/output evidence and no model judgment.

### Requirement: Ordinary-gateway reference

The hidden deterministic S1 reference SHALL build through the same legal actions, inventory, timing, reach, mutation and ownership policies as gameplay; its reference instructions/events SHALL be evaluator/operator-only.

#### Scenario: Ordinary-gateway reference acceptance

- **WHEN** the reference executes from the cached initial fixture
- **THEN** it passes with ordinary legal buffering, finite equipment and no privileged placement or leaked layout.

### Requirement: Live bypass controls

Live S1 validation SHALL reject preloaded ingredient/output buffers substituting for fresh flow, character supply during verification and disconnected/unused upstream supply. Software traces alone SHALL NOT establish engine measurement coverage.

#### Scenario: Live bypass controls acceptance

- **WHEN** each bypass is constructed with enough old inventory to sustain final output
- **THEN** the control fails or is explicitly invalid for missing coverage, while the positive reference passes under the same frozen evaluator rules.