# Choosing a model for AutoFactorio

**Default to Sol/high for day-to-day milestone work.** This repo's provider, recovery, durable-state and game boundaries make integration harder than isolated code edits. Use Terra when the task and its correctness checks are clear; use Astra for consequential design or diagnosis. These are starting recommendations, not a measured quality ranking on this repo.

| Work | Starting choice |
| --- | --- |
| Architecture, major spec decisions, unfamiliar cross-component failures | Astra; choose effort for the difficulty |
| Implement and own a milestone across runtime/provider/game boundaries | Sol/high |
| Bounded module changes, dashboard features, helper scripts, straightforward fixes | Terra/medium |
| Focused regression tests with known expected behavior | Luna/medium; stronger model for ambiguous invariants |
| Routine acceptance-check execution and evidence reporting | Existing Luna/medium verifier |
| Independent completion review | Fresh reviewer inheriting the author's authorized model/provider |
| Polling, calculations, hashes, readiness checks and log projections | Deterministic scripts |
| Gameplay agents | Keep the configured Astra/low profiles |

Use Astra to produce a compact design packet: interfaces, invariants, failure cases, acceptance checks and unresolved decisions. Start the implementation task from that packet and relevant files, rather than carrying the entire design conversation forward. Define test cases early; delegate test writing once interfaces stabilize, with named file ownership and a bounded result. Delegation is useful only when it removes distinct work from the parent.

Choose by uncertainty, coupling and verifiability: Terra suits a known approach within a clear boundary and a reliable correctness check; Sol suits implementation spanning several boundaries; Astra suits unresolved designs, conflicting invariants or unfamiliar causal diagnosis. Line count and labels such as "write tests" are weak signals. When unsure, start with Sol/high.

Escalate deliberately when investigation exposes an unplanned architectural decision, conflicting invariants, or repeated failed fixes without a better explanation. Return a compact packet of evidence, attempted hypotheses and the next discriminating check. A failed test alone is not a reason to upgrade: missing dependencies or unavailable services need operational fixes. Once diagnosis resolves the uncertainty, return bounded implementation to the cheaper model. Do not silently substitute models/providers or use API billing. Keep Fast mode off for this user's efficiency preference.

For new task plans, keep OpenSpec checkboxes unchanged and append a `## Model routing` table with columns `Task`, `Role`, `Model`, `Effort`, `Rationale`, `Escalate when`. Give each task ID exactly one row, use explicit model IDs/efforts, and refer to that task's existing acceptance checks. Roles are `author`, `verification` or `review`; review uses `inherit-author` for model and effort, and verification retains its assigned workflow model. An explicit override must record its reason and cannot override role rules. See the [archived task table](../openspec/changes/archive/2026-09-17-af-development-efficiency/tasks.md#model-routing) for an example. Recommendations do not start sessions or switch the current model.

The `dev:task` launcher previews the selected task/model by default and requires explicit `--start`, with managed ChatGPT discovery and existing permission settings preserved; it launches author tasks only. Independent review and verification still use their dedicated contracts/workflows. Automatic mid-task switching remains deferred. On the next authorized ordinary task, record the recommendation, actual model, escalation/reason, available aggregate usage, rework and acceptance result; use this pilot to refine guidance without a separate benchmark campaign. Model selection does not resume a paused milestone or authorize gameplay inference.

Current developer dispatch rules remain in the [verification workflow](../.agents/skills/verify-change/author-workflow.md) and [review workflow](../.agents/skills/change-audit/author-workflow.md). The [development-efficiency workflow](DEVELOPMENT_EFFICIENCY.md) documents the implemented usage, checkpoint, watcher, contract, preflight and task-routing helpers.

Model roles and availability can change. Consult [official model guidance](https://learn.chatgpt.com/docs/models#choosing-astra-sol-terra-and-luna) and [current pricing](https://learn.chatgpt.com/docs/pricing#token-rates) when selecting a model; this guide intentionally does not hardcode savings claims. Guidance checked 17 September 2026.
