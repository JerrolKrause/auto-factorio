# Development workflow

Use the selected phase's entry/exit criteria and current handoff. These helpers improve development execution; they do not authorize a new phase, provider inference, publishing or personal-data changes.

## Verify in order

```powershell
corepack pnpm verify
corepack pnpm verify --game
# Only when the selected phase calls for a fresh visible pause/restore trial:
corepack pnpm verify --pause
```

`verify` runs build, lint, tests and documentation checks sequentially. `--game` adds a fresh headless launch/smoke and cleanup of that exact profile. `--pause` adds the visible phase 04 launcher/probe only after the earlier chain and cleanup pass. No later step starts after a failed exit. Existing observers must be reused or explicitly stopped by project profile before a fresh visible launch. No command starts a model trial.

Each invocation creates `.runtime/verification/check-*/`. `results.json` records command/arguments, exit, elapsed time, log path and skipped steps. Full output stays in per-check logs; console output is a concise status stream. Inspect the failed log before selecting another run. Cleanup has its own result; `summary.json` records the aggregate software/smoke, cleanup and optional visible outcome. TypeScript uses `noEmitOnError`; previously emitted JavaScript can still exist after a failed build, so never bypass the failed gate by launching `dist` manually.

For custom PowerShell sequences, test `$LASTEXITCODE` immediately after each native command and `exit $LASTEXITCODE` on failure. A semicolon or newline alone does not gate the next command. Prefer the runner above for the standard sequence.

For a targeted test during implementation, use the direct runner and inspect its reported file/test counts:

```powershell
corepack.cmd pnpm exec vitest run tests/context.test.ts
```

In this checkout, `pnpm test -- <test paths>` forwarded an extra `--` and ran the full suite. Do not infer selection from the intended command alone. When asserting search counts, account for all queried record types; archive searches can include both events and projections.

## Review and closeout

When the completion review is required, load the [author workflow](../.agents/skills/change-audit/author-workflow.md) for delegation, adjudication, console reporting and closeout. The reviewer follows its separate read-only procedure.

## Edit narrowly with UTF-8

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

- Use `rg` to locate relevant files/sections, then read those sections. Start with the current handoff entry rather than the complete historical log.
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
