## 1. Establish this phase's entry state

- [x] 1.1 Read the current handoff, this change's proposal/design/spec and the relevant source sections listed in design; verify `af-04-pause-restore-gate` has a recorded passed implementation gate, preserve user changes, and record any concrete blocker. OpenSpec artifact readiness alone is not this verification.

## 2. Implement the bounded slice

- [x] 2.1 Add migrations, versioned events and transactional projections for current run/task/agent/message/command/measurement/intervention/checkpoint contracts; verify crash atomicity and projection rebuild equality.
- [x] 2.2 Add transactional command intent/outbox before dispatch; verify crashes before send, after game effect and before acknowledgement reconcile receipts without duplicate effects.
- [x] 2.3 Add checksummed visibility-labeled artifacts, exact agent observations and credential redaction; verify missing/corrupt payloads produce explicit incomplete evidence.
- [x] 2.4 Persist budget and task recovery state independent of provider transcripts and connect the existing checkpoint barrier; verify process replacement reconstructs pending work and retains expenditure.
- [x] 2.5 Exercise single-writer SQLite backup/reopen with concurrent event production; verify a consistent snapshot and perform a narrow live restart/receipt reconciliation against the phase 04 lifecycle.

## 3. Close with evidence

- [x] 3.1 Check the integrated exit gate against actual results: Crash/restart preserves pending intents, projections, budgets and references without duplicate effects; backup and artifact integrity checks pass against the validated engine lifecycle. Retain exact commands, outcomes and relevant evidence references; leave unmet criteria unchecked.
- [x] 3.2 Update `docs/IMPLEMENTATION_HANDOFF.md` with the tested revision, completed criteria, executed checks, remaining limits and next phase; keep README commands accurate, record material decisions and verify documentation links. Stop after this change; do not automatically start another phase or mark a failed implementation gate complete.