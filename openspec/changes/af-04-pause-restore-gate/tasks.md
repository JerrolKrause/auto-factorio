## 1. Establish this phase's entry state

- [ ] 1.1 Read the current handoff, this change's proposal/design/spec and the relevant source sections listed in design; verify `af-03-character-execution` has a recorded passed implementation gate, preserve user changes, and record any concrete blocker. OpenSpec artifact readiness alone is not this verification.

## 2. Implement the bounded slice

- [ ] 2.1 Implement pause admission/disarm and engine pause with continued polling; verify unchanged game.tick, experiment time, production, scenario timers, queued effects and inventories across a live pause.
- [ ] 2.2 Capture a disarmed/neutralized paused save and minimal checkpoint manifest; verify save completion/checksum and rejection of interrupted or mismatched captures.
- [ ] 2.3 Implement held managed load, ledger reconciliation, new epoch/session installation and explicit re-arm without on_load state mutation; verify the multiplayer-safe lifecycle with pending timed work in Factorio.
- [ ] 2.4 Exercise a pending order saved before later cancellation, delayed old traffic and stale arm; verify the restored world cannot execute it before reconciliation or without fresh authorization.
- [ ] 2.5 Implement/test heartbeat disarm and controlled-source recovery policy; verify reconnect alone cannot arm and an unsafe native/autosave cannot automatically continue.
- [ ] 2.6 Consolidate M0 provider, actions and real pause/restore traces; verify every M0 criterion is evidenced and explicitly block phase 05 if any required live gate remains unproven.

## 3. Close with evidence

- [ ] 3.1 Check the integrated exit gate against actual results: Real hosted pause under polling and disarmed capture/load/reconcile/re-arm pass, including timed activity, control loss, stale traffic, pending work and post-checkpoint cancellation; M0 evidence is consolidated. Retain exact commands, outcomes and relevant evidence references; leave unmet criteria unchecked.
- [ ] 3.2 Update `docs/IMPLEMENTATION_HANDOFF.md` with the tested revision, completed criteria, executed checks, remaining limits and next phase; keep README commands accurate, record material decisions and verify documentation links. Stop after this change; do not automatically start another phase or mark a failed implementation gate complete.