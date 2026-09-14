## 1. Establish this phase's entry state

- [ ] 1.1 Read the current handoff, this change's proposal/design/spec and the relevant source sections listed in design; verify `af-09-live-control-dashboard` has a recorded passed implementation gate, preserve user changes, and record any concrete blocker. OpenSpec artifact readiness alone is not this verification.

## 2. Implement the bounded slice

- [ ] 2.1 Implement verification admission/settling/scoring/abort/invalid states with frozen scope and fixed manifest timing; verify pending mutations are resolved before the admission baseline.
- [ ] 2.2 Enforce observation-only verification in Lua for queued and new actions, with allowed non-interacting walking; verify manual science crafting/fixture tampering is denied throughout and repair requests abort before mutation admission reopens.
- [ ] 2.3 Implement five 3600-tick fresh-production/collector windows; verify boundary ticks, 29-pack failures, old inventory exclusion, paused clocks and run deadline closure.
- [ ] 2.4 Implement required-stage net flow/inventory coverage accounting and explicit tolerances; verify disconnected upstream, recirculation and reserve drawdown traces fail while normal buffering passes.
- [ ] 2.5 Exercise disconnect gaps and human edits and run a narrow live queued-mutation guard check; verify invalid results cannot become success and evidence retains baselines/coverage/reasons for S1 calibration.

## 3. Close with evidence

- [ ] 3.1 Check the integrated exit gate against actual results: State-machine, window-boundary, missing-evidence and disconnected/recirculation controls pass deterministically; queued-action verification guard passes in the game. S1 engine measurement proof remains phase 11. Retain exact commands, outcomes and relevant evidence references; leave unmet criteria unchecked.
- [ ] 3.2 Update `docs/IMPLEMENTATION_HANDOFF.md` with the tested revision, completed criteria, executed checks, remaining limits and next phase; keep README commands accurate, record material decisions and verify documentation links. Stop after this change; do not automatically start another phase or mark a failed implementation gate complete.