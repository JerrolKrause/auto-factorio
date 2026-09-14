## Why

Recorded experiments need practical comparisons, evidence export and controlled branches for reviewing assistance and testing lessons.

## What Changes

- Run comparison, intervention review, portable observer exports, checkpoint branches and provenance-aware lesson candidates.
- Preserve the approved product safeguards and attach explicit acceptance evidence to this bounded phase.
- Complete phase 17 only after `af-16-fault-recovery` has passed its implementation gate; see the [implementation guide](../../../docs/IMPLEMENTATION_GUIDE.md).

## Capabilities

### New Capabilities

- `retrospectives-branches`: Run comparison, intervention review, portable observer exports, checkpoint branches and provenance-aware lesson candidates.

### Modified Capabilities

None. This adds a separate capability and consumes earlier phases without replacing their contracts.

## Impact

Planned implementation areas: apps/dashboard comparison views; core branch orchestration; storage exports. Source basis: ARCHITECTURE §§7–8; SCENARIOS: Comparison and improvement; IMPLEMENTATION_HANDOFF: Milestone 4. Requirement coverage: R03, R11, R13–R16; original milestone: M4.

Outside this change: Fine-tuning, automatic lesson promotion and guaranteed deterministic model replay. The current repository remains a documentation-only starter; earlier phases are prerequisites, not claims of existing code. This proposal is planning only.