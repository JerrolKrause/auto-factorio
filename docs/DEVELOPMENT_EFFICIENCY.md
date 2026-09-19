# Development efficiency workflow

These helpers reduce developer-session bookkeeping without reducing acceptance coverage. They are advisory, start no game, and grant no inference authority.

## Bounded implementation packet

Before crossing a new integration boundary, record the task/spec links, exact owned files, invariants, failure cases, acceptance commands, resource owner/cleanup and escalation condition. Sol/high owns milestones; Terra/medium handles clear bounded modules; Luna/medium handles routine verification and focused tests; Astra is reserved for consequential design or unfamiliar diagnosis. Missing requested models are blockers, never substitution or API-billing triggers.

A test-author packet adds stable interfaces, named test-file ownership, behavioral cases, forbidden side effects, a time/provider budget and the expected evidence. The parent integrates results rather than duplicating routine polling. Verification and review keep their dedicated contracts; reviewers inherit the authorized author model.

## Session discipline

Use `dev:usage` with an explicit root, interval and run mapping. A session plan gives named-unit limits, closeout reserves and checkpoint cadence. Check it at task start, before expensive experiments or retries, and at checkpoints. `stop` ends new discretionary work with a handoff; `unknown` requires resolving telemetry or recording a bounded author decision. Neither state changes gameplay enforcement.

Run `dev:preflight` before experiment spending. Serialize game profiles, browsers and timeout-sensitive suites under one named owner. After the same unchanged failure occurs twice, return its exact command, signature, evidence and the next discriminating check before rerunning. Stabilize the source candidate before final verification/review; reuse evidence only when its declared dependencies remain unchanged.

A compact handoff contains revision/fingerprints, current decisions, remaining criteria, evidence paths and exits, session-plan state, resource cleanup, limitations and one next bounded action.

## No-inference worked example

The checked-in declaration [development-preflight.example.json](examples/development-preflight.example.json) maps the current fake-only composition regressions to a software criterion:

```powershell
corepack.cmd pnpm dev:preflight --input docs/examples/development-preflight.example.json
corepack.cmd pnpm dev:task --change af-development-efficiency --task 4.3
```

The first command writes a new `.runtime/preflight/check-*/manifest.json`, runs only local Vitest processes and cannot dispatch a game/provider command. The second is preview-only and starts no inference. A non-ready manifest lists exact missing/failed/stale retained evidence; even a ready manifest states that it neither proves Phase 12 live-trial acceptance nor authorizes a trial.

## Routing pilot

Use [routing-outcome.template.json](examples/routing-outcome.template.json) for the next separately authorized ordinary task. Preserve unknown model/usage fields as `null`, link aggregate sessions and acceptance/rework evidence, and avoid comparative reruns. One observation may refine guidance but cannot establish savings from a model label.
