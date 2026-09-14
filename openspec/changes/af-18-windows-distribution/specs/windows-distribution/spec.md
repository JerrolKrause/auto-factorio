## Purpose

Defines windows distribution and release gates for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## ADDED Requirements

### Requirement: Windows local launch and packaging

The release SHALL provide tested Windows setup/launch/mod packaging instructions using the user's licensed installation and an explicit isolated data directory. Mods SHALL be copied into the controlled directory without mandatory symlink privileges; binaries/Space Age assets SHALL NOT be redistributed.

#### Scenario: Windows local launch and packaging acceptance

- **WHEN** a fresh local data directory is configured using the documented commands
- **THEN** the launcher validates prerequisites and starts a visible selected scenario without changing personal saves, global Codex settings or buying provider access.

### Requirement: Five ready-to-launch scenarios

Release readiness SHALL require all five versioned scenarios with reset, briefing, finite equipment, passing legal references and failing applicable bypass controls, including every S5 fault. Selecting scenario and solo/team roster SHALL be sufficient after setup.

#### Scenario: Five ready-to-launch scenarios acceptance

- **WHEN** the release matrix is evaluated while one S5 variant lacks an every-start negative control
- **THEN** the release remains incomplete even if First Shift or other scenarios work.

### Requirement: Retention and disk integrity

The runtime SHALL expose retention settings and disk pressure, preserve evidence completeness truthfully and avoid silently discarding required artifacts while labeling a run fully recorded. Cleanup SHALL preserve referenced checkpoint/branch artifacts or mark affected data explicitly unavailable.

#### Scenario: Retention and disk integrity acceptance

- **WHEN** disk space is exhausted or retention removes an artifact referenced by a report
- **THEN** recording failure or missing evidence is visible and affected verification/recovery cannot be claimed intact.

### Requirement: Reproducible software and licensed integration checks

Documented build/lint/test commands SHALL match actual scripts and lockfile and be executed on Windows, with portable fake/software checks on Linux where practical. Public CI SHALL NOT require licensed assets or automatic model-backed inference.

#### Scenario: Reproducible software and licensed integration checks acceptance

- **WHEN** software CI runs without Factorio or subscription credentials
- **THEN** deterministic checks execute and live engine/provider gates remain separately recorded rather than fabricated passes.

### Requirement: Release handoff

The release report SHALL identify tested code revision, Node/Codex/game/mod versions, notices, actual software/live/model checks, known limitations and operational recovery instructions. Model reliability SHALL be reported separately from scenario/reference readiness.

#### Scenario: Release handoff acceptance

- **WHEN** packaging completes with some model trials unsuccessful
- **THEN** the report preserves those outcomes and judges release gates from explicit implementation and scenario evidence without promising agent success.