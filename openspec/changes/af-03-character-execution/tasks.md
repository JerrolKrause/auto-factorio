## 1. Establish this phase's entry state

- [ ] 1.1 Read the current handoff, this change's proposal/design/spec and the relevant source sections listed in design; verify `af-02-subscription-provider` has a recorded passed implementation gate, preserve user changes, and record any concrete blocker. OpenSpec artifact readiness alone is not this verification.

## 2. Implement the bounded slice

- [ ] 2.1 Define and validate the bounded observation/action/receipt contracts with surface, quality, epoch, session, task revision and fixed test grants; verify malformed payload rejection and explicit unsupported rich recipe calculations.
- [ ] 2.2 Implement fixed structured RCON/Lua RPC plus bounded observations and installed-game recipe calculations; verify real entity/inventory reads, pagination, fingerprinting and denial of raw Lua/admin payloads.
- [ ] 2.3 Implement/reuse normal timed character movement, mining/crafting, placement, rotation, recipe changes, transfers and deconstruction in the dedicated sandbox; verify reach/collision/material constraints and recorded engine inventory deltas.
- [ ] 2.4 Implement asynchronous capped batches, progress, persistent command/step receipts and cancellation; verify partial failure identifies completed and unexecuted steps without claiming rollback.
- [ ] 2.5 Exercise live legal actions, lost acknowledgement/query-before-retry and protected fixtures with a visible client; verify no duplicate placement or illegal effect and retain observation/action/outcome evidence.

## 3. Close with evidence

- [ ] 3.1 Check the integrated exit gate against actual results: Visible movement, timing/reach, inventory accounting, placement/rotation/recipe/transfer/deconstruction, partial failure, cancellation and lost-response reconciliation pass in Factorio. Retain exact commands, outcomes and relevant evidence references; leave unmet criteria unchecked.
- [ ] 3.2 Update `docs/IMPLEMENTATION_HANDOFF.md` with the tested revision, completed criteria, executed checks, remaining limits and next phase; keep README commands accurate, record material decisions and verify documentation links. Stop after this change; do not automatically start another phase or mark a failed implementation gate complete.