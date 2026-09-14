# 002: Organize implementation into bounded OpenSpec phases

Status: planning organization prepared at the user's request, 14 September 2026. No implementation is authorized by this planning turn and no integration is claimed passed.

## Context

The repository contains approved requirements, scenario rules and eight review corrections, but no runnable code. Applying one change for all milestones would load too much unrelated planning and invite a single implementation session to cross several unverified gates.

## Decision

Use 18 sequential changes with one capability delta each and a complete proposal/design/spec/tasks packet. Phases 01–04 split feasibility, 05–09 build durable controls, 10–12 establish First Shift, 13–16 complete the remaining scenarios, and 17–18 provide retrospectives and distribution.

Keep the original documents as source context and add an [implementation guide](../IMPLEMENTATION_GUIDE.md) plus [requirements coverage map](../SPEC_TRACEABILITY.md). Main OpenSpec specs are populated only as completed changes are synced/archived; future behavior remains in delta specs. No capabilities currently exist to modify, so these initial deltas use ADDED requirements and distinct names.

Each apply request selects one exact change and stops after its evidence/handoff. The predecessor gate is an explicit task and guide contract. The current OpenSpec schema validates artifacts within a change; it does not enforce inter-change dependencies. Artifact readiness must never be mistaken for passing a live prerequisite.

## Boundaries and alternatives

One change per original milestone was rejected because milestone 0 combines provider and game feasibility, milestone 1 combines several failure-sensitive runtime features, and milestone 3 includes four distinct scenario control matrices. One giant umbrella spec would create broad repeated context and long partially completed task lists. Finer splitting by individual source file would scatter acceptance evidence across sessions.

Each packet targets one fresh context with a bounded integration outcome. Unforeseen external failures can require resuming the same change with a precise handoff. They do not justify skipping requirements to fit an artificial time or context guarantee.

The stack, fixtures and operating limits retain their documented proposed/validation status. The new budget defaults in phase 02 and phase 12 are bounded test plans to declare before use, not verified latency or subscription-cost estimates. Routine software/failure checks use fakes; model trial outcomes are reported independently of software/scenario correctness.

## Consequences

This adds planning files only. It preserves all R01–R18 requirements and all eight accepted corrections, particularly the real-game phase 04 gate before phase 05. Future contract changes must be reconciled into dependent proposals before applying them. Archive operations must update guide/coverage links. The next bounded action is phase 01 when explicitly requested.