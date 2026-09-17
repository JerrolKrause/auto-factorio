# Development workflow

Use the selected phase's entry/exit criteria and current handoff. These helpers improve development execution; they do not authorize a new phase, provider inference, publishing or personal-data changes. Follow the [development-efficiency workflow](DEVELOPMENT_EFFICIENCY.md) for model routing, implementation/test packets, advisory checkpoints, preflight, resource serialization and two-failure diagnosis.

## Verify in order

```powershell
corepack pnpm verify
corepack pnpm verify --game
# Only when the selected phase calls for a fresh visible pause/restore trial:
corepack pnpm verify --pause
```

`verify` runs TypeScript/dashboard builds, lint, tests and documentation checks sequentially. `--game` adds a fresh headless launch/smoke and cleanup of that exact profile. `--pause` adds the visible phase 04 launcher/probe only after the earlier chain and cleanup pass. No later step starts after a failed exit. Existing observers must be reused or explicitly stopped by project profile before a fresh visible launch. No command starts a model trial.

Each invocation creates `.runtime/verification/check-*/`. `results.json` records command/arguments, exit, elapsed time, log path and skipped steps. Full output stays in per-check logs; console output is a concise status stream. Inspect the failed log before selecting another run. Cleanup has its own result; `summary.json` records the aggregate software/smoke, cleanup and optional visible outcome. TypeScript uses `noEmitOnError`; previously emitted JavaScript can still exist after a failed build, so never bypass the failed gate by launching `dist` manually.

For custom PowerShell sequences, test `$LASTEXITCODE` immediately after each native command and `exit $LASTEXITCODE` on failure. A semicolon or newline alone does not gate the next command. Prefer the runner above for the standard sequence.

For a targeted test during implementation, use the direct runner and inspect its reported file/test counts:

```powershell
corepack.cmd pnpm exec vitest run tests/context.test.ts
```

In this checkout, `pnpm test -- <test paths>` forwarded an extra `--` and ran the full suite. Do not infer selection from the intended command alone. When asserting search counts, account for all queried record types; archive searches can include both events and projections.

## Review and closeout

Before completion, map the task's acceptance criteria to executed checks and observed outcomes on the final relevant source. Select software, browser and real-game checks according to the changed behavior; the standard runner does not cover every phase criterion. For documentation-only changes, documentation/skill validation can be sufficient. Mark missing required coverage as unverified and keep the task incomplete.

Use the [verification author workflow](../.agents/skills/verify-change/author-workflow.md) to delegate routine milestone checks with a small fresh-context packet. The verifier executes checks and reports evidence; the main author chooses coverage, fixes failures and owns completion. This is separate from independent code review.

Prepare implementation and substantive documentation for one combined independent review. Use the [author workflow](../.agents/skills/change-audit/author-workflow.md) to distinguish required review from routine documentation maintenance, run the applicable author checks, and handle findings. Routine status/evidence updates, link fixes and faithful archive/spec sync do not trigger another reviewer; changes to requirements, permissions or behavior still do.

Verifier/reviewer exchanges use the shared [agent handoff contracts](AGENT_CONTRACTS.md). Validate assignments before dispatch and returned results before relying on them; use the readiness check when closing a gate. Structural checks catch omissions and contradictions, while the author assesses evidence quality and required coverage. Keep packets/results and full logs in the task's ignored evidence directory.

## Edit narrowly with UTF-8

Keep non-obvious invariants and reasons beside the code they constrain, especially cross-method dependencies, ordering and units. Use decision records for broader rationale and named regression tests for failure examples; link them from a small module guide when discovery is otherwise difficult. Expand dense branches when it makes the sequence easier to inspect; comments should explain constraints, not restate statements.

Prefer contextual patches. For scripted replacements, require the expected match count and inspect the affected code afterward. Avoid global replacements of generic fragments shared by gameplay and operator dispatch. Read/write UTF-8 explicitly; preserve existing newlines and byte-order marks where practical.

If the patch tool is unavailable, the checked-in fallback accepts a JSON plan:

```json
{
  "path": "docs/example.md",
  "edits": [{"before": "Unique surrounding context", "after": "Updated surrounding context", "count": 1}]
}
```

Run `node scripts/edit-utf8.mjs .runtime/edit-plan.json`. The target must be an existing workspace file. It rejects absent/ambiguous context, invalid UTF-8 and concurrent changes observed during preparation. Optional `sha256` pins the expected initial bytes. All replacements are validated before writing that file; review its diff afterward. This is a single-file helper, not a multi-file transaction.

In Python use `read_text(encoding='utf-8-sig')` and `write_text(..., encoding='utf-8')`; use byte-preserving edits when BOM/newline preservation matters. Never depend on Windows' default code page.

## Inspect and manage project games

```powershell
corepack pnpm game:processes
corepack pnpm game:processes --stop-profile 'C:/@Projects/AutoFactorio/.runtime/<profile>/config.ini'
```

Build the helper first. Inventory prints only project config paths, PIDs, process start times, roles and ports. Raw command lines, environment variables and RCON credentials never belong in tool output or the handoff. Do not print `launch.json`, `launch.ps1` or raw `Win32_Process` objects; they may contain credentials. Full private process/game logs remain ignored.

`scripts/dev/game-processes.ts` centralizes profile/config generation, dedicated server launch, RCON readiness, observer startup, actual process identification and profile-scoped cleanup. Paths resolve beneath this repository's `.runtime`; stopping rechecks process identity/start time to avoid trusting a stale PID. Reuse these functions when adding a diagnostic. A returned Steam launcher PID is not proof of a graphical client: `processes.json` records `observerLauncherPid` separately from the actual `observerPid`. Gameplay readiness still requires the expected connected player in structured observations.

Steam runs one graphical instance. Reuse an existing suitable project observer or replace only the explicitly identified observer after its world is safe. Do not stop an unrelated or personal client. A cold observer may need minutes to load assets; use bounded readiness polling rather than repeated launch attempts. Always inspect the current inventory before selecting a process to stop; historical handoff PIDs are evidence, not current authority.

## Resume a recovery probe by stage

The phase 04 probe records atomic `stages.json` entries for startup, player readiness, capture, restore readiness, held load, verified visible join, reconciliation and completion. `restore-ready` is the supported recovery boundary: it includes a completed checkpoint/checksum, source fingerprints, the saved pending batch, post-checkpoint cancellation/rollback prerequisites and earlier checks.

```powershell
corepack pnpm game:pause-probe --stop-after restore-ready
# Inspect stage/result evidence. Stop only this trial's obsolete held-load server, if any.
corepack pnpm game:pause-probe --continue 'C:/@Projects/AutoFactorio/.runtime/phase04/<profile>/<probe>'
```

A deliberate stop has `passed: false` and `stoppedAfter: "restore-ready"`; its successful command exit does not pass the phase gate. Continuation creates separate evidence, identifies its predecessor and revalidates checkpoint plus mod/probe source fingerprints. It loads the checkpoint into a new held server; the original server need not still run. It never resumes an unknown active order in place or assumes later game effects survived rollback.

A completed probe, changed source, incomplete capture, absent cancellation/rollback proof, mismatched checksum, or `.pending` journal alone is refused. Older pre-journal trials require diagnosis; do not synthesize a successful stage for them. Preserve failed results. Changes after `restore-ready` in a failed trial are not replayed into the older checkpoint; inspect and stop that trial's own processes before continuation.

## Keep tool context bounded

- Use `rg` to locate relevant files/sections, then read those sections. Keep [the handoff](IMPLEMENTATION_HANDOFF.md) focused on current status, evidence, limits and the next action; consult [implementation history](IMPLEMENTATION_HISTORY.md) only for relevant past runs. Move superseded execution records there rather than growing the current handoff.
- Batch independent reads/checks with separate labeled results; keep dependent edits/checks sequential.
- Report status, counts, exact exits and evidence paths. Keep full logs on disk and inspect targeted excerpts when something fails. Avoid broad discovery dumps or repeatedly requesting truncated output.
- Preserve a before-task snapshot when sharing uncommitted files with other work. Pass that boundary to the independent reviewer. Re-read before editing shared documents; a later snapshot mismatch may be another session's work, which must be preserved rather than restored from the old copy.

## Known Windows sandbox startup failure

Local repair verified on 15 September 2026: `.agents` was owned by `CodexSandboxOffline`, preventing the normal user from installing the sandbox deny ACL (`SetNamedSecurityInfoW`, error 5). An administrator-approved, non-recursive `icacls .agents /setowner '<repository-owner>'` from the repository root restored ownership while preserving existing access rules. Subsequent ordinary sandbox launches succeeded; workspace writes worked and writes to `.agents`, `.codex` and `.git` remained denied. Keep protected top-level directories owned by the repository owner; avoid recreating them through a sandbox account. Inspect the specific failure in `$HOME/.codex/.sandbox/sandbox.*.log` before selecting a repair; do not reset ACLs or recursively change ownership as a generic workaround.

Git reads then exposed a separate path-format issue: Codex 0.154.0 injected backslash `safe.directory` paths that Git rejected under the sandbox account. Adding the already-trusted checkout's exact forward-slash path with `git config --global --add safe.directory C:/@Projects/AutoFactorio` restored ordinary Git reads. Never use a wildcard trust entry. These are local machine repairs, not repository permission-policy changes.

Observed in this workspace: the command/patch runner can fail before execution with `helper_unknown_error: setup refresh had errors`. One ordinary workspace attempt establishes whether it still occurs. Repeated shell/path/backend variations did not repair it in the phase 01-04 sessions.

For an already-authorized operation, request the tool's `require_escalated` review with its concrete project scope. Continue only if that review permits the operation. This fallback addresses startup failure; it does not bypass a permission denial or grant standing unsandboxed authority. If review rejects an action, follow the stated restriction and report any remaining blocker. Keep prerequisite/sandbox repair user-managed; do not change global settings to conceal the defect.

The handoff must distinguish the failed sandbox attempt from the reviewed execution that actually ran, and report any verification that remains unavailable.

## Recover an unresponsive Codex terminal

Distinguish an active command from a stalled interface before stopping anything. In the 15 September incident, Codex logged `turn/completed` and continued background requests with no active shell command. Only that verified idle process and its direct tool helpers were stopped; saved session history was preserved.

The ignored project `.codex/config.toml` now sets `[tui]` / `alternate_screen = "never"` for future launches. This uses inline rendering with scrollback; it is a mitigation, not a proven fix for the original interface freeze. Resume the specific saved session in a fresh terminal with `codex resume <session-id> --no-alt-screen`; avoid `--last` when several sessions are running. Do not kill all Codex/editor processes, delete session databases, or disable the sandbox. Keep prerequisite upgrades user-managed.

The freeze recurred on 16 September with inline rendering enabled in Codex 0.154.0. The completed session continued background requests, but Esc and `/status` produced no visible response. Its console had raw input enabled and no active selection; these checks do not identify the root cause. The process tree showed VS Code hosting PowerShell. Stopping only the identity-checked idle Codex process also ended its helpers, preserving the parent shell and other sessions.

For a separate interactive PowerShell window, use the checked-in launcher from the repository root:

```powershell
# New conversation:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/codex-terminal.ps1
# Resume only after the previous owner of this conversation has exited:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/codex-terminal.ps1 -SessionId <session-id>
```

The launcher opens an independent console with inline rendering and no PowerShell profile. It preserves Codex authentication, model and permission configuration, and never stops processes or chooses the most recent conversation. `-Preview` prints the launch plan without opening a window. The execution-policy flag applies only to that invocation; it does not change machine/user policy. This is an alternative launch path, not a verified cure for the Codex freeze. Verify typing and `/status` after resuming; record any recurrence before selecting further changes.

The freeze recurred on 17 September in the independent PowerShell/conhost launcher, disproving the earlier VS Code-only hypothesis. Root session `01a0af87-82e3-7ec2-8c83-d2fdb44ced7a` and its final-review child both recorded `task_complete`; the idle process and its helpers used no CPU. Stopping only identity-checked Codex PID 1748 left its PowerShell/conhost alive and preserved both transcripts. Codex 0.154.0 was also the latest published version, so no upgrade was available.

Recent freezes correlate with multi-agent completion, but the internal cause is unproven. Recover the root `source = "cli"` session, not its newest subagent transcript: inspect `session_meta.payload.source` and the final event without printing conversation content, require a terminal event such as `task_complete` or `turn_aborted`, stop only that session's identity-checked idle Codex process, then resume the explicit root ID. Prefer a fresh CLI process per bounded task; use the desktop app for parallel or long-running threads when practical until a newer CLI demonstrates the fix. The removed GPU-acceleration experiment remains irrelevant because the failure crosses terminal hosts.
