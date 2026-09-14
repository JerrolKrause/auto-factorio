## 1. Establish this phase's entry state

- [x] 1.1 Read the current handoff, this change's proposal/design/spec and the relevant source sections listed in design; verify the actual Git state and current prerequisites, preserve user changes, and record any concrete blocker. OpenSpec artifact readiness alone is not this verification.

## 2. Implement the bounded slice

- [x] 2.1 Recheck installed Node/pnpm/Codex/Factorio/Space Age versions and explicit data paths; verify the compatibility report contains current command outputs and unresolved checks without changing prerequisites.
- [x] 2.2 Create the minimal pnpm/strict-TypeScript workspace and real install/build/lint/test scripts; verify installation from the new lockfile and execute each documented script.
- [x] 2.3 Add the local diagnostic entry point and Windows SQLite transaction/backup probe; verify a write/read/reopen/backup round trip and an explicit unsupported-driver failure.
- [x] 2.4 Inspect selected FLE and Agentic-Factorio action code and license notices; deliver a decision with exact revisions, retained behavior and exclusions before copying any mechanics.
- [x] 2.5 Configure ignored runtime data and credential/game-asset exclusions; verify a generated diagnostic artifact stays out of tracked source and personal configuration is unchanged.

## 3. Close with evidence

- [x] 3.1 Check the integrated exit gate against actual results: Workspace commands execute, SQLite smoke passes and the compatibility/provenance report lists observed versions and remaining live gates. Retain exact commands, outcomes and relevant evidence references; leave unmet criteria unchecked.
- [x] 3.2 Update `docs/IMPLEMENTATION_HANDOFF.md` with the tested revision, completed criteria, executed checks, remaining limits and next phase; keep README commands accurate, record material decisions and verify documentation links. Stop after this change; do not automatically start another phase or mark a failed implementation gate complete.