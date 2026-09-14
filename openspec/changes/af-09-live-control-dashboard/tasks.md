## 1. Establish this phase's entry state

- [ ] 1.1 Read the current handoff, this change's proposal/design/spec and the relevant source sections listed in design; verify `af-08-bounded-context` has a recorded passed implementation gate, preserve user changes, and record any concrete blocker. OpenSpec artifact readiness alone is not this verification.

## 2. Implement the bounded slice

- [ ] 2.1 Implement loopback capability/origin-protected HTTP commands and durable-cursor SSE; verify unauthorized requests fail and reconnect reconstructs without duplicate events.
- [ ] 2.2 Build the React operator page for roster states, task graph, timeline, tool/observation detail, batch progress and measurements; verify the documented waiting/disconnected/unconfirmed states with deterministic UI fixtures.
- [ ] 2.3 Persist steering text/recipient/clocks before routing and separate delivery from interpretation; verify duplicates and advice racing a batch do not duplicate assignments or silently cancel it.
- [ ] 2.4 Wire pause/stop/resume and explicit reprioritization to existing budget/fence/lifecycle controls; verify real pause under polling and truthful disconnected cancellation/checkpoint behavior.
- [ ] 2.5 Record detected human edits and uncertain causality; verify a verification edit marks assistance and invalidation, and use UI tests to confirm the browser can close/reopen without ending the run.

## 3. Close with evidence

- [ ] 3.1 Check the integrated exit gate against actual results: Operator can watch two roles, inspect evidence, steer and pause/stop/resume; reconnect, duplicate steering, local-origin checks and unconfirmed-control states pass UI/integration tests. Retain exact commands, outcomes and relevant evidence references; leave unmet criteria unchecked.
- [ ] 3.2 Update `docs/IMPLEMENTATION_HANDOFF.md` with the tested revision, completed criteria, executed checks, remaining limits and next phase; keep README commands accurate, record material decisions and verify documentation links. Stop after this change; do not automatically start another phase or mark a failed implementation gate complete.