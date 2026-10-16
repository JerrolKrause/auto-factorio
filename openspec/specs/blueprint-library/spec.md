# Blueprint library

## Purpose

Preserve discoverable, compatible factory design variants as portable blueprints that humans can import and AutoFactorio characters can reconstruct.

## Requirements

### Requirement: Stable organized blueprint families and revisions

The library SHALL organize components by product/function, family, variant and immutable revision, using stable identities independent of editable names. It SHALL support multiple designs for the same output, including different machines, technology, modules, throughput and interfaces. Search/filter SHALL expose those dimensions plus surface, quality, footprint, verification status and provenance. Each revision SHALL retain canonical blueprint content, native export, compatibility, ports, bill of materials, measurements, lineage and evidence references. Human-readable names and portable folder conventions SHALL be documented.

#### Scenario: Find an appropriate circuit variant

- **WHEN** a consumer searches circuits under starter capabilities and later under an EM profile
- **THEN** compatible variants are discoverable with their actual requirements and tradeoffs, renaming one does not break references, and neither overwrites another's immutable revision.

### Requirement: Evidence-based automatic admission

The system SHALL distinguish draft, export-valid, production-verified and character-build-verified evidence. Default reusable admission SHALL require valid compatibility/export, measured assignment compliance and a recorded useful distinction or improvement relative to comparable entries. Automatic admission SHALL be available without human approval; optional UI checkpoints SHALL not replace validity gates. Duplicate/dominated outcomes SHALL retain session history and the admission reason. Atomic idempotent admission SHALL prevent concurrent/retried writes from overwriting unrelated variants. Every score SHALL name the exact evaluated revision and rubric/environment.

#### Scenario: Keep a useful earlier revision

- **WHEN** a later attempt regresses and an earlier valid variant meets the assignment with a useful cost/interface distinction
- **THEN** finalization can admit the earlier variant, retain both attempts' evidence and reject a repeated admission without creating duplicate library entries.

### Requirement: Explicit interfaces and compatibility validation

Each blueprint SHALL describe input/output item or fluid identities, rates, port coordinates/directions, belt lanes or fluid conditions, power/fuel assumptions, byproducts, orientation and required clearance. Before reuse, the system SHALL validate game/mod compatibility, research/bonuses, equipment, surface, supported fields and actual material availability against the target run. A changed fingerprint SHALL invalidate prior compatibility claims until explicitly revalidated; a compatible profile name alone SHALL NOT suffice.

#### Scenario: Unsupported target or changed game

- **WHEN** a consumer selects a blueprint using unavailable modules, an illegal surface condition or settings unsupported by its executor
- **THEN** preflight returns specific incompatibilities before any construction and does not silently downgrade, omit or substitute content.

### Requirement: Human-native export and clean round trip

The UI SHALL export individual native blueprint strings and selected blueprint books, with meaningful names/descriptions and optional metadata/evidence-summary bundles. Supported exports SHALL work in a compatible ordinary Factorio/Space Age game without the AutoFactorio mod. Exports SHALL exclude sandbox fixture entities, provider transcripts, credentials and game binaries. Draft exports SHALL be labeled unverified. Export/reimport validation SHALL preserve supported geometry, recipes, modules, settings, wires and descriptions, and demonstrate production against the declared interfaces.

#### Scenario: Human imports a blueprint book

- **WHEN** selected verified circuit variants are exported as a book and imported into a clean compatible game without AutoFactorio
- **THEN** the variants retain names, requirements and supported configuration, require no workshop supply entities, and a reconstructed reference produces the measured target under equivalent declared inputs.

### Requirement: Legal character reuse in ordinary runs

An authorized engineer SHALL be able to select a compatible library revision and construct it with a runtime-authorized character from its actual inventory through bounded deterministic batches. Reuse SHALL enforce ownership, reservations, legal reach/pathing/timing, finite material accounting, supported transformations/configuration and post-build comparison. It SHALL require neither construction bots nor fresh model reasoning per placement. It SHALL NOT grant sandbox provisioning or direct placement in ordinary runs. Successful construction SHALL be distinct from successful production.

#### Scenario: Character reconstructs a saved component

- **WHEN** an ordinary run supplies a compatible blueprint, sufficient materials, a character and suitable reserved space
- **THEN** the character places/configures it legally, receipts and normalized world state establish the exact reconstruction, and a separate production check verifies its advertised output without redesigning the layout.

#### Scenario: Partial build and save-load recovery

- **WHEN** a build is interrupted after some placements, a receipt is lost or a work position becomes blocked, and the game is saved/restored
- **THEN** reconciliation identifies completed effects, construction remains held until safe to continue, and recovery neither duplicates entities/material consumption nor deletes unrelated structures; an unreachable remainder reports its blocker.

### Requirement: Boundary-equivalent production evidence and reuse

Library admission, search, score comparisons, Improve and reuse SHALL preserve a versioned canonical evaluation-boundary identity alongside blueprint identity. This identity SHALL distinguish component/chain mode, target rates, external supplies/capacities, finite-stock policy, utilities/fuel, co-product destinations, surface/quality, profile/bonuses, construction/evaluation conditions and measurement rules. Comparisons SHALL require equivalent boundaries, installed compatibility and rubric; product/profile names alone SHALL NOT establish comparability. Identical native blueprint content evaluated under different boundaries SHALL retain separate immutable attestations without overwriting evidence or changing portable content identity.

New chain evidence SHALL retain the normalized public request and exact plan/evaluation provenance. Matching-boundary Improve SHALL restore those inputs, revalidate current compatibility and start a new evaluation. A boundary change SHALL require an explicit new evaluation and SHALL NOT inherit prior production verification or a comparison score. Legacy records SHALL retain historical content/scores; unknown boundary provenance SHALL be labeled and excluded from boundary-sensitive ranking and verified reuse until resolved from complete retained authoritative evidence or newly evaluated. Ordinary reuse SHALL retain actual-inventory, interface and ownership checks without inheriting sandbox supply privileges.

#### Scenario: S4-08 Compare and retain different boundaries

- **WHEN** a petroleum-fed sulfur component and a crude-oil-to-sulfur chain have the same product/profile, or identical blueprint bytes receive measurements under different supply capacities
- **THEN** unlike boundaries do not rank against one another or suppress admission as dominated, and separate boundary-keyed evidence survives retrieval without overwriting either historical measurement.

#### Scenario: S4-09 Improve and restore boundary provenance

- **WHEN** Improve is requested through the UI or runtime for a chain revision, then the request's input boundary is changed, or a legacy revision lacks complete boundary evidence
- **THEN** matching-boundary Improve restores and revalidates the exact public request/provenance, a changed boundary requires fresh evaluation without inherited verification, and the legacy record stays readable with an unknown boundary instead of being guessed compatible.
