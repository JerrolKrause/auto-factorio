## 1. Establish this phase's entry state

- [ ] 1.1 Read the current handoff, this change's proposal/design/spec and the relevant source sections listed in design; verify `af-15-mining-power-bootstrap` has a recorded passed implementation gate, preserve user changes, and record any concrete blocker. OpenSpec artifact readiness alone is not this verification.

## 2. Implement the bounded slice

- [ ] 2.1 Generate S5 initial saves from the S4 legal reference and implement the three private deterministic fault variants; verify actual injection ticks, repair spares and observer/gameplay visibility separation.
- [ ] 2.2 Implement admission/finish deadline semantics and recovery metrics; verify boundary ticks at 36000, fixed settling/scoring finish and independent wall-limit handling.
- [ ] 2.3 Collect tick-level do-nothing traces through the latest eligible finish for every variant; verify a deterministic sliding-window scan tests every eligible admission tick with the full output/stage/fuel evaluator.
- [ ] 2.4 Implement a legal repair or alternate restoration from each identical starting save; verify each passes while its do-nothing control cannot, revising and rerunning any ineffective fault fixture.
- [ ] 2.5 Verify hidden seed/reference/injection receipts remain unavailable to gameplay and publish the complete S1–S5 readiness matrix; verify no variant or shared bypass acceptance is omitted.

## 3. Close with evidence

- [ ] 3.1 Check the integrated exit gate against actual results: Each of the three variants fails every eligible unrepaired start and has a legal passing restoration from its identical save; deadline edges and archive restrictions pass. Retain exact commands, outcomes and relevant evidence references; leave unmet criteria unchecked.
- [ ] 3.2 Update `docs/IMPLEMENTATION_HANDOFF.md` with the tested revision, completed criteria, executed checks, remaining limits and next phase; keep README commands accurate, record material decisions and verify documentation links. Stop after this change; do not automatically start another phase or mark a failed implementation gate complete.