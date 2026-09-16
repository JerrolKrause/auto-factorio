# Author workflow for independent review

The main author loads this file when repository edits need the completion review required by [AGENTS.md](../../../AGENTS.md). It coordinates review; it does not authorize self-review. Implementation subagents hand back work to the main author. Read-only/no-change tasks and reviewers are exempt from the completion gate.

## Choose the review scope

Prepare implementation and substantive documentation together for one review. Review changes to requirements, permissions or behavior even when they live only in Markdown or skills. Fixes and later substantive changes need follow-up review; routine closeout edits do not.

Routine documentation-only maintenance needs no independent reviewer: status and task-checkbox updates supported by existing evidence, test/review summaries, commit references, spelling/formatting, link repairs, and faithful archive/spec sync of already reviewed behavior. Do not use this exception for new claims without evidence, changed acceptance criteria, authorization rules, operational instructions or spec semantics. Mixed changes still receive review of their substantive scope.

For the exception, the author checks the diff and runs `node scripts/check-docs.mjs` and `git diff --check` (also `--cached` for staged edits). Reconcile status/counts against retained results and confirm relevant implementation source is unchanged before reusing evidence. For archive/spec sync, compare Purpose, requirements, scenarios and metadata against the reviewed source, verify only intended relocation/format changes, and run strict OpenSpec validation. Record checks and the exemption in the handoff; do not create a reviewer assignment or claim an independent review ran. Uncertain or substantive differences require review.

## Prepare and delegate

Resolve known acceptance gaps before submitting a stable implementation candidate. Include required long-run, replacement and in-flight transition cases early in relevant tests. Later discoveries still require fixes and re-review; avoid announcing final verification while known implementation work remains.

Delegate to a fresh-context subagent using [SKILL.md](SKILL.md), inheriting the authorized model/provider. Pass task intent, relevant specifications, actual checks/results, HEAD and explicit path/hunk boundaries. Supply before-task snapshots when files contain unrelated work.

Write and validate `assignment.json` using the [shared contract](../../../docs/AGENT_CONTRACTS.md) before dispatch (`node scripts/check-agent-contract.mjs <assignment.json> --check-source`). Give it criterion IDs, exact review scope, source fingerprints, evidence references, read-only actions, budget and stop/return conditions. The reviewer returns contract JSON in its message; the author saves it verbatim and runs the validator. Malformed responses need correction, not inferred findings or coverage. Review findings and limits can be structurally valid; use `--check-source --require-ready` only for final clean review after adjudication and re-review.

Review only task-scoped uncommitted changes: staged, unstaged and untracked. Unchanged code is context only. The reviewer is read-only: no edits, staging, commits, application/game/model runs or further delegation. The author executes checks and fixes. Keep all actions within the user's existing authorization.

## Adjudicate and show findings

Show each review round in user-facing console updates; do not assume the user sees subagent messages. Include the reviewer grade, concise finding and disposition: `pending`, `fixed` with relevant verification, or `rejected` with concrete evidence. Confidence is separate from severity. Grades are P0 critical universal failure, P1 urgent defect, P2 ordinary defect and P3 low-impact worthwhile correction; cosmetic nits are excluded.

Example: `[P1, high confidence] Restricted facts survived revocation in copied text — fixed; regression passed.`

Evaluate findings rather than accepting them automatically. Fix verified issues; reject or downgrade others with concrete code/spec/test evidence, preserving the original grade and explaining the disagreement. Send that evidence back to the reviewer. Obtain review of fixes and later substantive edits; do not treat an earlier clean result as covering new work. Routine review and corrections need no renewed user approval and grant no additional action authority.

No findings is valid. Never manufacture issues, inflate severity or prolong review to reach a finding count. Report unverified risks separately from confirmed defects.

## Verify and close out

After fixes, run affected checks and the required integrated gate. Reuse earlier game/provider evidence only when changed paths cannot invalidate it, and state that boundary. Preserve actual commands, results and evidence references in the handoff.

Report unique findings by severity, fixed/rejected/remaining totals, the final review result and material verification limits. Example: `6 found (1 P1, 5 P2); 6 fixed, 0 rejected, 0 remaining; re-review: no findings.` An initially clean review should say zero found. Do not count the same issue again on follow-up.

Never commit or declare completion with outstanding actionable findings or an unavailable required review. The author owns adjudication and the completion report; the reviewer does not grant commit, publish or other action authority.
