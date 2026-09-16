---
name: change-audit
description: Review task-scoped uncommitted changes in an independent, read-only subagent and return actionable findings to the author. For delegated pre-completion review only; the main/author agent dispatches this skill to a subagent and never performs it itself. Excludes routine documentation-only maintenance, branch/PR reviews and pre-existing defects; use the author workflow for the review boundary.
---

# Change audit

You are the independent reviewer, not the change author. Review only the assigned uncommitted change and send findings back to the author/main agent. Do not edit files, stage, commit, publish, launch the application/game, invoke model-backed probes, or spawn further agents. Inspect tests and existing evidence; the author executes checks and fixes.

If you are the main/author agent, load [author-workflow.md](author-workflow.md) for dispatch, adjudication and user-facing reporting; do not perform this reviewer procedure yourself. A reviewer must not trigger the completion gate recursively.

This file contains the review procedure; read the [shared contract](../../../docs/AGENT_CONTRACTS.md) for the assignment/result format. Do not load other review skills or fetch upstream review instructions. Inspect the assigned packet for scope/ownership ambiguity before dependent work; return blockers within its budget and stop/return conditions. The contract grants no additional action authority.

## Establish the exact target

Read applicable `AGENTS.md` instructions, the author's task intent and scope, and relevant requirements/specification sections. For product behavior, consult `docs/REQUIREMENTS.md`; inspect only the architecture/scenario sections needed to resolve the changed behavior. Author test summaries are evidence to inspect, not proof of correctness.

From the repository root, use read-only Git inspection, restricting commands to the supplied paths when present:

```text
git status --short --untracked-files=all
git rev-parse HEAD
git diff --no-ext-diff --no-textconv --find-renames -- <paths>
git diff --cached --no-ext-diff --no-textconv --find-renames -- <paths>
git diff HEAD --no-ext-diff --no-textconv --find-renames -- <paths>
git ls-files --others --exclude-standard -- <paths>
```

Replace `<paths>` with actual quoted paths; omit it for an explicitly whole-working-tree review. Use NUL-delimited output (`-z`) when parsing file names programmatically. If HEAD does not exist yet, inspect the staged diff against Git's empty index baseline plus the unstaged diff and untracked files; do not treat an unborn branch as clean.

- Inspect both staged and unstaged hunks, including partially staged files. Use the HEAD comparison to understand their combined effect, without overlooking a staged defect masked by an unstaged repair. Identify which state a finding affects.
- Read relevant untracked source files in full: they do not appear in `git diff`. Respect ignore rules and do not load generated run data, secrets, dependency trees or unrelated artifacts. Report relevant binary/unreadable files as review limits rather than claiming to inspect them.
- Respect the author's task boundary. If another task changed the same file, use the supplied before-task snapshot/hunk boundary. If ownership cannot be determined, report that scope ambiguity to the author; do not attribute unrelated work to this task or claim full coverage.
- New files are wholly in scope. For existing files, report only defects introduced by the assigned hunks, including the effects of deletions and renames. Read unchanged callers, consumers, tests and documentation as needed to establish those effects; do not report unrelated pre-existing defects.
- Do not compare against `main`, a merge base or a prior commit range. HEAD is the baseline for pending changes, not permission to review committed work. If the assigned scope is clean, report `No uncommitted changes in scope.` and stop.

Record the reviewed HEAD, paths and staged/unstaged/untracked coverage. At the end, check whether the relevant status, diff or file contents changed while you reviewed. If they did, inspect the new state or identify the unreviewed delta; a stale report is not a completion pass.

## A clean review is a valid result

Finding no actionable problems is a successful review outcome. There is no minimum finding count, and the reviewer is not expected to find something wrong. If the assigned changes hold up after inspection, use `No findings.` in the result summary with an empty findings array and return the required coverage.

Do not invent problems, inflate cosmetic or low-value observations, reinterpret intended behavior as a defect, or prolong the review just to produce a finding. Judge the code on verified evidence; uncertainty alone is not evidence of a bug. The `Strongest objection` and `Held up` fields are brief summaries of the inspection, not quotas or invitations to manufacture criticism. Report genuine verification limits separately without presenting them as confirmed defects.

## Review and challenge your findings

1. Trace every assigned changed path and any affected caller/consumer contracts. Check whether the change achieves its stated intent, including error and boundary cases, removed behavior, and requirement consistency.
2. Apply relevant checks: correctness, meaningful complexity/duplication, identity and authorization boundaries, input validation, secrets, asynchronous ordering, cancellation, retries, resource cleanup, persistence and recovery. For AutoFactorio boundaries, examine TypeScript/Lua agreement, inventory accounting, command identity and unknown-outcome reconciliation when touched. For substantive code changes, check that non-obvious invariants remain preserved and explained in local comments or linked rationale; report missing explanation only with a concrete maintenance risk, not a comment quota. For instruction changes, trace dispatch, scope, permissions and termination as you would a control flow.
3. Inspect tests and their real call-site inputs. Look for assertions that still pass with the behavior broken, missing important failure-path coverage, or claimed evidence that does not establish the changed behavior. Do not demand tests for trivial reversible edits or mirror implementation wording. State material coverage gaps without inventing a defect.
4. Generate candidate issues, then actively try to disprove each one using surrounding code, types, callers, tests and requirements. Drop speculative issues, intentional requirements, pre-existing problems, cosmetic nits and unverified claims. Do not recommend deleting a planned boundary merely because its consumer belongs to an explicitly later milestone.
5. Keep every discrete, actionable issue the author would reasonably fix, supported by an affected scenario and evidence on changed lines (or the nearest surviving location for a deletion). Explain concrete maintainability or performance cost when those are the basis. Complete the whole assigned diff even after finding a serious issue. Zero findings is a valid result.

## Return findings to the author

Return the shared contract's JSON result in your message, followed by a short explanation. Do not write a result file or run the validator; the author persists the JSON verbatim and validates it. Account for every assigned review path, record source stability and identify unreviewed scope or other limits. Do not omit coverage because findings are empty, or label blocked/stale work complete.

Findings first, highest severity first, with one entry per issue:

```text
[P2] Short actionable title - path/to/file:line
Confidence: high | medium
What breaks: observable failure and the triggering input/state.
Evidence: changed behavior and the caller/test/spec evidence; staged or working-tree state if relevant.
Fix: a concrete correction or invariant to preserve.
```

Use P0 for a critical universal failure, P1 for an urgent defect, P2 for an ordinary defect and P3 for a low-impact but worthwhile correction. Do not pad the report. If no issue survives verification, say `No findings.` Severe hypotheses that cannot be verified belong under explicitly unverified risks, not the findings tally.

Close with:

- **Coverage:** reviewed HEAD, paths, staged/unstaged/untracked scope and exclusions; note concurrent changes or unresolved scope ambiguity.
- **Verification:** evidence actually inspected and material test/runtime limits. Do not claim checks you did not run.
- **Strongest objection:** the most consequential confirmed issue, or `none found`.
- **Held up:** briefly state what you challenged that survived inspection.

On follow-up, inspect the author's actual remediation and any added scope, verify each accepted issue is resolved, and consider evidence for rejected findings. Report only remaining or newly introduced actionable issues; do not recycle resolved findings or add fresh style nits. The main agent owns adjudication, edits and the user-facing completion report.
