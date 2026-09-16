# Author workflow for verification

Use for routine milestone verification under [AGENTS.md](../../../AGENTS.md); narrow documentation-only checks may stay with the author. Verification executes acceptance checks; the separate [independent review](../change-audit/author-workflow.md) examines changes. Neither replaces the other.

## Prepare a stable candidate

Choose checks from the task's acceptance criteria, relevant failure paths and architecture gates. Include observable browser/game behavior where required; a green software suite does not establish those outcomes. Keep provider inference deliberate and within an explicitly authorized budget.

Freeze relevant source during verification. Provide HEAD plus task path/hunk boundaries, before-task snapshots for unrelated uncommitted work, and hashes of the relevant current inputs (including untracked files). If dependencies outside that set can affect results, include them. Assign exclusive ownership of runtime directories, game profiles and browser sessions; the author can continue unrelated work without changing tested inputs or sharing those resources.

Write a small `assignment.json` using the [shared contract](../../../docs/AGENT_CONTRACTS.md), with criterion IDs, exact source/check boundaries, allowed actions, resource ownership, budgets and stop/return conditions. Include relevant references and distinguish any proposed reused evidence. Validate it with `node scripts/check-agent-contract.mjs <assignment.json> --check-source` before dispatch; send its path and the worker skill rather than full logs or history.

Point the worker to [SKILL.md](SKILL.md). Do not forward the full author conversation or private evaluator fixtures to gameplay agents.

## Dispatch and handle results

For the user-approved routine developer verifier trial, call `collaboration.spawn_agent` with `fork_turns: "none"`, `model: "gpt-5.6-luna"` and `reasoning_effort: "medium"`. Pin only this role; independent reviewers inherit the author's authorized model/provider and gameplay agents retain their configured Astra access. Record requested and available observed model/usage metadata. If the requested model cannot run, report it and retain verification with the main author; do not silently substitute another model/provider or introduce API billing.

Require criterion-level pass/fail/unverified results, exact executed commands/outcomes, evidence paths and cleanup status. The main author evaluates coverage, diagnoses unfamiliar failures and makes fixes. After relevant edits, refresh the fingerprint and rerun affected checks plus required integration gates; retain earlier evidence only with a defensible unaffected-source boundary. Stop repeated unchanged failures and resolve their cause before another run.

Require the contract's `result.json` plus a short explanation. Validate it against the assignment; use `--check-source --require-ready` before accepting a verification pass. Missing coverage, blocked work and stale evidence cannot pass this gate. Ask the worker to correct malformed reports within the assignment budget; never infer or invent missing passes. Valid reports can still be incomplete, and the author must inspect evidence before accepting any result.

Resolve missing required verification and actionable independent-review findings before declaring completion. Update the handoff with actual results and remaining limits. A verifier's pass is evidence, not approval or a transfer of responsibility. Compare observed cost/latency and quality before claiming savings; fresh contexts reduce parent log volume but delegation adds work and may increase total tokens.
