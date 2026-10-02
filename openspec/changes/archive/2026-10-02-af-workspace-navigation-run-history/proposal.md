# Proposal

## Why

The operator console mixes workshop setup, game controls, library maintenance and unscoped evidence on one page. Users cannot reliably tell whether a click started work, what owns the game, which attempt produced feedback, or whether the requested goal was achieved. Repeated experiments need a durable, understandable home before more scenarios expand the interface.

## What Changes

- Add main navigation with dedicated Overview, Blueprint Workshop, Scenarios, Run History and Blueprint Library pages, using a shared application shell, run controls, status presentation and evidence inspector.
- Give every asynchronous action immediate accessible feedback, keep the active run and Stop run control visible across pages, and distinguish completed work, target success, cancellation, failure and unresolved effects.
- Admit only one experiment at a time against the managed game; enforce this in the runtime as well as disabling conflicting launch/resume actions in the UI. Support idempotent launch and stopping throughout preparation, inference, construction, measurement, checkpoints and finalization.
- Persist Brief/Scenario → Run → Attempt history independently of browser state and startup directories. Starting a run selects a clean run-scoped view; prior evidence remains navigable in grouped history.
- Remember workshop drafts in versioned localStorage, validate restored selections against current options and provide an explicit reset to defaults.
- Replace internal vocabulary with descriptive labels, inline help and accessible details. Present ordinary setup first and progressively disclose evaluation, budget, model and learning options.
- Expand summaries into the exact retained public instructions, observations, messages and results. Require structured, evidence-linked critique and carry it into the next design attempt without relaxing visibility or scoring rules.

## Capabilities

### New Capabilities

None; extend the existing dashboard and workshop contracts.

### Modified Capabilities

- `live-control-dashboard`: Application navigation, reusable UI, action feedback, durable grouped history, active-game ownership and truthful completion presentation.
- `blueprint-workshop`: Understandable persistent setup, single-run admission and cancellation, run-scoped attempt inspection, full supplied-context access and actionable iteration feedback.

## Impact

Primary implementation areas: `apps/dashboard/src/`, `apps/runtime/http.ts`, `apps/runtime/dashboard-types.ts`, `apps/runtime/operator.ts`, `apps/runtime/workshop-composition.ts`, `apps/runtime/workshop-live-host.ts`, `packages/core/workshop/`, shared contracts and storage, `scripts/dashboard.ts`, `scripts/scenario.ts`, `scripts/scenario-trial.ts`, `scripts/dev/first-shift-session.ts` and project-scoped startup/history registration. History registration/import covers existing ordinary scenario dashboards as well as standalone dashboard sources. Existing TypeScript/Lua receipt and durable fencing boundaries remain authoritative. Browser, runtime, storage and dedicated real-game acceptance checks are required during implementation.

Requirement coverage: R10–R19 and R21 observability, controls, retention, context isolation and workshop behavior. This is a planning-only change; the main requirements and architecture will be reconciled during implementation. No new framework dependency is required by this proposal.

## Non-goals

Implementing deferred scenario mechanics, adding a run queue or concurrent games, statistical experiment comparison, checkpoint branching, changing the scoring predicate, exposing hidden reasoning, broadening library/learning authority, or deleting existing runs. `af-17-retrospectives-branches` retains comparison/export/branching; `af-18-windows-distribution` retains release packaging and retention policy. This change supplies browseable history and startup registration they can consume, and preserves `npm start` as the ordinary entrypoint.
