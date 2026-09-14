## 1. Establish this phase's entry state

- [ ] 1.1 Read the current handoff, this change's proposal/design/spec and the relevant source sections listed in design; verify `af-11-first-shift-reference` has a recorded passed implementation gate, preserve user changes, and record any concrete blocker. OpenSpec artifact readiness alone is not this verification.

## 2. Implement the bounded slice

- [ ] 2.1 Wire the S1/roster launch workflow to existing provider, game, evaluator and dashboard; verify fake preflight rejects missing reference evidence or unsupported auth/tools before inference.
- [ ] 2.2 Record the declared per-run/per-turn caps, model/instruction versions and two-run trial plan from design; verify the run manifests show these settings and unknown telemetry honestly.
- [ ] 2.3 Run the bounded unassisted team trial with one fresh engineer-session replacement; verify separate histories, refreshed authorized context, reconciled pending effects and continuous budget accounting.
- [ ] 2.4 Run the separately assisted trial and capture an actual operator hint; verify exact text/recipient/clocks/acknowledgement/interpretation and resulting work appear in the report.
- [ ] 2.5 Publish a sanitized trial report with run IDs, checksums/references, evaluator outcome and failure/usage reasons; verify stochastic failure is separate from software gate status and no unbounded retries were used.

## 3. Close with evidence

- [ ] 3.1 Check the integrated exit gate against actual results: Declared team, assisted and fresh-context exercises finish with complete evidence or explicit bounded model failure. Software/reference gates must pass; missing integration evidence is still a blocker. Retain exact commands, outcomes and relevant evidence references; leave unmet criteria unchecked.
- [ ] 3.2 Update `docs/IMPLEMENTATION_HANDOFF.md` with the tested revision, completed criteria, executed checks, remaining limits and next phase; keep README commands accurate, record material decisions and verify documentation links. Stop after this change; do not automatically start another phase or mark a failed implementation gate complete.