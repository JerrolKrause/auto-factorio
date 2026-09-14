## 1. Establish this phase's entry state

- [ ] 1.1 Read the current handoff, this change's proposal/design/spec and the relevant source sections listed in design; verify `af-06-fenced-ownership` has a recorded passed implementation gate, preserve user changes, and record any concrete blocker. OpenSpec artifact readiness alone is not this verification.

## 2. Implement the bounded slice

- [ ] 2.1 Add definition/instance/actor/provider-lineage contracts and foreman/engineer/solo configurations; verify independent histories and a bodyless foreman.
- [ ] 2.2 Implement durable task graph transitions, dependency/cycle checks and evidence-based completion; verify invalid cycles, unsupported success claims and superseded revisions are rejected.
- [ ] 2.3 Implement scoped authenticated messaging and deterministic handoff/assistance routing; verify duplicate delivery around restart does not duplicate assignments.
- [ ] 2.4 Wire persisted budgets and acknowledged reservations into scheduling; verify queue progress needs no model polling and two active sessions at exhaustion cannot admit late work.
- [ ] 2.5 Register a synthetic third specialist and exercise solo/team restart/handoff through existing contracts; verify no rewrite of initial roles or coordination mechanisms is needed.

## 3. Close with evidence

- [ ] 3.1 Check the integrated exit gate against actual results: Two roles hand off durable work, a third synthetic role registers without rewriting coordination, solo uses the same contracts and concurrent budget exhaustion safely cancels game work. Retain exact commands, outcomes and relevant evidence references; leave unmet criteria unchecked.
- [ ] 3.2 Update `docs/IMPLEMENTATION_HANDOFF.md` with the tested revision, completed criteria, executed checks, remaining limits and next phase; keep README commands accurate, record material decisions and verify documentation links. Stop after this change; do not automatically start another phase or mark a failed implementation gate complete.