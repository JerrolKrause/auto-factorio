## 1. Establish this phase's entry state

- [x] 1.1 Read the current handoff, this change's proposal/design/spec and the relevant source sections listed in design; verify `af-01-compatibility-foundation` has a recorded passed implementation gate, preserve user changes, and record any concrete blocker. OpenSpec artifact readiness alone is not this verification.

## 2. Implement the bounded slice

- [x] 2.1 Implement the pinned provider port and managed-auth/model preflight; verify fakes reject API authentication, absent Astra and paid fallback while retaining actual model/effort.
- [x] 2.2 Implement isolated role profiles and authenticated MCP identities; verify forbidden shell/edit/browser/connectors/admin/native-subagent tools and identity spoofing are denied by the effective catalog and gateway.
- [x] 2.3 Stream public lifecycle/tool/usage events to the diagnostic console; verify correlated start/steer/interrupt/resume and late-output/unconfirmed-interrupt behavior using fakes.
- [x] 2.4 Implement roster turn/tool/time/token accounting and admission closure; verify one long turn, rejected tool attempts, duplicate/missing usage, final admitted turns, replacement sessions and simultaneous exhaustion without new inference.
- [x] 2.5 Declare the small live probe caps from design, then run two real synthetic scoped sessions through supported ChatGPT access; verify separate histories, a handoff, public activity, effective isolation and cancellation/resumption, recording any failed capability as a gate failure.

## 3. Close with evidence

- [x] 3.1 Check the integrated exit gate against actual results: Managed authentication, Astra discovery, two isolated histories, live activity and lifecycle are evidenced; deterministic budget/late-tool tests pass. No real game is required in this phase. Retain exact commands, outcomes and relevant evidence references; leave unmet criteria unchecked.
- [x] 3.2 Update `docs/IMPLEMENTATION_HANDOFF.md` with the tested revision, completed criteria, executed checks, remaining limits and next phase; keep README commands accurate, record material decisions and verify documentation links. Stop after this change; do not automatically start another phase or mark a failed implementation gate complete.