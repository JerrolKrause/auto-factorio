## 1. Establish this phase's entry state

- [x] 1.1 Read the current handoff, this change's proposal/design/spec and the relevant source sections listed in design; verify `af-07-agent-coordination` has a recorded passed implementation gate, preserve user changes, and record any concrete blocker. OpenSpec artifact readiness alone is not this verification.

## 2. Implement the bounded slice

- [x] 2.1 Implement default-deny visibility authorization for events/artifacts and current role/task scopes; verify direct-ID and cross-role requests cannot retrieve hidden evidence.
- [x] 2.2 Apply authorization to searches, counts/snippets, pagination, payload downloads and recursive references; verify guessed IDs and permitted-parent/restricted-child attacks disclose no protected content.
- [x] 2.3 Implement bounded briefing/detail/archive retrieval and recipe fingerprint caching with separate dynamic availability; verify byte/entity caps, explicit omissions and stale-cache prevention.
- [x] 2.4 Build replacement-session briefings and provenance-preserving summaries from durable state; verify pending orders/steering are reconstructed without including restricted source facts.
- [x] 2.5 Run a privacy matrix including hidden reference plans, fault receipts, raw saves, operator exports and sanitized projections; verify useful normal world symptoms remain observable while archive answers stay private.

## 3. Close with evidence

- [x] 3.1 Check the integrated exit gate against actual results: Direct-ID/search/reference/cross-role/summary/replacement tests deny hidden evidence, and a fresh briefing reconstructs useful authorized work within configured bounds. Retain exact commands, outcomes and relevant evidence references; leave unmet criteria unchecked.
- [x] 3.2 Update `docs/IMPLEMENTATION_HANDOFF.md` with the tested revision, completed criteria, executed checks, remaining limits and next phase; keep README commands accurate, record material decisions and verify documentation links. Stop after this change; do not automatically start another phase or mark a failed implementation gate complete.
