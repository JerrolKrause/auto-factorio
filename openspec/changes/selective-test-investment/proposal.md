# Proposal

## Why

The local session audit found substantial test-authoring and fixture-repair effort, while healthy suite execution was inexpensive and some runtime integration tests caught real defects. Reduce maintenance that does not strengthen acceptance evidence without discarding useful protection or weakening physical game verification.

## What Changes

- Defer activation until the user's current in-flight effort is finished and the user explicitly starts this change; writing this proposal changes no current gate.
- Require a named failure and coverage rationale before adding developer tests; no blanket requirement for a new unit test on every change.
- Retain existing stable software gates, focused deterministic and runtime integration protection, independent review, and required browser/native game acceptance.
- Diagnose after two unsuccessful corrections to one invariant; stabilize interfaces and compile changed fixtures before repeated behavioral runs.
- Define reviewed, case-by-case test retirement or replacement with explicit retained coverage. Actual test deletions are deferred to subsequent authorized maintenance, not this policy rollout.
- Evaluate the next three separately authorized implementation tasks (one observation per task) through existing evidence records, distinguishing useful catches, fixture repairs, and later-discovered defects without claiming subscription savings.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `development-efficiency`: selective developer-test investment, bounded fixture diagnosis, reviewed retirement, and evidence-based follow-up.

## Impact

- `AGENTS.md`: concise policy entrypoint and link to detailed guidance.
- `docs/DEVELOPMENT_WORKFLOW.md`, `docs/DEVELOPMENT_EFFICIENCY.md`, `docs/MODEL_SELECTION.md`: test decisions, repair limits, delegation prerequisites and follow-up observations.
- `.claude/stack.md`: clarify Vitest's unit/integration scope, retained gates, and how the kit `fix-defect` Guard step's single regression test is subject to failure-driven layer selection.
- `.agents/skills/verify-change/author-workflow.md`, `.agents/skills/verify-change/SKILL.md`, `.agents/skills/change-audit/author-workflow.md`, `.agents/skills/change-audit/SKILL.md`: author/verifier/reviewer responsibilities for coverage rationale and retirement.
- `openspec/specs/development-efficiency/spec.md`: sync the reviewed requirements at implementation closeout.
- `docs/IMPLEMENTATION_HANDOFF.md`, `docs/IMPLEMENTATION_HISTORY.md`: implementation activation boundary and compact follow-up pointer, only when this deferred change is applied.
- No runtime API, dependencies, runner/schema changes, test deletions, global settings or gameplay-agent policy changes.

## What this deliberately does NOT do

- Does not change any current gate, assignment or acceptance criterion until the in-flight effort finishes and the user explicitly starts this change. `owner-ruled`: "The user's instruction is to implement after the current effort is done." (design Context)
- Does not delete, skip or reclassify any test or change runner configuration during the rollout; later retirements happen one at a time under separate authorized maintenance. `inferred`
- Does not let fakes, simulations or test counts substitute for required browser or native-game evidence. `inferred`
- Does not let retirement reduce required acceptance; changing approved acceptance remains a user-governed scope change outside this procedure. `inferred`
- Does not add metrics infrastructure, a model benchmark, numeric coverage targets or extra work launched to obtain observation samples. `inferred`
- Does not mechanically stop fixture loops inside delegated worker sessions; the correction limit there relies on worker self-reporting and return-to-author. `inferred`
