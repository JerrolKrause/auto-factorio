## 1. Establish this phase's entry state

- [ ] 1.1 Read the current handoff, this change's proposal/design/spec and the relevant source sections listed in design; verify `af-17-retrospectives-branches` has a recorded passed implementation gate, preserve user changes, and record any concrete blocker. OpenSpec artifact readiness alone is not this verification.

## 2. Implement the bounded slice

- [ ] 2.1 Implement/test the Windows local launcher and copied mod packaging with explicit data directory; verify setup in a fresh data path without touching personal saves, global provider settings or game assets.
- [ ] 2.2 Document exact install/build/lint/test/launch/reset/recovery commands from actual scripts and lockfile; execute the Windows commands and verify each recorded result.
- [ ] 2.3 Implement retention, referenced-artifact protection, disk-pressure and recording-failure reporting; verify low-disk/corrupt/missing evidence does not appear fully recorded or safely restorable.
- [ ] 2.4 Configure deterministic software CI without licensed assets or model access; verify Windows software checks and Linux portability checks where practical while retaining separate live-gate records.
- [ ] 2.5 Run a packaged visible launch/reset/control/backup smoke and audit all five reference/bypass/fault matrices against the release fingerprint; verify release gates, notices and known model limitations are documented.

## 3. Close with evidence

- [ ] 3.1 Check the integrated exit gate against actual results: Windows setup/launch/reset/control/backup smoke and all five scenario release gates pass, software commands are accurate, licenses/provenance are recorded and known model limitations remain explicit. Retain exact commands, outcomes and relevant evidence references; leave unmet criteria unchecked.
- [ ] 3.2 Update `docs/IMPLEMENTATION_HANDOFF.md` with the tested revision, completed criteria, executed checks, remaining limits and next phase; keep README commands accurate, record material decisions and verify documentation links. Stop after this change; do not automatically start another phase or mark a failed implementation gate complete.