## Context

See [proposal](proposal.md) for motivation and [capability spec](specs/compatibility-foundation/spec.md) for behavior. The baseline is documentation-only at planning revision `1cdff32`; no proposed runtime package exists yet. Source reading for this phase: ARCHITECTURE §§1, 10–12; IMPLEMENTATION_HANDOFF: Milestone 0. Prior phases supply the interfaces described below only after their gates pass.

## Goals / Non-Goals

**Goals:** Complete one bounded implementation slice (M0, phase 01) using the smallest affected modules: root workspace configuration; packages/contracts; scripts; third_party; docs/decisions.

**Non-Goals:** Provider sessions, game execution and full storage/runtime implementation. Preserve the first-release exclusions in REQUIREMENTS; do not build unused future packages.

## Decisions

1. Create only the workspace packages needed by the first probes. Use Node 24 LTS, strict TypeScript and pnpm with an actual lockfile; keep pure contracts independent of HTTP, provider and engine adapters. A full empty package tree would increase maintenance before feasibility is known.

2. Probe better-sqlite3 transaction/backup behavior on Windows as the initial candidate; select another compatible SQLite driver only with recorded evidence. Record current executable versions rather than inferring compatibility from the documentation's September observations.

3. Inspect the narrow action/pathing portions and notices of FLE and Agentic-Factorio before choosing selective reuse or a small original adapter. Do not import their agent loops or provision reference blueprints.

## Risks / Trade-offs

Unusable installed prerequisites → report the exact requirement and let the user manage upgrades. Unclear upstream notices → do not copy affected code until resolved.

## Migration Plan

Prerequisite: preserve current user changes and recheck installed prerequisites. Read the [implementation guide](../../../../docs/IMPLEMENTATION_GUIDE.md) and only this change's artifacts plus the listed source sections. Implement its tasks; do not begin the next change. Record interface decisions and exact executed checks in the handoff. If a live gate fails, retain the evidence and keep the relevant task open. Roll back software through a reviewed change and recover only from validated disarmed game checkpoints; never reset personal saves or discard user work.

## Exit Gate

Workspace commands execute, SQLite smoke passes and the compatibility/provenance report lists observed versions and remaining live gates.

Target one fresh context window for this phase, not a guaranteed elapsed-time or token promise. If an integration investigation exhausts useful context, write a precise handoff with pending task IDs and resume this same change; do not weaken its acceptance criteria or silently advance.