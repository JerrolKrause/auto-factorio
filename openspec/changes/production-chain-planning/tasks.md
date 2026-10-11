# Tasks

Planning only: every checkbox below is implementation work and remains pending. Follow [design](design.md), [model selection](../../../docs/MODEL_SELECTION.md), [verification](../../../.agents/skills/verify-change/author-workflow.md) and [independent review](../../../.agents/skills/change-audit/author-workflow.md).

## 1. S1 - Installed facts and discovery

- [ ] 1.1 Establish the shared finite session plan and v2 readiness manifest with the scenario map below, exact source boundaries, resource owner and cleanup; verify `change:ready` permits S1 only and rejects premature dependent expansion. Install pinned dependencies with `corepack.cmd pnpm install --frozen-lockfile` and record actual prerequisites without upgrading them.
- [ ] 1.2 Add versioned product/recipe/machine/public-request contracts, effective Lua fact export and TypeScript indexes; verify alias/ambiguous-name lookup, separate product/recipe IDs, changed research/fingerprints, Space Age categories, fluid geometry/temperature and profile blockers through `production_search`.
- [ ] 1.3 Add bounded authorized search/detail delivery and artifact-reference contracts; delegate focused test writing after interfaces stabilize. Verify response/cursor limits, revoked in-flight delivery, private-source exclusions and machine compatibility with `tests/production-facts.test.ts` and a dedicated installed-data export probe.
- [ ] 1.4 Delegate S1 verification and fresh combined review using validated contracts; require current production-entrypoint evidence for S1-01 through S1-03 and no remaining findings before S2 admission.

## 2. S2 - Calculated durable chains

- [ ] 2.1 Implement explicit boundaries, selected-route expansion, shared stage/product identities and actionable missing/locked/cyclic/unsupported prerequisites; verify sulfur, processing-unit and utility-science closures contain no undeclared intermediate leaf.
- [ ] 2.2 Implement bounded deterministic rational material balances for selected routes, co-products/refining/cracking, source/sink capacities and repeatable tie-breaking; verify independent balance residuals, shared demand, infeasibility and solver exhaustion in `tests/production-planning.test.ts`.
- [ ] 2.3 Add machine rounding, selected compatible fuel, combined recipe/fuel source constraints, power allowance, transport constraints and once-only headroom; add exploration and supported whole-craft quantity estimates with explicit coupled-quantity rejection. Verify shared capped coal, missing fuel, operating versus full-duty bounds (including incomplete between-bound cases), fractional counts, leftovers, unsupported bonuses and finite-stock versus rate behavior.
- [ ] 2.4 Persist immutable plan revisions, bounded stage/subgraph retrieval and the `production_plan`/`production_inspect` gameplay and workshop service adapters; verify replacement, stale facts, stage evidence invalidation, cap handling and no implicit tasks/game effects.
- [ ] 2.5 Delegate S2 acceptance and combined independent review; use production tool calls with installed-data snapshots plus independently checked arithmetic for all three 1-item/game-second targets, cover S2-01 through S2-10, and require current ready contracts before S3.

## 3. S3 - Stage commitments and recovery

- [ ] 3.1 Add `production_commit` and durable stage-to-task mapping with idempotent request identity, atomic task/mapping admission and role/profile/revision/ownership validation; verify duplicate/lost responses, changed payload conflicts and denied engineer commitment in `tests/production-coordination.test.ts`.
- [ ] 3.2 Separate continuous material edges from scheduler dependencies and construction/commissioning/health states; verify independent downstream construction and that command/message completion never establishes sustained output.
- [ ] 3.3 Integrate plan revision, Stop, replacement and save/load with existing receipt/cancellation fences and budgets; verify unknown effects hold conflicting work and preserve unaffected construction with exact matching evidence.
- [ ] 3.4 Delegate S3 verification and fresh combined review of the actual MCP-to-coordinator entrypoints; cover S3-01 through S3-04 including effectful negative/recovery fakes, and require acceptance before S4.

## 4. S4 - Observations and multi-recipe workshop

- [ ] 4.1 Extend ordinary Lua/TypeScript measurements and identities for supported furnace/chemical/refining items and fluids; calibrate fluid bounds in a dedicated game probe. Verify local gross flow versus stock, recipe/membership/epoch discontinuities and unsupported bonuses in `tests/production-observations.test.ts` plus real engine evidence.
- [ ] 4.2 Add `production_status`, stage-scope bindings and existing-watch integration; verify evidence-linked deficits, unknowns, hypothesized causes, recovered condition state and coalesced notifications without evaluator disclosure.
- [ ] 4.3 Add explicit workshop chain mode and multi-recipe/machine profile resolution, external-only source provisioning, target/co-product destinations and bounded shared-plan designer input; verify component compatibility, denied profiles, no internal fixture feeds, complete evaluation manifests and both build compilers in `tests/production-workshop.test.ts`.
- [ ] 4.4 Add the minimal chain/component setup fields and plan/stage activity/detail views, preserving saved component drafts/history; update relevant gameplay/workshop prompts. Verify actual browser navigation, validation, restored progress and evidence links in `tests/ui/production-chain.spec.ts`.
- [ ] 4.5 Extend library evidence/search/comparison and both UI/runtime Improve paths with canonical evaluation-boundary identity and normalized request/plan provenance; verify same-product unlike-boundary isolation, identical-content multiple attestations, matching-boundary restoration, changed-boundary fresh evaluation and legacy unknown provenance in `tests/production-workshop.test.ts` and the UI suite.
- [ ] 4.6 Delegate S4 verification and combined independent review; cover S4-01 through S4-09 using production entrypoints, browser checks and scoped live observation probes, then require current ready contracts before S5.

## 5. S5 - Physical acceptance

- [ ] 5.1 Add deterministic sulfur and refining/cracking reference probes using existing dedicated-game helpers and production tools; register a diagnostic `game:production-chain-probe` entrypoint with named cases, emitted-code prerequisites, immutable evidence and profile-scoped cleanup. Verify it cannot target personal saves or a held user experiment.
- [ ] 5.2 Delegate the sulfur acceptance matrix through ordinary legal-character gameplay tasks and direct/character workshop modes; verify S5-01's five consecutive 60-second production/delivery windows, upstream flows, actual tool delivery, legal timing/reach/inventory and source boundary for each mode.
- [ ] 5.3 Delegate advanced refining/cracking and false-success controls plus lost-acknowledgement/cancellation/save-load probes; verify S5-02 and S5-03 expose shortages/blockage/invalid evidence, deny preload/intermediate bypasses and produce no duplicate effects or cleanup leaks.
- [ ] 5.4 Obtain independent combined review and final source-matched delegated verification of all accepted slices; run the standard software gate and relevant browser/game checks, reusing only dependency-matched evidence. Verify all scenario mappings, negative controls, recovery and owned-resource cleanup before declaring implementation complete.

## 6. Closeout

- [ ] 6.1 Update REQUIREMENTS, README, relevant architecture/decision references and IMPLEMENTATION_HANDOFF with actual scope, commit baseline, executed evidence, limitations and next bounded scenario-builder action; include substantive documentation in the combined review and verify docs, strict OpenSpec validation and whitespace on final files. Do not archive or commit unless requested.

## Acceptance map and execution discipline

Scenario IDs are unique in this change; every scenario belongs to exactly one slice. A later physical check supplements an earlier software scenario without relabeling its evidence or satisfying a different slice twice.

| Slice | Prerequisites | Scenario IDs | Production entrypoints and required evidence |
| --- | --- | --- | --- |
| S1 | None | S1-01, S1-02, S1-03 | Production fact export and `production_search`/authorized retrieval; unit failures and installed-game fact/geometry probe. |
| S2 | S1 | S2-01, S2-02, S2-03, S2-04, S2-05, S2-06, S2-07, S2-08, S2-09, S2-10 | `production_plan`/`production_inspect`; exact balance fixtures, combined utility/source constraints, all three installed-data chains, caps and durable replacement. |
| S3 | S2 | S3-01, S3-02, S3-03, S3-04 | `production_commit` through real gateway/coordinator and journal; denied/stale inputs, lost acknowledgements, restart/revision/Stop. |
| S4 | S3 | S4-01, S4-02, S4-03, S4-04, S4-05, S4-06, S4-07, S4-08, S4-09 | `production_status`, Lua sampler, live workshop resolution, library admission/search/Improve and setup/activity UI; bounded watches, fluid calibration, boundary compatibility and browser behavior. |
| S5 | S4 | S5-01, S5-02, S5-03 | Dedicated real-game probes through production MCP/task/build and workshop host paths; sulfur three-mode matrix, oil balance negative controls and physical recovery. |

Test files and the production-chain probe above are proposed additions, not existing executed checks. Use `corepack.cmd pnpm exec vitest run <named-file>` for focused tests, `corepack.cmd pnpm exec playwright test tests/ui/production-chain.spec.ts` for the new UI file, and register/document exact game-probe argv before assignment. Run final standard gates with `corepack.cmd pnpm verify --plan <task-owned-session-plan.json>`, strict change validation with `corepack.cmd pnpm exec openspec validate production-chain-planning --strict`, and `git diff --check`. Every task verifies its local contract; each slice's broader verification/review is a separate gate, not a substitute for those checks.

At implementation start, record a finite shared wall-time/provider budget and closeout reserve, per-slice acceptance commands, exact sources and one resource owner for serialized game/browser runs. Default task-initiated provider inference is zero: scripted production-tool delivery is the acceptance reference and gameplay improvement remains unmeasured. A model-backed comparison needs a separately declared budget and authority, preserving existing Astra gameplay policy. Stops, missing telemetry, replacements and corrections retain the same plan/spent usage. Delegate test writing once interfaces stabilize; diagnose after two unsuccessful corrections to the same invariant. Do not admit later slices without source-matched predecessor verification/review.

## Model routing

Recommendations do not switch this session or authorize dispatch; verify managed subscription capability before new worker launches. Review inherits the authorized author. Escalation means a revised bounded packet, never silent model/provider substitution.

| Task | Role | Model | Effort | Rationale | Escalate when |
| --- | --- | --- | --- | --- | --- |
| 1.1 | author | gpt-6.1-sol | medium | Bounded readiness and dependency setup | Prerequisite evidence conflicts |
| 1.2 | author | gpt-6.1-sol | high | Effective Lua/TypeScript fact boundary | Installed API semantics remain ambiguous |
| 1.3 | author | gpt-6.1-sol | medium | Bounded authorization and paging | Scope revocation crosses unknown ownership |
| 1.4 | verification | gpt-6-luna | high | Bounded live facts and evidence checks | Engine facts conflict with contracts |
| 2.1 | author | gpt-6.1-sol | high | Shared graph and route semantics | Supported routes require cyclic behavior |
| 2.2 | author | gpt-6.1-sol | high | Coupled rational balances | Solver cannot meet bounds or exactness |
| 2.3 | author | gpt-6.1-sol | medium | Explicit deterministic sizing rules | Missing engine facts affect feasibility |
| 2.4 | author | gpt-6.1-sol | high | Durable identities and context boundaries | Revision/evidence invariants conflict |
| 2.5 | verification | gpt-6.1-sol | high | Cross-chain balance verification | Independent oracle disagrees |
| 3.1 | author | gpt-6.1-sol | high | Atomic idempotent task admission | Existing journal cannot preserve invariant |
| 3.2 | author | gpt-6.1-sol | high | Scheduler versus continuous flow | Existing completion rules conflict |
| 3.3 | author | gpt-6.1-sol | high | Unknown effects and replacement | Two corrections fail one invariant |
| 3.4 | verification | gpt-6.1-sol | high | Cross-component recovery checks | Receipt/ownership evidence conflicts |
| 4.1 | author | gpt-6.1-sol | high | Engine observations and fluid precision | Stage-local coverage cannot be established |
| 4.2 | author | gpt-6.1-sol | medium | Existing watch/status integration | Diagnosis requires unsupported measurements |
| 4.3 | author | gpt-6.1-sol | high | Workshop boundary and profile changes | Existing build/evaluation loses configuration |
| 4.4 | author | gpt-6.1-sol | medium | Bounded setup/activity presentation | UI migration affects run authority |
| 4.5 | author | gpt-6.1-sol | high | Durable boundary evidence and Improve round trip | Legacy evidence or identity is ambiguous |
| 4.6 | verification | gpt-6.1-sol | high | Multi-surface acceptance | Live evidence differs from fakes |
| 5.1 | author | gpt-6.1-sol | high | Production-path physical references | Probe requires fixture privilege in gameplay |
| 5.2 | verification | gpt-6-luna | high | Fixed matrix with explicit thresholds | Unexpected physical behavior needs diagnosis |
| 5.3 | verification | gpt-6.1-sol | high | Fluid negative controls and recovery | Unknown effects or measurement ambiguity |
| 5.4 | review | inherit-author | inherit-author | Independent combined final review | Required coverage missing or stale |
| 6.1 | author | gpt-6.1-sol | medium | Evidence-backed closeout | Scope claims exceed accepted evidence |

Each slice review named in a verification task is a separate read-only contract using `inherit-author` model/effort; focused delegated test authors use `gpt-6-luna/medium` after interfaces stabilize. These subordinate assignments do not replace the single accountable task route above. Consequential unfamiliar diagnosis recommends `gpt-6-astra/medium` in a bounded packet; subsequent fixes and verification retain their prescribed roles.
