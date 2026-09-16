# Developer-agent handoff contracts

The author writes a version 1 assignment before delegating verification or independent review. The worker returns a matching JSON result. These contracts constrain authority, account for coverage and preserve uncertainty; they leave investigation within the assigned boundary flexible. They are developer workflow records, separate from gameplay agents and product state.

Use a fresh `assignmentId` for each delegation, including reruns after source changes. The checker can correlate a pair but cannot enforce uniqueness across historical assignments. Keep assignment, result and evidence under the ignored `.runtime/` directory. Reviewers return JSON in their message; the author persists that JSON unchanged because reviewers remain read-only. Do not edit an unfavorable result into a passing one. Retain it and issue a new assignment if further work is needed.

## Validate before and after delegation

From the repository root:

```powershell
node scripts/check-agent-contract.mjs .runtime/contracts/task-001/assignment.json --check-source
node scripts/check-agent-contract.mjs .runtime/contracts/task-001/assignment.json .runtime/contracts/task-001/result.json --check-source
node scripts/check-agent-contract.mjs .runtime/contracts/task-001/assignment.json .runtime/contracts/task-001/result.json --check-source --require-ready
```

The CLI prints JSON with `valid`, `ready`, `errors` and `readinessErrors`. Assignment-only validation has `ready: null`. `--check-source` adds `sourceMatches` after successful structural validation. Inspect that field and `readinessErrors` before dispatch: assignment-only validation never establishes task completion.

Exit 1 means malformed JSON, invalid arguments or an inconsistent contract. A structurally valid result exits 0 even when incomplete. `--require-ready` requires a result and exits 2 when valid but not ready. Source mismatch is a readiness failure, not malformed reporting; without `--require-ready` it does not change exit 0. The checker never executes assigned commands, writes evidence, changes source or starts providers. The exported `validateContract(assignment, result?)`, `checkSource(assignment, root?)` and `main(args, root?)` support direct tests and local callers; `main` returns `{report, exitCode}` without printing.

**Validity is not proof that observations or evidence are true.** The author must inspect evidence, command coverage, source boundaries, permissions, findings and remaining limits. A ready review says its reported scope is covered and has no findings; it does not independently prove absence of defects. Findings require author adjudication, correction or documented rejection under the review workflow. Keep the original finding report; the checker does not encode adjudication or override findings into readiness.

## Assignment example: verification

This is exact JSON with an illustrative hash. Replace its source revision/hash and task facts with the actual snapshot before dispatch.

```json
{
  "version": 1,
  "assignmentId": "bytes-verification-001",
  "role": "verification",
  "objective": "Verify byte preservation within the helper change",
  "criteria": [
    {"id": "C1", "description": "The helper preserves UTF-8 BOM and CRLF"}
  ],
  "source": {
    "revision": "author-recorded-base-revision",
    "files": [
      {"path": "scripts/edit-utf8.mjs", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
    ]
  },
  "scope": [
    {"path": "scripts/edit-utf8.mjs", "boundary": "Only the BOM-preservation hunk; before-task snapshot .runtime/contracts/bytes-verification-001/before/edit-utf8.mjs; final full-file SHA-256 above"}
  ],
  "checks": [
    {"id": "T1", "command": "corepack.cmd pnpm exec vitest run tests/development-js.test.mjs", "expected": "The BOM and CRLF preservation case passes"}
  ],
  "allowedActions": ["Read scoped source and linked evidence", "Run scoped local tests and write logs in the evidence directory"],
  "additionalChecks": "within-scope",
  "resources": [],
  "evidenceDirectory": ".runtime/contracts/bytes-verification-001",
  "budget": {"timeSeconds": 600, "providerCalls": 0},
  "stopConditions": ["Stop before the time budget expires", "Do not start game or model-backed checks", "Stop if assigned source changes"],
  "returnConditions": ["Return one result for every criterion and prescribed check", "Return blocked with explicit gaps if execution is unavailable"]
}
```

All shown fields are required; unknown fields are rejected. Strings must be nonempty except nullable fields and empty arrays explicitly described here. Criterion/check/resource/finding IDs are unique within their respective arrays. Criteria, scope, source files, allowed actions, stop conditions and return conditions must be nonempty. `checks` and `resources` may be empty; review assignments must have `checks: []` and `additionalChecks: "forbidden"`.

Source revisions are author-recorded labels that must match exactly in the result. The checker does not inspect Git HEAD or prove which commit a label identifies. Source files pin final input bytes with lowercase 64-character SHA-256, or `sha256: null` for an intentionally absent/deleted path. Missing hashed files fail current-source checking; reappearing null-hash paths also fail it. Paths must be repository-relative, use `/`, and contain no absolute prefix, drive prefix, `.` or `..` component. Case-only duplicate paths are rejected, and assignment/result spellings must match exactly. Current-source checks resolve symlinks/junctions and reject paths escaping the workspace, including existing ancestors of absent files.

Every scoped path must appear in source files. Source files may additionally pin relevant dependencies outside the reviewed change. `scope[].boundary` describes exact assigned hunks or whole-file snapshots and identifies any before-task snapshot; the checker requires text but cannot interpret a hunk boundary. Include enough context for investigation without authorizing unrelated work. Files whose execution affects acceptance should be pinned as dependencies. Checks store exact shell command strings and their expected observations; equivalent command rewrites require a new assignment.

`allowedActions` lists concrete authorizations; an additional verifier check requires `additionalChecks: "within-scope"` and must cite one exact allowed-action string in its result `authorization`. This is mechanical provenance, not semantic proof that the check was authorized. Workers must still obey the scope and resource policy. `resources` names each resource's `id`, `owner` and textual `cleanup` requirement; use the exact string `"none"` only for a resource requiring no cleanup. No assigned resources means `resources: []` and result `cleanup: []`.

`budget.timeSeconds` is a positive integer; `budget.providerCalls` is a nonnegative count of task-initiated provider/test invocations, excluding the worker's own reasoning session. Zero forbids provider-backed checks. Time enforcement and investigation limits remain worker/author responsibilities. The checker compares reported task provider calls with the budget when usage is available. It does not time the worker or enforce a scheduler.

## Verification result example

```json
{
  "version": 1,
  "assignmentId": "bytes-verification-001",
  "role": "verification",
  "summary": "The assigned byte-preservation case passed",
  "disposition": "returned",
  "source": {
    "revision": "author-recorded-base-revision",
    "files": [
      {"path": "scripts/edit-utf8.mjs", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
    ],
    "stable": true
  },
  "limits": [],
  "model": {"requested": "gpt-5.6-luna / medium", "observed": null, "usage": null},
  "cleanup": [],
  "criteria": [
    {"id": "C1", "status": "pass", "observation": "The BOM/CRLF case retained both byte conventions", "evidence": [".runtime/contracts/bytes-verification-001/test.log"], "checks": ["T1"]}
  ],
  "checks": [
    {"id": "T1", "command": "corepack.cmd pnpm exec vitest run tests/development-js.test.mjs", "authorization": null, "status": "executed", "exit": 0, "outcome": "pass", "observation": "The named preservation case passed", "evidence": [".runtime/contracts/bytes-verification-001/test.log"]}
  ]
}
```

Result `version`, `assignmentId`, `role` and source `revision` must match the assignment. Every assigned source file must be returned once. Record observed final hashes even when stale, and `stable: false` when source changed during work. Stale hashes and instability are valid reports that cannot be ready. `--check-source` additionally compares current workspace bytes with the assignment, even if the worker claims stability.

`disposition` is `returned` or `blocked`. Each `limits` entry has `description` and boolean `affectsCoverage`; a coverage-affecting limit prevents readiness. `model.requested` records the assigned model/effort, `observed` is the actually exposed metadata string or `null`, and `usage` is `null` when unavailable or `{ "providerCalls": 0, "totalTokens": 1234 }` with nonnegative integers. Provider calls here mean the budgeted task invocations above; total tokens are observed worker usage. Never infer unavailable usage, model identity or savings.

Return every criterion exactly once with `pass`, `fail` or `unverified`; return every prescribed check even if it was skipped or blocked. Each check status is `executed`, `skipped` or `blocked`, with outcome `pass`, `fail` or `unverified`. Unexecuted checks require `exit: null` and `outcome: "unverified"`. Executed checks use the observed nonnegative integer exit or `null` when unavailable (for example, launch failure). Passing checks require executed status, exit 0 and nonempty evidence. An exit 0 can still fail the expected observation.

Criterion `checks` references returned check IDs; no unknown or duplicate references are allowed. A passing criterion requires evidence and may reference only passing checks. An empty check-reference array supports direct/manual observation; the author decides whether it establishes acceptance. Prescribed checks use `authorization: null`; additional checks use one exact assigned allowed-action string. Evidence arrays hold useful file/line or artifact references, including previous-run evidence when explicitly applicable; the checker neither reads nor authenticates their content. All prescribed and additional checks must pass for readiness.

Every assigned resource needs exactly one cleanup result with `id`, `status`, `observation` and `evidence`. Status is `completed` (requires evidence), `not-needed` (only for assignment cleanup `"none"`) or `unresolved` (prevents readiness). For example:

```json
{"id": "dedicated-profile", "status": "completed", "observation": "The exact assigned process identity is absent", "evidence": [".runtime/contracts/task-001/cleanup.json"]}
```

## Review assignment and result examples

Reviewers read and investigate the assigned boundary, return JSON in their message, and do not write it themselves. The author persists it unchanged. Review coverage accounts for every scoped path instead of verifier criterion outcomes; assignment criteria still express what the review must investigate.

```json
{
  "version": 1,
  "assignmentId": "bytes-review-001",
  "role": "review",
  "objective": "Review BOM preservation for correctness and regressions",
  "criteria": [{"id": "R-C1", "description": "Check preservation of input encoding and line endings"}],
  "source": {
    "revision": "author-recorded-base-revision",
    "files": [{"path": "scripts/edit-utf8.mjs", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]
  },
  "scope": [{"path": "scripts/edit-utf8.mjs", "boundary": "BOM-preservation hunk against .runtime/contracts/bytes-review-001/before/edit-utf8.mjs"}],
  "checks": [],
  "allowedActions": ["Read scoped source, relevant dependencies and author evidence; return JSON in the message"],
  "additionalChecks": "forbidden",
  "resources": [],
  "evidenceDirectory": ".runtime/contracts/bytes-review-001",
  "budget": {"timeSeconds": 600, "providerCalls": 0},
  "stopConditions": ["Stop before the time budget expires", "Do not mutate files or execute tests", "Stop if assigned source changes"],
  "returnConditions": ["Return reviewed or unreviewed for every scoped path", "Report only actionable scoped findings; return an empty findings array when none remain"]
}
```

```json
{
  "version": 1,
  "assignmentId": "bytes-review-001",
  "role": "review",
  "summary": "Reviewed the assigned hunk; no actionable findings",
  "disposition": "returned",
  "source": {
    "revision": "author-recorded-base-revision",
    "files": [{"path": "scripts/edit-utf8.mjs", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}],
    "stable": true
  },
  "limits": [],
  "model": {"requested": "author's authorized model", "observed": null, "usage": null},
  "cleanup": [],
  "scope": [{"path": "scripts/edit-utf8.mjs", "status": "reviewed", "observation": "Examined BOM decoding and byte-preserving output against the prior snapshot"}],
  "findings": []
}
```

Each scoped path appears exactly once with `reviewed` or `unreviewed` and an observation. Unreviewed scope prevents readiness. Each finding has a unique `id`, severity `P0`–`P3`, confidence `high` or `medium`, an exact scoped `path`, positive integer `line`, `description`, nonempty `evidence` and actionable `fix`. Use the prior snapshot's line for a deleted path and identify that snapshot in evidence. Findings prevent checker readiness until resolved through author review handling and, when appropriate, a fresh review. An individual finding looks like:

```json
{"id": "R1", "severity": "P2", "confidence": "high", "path": "scripts/edit-utf8.mjs", "line": 20, "description": "The output reconstruction drops an input BOM", "evidence": ["scripts/edit-utf8.mjs:20", ".runtime/contracts/bytes-review-001/before/edit-utf8.mjs:18"], "fix": "Retain the detected BOM when rebuilding the output bytes"}
```
