# Implementation handoff

Status: phase 01 compatibility foundation passed on 14 September 2026. Phase 02 passed its software and live subscription-provider exit gate on 15 September 2026; it is archived with its capability synced to main specs. Phase 03 passed its live character-action and quiescent receipt-readback gate; phases 04-18 remain unimplemented. The current execution record below supersedes the historical documentation-only observations. Product requirements remain approved; later architecture gates require their own execution evidence.

Update, 11 September 2026: the user approved all eight adversarial review fixes and requested documentation updates only. They are incorporated in the requirements, architecture, scenario specifications and milestones. [Decision 001](decisions/001-review-hardening.md) records the accepted changes. This approval has not started application implementation.

## Development workflow handoff - independent change review, 15 September 2026

User requested automatic subagent review of new/updated uncommitted work. Added the completion gate in [AGENTS.md](../AGENTS.md) and repo-local [change-audit](../.agents/skills/change-audit/SKILL.md), with explicit-only invocation metadata. The author dispatches a fresh read-only reviewer, evaluates evidence-backed findings, fixes accepted issues and obtains remediation review before completion. Scope includes staged, unstaged and relevant untracked task changes; unchanged code is context only. The reviewer does not edit or recursively delegate.

The repo-local skill contains the complete review procedure. Follow-up, 15 September 2026: removed upstream skill/documentation links, source lookup details and the instruction to load another review skill at the user's request. Reviewers use the local instructions directly. Also made a clean review explicitly successful: no finding quota, invented defects, inflated nits or prolonged searching to force a criticism. Follow-up validation passed: skill validator, documentation checks (97 Markdown files, 286 local links), scoped whitespace check, and absence of upstream URLs/other review-skill references in the skill. The independent reviewer compared these refinements with the before-turn snapshots using local instructions only and returned **No findings**; no remediation was needed.

Context-efficiency follow-up: condensed the AGENTS.md review gate from 427 to 149 words and required concise future edits, with detail in local skills/docs. Documentation checks (99 files, 293 links) and scoped whitespace checks passed; independent review returned **No findings**.

Base HEAD: `4000a32869bed71133c88ea0c42eed5dd4c5ff85`. The user requested a commit containing only this review workflow. The commit containing this section has the base HEAD above as its parent; resolve it with `git log -1 --format=%H -- .agents/skills/change-audit/SKILL.md`. No push was requested. Concurrent phase 04 changes were already present and remain outside this task; the phase 03 milestone history below is not a claim about that concurrent work's status.

Validation: bundled `quick_validate.py .agents/skills/change-audit` passed using `.runtime/review-skill-validation/venv/Scripts/python.exe` after installing PyYAML 6.0.3 in that ignored environment. The first attempt with system Python failed because PyYAML was absent. Invocation metadata also parsed successfully with PyYAML. `corepack pnpm check:docs` passed (97 Markdown files, 286 local links); scoped `git diff --check` passed. Independent fresh-context subagent `review_workflow` reviewed the initial skill version, reviewed the AGENTS.md addition, both new skill files and this added handoff section, and returned **No findings**; no remediation was needed. Its report explicitly excluded concurrent phase 04 changes and confirmed the original three review targets were stable. No build, application test, game or subscription-provider probe was run for this instruction-only change.

Limit: this is an agent instruction gate, not a Git hook or enforced tool sandbox. The metadata prevents implicit skill loading; root AGENTS.md explicitly routes invocation to the reviewer. If subagent tools are unavailable, future agents must report review incomplete. The next bounded action for this workflow is to apply the gate to the next completed task, not to start a product milestone.

## Current implementation handoff - phase 03 completed, 15 September 2026

**Change:** `af-03-character-execution`, 8/8 tasks, exit gate passed. User authorized phase 02 archive/commit and phase 03. Phase 02 is archived and committed as `2198f20f18699670bf919ddd0dd029fe80cb1cee` on `main`. Phase 03 is now archived and synced to main specs. Its implementation/archive commit contains this record and has that phase 02 commit as its parent; no push was made. Source hashes are retained in `.runtime/phase03/game-KL4Zrd/evidence/probe-MKDBNf/source-manifest.json`. Do not start phase 04 automatically.

Implemented: strict surface/quality/identity/grant-bearing contracts; original authenticated loopback RCON transport and Lua RPC; runtime role restrictions; bounded live observations and installed-game recipe ratios; normal character pathing/walking, crafting, mining, placement, rotation, recipe changes, transfers and deconstruction; capped asynchronous batches, persistent per-step inventory/tick receipts, partial failure and native cancellation; unknown-response admission freeze and receipt reconciliation. Files are `packages/contracts/src/game.ts`, `packages/factorio/src/{rcon,client}.ts`, `packages/tools/src/game.ts`, `mods/autofactorio/{info.json,common.lua,actions.lua,control.lua}`, `scripts/game-{launch,smoke,probe,load-probe}.ts`, tests and root configuration/docs. No dependency or lockfile change; no model inference consumed in phase 03.

Versions: installed Factorio **2.0.77 build 84539**, base/Space Age/quality/elevated-rails **2.0.77**, original AutoFactorio mod **0.1.0**; Node 24.21.0 and Corepack pnpm 12.4.1. [Decision 005](decisions/005-character-execution.md) records inspected upstream/API sources and changes. Graphical `--host` did not expose RCON; the verified topology is the installed executable as a loopback dedicated server plus an attached visible Steam client with separate project write-data/config directories.

### Executed evidence

Final documentation checks: `corepack pnpm check:docs` passed (95 Markdown files, 282 links); strict selected OpenSpec validation passed; apply instructions report `all_done`, 8/8; `git diff --check` passed.

- `corepack pnpm build`, `corepack pnpm lint`, `corepack pnpm test`: passed, **72 tests** (17 game boundary/framing, 44 provider, 11 foundation). The game framing regression delays the actual command response so an immediate delimiter would overtake it, reproducing the live multiplayer bug.
- `corepack pnpm game:smoke`: passed 9 headless observation, inventory, fingerprint, recipe and malformed/raw rejection checks in `.runtime/phase03/game-si2daM`; not counted as visible action proof.
- `node dist/scripts/game-launch.js`: created `.runtime/phase03/game-KL4Zrd`, dedicated server PID 20028 and visible client PID 22892. User confirmed successful launches. Server/client logs record successful multiplayer join. Current project pointer is `.runtime/phase03/current.json`; credentials remain ignored in its generated profile.
- `node dist/scripts/game-probe.js`: **21 live action checks passed** in `game-KL4Zrd/evidence/probe-MKDBNf/{events.jsonl,result.json}`. Normal walking/path around the protected wall, blocked destination, native crafting/mining timing, reach/material/collision rejection, unchanged protected fixtures, placement, belt rotation, assembler recipe/speed, put/take, partial stop, cancellation, lost-response reconciliation/idempotent replay and timed deconstruction all passed. The preceding run crafted 2 gears then stopped on legitimate resource reach rejection; its known state was reconciled, and the next run used fresh IDs plus ordinary walking into mining reach. It was not a blind retry of unknown work.
- Additional retained-receipt audit passed: each placement consumed exactly one matching item; transfer deltas were -5/+5 iron plates; cancelling the 40-gear queue at 18 ticks restored the full starting inventory and left the following placement unexecuted. The lost-response command consumed one chest and produced exactly one entity after receipt read and same-ID replay.
- The live probe exited 1 **only at its final save assertion**: Factorio rejected the absent project `data/saves` directory. The original failed result remains intact. Created that directory, fixed the launcher to create it, and retried only the rejected operator save. `save-recovery.json` is successful; server log records save completion at 258.950 seconds. Combined evidence is `integrated-result.json` (passed, 21 actions, 18 saved receipts).
- `node dist/scripts/game-load-probe.js`: exit 0. Separate isolated server loaded `data/saves/phase03-complete.zip`, matched **18/18 command receipts** exactly, and rejected a fresh batch with `restore_requires_phase04_barrier`. Evidence: `game-KL4Zrd/receipt-readback/{events.jsonl,result.json,process.log}`. The probe stopped its own temporary server.
- Engine screenshot exists at `game-KL4Zrd/observer-data/script-output/phase03-complete.png`; image inspection was blocked by the existing filesystem sandbox helper failure. No screenshot-based assertion is claimed. Structured state and actual engine ticks are the acceptance evidence.

Earlier failures are preserved: the initial player-controller error was fixed before startup; graphical host had no RCON; `probe-Ju52FT` had an empty observation response; `game-si2daM/evidence/probe-CJjtVX` exposed native fast replacement of the protected chest with actual inventory deltas. Fixes wait for the first queued RPC response before sending the delimiter and reject occupied placement footprints before inventory mutation. The fresh `game-KL4Zrd` protection check passed. No earlier failed trial is relabeled a pass.

Limits: fixed test grant, one assigned character in this fixture, normal-quality placement, conservative square footprint checks, 100-step batches and 200 retained orders. Rich fluid/probabilistic/multi-output calculations are explicitly unsupported. This is a deterministic character integration, not yet a provider-driven gameplay run. Save/load proof is **quiescent receipt persistence only**; active-order pause/checkpoint recovery, fencing and re-arm remain phase 04. The dedicated visible session is left running and playable; only project-owned earlier/temporary processes were stopped. No personal saves, global Codex settings, game binaries or prerequisite versions were changed intentionally.

**Next bounded action:** implement `af-04-pause-restore-gate` only when authorized. Its real-game pause/restore gate must pass before phase 05.

Archive/commit continuation, 15 September 2026: the user requested phase 03 archive and commit plus the next kickoff prompt. Verified all eight tasks, retained integrated evidence and matching tested source hashes; synced the Purpose and all six character-execution requirements to `openspec/specs/character-execution/spec.md`; archived to `openspec/changes/archive/2026-09-15-af-03-character-execution/`. Updated archive-relative document links and guide/traceability references. Resolve this commit with `git log -1 --format=%H -- openspec/changes/archive/2026-09-15-af-03-character-execution/tasks.md`. Archive validation passed: 3/3 main specs, 18/18 combined OpenSpec items, 96 Markdown files/282 local links, and staged whitespace checks. Phase 04 has not started. No game or model trial was rerun for the archive.

## Previous implementation handoff - phase 02 completed, 15 September 2026

**Change:** `af-02-subscription-provider`, spec-driven, **8/8 tasks complete; exit gate passed**. Phase 01 remains the verified entry gate. Repository `C:\@Projects\AutoFactorio`, branch `main`, tested HEAD `6a7427447721c35ecdfbd774dfe8e49bd25630dc` plus the pre-existing uncommitted phase 02 files and this continuation's edits. No commit, push or archive was made. Phase 03 has not started.

This continuation changed `packages/codex/src/provider.ts`, `scripts/provider-probe.ts`, `tests/provider.test.ts`, README, guide, decision 004, this handoff and phase 02 task checkboxes. It preserved all existing work. Added a bounded read-only retry for the pinned server's transient empty-rollout metadata error after turn acceptance; gateway tools remain unbound until environment verification succeeds. The accepted turn is never resubmitted. Concurrent start promises now settle before cleanup, and resumed-history checks require each original private marker to exist as well as excluding the other role's marker.

Fresh versions: Node 24.21.0, Corepack pnpm 12.4.1, Codex CLI 0.154.0. Supported managed-auth preflight now reports plan identifier `prolite`, exact `gpt-6-astra` / `low`, included usage allowed, primary weekly usage 0% at no-inference preflight and 1% at the passing trial, no secondary window, and `spendControlReached: false`. These are provider observations, not a guaranteed remaining allowance. No credentials were copied, settings changed, purchases made or alternative model/provider used. Factorio was not started or revalidated.

### Live evidence and accounting

- No-inference preflight: `.runtime/phase02/probe-tVhEyh`, zero turns, two distinct empty-environment sessions and exact scoped catalogs; successful result.
- Initial continuation trial: `.runtime/phase02/probe-aEdDlS`, exit 1, one submitted turn, zero gateway attempts, 3.376 seconds and no token telemetry (actual usage unknown). An immediate metadata read reported an empty rollout; terminal interruption stayed unconfirmed, synthetic cancellation was confirmed and provider processes were closed. A subsequent supported `thread/read` reconciliation still reported empty engineer metadata and an unloaded foreman thread. No unknown turn was resubmitted. The failure is preserved, not counted as a pass.
- Corrected trial: `.runtime/phase02/probe-5Buw16/{events.jsonl,result.json}`, **exit 0**, four submitted turns, two initially overlapping roles, seven gateway attempts (including two deliberate rejections), 46.940 seconds and **68,386 cumulative reported tokens** (engineer 34,303; foreman 34,083, including cached input). Both trials declared four turns, two concurrent turns, 60 seconds/12 gateway attempts per turn, 300 seconds/run and 120,000 reported tokens. This continuation therefore recorded five total submissions, seven gateway attempts and at least 68,386 reported tokens; the failed attempt's usage is unknown. Earlier trials in the historical record retain their separate usage and evidence.
- Passing lifecycle: foreman handoff, engineer checkpoint, acknowledged steering, confirmed terminal interruption, confirmed synthetic cancellation, engineer process replacement/resume and report `20 + 22 = 42.`, then foreman process replacement/resume and acknowledgment. Final saved histories contain two turns each; engineer statuses are interrupted/completed and foreman statuses completed/completed. Each retains its own original private marker and excludes the other's.
- Isolation: all four turns verified empty environments before gateway binding; the metadata race required four read retries in the passing trial. Exact role catalogs and effective feature controls passed for initial and replacement processes. Live engineer requests for foreman-only handoff and spoofed identity were rejected. Public activity and tool outcomes streamed incrementally. No forbidden native-tool events occurred. Native-tool exclusion uses the pinned registration source and effective environment/features; the catalog endpoint itself only enumerates MCP tools.

### Executed checks

- `node --version`, `corepack pnpm --version`, `codex --version`, `git rev-parse HEAD`: versions/revision above.
- `openspec status --change af-02-subscription-provider --json` and `openspec instructions apply --change af-02-subscription-provider --json`: ready, repo-local, spec-driven, 6/8 at entry; all four context files and required architecture sections read.
- `corepack pnpm build`, `corepack pnpm lint`, `corepack pnpm test`: exit 0 each after the correction; **55/55 tests in two files** (44 provider, 11 foundation). New regressions cover transient and persistent metadata failures, unrelated read errors, and unsafe environments; each asserts no accepted-turn resubmission or premature tool binding.
- Exact no-inference command: `corepack pnpm provider:probe --codex 'C:/Users/Jerrol/AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'`. Both continuation live commands append `--live --turn-cap 4 --token-cap 120000`; results above.
- `corepack pnpm check:docs`: exit 0, 93 Markdown files and 278 local links. `openspec validate af-02-subscription-provider --strict --no-interactive`: exit 0. Final apply instructions report `all_done`, 8/8 tasks. `git diff --check`: exit 0. Source hashes are saved in `.runtime/phase02/probe-5Buw16/source-manifest.json`.

Remaining limits: only the pinned Windows client was tested; experimental environment controls and deprecated full-history hydration remain version-sensitive. Reported tokens and account percentages are approximate usage measures. The earlier failed attempt's terminal state/usage remains unknown. Cancellation here is synthetic; real game actions, cancellation, pause/save/load and fencing remain phases 03 onward. The Windows sandbox still fails at startup with `setup refresh had errors`; reviewed elevated tool execution permitted this work, without repairing the sandbox or changing prerequisites.

**Next bounded action:** phase 03 (`af-03-character-execution`), now explicitly authorized by the user after the requested phase 02 archive and commit. Do not skip phase 04's real-game pause/restore gate before phase 05.

Archive/commit continuation, 15 September 2026: verified 8/8 tasks and the passed live evidence, synced all six subscription-provider requirements and their Purpose to main specs, validated both main specs, and archived to `openspec/changes/archive/2026-09-15-af-02-subscription-provider/`. Guide/traceability links and archived relative document links were updated. The user explicitly requested this archive, commit, and subsequent phase 03 implementation. The phase 02 commit containing this record has parent `6a7427447721c35ecdfbd774dfe8e49bd25630dc`; resolve its hash with `git log -1 --format=%H -- openspec/changes/archive/2026-09-15-af-02-subscription-provider/tasks.md`. No new model trial was needed for archive.

## Earlier partial implementation handoff - phase 02, 15 September 2026

**Change:** `af-02-subscription-provider` (`spec-driven`). **Entry gate:** passed, from phase 01's archived implementation record and actual clean Git state at start. **Exit gate:** NOT passed. Tasks 1.1 and 2.1-2.4 are implemented/tested; 2.5 and 3.1 remain open. Task 3.2 records this partial handoff. Stop before phase 03; do not archive this change yet.

Repository `C:\@Projects\AutoFactorio`, branch `main`, tested base HEAD `6a7427447721c35ecdfbd774dfe8e49bd25630dc` plus this phase's uncommitted files. No commit or push was made. Files: `packages/codex/src/{protocol,rpc,preflight,budget,provider}.ts`, `packages/tools/src/gateway.ts`, `scripts/provider-probe.ts`, `tests/provider.test.ts`, root package/TypeScript configuration, README, guide status, third-party inspection note, decision 004, this handoff and selected task checkboxes. No dependency or lockfile change; no game, scheduler, dashboard or later phase was implemented. Initial working tree was clean.

Implemented: pinned app-server port and managed ChatGPT-only preflight; exact Astra/low selection with no API/provider/model/credit-reset methods; isolated role profiles and authenticated per-turn MCP capabilities; permanent late-call revocation; public console/JSONL lifecycle evidence; separate monotonic turn/run time, roster turn, gateway attempt and cumulative token accounting; explicit unknown telemetry; admission closure, interrupt outcomes and a synthetic acknowledged-cancellation callback. Provider replacements resume the recorded role history and retain the same budget object. No real game cancellation is claimed. [Decision 004](decisions/004-subscription-provider.md) records the boundaries and inspected source.

Observed versions: Windows x64, Node 24.21.0, Corepack-pinned pnpm 12.4.1, Codex CLI 0.154.0. Generated stable and experimental protocol bindings into `.runtime/phase02/protocol` and `protocol-experimental`. Inspected release commit `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`; no upstream implementation or generated bindings were copied. Factorio was not started or revalidated in phase 02.

Managed preflight succeeded via `account/read` and `getAuthStatus` with `includeToken: false`: ChatGPT, Plus. `model/list` reported `gpt-6-astra` and low effort. At the first live trial, `ordinaryUsageAllowed` was true, with reported usage 50% of the five-hour window and 22% of the weekly window. These account-wide percentages include other concurrent activity and cannot be attributed to this probe or converted to a guaranteed allowance. Initial inspection reported no available paid credits; no credits or resets were consumed. No OAuth/browser token was read, copied or proxied.

Live trial 1, `.runtime/phase02/probe-W3bsGP`, failed. Declared ceilings were 6 provider turns, 2 concurrent turns, 60 seconds and 12 gateway attempts per turn, 300 seconds/run and 30,000 reported tokens. Actual: 2 submitted, overlapping provider turns; 34,153 cumulative reported tokens including cached input; 14.028 seconds of recorded run time. Token telemetry crossed the cap after generation, demonstrating that this is an approximate ceiling. Run admission closed automatically and no new inference was started. There were 2 provider-side MCP tool attempts but 0 gateway attempts: both `checkpoint` and `handoff` were rejected by Codex with `MCP tool call requires approval, but approval policy is never`. Both roles streamed public activity and explanations, but no handoff occurred. At shutdown the foreman's interruption was acknowledged at RPC level but terminal completion remained unconfirmed; synthetic cancellation was confirmed. The engineer completed normally after its rejected tool. No failed criterion is treated as a pass.

Correction: set `mcp_servers.autofactorio.default_tools_approval_mode = "approve"` only for the bounded synthetic gateway. Global approvals and unrelated tools remain restricted. The corrected no-inference check passed in `.runtime/phase02/probe-NIxkUJ`: two distinct sessions, exact model/effort, no selected local environments, empty runtime workspace roots and instruction sources, and the exact foreman (`observe`, `handoff`) versus engineer (`observe`, `report`, `checkpoint`) MCP catalogs. Native tool isolation is supported by effective launch controls plus the pinned tool-registration source; the client does not expose a unified all-native-tools listing through the used catalog endpoint. Live hostile gateway calls and resumed history-content checks still await the corrected live trial. Final code additionally requires successful session/catalog checks before `start`, and fails closed on forbidden native-tool/model/authentication events.

The corrected live probe was authorized, but its continuation was blocked before execution by automatic provider usage-limit review. No workaround, alternate provider, credit purchase, model substitution or indirect execution was attempted; no additional turns were consumed. The corrected empty-environment resume fix is covered by deterministic tests only.

Exact checks/results:

| Command/check | Result |
| --- | --- |
| `git status --short`; `git log -1 --format=%H` at entry | Clean; HEAD recorded above |
| `openspec status --change af-02-subscription-provider --json`; `openspec instructions apply --change af-02-subscription-provider --json` | Ready, repo-local, spec-driven, initially 0/8 tasks; all four context files read |
| `node --version`; `corepack pnpm --version`; `codex --version` | 24.21.0; 12.4.1; 0.154.0 |
| `codex app-server generate-ts --out .runtime/phase02/protocol` | Exit 0 |
| `codex app-server generate-ts --experimental --out .runtime/phase02/protocol-experimental` | Exit 0 |
| `node .runtime/phase02/inspect-preflight.mjs` | Exit 0, no inference; sanitized auth/model evidence in `preflight.json` |
| `corepack pnpm provider:probe --codex 'C:/Users/Jerrol/AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'` | Exit 0 before and after scoped MCP fix; 0 turns in `probe-1TDF7D` and `probe-NIxkUJ` |
| Same provider command with `--live` | Expected recorded failure, exit 1; trial details above, not a passed gate |
| `corepack pnpm build` | Exit 0 after fixes |
| `corepack pnpm lint` | Exit 0 after three prefer-const findings were fixed |
| `corepack pnpm test` | Exit 0; 2 files, 51/51 tests (40 provider, 11 foundation), final run at 08:37:26 local before documentation-only edits |
| `corepack pnpm check:docs` | Exit 0 after handoff insertion; 93 Markdown files, 278 local links |
| `openspec validate af-02-subscription-provider --strict --no-interactive` | Exit 0; selected change valid |
| `git diff --check` | Exit 0; no whitespace errors |
| Final `openspec instructions apply --change af-02-subscription-provider --json` | 6/8 tasks complete; 2.5 and 3.1 remain unchecked |
| Protected configuration hash/absence comparison | 5/5 unchanged, `.runtime/phase02/protected-{before,after}.json` |
| Scoped `codex.exe` process inspection after shutdown | No remaining process with this phase's path in its command line |

The 40 provider tests cover managed/API/external authentication, missing exact model/effort, included-usage/paid-fallback denial, effective config defaults, final-turn admission, a long turn without usage, atomic two-role time/token/account exhaustion, rejected attempts, cumulative usage deduplication and session/controller replacement, all named gateway bypass categories, identity spoofing, revoked credentials, actual authenticated HTTP and origin rejection, correlated steering/interruption/resumption, late output, unconfirmed interruption/cancellation and summary-only reasoning. The existing SQLite real-driver test also passed. No additional dependencies were installed; prior phase foundation checks were not reclassified as new game evidence.

Tooling issues: sandboxed shell, apply_patch and Node REPL startup failed with the existing Windows helper error. Automatically approved unsandboxed project commands permitted the work. An initial JSON BOM written by Windows PowerShell caused `Invalid package.json`; corrected to BOM-free UTF-8 before successful build/test runs. One outdated upstream source path returned 404; the release tree identified the correct file. These failures are not passing checks and no sandbox/prerequisite repair was attempted.

Remaining limitations: the live gate is incomplete. The corrected trial proved a real handoff, public streaming, forbidden role and identity rejection, acknowledged steering, confirmed interruption and synthetic cancellation; resume isolation then blocked the run. Separate resumed histories and the live post-fix resume remain unverified because the authorized continuation was stopped before execution by the provider usage-limit review. Wait for allowance reset before a new bounded experiment. No real Factorio behavior or later lifecycle/fencing gate is claimed.

Next bounded action: wait for provider allowance reset, then resume this same phase with a newly declared bounded probe budget and finish tasks 2.5 and 3.1. Do not start phase 03.

## Previous implementation handoff - phase 01, 14 September 2026

**Change:** `af-01-compatibility-foundation` (`spec-driven`). **Gate:** passed; 8/8 implementation tasks complete; archived and synced to main specs. Repository `C:\@Projects\AutoFactorio`, branch `main`, tested HEAD `1cdff328c76471cae80b6c6059057da94569c755` plus the phase 01 working-tree files below. The implementation and archive are included in the commit containing this record, together with the existing planning package. No push or next-phase implementation was performed. Earlier edits to AGENTS.md, README, this handoff, the implementation guide, traceability, decision 002 and all 18 planning changes were preserved.

Entry gate verified from actual Git state, the selected change's four artifacts, REQUIREMENTS, architecture sections 1 and 10-12, milestone 0 context and fresh prerequisite commands. Existing Node 24.21.0 satisfies the phase baseline; Corepack 0.36.0 runs pinned pnpm 12.4.1 without a global shim. Current Codex CLI is 0.154.0. Factorio executable and base/Space Age/quality/elevated-rails metadata are 2.0.77. These are installed-version checks, not provider/game integration proof.

Completed: minimal strict TypeScript/pnpm workspace and pure diagnostic contracts; local console/JSON compatibility entry point; explicit isolated data-directory checks; SQLite real-driver transaction/rollback/reopen/backup verification; missing-driver/version/path failure reporting; ignored runtime/credential/game-binary data; exact upstream revision and notice review with a bounded original-adapter decision. [Compatibility report](COMPATIBILITY_REPORT.md), [decision 003](decisions/003-compatibility-foundation.md) and [provenance](../third_party/README.md) contain the supporting detail. No game mechanics were copied or implemented.

Phase 01 implementation files: `.gitignore`, root package/lock/workspace/TypeScript/ESLint/Vitest configuration, `packages/contracts`, `scripts/{compatibility,data-directory,diagnose,sqlite-probe}.ts`, `scripts/check-docs.mjs`, `tests/foundation.test.ts`, `third_party/README.md`, `docs/COMPATIBILITY_REPORT.md`, decision 003, README/current guide status, this handoff and the selected change's task checkboxes. All other phases' artifacts remain future work.

Executed checks (Windows x64):

| Exact command/check | Result |
| --- | --- |
| `corepack pnpm install --force` after correcting project build approvals/store configuration | Exit 0; only generated dependencies recreated |
| `corepack pnpm install --frozen-lockfile` in a fresh isolated copy | Exit 0; separate empty dependency store, no pre-existing node_modules or build output |
| `corepack pnpm build` in that copy | Exit 0 |
| `corepack pnpm lint` in that copy | Exit 0 |
| `corepack pnpm test` in that copy | Exit 0; 1 test file, 11/11 tests passed |
| Root `corepack pnpm install --frozen-lockfile`, `corepack pnpm build`, `corepack pnpm lint`, `corepack pnpm test` | Each exit 0; 11/11 tests passed in 1 file (final run at 11:25:33 local) |
| `corepack pnpm diagnose --data-dir 'C:/@Projects/AutoFactorio/.runtime/local' --factorio-dir 'C:/Program Files (x86)/Steam/steamapps/common/Factorio'` | Exit 0; foundation PASS, later live checks explicitly unverified |
| Same diagnostic with `--sqlite-driver unsupported` | Expected exit 1; foundation FAIL, explicit unsupported driver, no fallback |
| `corepack pnpm diagnose` without arguments | Expected exit 1; usage error |
| Diagnostic with personal Factorio data path / unignored repository data path | Expected exit 1 each; rejected before initialization |
| Actual SQLite probe and test | better-sqlite3 13.0.3 / SQLite 3.53.4: WAL, commit/read, constraint rollback, reopen, backup/reopen passed |
| Git ignore/untracked evidence checks | Reports, dependencies, runtime/build data, credentials and game asset/binary paths excluded; no tracked generated data |
| Before/after SHA-256 or absence comparison of five Codex/Factorio config files | 5/5 unchanged |
| `corepack pnpm check:docs` | Exit 0; 91 Markdown files, 273 local links, balanced fences, no encoding/conflict markers |
| `openspec validate af-01-compatibility-foundation --strict --no-interactive` | Exit 0; selected change valid |
| `git diff --check` | Exit 0; no whitespace errors |

Local evidence: `.runtime/local/diagnostic-1pMoKG/compatibility.json` and its fresh probe/backup databases; failing driver report `.runtime/local/diagnostic-4VlSQ4/compatibility.json`; `.runtime/evidence/{clean-install-results,failure-results,protected-after}.json`; exact failure logs. The clean installation is `.runtime/clean-install-180dda4d5e074522b667f1c029c5dfa9`. Final root outputs/exits are in `.runtime/evidence/final-*.log` and `final-results.json`; `.runtime/evidence/final-source-manifest.json` records SHA-256 hashes of this phase's source/configuration/documentation. These paths are ignored and reproducible via README commands; this handoff and the compatibility report retain the key results in source.

Remaining limitations: no inference, subscription/Astra authentication, role/tool streaming checks, game session, live Space Age profile, character action, pause/save/load run, custom mod or scenario was tested. SQLite is a probe, not the durable runtime. Windows x64 is the only tested platform; the host already had Python 3.12.1 and VS2019 BuildTools, which node-gyp invoked. Initial installs populated ordinary tool caches; no prerequisite upgrade or personal provider/game setting change occurred. The registry warned that pinned ESLint 9.39.2 is deprecated; lint still passed. Project licensing remains undecided; Agentic-Factorio notice coverage remains unresolved for any future copying.

Environment issue: sandboxed shell and Node REPL startup failed with `helper_unknown_error: setup refresh had errors`. Approved unsandboxed commands permitted the authorized work; no sandbox repair was made. Initial install failures for esbuild build approval and store relocation were resolved with project-scoped configuration and a generated-dependency reinstall; they were not treated as passing checks.

Next bounded action: `$openspec-apply-change af-02-subscription-provider`, following phase 02's entry gate. Phase 02 has not started. Do not start phase 05 until phase 04 records real hosted pause/save/load/reconcile/re-arm evidence.

Archive and commit record, 14 September 2026: all four planning artifacts and 8/8 tasks were complete before archival. The inline spec sync preserved the delta Purpose and all four requirement/scenario blocks, then `openspec validate --specs --strict --no-interactive` passed 1/1 specs. Archived to `openspec/changes/archive/2026-09-14-af-01-compatibility-foundation/`, including `.openspec.yaml`. Main spec: `openspec/specs/compatibility-foundation/spec.md`. Guide and traceability links now point to the archive, and archived relative document links were repaired. No later phase was archived or implemented. The post-archive documentation check passed 92 Markdown files and 273 local links. `openspec validate --all --strict --no-interactive` passed all 18 current items (17 active changes and 1 main spec), with zero failures; `git diff --cached --check` passed before commit. Application sources are unchanged from the tested phase 01 source manifest; no additional provider/game runs were needed for archival. The archive/implementation commit has parent `1cdff328c76471cae80b6c6059057da94569c755`; resolve its ID with `git log -1 --format=%H -- openspec/changes/archive/2026-09-14-af-01-compatibility-foundation/tasks.md`.
## Historical OpenSpec planning handoff — 14 September 2026

The user requested conversion of the docs into bounded OpenSpec implementation phases and a copyable execution guide. Planning is complete; application implementation has not begun. Work remains in `C:\@Projects\AutoFactorio` on `main`, based on commit `1cdff32` (`Update tagline in README.md`). This planning package is an uncommitted working-tree change; no new commit or push was made.

Created 18 sequential changes under `openspec/changes/af-01-compatibility-foundation` through `af-18-windows-distribution`, each with proposal, design, a capability delta spec and a task checklist. There are 145 unchecked implementation tasks. No artifact was skipped, no main spec was populated and no change was archived.

Start with [IMPLEMENTATION_GUIDE](IMPLEMENTATION_GUIDE.md) for exact phase order, entry/exit gates and standalone Codex prompts. [SPEC_TRACEABILITY](SPEC_TRACEABILITY.md) maps all R01–R18 requirements and eight review corrections. [Decision 002](decisions/002-openspec-phase-plan.md) records the organization. The original milestones below remain acceptance context; execute only the selected OpenSpec phase.

Executed planning validation: `openspec validate --all --strict --no-interactive` passed all 18 changes, with zero failures. Each change's status reported all four required artifacts complete. A documentation audit also passed for 81 Markdown files and 260 local links, balanced fences, encoding/conflict markers, all 18 launch prompts and requirement mappings, 18 capability specs containing 90 requirements, and 145 unchecked / zero checked implementation tasks. The largest four-artifact planning packet is 10,854 characters. git diff --check passed. These checks establish planning structure only. Application install/build/lint/unit tests, live Factorio gates and provider inference were not run; all implementation criteria remain unverified.

Next bounded action: `$openspec-apply-change af-01-compatibility-foundation`. Recheck installed prerequisites; do not assume the old observations below still apply. Do not begin phase 05 until phase 04 has actual passed hosted-game pause/save/load/reconcile/re-arm evidence. The current OpenSpec schema does not enforce dependencies between changes; the guide and prerequisite tasks require checking recorded evidence.

## Start here

Project: **AutoFactorio: The Factory Needs Nobody**. Repository: `https://github.com/JerrolKrause/auto-factorio`.

The project documents already reside in `C:\@Projects\AutoFactorio`, with README.md and AGENTS.md at root and design documents under docs/. Work in place; no relocation or starter copy is needed. The current task has workspace write access. The user manages Node and other prerequisite upgrades.

The user is an experienced software engineer on Windows with ChatGPT Plus and Factorio 2.0 plus Space Age. Existing subscription usage is acceptable; API charges are not. The project studies factory design, long-horizon reasoning, narrow specialized agents, coordination and recovery. Use deterministic code for routine work. Gameplay must be visible and recorded. Avoid hand-mining and chopping.

Read [REQUIREMENTS.md](REQUIREMENTS.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [SCENARIOS.md](SCENARIOS.md). Treat requirements as accepted product intent. Architecture contains proposed implementation decisions and explicit validation gates; do not describe those gates as already passed.

Recommended stack: Node 24 LTS, TypeScript/pnpm, Lua, local Codex app-server with ChatGPT authentication, scoped MCP gameplay tools, Fastify/React/Vite, SQLite and artifact files. Keep orchestration deterministic and independent of Codex session history. Start with foreman and engineer roles, one builder character, and optional solo mode.

## Intent from the planning conversation

- This is a fun engineering and agent-behavior experiment. Deliver useful incremental progress; a visible small factory is valuable well before a rocket or another planet. Do not let prospective benchmark sophistication delay the first playable result.
- The user has substantial multi-agent experience and explicitly rejected postponing multi-agent foundations to avoid later rewrites. Narrow contexts and easy specialization are intentional. Do not replace this requirement with a single global conversation and a promise to add roles later.
- The user has no personal stack preference and expects the coding agent to write and maintain the code. Favor understandable boundaries, debuggability and practical AI development over a fashionable framework.
- Space Age was selected to preserve modern game rules and room to grow, not to require full expansion gameplay in release one. Plan for multiple surfaces and quality without building speculative late-game subsystems.
- The agent should design factories. Reliable movement, arithmetic and batch execution are welcome; hidden ready-made factory solutions change what the experiment measures. Upstream starter blueprints therefore need explicit treatment.
- Autonomous play and human steering are complementary. Advice should help a run continue and remain available for later analysis. A hint must not disappear into a transcript with no connection to resulting actions.
- The dark/snarky title is intentional branding. Keep activity messages and errors precise enough to debug; humor must not obscure what the system actually did.
- The user accepts consuming their Plus allowance and may upgrade if the project is enjoyable. Do not assume an upgrade, unlimited usage, API access or a paid fallback.
- The user wants fresh-task development to avoid context overload. These files replace the need to inherit the planning conversation.

## Decision status and discovery work

Approved: product scope, project name, multi-agent foundations, five scenarios, Space Age, deterministic-first operation, visible/autonomous runs with recorded steering, and the target project location.

Also approved: end-to-end automation scoring with failing bypass controls; do-nothing controls for every S5 fault; acknowledged game-side fencing and controlled restore barriers; quantitative fuel sufficiency; authorized archive retrieval and briefings; budgets within provider turns; live pause/save/load validation before milestone 1; and correction of obsolete relocation instructions.

Proposed technical baseline: the stack and component boundaries in ARCHITECTURE. Fixture dimensions, equipment quantities, batch size, concurrency limits and run deadlines are engineering defaults to validate, not separately promised outcomes. Record justified adjustments rather than reopening settled product decisions.

Still to discover or revalidate: the selected game/runtime versions after the user's updates, working subscription authentication and Astra access in the selected client, actual tool restrictions, live game control and restore compatibility, and upstream reuse provenance. The read-only installation observations below are starting points, not passed integration gates. Inspect these during milestone 0; the planning conversation is not needed.

When the user requests development, the first action is to inspect the actual repository and environment, preserve any existing work, then execute milestone 0. Do not regenerate the whole design package, invent setup commands, or ask the user to reconfirm settled requirements.

## Observed environment

On 10 September 2026, read-only inspection found:

- Windows PowerShell environment.
- Shell Node: v20.10.0; needs a compatible runtime for the proposed stack.
- Codex CLI: 0.153.4; app-server command and TypeScript-schema generation are present. Local help labels app-server experimental.
- Git and pnpm commands are available; dependency installation/builds have not been tested.
- The shell's Codex command emitted a home-directory/PATH-alias warning. Investigate in setup; do not infer that interactive authentication will work from the help command alone.
- No Factorio installation, subscription login, running game, or model invocation was tested during design.
- A documentation starter with root README.md and AGENTS.md was created after the initial design. No application source, Git repository, runnable commands or upstream code has been added.

Initial research identified stable Factorio 2.0.77 and experimental 2.1.17. Recheck the selected installation and pin the tested game/mod combination. Current upstream documentation may be ahead of stable.

The subsequent read-only review on 10 September found Codex CLI 0.154.0 and Node 20.10.0. It located Factorio at `C:\Program Files (x86)\Steam\steamapps\common\Factorio`, with base metadata 2.0.77 and Space Age data present. Inspected recipe definitions agreed with the stated red-science ingredient ratios. No game session, subscription authentication or model-backed integration was exercised. These observations supersede the earlier CLI version and unknown installation location; recheck them before implementation.

## Milestone 0 — prove the integration

Scope this as a bounded feasibility spike with a small visible diagnostic page/console. Do not build the full dashboard first.

1. Establish a supported Node runtime and a dedicated game/mod/save configuration. Do not silently alter the user's personal saves or global Codex settings.
2. Verify managed ChatGPT sign-in, Astra availability, effective role tool restrictions, public activity streaming, cancellation and resumption with the installed Codex. No model call under API authentication.
3. Start two tiny role-specific sessions and exercise a synthetic handoff, showing separate histories. Check behavior and usage for concurrent sessions under explicit per-turn time/tool caps. Establish available usage events and interruption behavior; use fakes for exhaustive budget cases.
4. Connect to a visible Space Age sandbox. Read bounded structured state, walk a character, place an inventory-backed entity, and observe its actual state.
5. Submit a small batch, force a partial failure, cancel remaining steps, and reconcile after a simulated lost acknowledgement. No duplicate effects.
6. In the visible hosted topology, pause while RCON polling continues and verify scoring time, production, scenario timers and queued effects remain frozen. Record `game.tick`, `ticks_played`, inventories and receipts. Disarm and save with pending intents, confirm save completion, reload behind the execution barrier, reconcile and explicitly re-arm only authorized work. Include a saved order cancelled after the checkpoint: it must not execute on reload before reconciliation. Establish safe handling or rejection of an uncontrolled/native autosave, and prove the Lua lifecycle is multiplayer-safe.
7. Evaluate FLE and Agentic-Factorio's applicable game-action code. Pick a narrow reusable foundation or implement the first bounded action set. Record upstream revision and actual license notices before copying. Starter blueprints, accelerated walking and raw console access must not leak into benchmark defaults.

Exit evidence: a short compatibility report, exact versions, visible event trace, legal game effects, no billing fallback, a live pause/save/load/reconcile/re-arm trace, and an accepted decision on the game foundation. The real-game pause and restore gate must pass before building milestone 1's durable controls; if necessary, revise the adapter or hosted topology and rerun the same gate. This spike needs only a minimal checkpoint manifest, not the full branch UI. If app-server cannot satisfy the required behavior, test the visible Codex CLI plus the same MCP interface as a limited fallback and state which automated controls remain missing. Do not call that fallback equivalent to the full architecture.

## Milestone 1 — durable runtime and visible control

Implement contracts, task ownership, dependencies, acknowledged game-side reservation/fencing rules, event storage, command outbox and receipt reconciliation using milestone 0's validated lifecycle. Implement archive visibility enforcement, filtered context reconstruction and run/per-turn budgets. Build agent activity/timeline views and steering/pause/stop/resume controls. Use deterministic fake provider and game adapters for conflict, restart, stale-epoch and cancellation cases. Demonstrate adding a third synthetic specialist without editing existing role logic.

Exit evidence: a restart preserves pending tasks; delayed revocation blocks reassignment; stale grants, task revisions and restored queues cannot mutate the game; archive IDs/searches/references and new-session briefings do not leak restricted evidence; per-turn tool/time limits and run exhaustion stop active turns and reject late tools. Intervention delivery is acknowledged; UI reconnect reconstructs history; no LLM is used for polling or deterministic validation. Pair failure-path fakes with real-game fencing and restore checks.

## Milestone 2 — First Shift end to end

Build and validate scenario 1 with a deterministic reference action plan and failing preloaded-buffer, character-supply and unrelated-production controls, then run the foreman/engineer team to the red-science target under a visible usage budget. Include one assisted run and one fresh-session continuation. Keep the live dashboard useful before adding visual polish.

Exit evidence: five valid output windows plus required automated terminal-to-science flows, enforced verification mutation restrictions, traceable actions, legal inventory usage, recorded model/assistance settings, and a complete reviewable history. The positive reference passes and the bypass controls fail. A model failure is useful evidence but does not replace reference validation.

## Milestone 3 — complete the sandbox suite

Implement scenarios 2 through 5, their reference solutions and deterministic evaluators. Verify each required upstream stage, inventory balances and quantitative fuel replenishment. Require failing controls for skipped stages, reserve-backed deficient fuel delivery and every unrepaired S5 fault across all eligible verification starts; prove legal restorations pass from the same starting fixtures. Test reset, per-scenario briefings and solo/team comparisons with explicit usage/concurrency accounting. The first release is not complete until all five are ready to launch even if agent reliability varies.

## Milestone 4 — retrospectives and distribution

Add run comparison, intervention review, evidence export, checkpoint branches, disk/retention diagnostics and reliable installation/mod packaging. Verify setup and tests on Windows. Keep model-backed experiments explicit; routine CI uses fakes and deterministic tests.

## Continuity for coding tasks

Repository setup, 11 September 2026: initialized in place on `main`, with `origin` set to `https://github.com/JerrolKrause/auto-factorio`. The initial commit is titled `chore: initialize AutoFactorio documentation starter` (resolve its hash with `git rev-list --max-parents=0 HEAD`). It includes the documentation, OpenSpec configuration and skills, and ignore rules for local credentials, dependencies and generated game data. This setup does not start milestone 0 or push to GitHub. No application tests apply to this documentation-only repository; implementation and live integration checks remain unexecuted. Next bounded action remains milestone 0 when requested.

Historical documentation handoff before Git initialization, 11 September 2026: location `C:\@Projects\AutoFactorio`; at that earlier point no Git repository, branch or commit existed, as confirmed by `git status --short`. Completed: all eight approved design corrections and their milestone acceptance criteria. No source code, mod, scenario saves or dependency setup was added. Application tests and live-game/provider checks remain unexecuted; all implementation acceptance criteria above remain open. Next bounded action, when implementation is requested: recheck prerequisites and execute milestone 0 including the live pause/restore gate.

Executed documentation validation: a PowerShell check across all seven Markdown files passed for existing local-link targets, balanced fenced code blocks, absence of replacement characters/conflict markers, and removal of obsolete relocation instructions. Manual consistency review covered all eight findings across requirements, architecture, scenarios, milestone gates and decision 001, including S5 deadline handling and provider-turn admission versus active execution limits. No application build, lint, unit test, live-game test or provider inference was run.

Use one implementation task through a coherent milestone. Do not create a new task per file. At each milestone, update this handoff with:

- Current repository location, branch and commit.
- Completed requirements and unresolved acceptance criteria.
- Tests actually executed and their results, including live-game evidence.
- Current game/Codex/Node/mod versions.
- Architectural decisions accepted or changed and why.
- Known limitations, reproducible failures, and the next bounded objective.

Keep root `AGENTS.md` short and point to the relevant documents. A fresh task should read the current handoff and the documents relevant to its milestone; it should not need the complete planning conversation. Do not put game-agent prompts or player memory into coding-agent instructions.

## Historical next-task request before phase 02

Paste this into a fresh Codex conversation opened in this repository:

```text
$openspec-apply-change af-02-subscription-provider
Work in C:\@Projects\AutoFactorio. Follow phase 02 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

This starts only phase 02 of milestone 0 after the passed phase 01 gate. Use the guide's later prompts in order after each predecessor gate passes. A request to implement the selected phase supplies its implementation authorization; historical proposal wording does not require a second approval. Phase 01 implementation stopped before submitting this phase 02 request.

## Development permissions ? 14 September 2026

At existing commit 1cdff32 on main, the user authorized reducing routine development approvals. Added ignored project-local `.codex/config.toml` with `approval_policy = "on-request"`, `approvals_reviewer = "auto_review"`, `sandbox_mode = "workspace-write"`, and sandbox network access enabled. Global settings and other projects were not changed. Root AGENTS.md now records autonomous execution within an authorized milestone, including project dependencies, tests, dedicated local game runs, fixes and documentation.

Verified: TOML parsing and the desktop Codex 0.153.4 app-server strict configuration load; `config/read` with this project as cwd returned all four requested values. No model inference or application/game tests ran. Existing planning changes were preserved. This running chat retains its supplied permission policy; reopen the project in a new chat to load the configuration, and check the app permissions control if it supplies an override. The Windows sandbox startup error (`setup refresh had errors`) observed in this session remains unresolved; these settings are not a verified repair for it. No implementation milestone was started and no commit or push was made. Next bounded action: verify effective permissions in a fresh project chat, then continue the user-selected implementation phase.

### Continuation update - 15 September 2026

The authorized corrected live probe continuation did not execute. Automatic approval review blocked the process before launch because the ChatGPT provider usage limit had been reached, with instructions to retry after reset or upgrade. No workaround, alternate provider, credit purchase, model substitution or indirect execution was attempted. No additional provider turns were consumed.

The corrected implementation now supplies an empty environment override on every turn and verifies thread state before gateway admission. This fix is covered by the deterministic test suite, but the live post-fix resume check remains unverified. The previous corrected trial remains evidence: 2 turns consumed, 28,384 reported tokens, one real handoff, public activity, forbidden role and identity calls rejected, steering acknowledged, interruption confirmed and synthetic cancellation confirmed; resume was blocked by the environment-selection check before further inference.

Phase 02 remains at 6/8 tasks complete. Task 2.5 and the integrated exit gate task 3.1 remain unchecked. The next bounded action is to wait for provider allowance reset and resume this same phase with a newly declared live budget. Phase 03 must not start.
