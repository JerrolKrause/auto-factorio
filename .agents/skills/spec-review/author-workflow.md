# Author workflow for independent spec review

Use `agent-graph-kit:spec-review` for pre-code specs/plans, with these repository dispatch and acceptance rules. Read the [kit profile](../../../.claude/stack.md) before loading that skill; use its matching-version scripts, authoring rubric, gates, learning stores and verbatim reviewer contract. These additions do not replace the skill or authorize new work. Implementation review stays with [change-audit](../change-audit/author-workflow.md).

## Route and prepare

Use a fresh-context, read-only reviewer. Default provisionally to `gpt-6.1-sol` / `high`; select `gpt-6-astra` / `high` upfront when the design has consequential ownership, recovery or cross-component uncertainty. Record the reason. An unresolved source question can justify a bounded escalation, never an automatic second review or a model fallback. Preserve the skill's explicit multi-reviewer triggers when applicable; do not add a routine two-model panel.

Before dispatch, validate managed ChatGPT authentication, the exact requested model/effort and included allowance. The existing verification-only capability command does not accept Astra. From the worktree root, use the exported generic discovery function (replace only the explicit model when selecting Astra):

```powershell
node --input-type=module -e "import { discoverCodex } from './scripts/dev/task.mjs'; console.log(JSON.stringify(await discoverCodex('codex.exe', 'gpt-6.1-sol', 'high')));"
```

Discovery starts no inference. Failure blocks dispatch; never substitute credentials, provider or model. Keep Fast mode off. Record actual model/effort from exposed runtime/session metadata after dispatch; requested values are not proof of observed values. Unavailable metadata/usage stays unknown.

Write and validate a read-only review assignment under the existing [agent contracts](../../../docs/AGENT_CONTRACTS.md), with explicit source fingerprints, scope, finite shared budget and stop conditions. The dedicated assignment records the spec-review route; do not send it through the author-task launcher or change implementation-review routing rows. Pass artifact/dependency pointers, gate results and exact allowed evidence roots, not an author's interpretation or expected findings. Make temporary/ignored supporting evidence paths explicit; check a named path before declaring it unavailable. Reviewers never edit, run applications/provider trials or delegate further under the local contract.

## Investigate before judging

Include this evidence obligation with the skill's verbatim reviewer contract. Keep it in the returned report beside the existing contract JSON, not a new file/schema/framework:

- For every load-bearing decision or factual premise, provide a compact row: claim/decision, source-derived behavior with exact quote/path, consequence, verdict or evidence gap. Derive actual behavior before deciding whether the claim holds. Read enough surrounding source to test contrary evidence.
- For a policy or reused mechanism, trace actor -> actual instruction consumer -> entry condition -> enforcement -> bypass/exception. Search relevant consumers beyond the proposal's Impact list; scope limits recommended changes, not dependency investigation. Distinguish guidance, self-reporting and mechanical enforcement.
- Derive each decision's consequences, compare shared invariants across decisions and trace requirements/scenarios to tasks. A structural gate does not establish any of these facts.
- Check every normative requirement for lasting behavior versus one-time rollout/history. Keep activation scheduling and initial-only work constraints in design/tasks unless a lasting behavior is intended. Reconcile task versus slice, authorization versus acceptance, sample ownership and failed/abandoned/open-task treatment wherever those concepts occur.
- Check exceptions and authority at the actual affected consumer. Do not turn a narrow new rule into a repository-wide prohibition, or dismiss a specific conflict solely because a higher-level policy exists; show how that policy reaches the consumer.
- Give two concrete failure stories, then attempt to refute each candidate. Retain supported findings with the skill's evidence/severity/confidence; identify rejected consequential candidates and why. No minimum finding count. Unknown critical evidence means a coverage gap, not a pass.

## Author acceptance

Persist the review JSON unchanged and validate it against the assignment/source. Inspect the evidence rows and checks roster for each load-bearing decision, not only the findings count. Verify consequential quotes and entry conditions, the strongest contrary evidence, and claims that supporting files are absent. Missing coverage cannot become ready merely because a report is structurally valid or has no findings.

Return incomplete coverage to the reviewer as bounded unanswered questions with source pointers, without supplying the expected answer. Keep the same shared budget and record added usage; use a fresh assignment/context when sources change or a different model is justified. Do not treat an investigation-only follow-up as implementation acceptance. Apply the [change-audit adjudication and follow-up rules](../change-audit/author-workflow.md#adjudicate-and-show-findings) to fixes, retaining original findings and re-reviewing substantive changes. Honor a user's read-only request instead of applying the kit's automatic-fix step.

## Record outcomes without extra runs

Use the existing [routing-outcome template](../../../docs/examples/routing-outcome.template.json) and [routing pilot](../../../docs/DEVELOPMENT_EFFICIENCY.md#routing-pilot). Link each review's original result, actual route, duration/usage or unknowns, author-adjudicated findings and later escapes. One separately authorized task counts once, including failed/abandoned closeouts; multiple slices or review rounds do not create extra samples. The first three qualifying tasks after adoption support a keep/adjust recommendation, not automatic policy changes, mandatory comparative reruns or a claim of model parity.

## Acceptance examples

- A retry policy names a ledger: read its admission predicate. If it requires a reviewer finding, an ordinary pre-review failure needs an explicit manual path or separately scoped mechanism work; the ledger's existence is insufficient evidence.
- A report says a pinned audit summary is unavailable: resolve the provided evidence path before accepting that limit. Truly absent raw logs remain unverified; summary inspection is not recomputation.
- A new retrospective-candidate rule forbids automatic promotion: inspect its consumer and the existing workshop exception before claiming a global conflict.
- A delta includes the rollout's start date or initial-only file restrictions: put those constraints in design/tasks and retain only enduring behavior in the canonical requirement.
- The first observed task is abandoned after costly repair: close its observation with the failure and unknowns; do not replace it with a later successful task.
