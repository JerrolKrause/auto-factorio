# Phase 01 compatibility report

Current M0 integration evidence is consolidated in the [integration gate report](INTEGRATION_GATE_REPORT.md) and [handoff](IMPLEMENTATION_HANDOFF.md). The phase 01 observations below remain historical; phase 02 provider, phase 03 actions and phase 04 real pause/restore now have their own executed evidence.

Observed on 14 September 2026 on Windows x64 in `C:\@Projects\AutoFactorio`, branch `main`, HEAD `1cdff328c76471cae80b6c6059057da94569c755` plus the phase 01 implementation and preserved pre-existing planning edits, subsequently committed with the phase 01 archive. The handoff records how to resolve the archive commit. Phase 01's compatibility foundation gate passed. This does not complete milestone 0's provider/game integration gates.

## Current version evidence

| Check / exact command or source | Actual output / result |
| --- | --- |
| `node --version` | `v24.21.0` |
| `corepack --version` | `0.36.0` |
| `pnpm --version` | Not found on PATH; no global shim installed |
| `corepack pnpm --version` | `12.4.1`, pinned in package.json and lockfile |
| `codex --version` | `codex-cli 0.154.0`; version only, no authentication or inference |
| `git rev-parse HEAD` | `1cdff328c76471cae80b6c6059057da94569c755` |
| `& 'C:/Program Files (x86)/Steam/steamapps/common/Factorio/bin/x64/factorio.exe' --version` | `Version: 2.0.77 (build 84539, win64, steam)`; `Version: 64`; map input `1.0.0-0`; map output `2.0.77-0` |
| `<Factorio>/data/{base,space-age,quality,elevated-rails}/info.json` | All four installed mods report `2.0.77`; Space Age declares base, quality and elevated-rails dependencies. Active-game mod profile remains unverified. |
| SQLite real-driver probe | better-sqlite3 `13.0.3`, SQLite `3.53.4`; WAL, committed write/read, constraint-triggered rollback, close/reopen and online backup/reopen passed |
| Native dependency installation | node-gyp `12.3.0`, existing Python `3.12.1`, existing VS2019 BuildTools `16.11.34301.259`; no prerequisites upgraded |

The installed Node version is on the [Node 24 LTS line](https://nodejs.org/en/about/previous-releases). The game version above is the selected installed 2.0 baseline, not a claim that every more recent game version is compatible. No Factorio installation, personal mod profile or save was modified. The [driver API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) informed the transaction/backup probe; actual host results establish this selection.

## Reproduction and checks

From the project directory:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm lint
corepack pnpm test
corepack pnpm check:docs
corepack pnpm diagnose --data-dir 'C:/@Projects/AutoFactorio/.runtime/local' --factorio-dir 'C:/Program Files (x86)/Steam/steamapps/common/Factorio'
openspec validate af-01-compatibility-foundation --strict --no-interactive
```

Fresh-copy installation with no existing node_modules/build outputs and a separate store passed with exit 0, as did build, lint and all 11 tests. The copy is `.runtime/clean-install-180dda4d5e074522b667f1c029c5dfa9`; `.runtime/evidence/clean-install-results.json` records each exit. It reused the host's installed prerequisites and Corepack/native-tool caches, so it is not a clean-Windows-machine certification. Final root command results are recorded in the [handoff](IMPLEMENTATION_HANDOFF.md).

The successful diagnostic report is `.runtime/local/diagnostic-1pMoKG/compatibility.json` (observed at `2026-09-14T15:19:41.604Z`). It retains exact version command arrays, stdout/stderr/exit codes, installed metadata, paths, revision/dirty state and unresolved gates. Its unique SQLite database and backup remain alongside it. Reports are local ignored evidence; the checked-in report/handoff retain the outcomes if that data is later removed.

Eleven tests cover actual SQLite commit/rollback/reopen/backup, unsupported driver, unavailable native loader, owned directory reuse, personal-save sentinel preservation, protected ancestors/descendants, Windows junction resolution, absolute paths, missing executable, incompatible runtime output, and absent/malformed mod metadata. Four CLI checks also returned the expected exit 1: the diagnostic above with `--sqlite-driver unsupported`; `corepack pnpm diagnose` without arguments; the normal diagnostic with `--data-dir 'C:/Users/Jerrol/AppData/Roaming/Factorio'`; and with `--data-dir 'C:/@Projects/AutoFactorio/unsafe-data'`. The unsupported-driver run wrote `.runtime/local/diagnostic-4VlSQ4/compatibility.json` with foundation failure and no driver fallback. The path/argument failures do not initialize those data directories. Exact failure outputs and exits are in `.runtime/evidence/diagnostic-*.log` and `failure-results.json`.

`git check-ignore -v -- <report-path>` resolved both reports to `.gitignore`'s `.runtime/` rule. `git ls-files -- .runtime .pnpm-store node_modules dist auth.json credentials.json saves game-assets factorio-install` returned no tracked paths. Additional `git check-ignore --no-index` checks passed for `.env`, auth/credential names, databases' containing data path, save ZIPs, game assets, installation paths, EXE/DLL/ZIP outputs, dependencies and build output.

SHA-256/existence snapshots before implementation writes and after the probes match for user `.codex/config.toml`, `.codex/auth.json`, personal Factorio `config/config.ini`, personal `mods/mod-list.json` and project `.codex/config.toml`: 5/5 unchanged. Hashes remain only in `.runtime/evidence/protected-before.json`; boolean comparisons are in `protected-after.json`. No personal save was opened or written; an isolated sentinel test verifies rejection preserves existing contents.

## Resolved setup failures and remaining limitations

The Windows Codex sandbox failed before shell creation with `helper_unknown_error: setup refresh had errors`; the Node REPL filesystem fallback failed identically. Authorized commands ran via approved unsandboxed execution. That tool-environment defect remains unresolved; this phase did not alter global settings to repair it.

The first dependency install stopped with `ERR_PNPM_IGNORED_BUILDS` for esbuild. After explicitly allowing only esbuild and better-sqlite3 and correcting pnpm 12's store configuration to workspace YAML, switching stores required `corepack pnpm install --force` to recreate generated dependencies. That command passed, followed by a successful fresh-copy frozen install. Normal user commands need no force flag. Initial Corepack/pnpm/node-gyp downloads populated user caches, but no global tool version, provider setting or game setting was changed. The package registry emitted an ESLint 9.39.2 deprecation warning; the pinned lint tool passed. No claim of a dependency security audit is made.

The [provenance inventory](../third_party/README.md) pins FLE `e2a829d22a635a9a111d21bf5523e09e903ae145` and Agentic-Factorio `158dee786df204cf588a3c5e5120b2dd79aab695`, inspected action paths and license evidence. [Decision 003](decisions/003-compatibility-foundation.md) selects a bounded original game adapter for phase 03. No upstream mechanics, factory blueprints, game assets or provider loops were copied.

Unverified: ChatGPT authentication/Astra/allowance, live public activity and role restrictions (phase 02); running Space Age profile/prototype facts and legal character actions (phase 03); hosted pause and controlled save/load/reconcile/re-arm (phase 04). No provider inference, game session, custom mod, scenario run, browser dashboard, Linux test or release packaging was performed. Phase 05 remains blocked on phase 04's actual live gate. Stop here; phase 02 is the next bounded implementation action only when requested.
