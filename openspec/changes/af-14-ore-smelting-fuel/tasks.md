## 1. Establish this phase's entry state

- [ ] 1.1 Read the current handoff, this change's proposal/design/spec and the relevant source sections listed in design; verify `af-13-plate-to-science` has a recorded passed implementation gate, preserve user changes, and record any concrete blocker. OpenSpec artifact readiness alone is not this verification.

## 2. Implement the bounded slice

- [ ] 2.1 Add the S3 ore/coal fixture, furnaces, briefing, grants/kit and reset entry; verify supplied rates/equipment and legal live furnace interactions match the manifest.
- [ ] 2.2 Extend required-stage measurements for ore admission, smelting, gear production and delivery; verify the documented 300/150 ore and plate totals plus 150 gears from installed recipes.
- [ ] 2.3 Implement per-branch coal source/route/consumer and burning-energy balances; verify declared tolerances allow legal item-phase buffering and missing coverage returns invalid.
- [ ] 2.4 Execute a legal S3 reference; verify five science windows, fresh smelting-chain totals and adequate measured furnace fuel replenishment in Factorio.
- [ ] 2.5 Run no-fuel, trickle/deficient-branch delivery with large reserves, unrelated coal/production, skipped smelting, preload and character-supply controls; verify output-sufficient bypasses still fail.

## 3. Close with evidence

- [ ] 3.1 Check the integrated exit gate against actual results: S3 positive reference and smelting/shared controls pass; absent and insufficient furnace fuel delivery reliably fail despite reserves, with coverage/tolerances recorded. Retain exact commands, outcomes and relevant evidence references; leave unmet criteria unchecked.
- [ ] 3.2 Update `docs/IMPLEMENTATION_HANDOFF.md` with the tested revision, completed criteria, executed checks, remaining limits and next phase; keep README commands accurate, record material decisions and verify documentation links. Stop after this change; do not automatically start another phase or mark a failed implementation gate complete.