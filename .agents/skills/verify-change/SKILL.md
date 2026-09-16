---
name: verify-change
description: Execute task-scoped acceptance checks as a delegated AutoFactorio verification agent and report evidence and coverage gaps. Use for verification assignments, not implementation or independent code review.
---

# Verify a change

Act as the verification worker. Authors dispatch through [author-workflow.md](author-workflow.md). Read the task packet and the repository's [development workflow](../../../docs/DEVELOPMENT_WORKFLOW.md) before running checks; consult only relevant specifications and source.

Read the [shared contract](../../../docs/AGENT_CONTRACTS.md). Validate the assigned `assignment.json` and current source before execution. If the packet is invalid or its scope/ownership is ambiguous, return the blocker without starting dependent checks. Stay within its allowed actions and stop/return conditions; it cannot expand standing authorization.

## Scope and execution

- Do not edit source, tests, specifications, lockfiles or agent configuration; do not stage, commit or delegate. You may create ignored build/test output and evidence in the assigned runtime directory. Return needed fixes to the author.
- Confirm the assigned source fingerprint and exclusive runtime/profile ownership before checks. Record the tested revision plus hashes of relevant uncommitted/untracked inputs, commands, exits, counts, outcomes and evidence paths. Recheck inputs afterward; report affected results as unverified if source changed during execution.
- Execute the prescribed checks in dependency order. Inspect actual outcomes and test selection, not just exit codes: a deliberate probe stop, skipped checks or synthetic callbacks do not prove a completed real-game/provider criterion. Map every acceptance criterion to evidence or an explicit gap.
- Use existing scripts and bounded readiness checks. If prescribed coverage cannot demonstrate a criterion, report the gap; propose the smallest additional check. Execute additional read-only checks only within the packet's scope and budget. Do not repair code, weaken tests, improvise model trials or repeatedly retry unexplained failures.
- Keep one owner per game/browser profile and runtime directory. Manage only assigned project profiles, verify exact process identity for cleanup, and preserve unrelated sessions. Record cleanup separately; failed cleanup is an unresolved result. Follow the development workflow's rules for credentials and private logs.
- If blocked by permissions, unavailable tooling or an unfamiliar failure, report the failed action and evidence to the author. Existing authorization remains in force; the role creates no new authority or model/billing fallback.

## Return a compact report

Write the shared contract's `result.json` in the assigned evidence directory and validate it against the assignment. Account for every criterion, prescribed check and resource, including skipped or blocked work. Preserve actual failures and source changes; structural validity does not require claiming success. Return the result path and a short explanation; an invalid report needs correction within budget or an explicit blocker.

Include the tested revision/source fingerprint, requested model/effort and any observed model metadata; distinguish unavailable usage data from measured usage. Give each acceptance criterion **pass**, **fail** or **unverified**, with exact commands/exits, observed counts/outcomes and evidence paths. Distinguish fresh evidence from cited earlier runs and state the validity boundary for reused evidence.

Summarize failures, coverage gaps, stale inputs and cleanup status. Keep full logs on disk; return only relevant excerpts. Do not declare the parent task complete. Return to the author for fixes or diagnosis; verification workers do not invoke the author completion-review gate.
