## Why

AutoFactorio has approved requirements and design documents but no executable application. A reproducible Windows foundation must establish actual prerequisites and upstream provenance before provider or game integration work begins.

## What Changes

- Establish the minimal Node 24 LTS, strict TypeScript and pnpm workspace with executable validation scripts and a lockfile.
- Add a local compatibility diagnostic that records installed versions and verifies the selected SQLite driver on Windows.
- Record a bounded FLE and Agentic-Factorio reuse decision before implementing character mechanics.
- Preserve dedicated runtime data paths, the licensed game installation, personal saves and global provider configuration.

## Capabilities

### New Capabilities

- `compatibility-foundation`: Reproducible local prerequisites, isolated data paths and evidence-backed game foundation selection.

### Modified Capabilities

None. The main OpenSpec capability inventory is empty.

## Impact

Planned changes touch root workspace configuration, minimal diagnostics, `packages/contracts`, the storage-driver probe and provenance documentation. Phase 01 covers the setup portion of milestone 0; see [implementation guide](../../../../docs/IMPLEMENTATION_GUIDE.md). Provider inference, game actions and the dashboard belong to later phases. These are planning artifacts; no runtime capability has been implemented or validated.