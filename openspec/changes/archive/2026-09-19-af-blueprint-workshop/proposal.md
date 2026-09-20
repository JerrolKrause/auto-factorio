# Blueprint workshop

## Why

Agents repeatedly spend reasoning and game interactions designing the same factory components. A workshop should turn that work into measured, reusable blueprints for both AutoFactorio characters and human players, while using observed mistakes to improve the designer and scorer without endlessly growing their instructions or tools.

## What Changes

- Add a UI-launched, durable workshop with designer, scorer and learnings roles, configurable human checkpoints, and unattended design/score loops.
- Add session-default and per-role model/reasoning-effort options using managed OpenAI subscription access, with capability validation, pinned run provenance and a provider-extensible contract; other providers remain deferred.
- Provide a large extensible cleared sandbox, unlimited profile-allowed supplies, character construction or direct placement, and accelerated game-time evaluation.
- Define technology profiles, explicit component interfaces and every-window per-port production acceptance, with separate qualitative scoring and interaction critique; isolate blind critique from private library comparison.
- Store versioned blueprint families and useful variants; support discovery, native blueprint/book export, and legal character-based reuse in ordinary runs.
- Expose revision comparisons, scorer feedback, supplied agent context/history, usage and learning diffs/results through the existing dashboard.
- Allow bounded autonomous improvements to role instructions and approved tool modules between sessions, with exact-bundle validation/review, isolated helper execution after activation, stale-activation rejection, rollback, scoped knowledge and explicit no-change outcomes.

## Capabilities

### New Capabilities

- `blueprint-workshop`: Session configuration, sandbox execution, independent scoring, optional human interaction, durable orchestration and observability.
- `blueprint-library`: Variant organization, compatibility, admission, native exports and character-based construction from saved designs.
- `agent-learning`: Evidence-based maintenance of designer/scorer instructions and tools, bounded knowledge, validation, activation and review history.

### Modified Capabilities

None. Existing character, subscription, coordination, dashboard and benchmark safeguards remain applicable. Workshop-only privileges and a separate maintenance role extend those interfaces without granting ordinary gameplay administrative access or changing S1-S5 scoring.

## Impact

Extend `apps/dashboard`, `apps/runtime`, contracts, orchestration, storage, structured tools and the Factorio adapter/mod; add focused workshop/library/learning modules rather than growing scenario-specific files. Reuse provider isolation, durable budgets, ownership and pause/load reconciliation. Character reuse needs configuration/module/wire operations beyond the current basic action set.

At implementation, document the workshop's explicit unlimited-supply/direct-placement exceptions in REQUIREMENTS and reconcile Phase 17's earlier recommend-only lesson scope. This proposal authorizes planning only; main requirements, existing changes and product code are not modified here. The new workflow admits tested improvements, not speculative permanent instruction promotion.

## Non-goals

Construction bots, finite-supply workshop challenges, public hosting/publishing, automatic external blueprint harvesting, model-weight training, API billing, arbitrary agent shell access, and factory-wide automatic composition. Initial supported designs use normal quality and deterministic production on Nauvis-compatible surfaces; trains, platforms, planetary progression, quality generation and advanced circuit programs are deferred with explicit unsupported results.
