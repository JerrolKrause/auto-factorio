## Why

Implemented capabilities are not a usable release until setup, mod packaging and evidence retention work on Windows.

## What Changes

- A local launcher/install path, five-scenario release matrix, retention/disk diagnostics and reproducible software checks.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 18 only after `af-17-retrospectives-branches` has passed its implementation gate; see the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `windows-distribution`: A local launcher/install path, five-scenario release matrix, retention/disk diagnostics and reproducible software checks.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: scripts; launcher; mod packaging; README; CI; retention/backup controls. Source basis: ARCHITECTURE §§1, 8, 11–12; REQUIREMENTS: Deferred scope; IMPLEMENTATION_HANDOFF: Milestone 4. Requirement coverage: R08–R11, R14, R17; original milestone: M4.

Outside this change: Bundled game binaries/assets, public hosting and automatic prerequisite upgrades. The current repository remains a documentation-only starter; earlier phases are prerequisites, not claims of existing code. This proposal is planning only.