## 1. Establish this phase's entry state

- [x] 1.1 Read the current handoff, this change's proposal/design/spec and the relevant source sections listed in design; verify `af-05-durable-event-runtime` has a recorded passed implementation gate, preserve user changes, and record any concrete blocker. OpenSpec artifact readiness alone is not this verification.

## 2. Implement the bounded slice

- [x] 2.1 Implement atomic area/item/actor reservation sets with deterministic ordering; verify conflicting acquisition, partial-grant prevention and independent actor/agent identities.
- [x] 2.2 Persist revocation intent and close admission before Lua fencing; verify delayed or disconnected acknowledgements keep reservations unavailable for replacement.
- [x] 2.3 Check epoch/session/task revision and every required generation at admission and each per-tick effect; verify stale area grants and continuing movement/mining/crafting stop safely.
- [x] 2.4 Implement idempotent revoke and monotonic grant/arm processing; verify duplicate controls and reordered old grants cannot regress generations or revive work.
- [x] 2.5 Run fake race tests and live revoke/reassign/restore tests including a post-checkpoint cancelled task; verify final receipts and no effects from revoked or restored obsolete work.

## 3. Close with evidence

- [x] 3.1 Check the integrated exit gate against actual results: Conflict, delayed revocation, stale task/grant/arm, per-tick cancellation and restored cancelled-order checks pass with both deterministic failure tests and live evidence. Retain exact commands, outcomes and relevant evidence references; leave unmet criteria unchecked.
- [x] 3.2 Update `docs/IMPLEMENTATION_HANDOFF.md` with the tested revision, completed criteria, executed checks, remaining limits and next phase; keep README commands accurate, record material decisions and verify documentation links. Stop after this change; do not automatically start another phase or mark a failed implementation gate complete.
