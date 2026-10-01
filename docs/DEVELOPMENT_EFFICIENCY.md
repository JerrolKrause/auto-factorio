# Development efficiency workflow

These helpers reduce developer-session bookkeeping without reducing acceptance coverage. Usage reports are advisory; managed task and verification admissions enforce the declared plan. The authorized verification runner can start owned game checks. Reports grant no inference authority.

## Bounded implementation packet

Before crossing a new integration boundary, record the task/spec links, exact owned files, invariants, failure cases, acceptance commands, resource owner/cleanup and escalation condition. `gpt-6.1-sol` / high owns coupled milestones and / medium handles bounded modules; `gpt-6-luna` / medium handles exact verification and / high bounded adaptive checks; uncertain cross-component/recovery verification uses `gpt-6.1-sol` / high; `gpt-6-astra` / medium handles consequential diagnosis. Missing requested models are blockers, never substitution or API-billing triggers.

Changes spanning more than two capabilities or more than four integration boundaries require at least two independently accepted vertical slices. Assign each scenario to exactly one slice so duplicated slice records cannot satisfy the gate. Each slice names its production entrypoint, covered scenarios and acceptance commands. Effectful scenarios also name negative cases and recovery coverage. Fixture-only coverage cannot close a production scenario.

A test-author packet adds stable interfaces, named test-file ownership, behavioral cases, forbidden side effects, a time/provider budget and the expected evidence. The parent integrates results rather than duplicating routine polling. Verification and review keep their dedicated contracts; reviewers inherit the authorized author model.

## Session discipline

Use `dev:usage` with an explicit root, interval and run mapping. A session plan gives named-unit limits, closeout reserves and checkpoint cadence. Check it at task start, before expensive experiments or retries, and at checkpoints. `stop` ends new discretionary work with a handoff; `unknown` requires resolving telemetry or recording a bounded author decision. Neither state changes gameplay enforcement.

Run `dev:preflight` before experiment spending. Serialize game profiles, browsers and timeout-sensitive suites under one named owner. After the same unchanged failure occurs twice, return its exact command, signature, evidence and the next discriminating check before rerunning. Stabilize the source candidate before final verification/review; reuse evidence only when its declared dependencies remain unchanged.

A compact handoff contains revision/fingerprints, current decisions, remaining criteria, evidence paths and exits, session-plan state, resource cleanup, limitations and one next bounded action. Keep automatic compaction defaults. A fresh author context at an accepted boundary receives this packet with stable invariant/finding IDs and the same plan balance; no mandatory per-check compaction or global settings changes.

`node scripts/dev/handoff.mjs --input <runtime.json>` accepts a v2 `manifest`, `startSlice`, hash-pinned ledger `records`, optional `usageReport`, bounded `decisions`, `nextAction` and runtime `outputRoot`. It validates current accepted predecessors, captures assignment/result hashes and source fingerprint references, findings, resource cleanup and the unchanged plan/balance into an immutable `packet.json`. Missing usage remains unknown; a stop packet is a truthful handoff, never renewed authority. Detailed source/evidence stays behind the captured references.

## Change readiness

Copy [change-readiness.template.json](examples/change-readiness.template.json) into a task-owned path and fill its capabilities, boundaries, slices and scenario map before crossing the first integration boundary. Update the same manifest with verification/review contracts and closeout markers rather than maintaining a second status ledger.

Version 1 retains the template's existing closeout semantics and lifecycle; it cannot authorize dependent expansion. Version 2 adds explicit `prerequisites` and `acceptance` contract pairs to each slice. Run `corepack.cmd pnpm change:ready --input <manifest.json> --start-slice <id>` before expansion. Every transitive predecessor needs actual current ready verification and independent review: scenario criterion passes, matching command/evidence, source fingerprints, entrypoint review and cleanup. Slice counts and historical accepted labels cannot substitute for proof.

Version 2 uses `candidate -> smoke-verified -> reviewed-with-findings -> corrected -> reviewed-clean -> acceptance-verified -> closable`; zero-findings review can proceed directly to reviewed-clean. Final `change:ready` validates every slice on current relevant source plus completed task checkboxes and handoff markers. Routine status-only task/handoff/index updates can stay outside reusable implementation fingerprints; the gate reads them afresh. Preserve old contracts unchanged as historical provenance and supply new affected proofs after substantive changes. `--render-handoff` emits a compact block; it does not promote a lifecycle label to acceptance.

When the mutable acceptance index is excluded from source fingerprints, retain its semantics as an immutable `definition: {path, sha256}` generated by `acceptanceDefinition()` in `scripts/dev/slice-readiness.mjs`. Both verification and review must pin it, with independent reviewed scope. The gate compares all scenario/check/plan/closeout declarations to that definition; only lifecycle and returned contract/history pointers can change without new proof. Final closure also refuses accepted criteria omitted from the scenario map.

For a planned faithful archive, `closeout.archivedTaskFile` can declare the exact destination alongside the active `taskFile` in that same reviewed definition. Exactly one must exist; the gate reads its current checkboxes and refuses missing or competing checklists. Preserve reviewed spec context as immutable snapshots when its later relocation is outside the implementation boundary. Faithful archive/spec sync still requires author-run equivalence, strict OpenSpec, docs and whitespace checks.

## Review lineage and corrective admission

`node scripts/dev/review-ledger.mjs record --input <runtime.json>` writes immutable, hash-pinned records and allowlisted events. Its input names `directory`, `records` (prior references) and `record`; `assess` reads a records list and `admit` additionally names the invariant. Original findings retain both reviewer assignment/result hashes. Follow-up observations link the original record and invariant, counting the defect once. Adjudications preserve author, reason and evidence even for rejected claims. Unaffected coverage records bind unchanged file hashes in the original and fix-only independent review.

Correction records name predecessor, invariant, exact command, source hash, failure signature, outcome, rerun reason and the immutable `admission` reference issued before the attempt. `admit` inputs supply the `command` and explicit `inputs` dependency boundary; its result captures the original ledger prefix, finding/invariant, predecessor and source fingerprint. Recorded outcomes must match that command/source and required diagnosis. After two unsuccessful corrections to one invariant, changing symptoms do not permit another attempt: a bounded diagnosis packet must cover both predecessor records, hypothesis, failure command/evidence and a current passing receipt for the discriminating check. An unsuccessful negative experiment can be encoded as a passing assertion that establishes the expected failure; exit status alone cannot establish a recorded observation.

Historical diagnosis and admission records retain integrity after a legitimate correction changes source; they are not retrospectively reauthorized against today's dependencies. New diagnoses/admissions require current discriminating proof. Task/verification entrypoints record and return the corrective admission reference and recheck its candidate before effects. Lineage permission does not override the separate shared budget/resource/assignment gates. Corrupt historical receipt or observation bytes still invalidate lineage.

Declare corrective context with `dev:task --start --correction <runtime.json>` or a pinned verification manifest's `correction` field. These entrypoints refuse invalid or undiagnosed lineage before admissions/effects. They cannot infer undisclosed corrections, classify invariants from private conversations, stop direct shell commands or govern already-running external reasoning. Authors must declare the lineage; ordinary budget admission remains mandatory. Missing telemetry needs a documented finite wall/admission alternative, never zero. Replacement contexts retain the same spent usage and plan.

Run the combined software/game composition once. Later invocations reuse only passing receipts with unchanged explicit source/build/configuration/tool/game/observation dependencies; fresh-required checks run anew. Fixes require affected checks and follow-up review, not an unnecessary repetition of every chain. Stop/unknown, exhausted budgets, unresolved findings and cleanup never become acceptance.

## No-inference worked example

The checked-in declaration [development-preflight.example.json](examples/development-preflight.example.json) maps the current fake-only composition regressions to a software criterion:

```powershell
corepack.cmd pnpm dev:preflight --input docs/examples/development-preflight.example.json
corepack.cmd pnpm dev:task --change af-development-efficiency --task 4.3
```

The first command writes a new `.runtime/preflight/check-*/manifest.json`, runs only local Vitest processes and cannot dispatch a game/provider command. The second is preview-only and starts no inference. A non-ready manifest lists exact missing/failed/stale retained evidence; even a ready manifest states that it neither proves Phase 12 live-trial acceptance nor authorizes a trial.

## Routing pilot

Use [routing-outcome.template.json](examples/routing-outcome.template.json) for the next separately authorized ordinary task. Preserve unknown model/usage fields as `null`, link aggregate sessions and acceptance/rework evidence, and avoid comparative reruns. One observation may refine guidance but cannot establish savings from a model label.

## Local observations

`dev:usage` reads only selected roots, proven descendants and explicit run mappings, including nested rollout directories. Report v2 separates aggregate validity from response/model/phase attribution; monotonic cumulative-only totals can be valid while fine detail remains unknown. Counter resets and representation conflicts remain gaps. Cached input and reasoning are subsets.

Append version-1 metadata with `appendEvent` from `scripts/dev/events.mjs` to one writer-owned stream under `.runtime/development/<change>/<run>/`. Never put prompts, environment values, credentials or game snapshots in event identifiers. `corepack.cmd pnpm dev:report <stream.jsonl> ... --output <runtime-directory>` derives atomically replaced `summary.json` and `report.md`; streams remain local evidence. Reports deduplicate event identities, retain partial-tail/lineage gaps, distinguish summed process time from union/elapsed time and preserve incomplete attempts. Console cap is 4 KiB and summary cap 64 KiB; omitted detail is labeled. Cumulative checkpoints are not separately charged to the phase that recorded them. Real subscription savings remain unmeasured.
