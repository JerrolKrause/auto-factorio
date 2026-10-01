# Proposal

## Why

Implementation sessions repeatedly discover integration and probe defects late, then spend model usage coordinating repairs and verification. Existing compact observations, cheap verifiers and advisory efficiency helpers do not provide reliable phase attribution or make the bounded workflow the default execution path.

## What Changes

- Extend the existing developer tools with a manifest-driven verification runner, early probe preflight, bounded assertion results, dependency-aware evidence reuse and deterministic result preparation.
- Record local, correlated execution and review events so developers can distinguish product defects, harness failures, incomplete fixes, regressions, redundant checks and coverage expansion; repair real-session usage/model attribution and expose uncertainty.
- Require accepted production slices, early transition/failure coverage, bounded diagnosis after repeated invariant failures, and focused review follow-ups before final acceptance.
- Replace active developer routing defaults based on GPT-5.6 with explicit GPT-6.1 Sol, GPT-6 Luna and GPT-6 Astra selections. Choose verifier capability by uncertainty; validate availability and effort before dispatch without fallback. Preserve independent review and Astra/low gameplay rules.
- Keep automatic compaction; use evidence-backed handoffs at stable slice boundaries instead of forced compaction after every check.

## Capabilities

### New Capabilities

- `verification-orchestration`: Bounded developer check execution, resource preflight, evidence reuse, diagnostic reports and observable review cycles. This is separate from gameplay verification/scoring.

### Modified Capabilities

- `development-efficiency`: Real-log attribution, enforceable managed checkpoints, current model routing, independently accepted slices and stable verification/review sequencing.

## Impact

Extend `scripts/verify.mjs`, `scripts/dev/{checks,usage,watch,preflight,contract,task,change-readiness}.mjs`, developer tests, local workflow skills and linked documentation. Add versioned local event/manifest schemas and bounded JSON/Markdown reports under `.runtime/`; do not add an external service or a product dashboard in this change. Reuse existing game probe/composition helpers for one focused live acceptance path.

Planning changes no runtime defaults today. Implementation must preserve current uncommitted workspace work, historical model evidence, personal settings/saves and subscription-only access. It does not resume the paused workspace milestone, change gameplay scoring, launch comparative model trials, or introduce paid API usage.
