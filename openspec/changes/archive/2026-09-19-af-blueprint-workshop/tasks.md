# Blueprint workshop implementation tasks

Implementation is complete. Final source-pinned verification passed T1-T8 on 415 tests, all browser flows and both fresh game paths; final review confirmed the cancellation fixes and its sole status finding is resolved in this closeout.

## 1. Contracts and capability profiles

- [x] 1.1 Add versioned assignment, session/iteration, artifact/interface, score and learning outcome contracts; verify validation cases for unit normalization, contradictory briefs, checkpoint/iteration policies, rich identities, per-port every-window targets/quantization/errors/stock limits and missing required fields. Cover workshop UI configuration and library interfaces; consume the implemented decision-context contracts without assuming late-game/fluid measurement support.
- [x] 1.2 Implement installed-data profile resolution and starter/advanced/EM presets, custom profiles and current-run snapshots; verify prerequisite closure, research bonus levels, allowed versus locally manufacturable equipment, surface rules, normal-quality restriction and changed-fingerprint rejection using fakes and a recorded installed-data sample.
- [x] 1.3 Define the supported entity/recipe/settings matrix and compatibility adapter boundary; verify accepted solid/fluid/module/byproduct cases and explicit rejection of unsupported quality, stochastic/spoilage, trains/platforms/circuit programs and mining/power designs. Record exact installed API/prototype availability before advertising support.

## 2. Blueprint artifacts and library

- [x] 2.1 Implement canonical blueprint normalization, content hashes, rotation/translation, configuration/wire preservation, and bill of materials; verify semantic round trips, deterministic IDs, malformed/unsupported fields and non-mirrored transforms with fixture artifacts.
- [x] 2.2 Add immutable family/variant/revision storage, compatibility indexes, search and transactionally idempotent admission; verify starter/EM variants coexist, names do not change identity, the index rebuilds, and concurrent/lost-acknowledgement admissions cannot overwrite or duplicate revisions.
- [x] 2.3 Implement native blueprint/book export plus optional sanitized metadata bundles and interface descriptions; verify serialization/reimport preserves supported content and excludes fixtures, credentials and provider histories. Retain the no-mod game acceptance for task 8.2.

## 3. Sandbox and two construction paths

- [x] 3.1 Add isolated workshop game setup, 512 x 512 cleared area with nondestructive expansion, profile force/research and declared supply/sink fixtures; verify exact profile-only resources, inventory replenishment receipts, cap rejection and preservation of unrelated game profiles.
- [x] 3.2 Implement scoped direct materialization and clean export/reconstruction with configuration/module/wire fidelity; verify bounded ownership, invalid-field preflight, ordinary-role privilege denial, cancellation and receipt reconciliation in fake tests and a dedicated live smoke.
- [x] 3.3 Extend legal character actions and deterministic blueprint compilation for reachable ordering, inventory/modules, recipes, filters, power wiring and supported settings; verify finite-inventory ordinary-run reconstruction, occupied/unreachable work positions, insufficient material, partial cancellation and lost responses without duplicated consumption. Preserve game legality; real save/load acceptance is in 8.2.

## 4. Hotbox measurement and scoring

- [x] 4.1 Implement evaluator-owned empty-start reconstruction, per-port/stage stock/flow and energy coverage plus the pinned every-window production/delivery predicate for deterministic solid/fluid/byproduct production; verify positive reference, burst-then-starvation, item/fractional/fluid threshold boundaries, settling-stock baselines, nonduplicated port allocation, preload, hidden-feed, manual-output, recirculation and missing-coverage controls, recording uncertainty rather than a pass.
- [x] 4.2 Add Lua tick-boundary sampling, fixed settling/windows and dedicated-process speed control; verify normal/accelerated equivalence, achieved speed reporting, pause/resume and disconnect invalidation without altering unrelated sessions or scoring past budget closure.
- [x] 4.3 Implement deterministic score features, versioned weights/materiality, raw-cost recipe-route vectors, expansion/connection probes and scorer feedback contracts; verify 1x/2x/3x/4x claims where tested, unknown cost handling, Pareto/interface distinctions and separation of subjective aesthetics/interaction critique from measured output.

## 5. Roles, orchestration and accounting

- [x] 5.1 Register designer specialization, scorer and maintenance identities with narrow effective catalogs and pinned managed OpenAI model/effort selections; implement session defaults, role overrides, capability validation and concrete-ID resolution in the versioned contracts. Verify unsupported providers/models/efforts and unavailable defaults fail preflight without fallback, both scorer contexts inherit their selection, learning trials use target-role selections and learning review inherits the learnings selection. Verify invocation provenance, unknown provider metadata, preserved selections/budgets across replacement/save/load, blocked inference when availability changes and a new session/comparison series for operator selection changes. Separate library-blind critique from final private comparison using distinct sessions/credentials/history scopes. Verify provenance restrictions across tools, feedback, learned instructions/helpers and reconstruction, including paraphrased layout suggestions, private-comparison influence on iteration and attempted role/admin impersonation.
- [x] 5.2 Implement durable configure/build/measure/score/finalize state transitions, optional checkpoints/timeouts, exact-N/max-N/plateau policies and best-valid-revision selection; verify five unattended attempts, no-valid-result, assisted steering, stale feedback, stop and recovery from each interrupted transition with fake providers.
- [x] 5.3 Integrate per-role/iteration/session/batch usage and reserved learning budgets; verify cumulative-event deduplication, missing usage, replacement/retry accounting, batch ownership, validation/review charging, unknown monetary/allowance values and no automatic billing/model fallback.

## 6. Workshop, library and inspection UI

- [x] 6.1 Add launch/preset/Improve forms and all manifest settings with visible effective defaults; verify browser flows for character/direct mode, profiles, human checkpoints off/on, five-attempt configuration, learning cadence/budgets and actionable preflight errors using the authenticated local API. Include OpenAI model/effort selectors, supported-effort filtering, session defaults and role overrides, preset round trips, resolved selections in reports and rejection of unsupported providers/combinations without substitution.
- [x] 6.2 Add live and final-focused workshop reports, revision/metric comparisons, scorer feedback, library search/admission/export and operator context/history inspection; verify reconnect/replay, closing the tab during execution, pagination/redaction and assisted-run labels in browser tests.
- [x] 6.3 Add learning decision/diff/evidence/validation/review/activation views and configurable approval, disable/quarantine/rollback controls; verify an unattended no-change outcome and automatic update can both be understood afterward, protected proposals introduce no mandatory pause, and rollback affects only future sessions.

## 7. Bounded autonomous learning

- [x] 7.1 Add provenance-bearing candidate/lesson stores, scope retrieval and no-change/adjudication lifecycle; verify deduplication/revisit conditions, deterministic-guard preference, prompt/count caps, relocation/merge/retirement reasons and no library leakage. Inspect source notices before any reuse of agent-graph scripts and record provenance.
- [x] 7.2 Implement registered writable instruction/helper scopes, isolated staging and retained OS confinement for activated helper workers, with bounded structured I/O, read-only bundles, invocation quotas and trusted gateway reauthorization of proposed actions. Verify path/junction escapes, protected-file changes, network/secret/live-checkout/admin access and child processes are denied both in staging and after activation in a later session; prove quota/policy/hash failures reject outputs without in-process or unsandboxed fallback, and unavailable isolation does not prevent completed blueprint delivery.
- [x] 7.3 Implement candidate/attempt/catalog caps and immutable final-bundle/control manifests; bind regression/interaction checks, representative behavioral trials and fresh independent review to the exact combined bundle hash plus expected incumbent/generation and environment. Verify individually passing but jointly failing patches, post-review changes and failed/inconclusive/over-budget bundles stay inactive, and instruction lint alone cannot activate behavior changes. Use fakes for workflow tests; budgeted real behavior evidence belongs to 8.3.
- [x] 7.4 Implement atomic compare-and-swap activation against the attested incumbent hash and monotonic generation, pinned session bundles, deferred proposals, quarantine/rollback and restart reconciliation; verify two competing activations, rollback to a prior hash, and lost responses cannot admit stale evidence or duplicate effects. Require revalidation/review after rebasing; verify current sessions retain their versions, future sessions use the selected verified bundle, and cumulative regressions can quarantine it without erasing history.

## 8. Integrated acceptance and handoff

- [x] 8.1 Delegate final relevant-source software/browser verification using the repository contract: execute `corepack.cmd pnpm verify` and `corepack.cmd pnpm test:ui`, map all three delta specs to actual checks, and require passing results with explicit coverage gaps resolved. Include existing S1/S2/provider/ownership regressions, actual activated-worker confinement/quotas, provenance-based paraphrase isolation, exact-bundle interaction rejection and stale-activation controls.
- [x] 8.2 Delegate dedicated local-game acceptance with exact profiles and bounded cleanup: prove both construction modes, modules/beacons, fluid/byproduct and EM/foundry profiles, expansion/connection tests, normal/accelerated scoring with every-window burst/starvation and threshold/settling-stock controls, no-mod blueprint/book round trip, and ordinary finite-inventory character reuse with in-flight pause/save/load/lost-ack recovery. Retain source-matched evidence; missing any supported mechanic's required coverage keeps its acceptance open.
- [x] 8.3 Conduct a deliberately budgeted visible managed-provider exercise with manifests fixed before invocation: five unattended attempts with early stopping disabled, a separate human-checkpoint flow, a no-change learning result and an evidence-backed instruction/tool improvement validated against incumbent/control cases then consumed by a fresh session. Record exact usage, interference, outcomes and effective role permissions; no silent retry/substitution or success claim from synthetic-only evidence. If a required outcome is not demonstrated, retain it as incomplete.
- [x] 8.4 Delegate a fresh read-only combined implementation/documentation review using the shared assignment/result contract; resolve findings and obtain source-matched follow-up review after substantive fixes, with no self-review or outstanding actionable findings at completion.
- [x] 8.5 Update REQUIREMENTS, README, architecture/decision records, Phase 17 overlap and IMPLEMENTATION_HANDOFF to reflect implemented exceptions, accepted learning authority, executed checks, limitations and next bounded action; verify links, strict OpenSpec validation and whitespace, and reconcile claims with retained evidence before marking the feature complete.

## Coverage map

| Capability | Primary tasks | Final evidence |
| --- | --- | --- |
| Workshop configuration, profiles, sandbox, modes | 1.1-1.3, 3.1-3.3, 5.2, 6.1 | 8.1-8.3 |
| Measurement, scoring and expansion | 4.1-4.3 | 8.1-8.3 |
| Roles, blindness, observability, usage/recovery | 5.1-5.3, 6.1-6.3 | 8.1-8.3 |
| Library organization, admission, export, reuse | 2.1-2.3, 3.3, 6.2 | 8.1-8.3 |
| Learning cadence, authority, caps, validation, activation | 7.1-7.4, 6.3 | 8.1-8.3 |
| Independent completion and truthful handoff | 8.4-8.5 | Contract results and handoff |

## Model routing

Recommendations follow [model selection](../../../../docs/MODEL_SELECTION.md); they do not switch the current model or authorize inference. Workshop gameplay/maintenance invocations use the manifest's validated OpenAI model/effort selections with managed subscription access, defaulting to Astra/low when available; ordinary gameplay defaults are unchanged. Dedicated developer verification uses its assigned Luna/medium workflow; independent completion reviewers inherit the author. Escalation diagnoses the named uncertainty, then returns to the bounded task.

| Task | Role | Model | Effort | Rationale | Escalate when |
| --- | --- | --- | --- | --- | --- |
| 1.1 | author | gpt-5.6-sol | high | Cross-role durable contracts | Assignment semantics conflict with existing fences |
| 1.2 | author | gpt-5.6-sol | high | Installed technology and surface integration | Research/recipe rules cannot be reconciled |
| 1.3 | author | gpt-6-astra | high | Set verifiable mechanics boundary | Installed APIs cannot establish required fidelity |
| 2.1 | author | gpt-5.6-sol | high | Configuration-preserving transforms | Round trips lose engine semantics |
| 2.2 | author | gpt-5.6-terra | medium | Bounded versioned storage | Admission races cross durable runtime boundaries |
| 2.3 | author | gpt-5.6-terra | medium | Defined export contract | Native book fidelity is ambiguous |
| 3.1 | author | gpt-5.6-sol | high | Isolated game lifecycle | Expansion or provisioning breaches ownership |
| 3.2 | author | gpt-5.6-sol | high | Privileged scoped game execution | Unknown effects cannot reconcile |
| 3.3 | author | gpt-5.6-sol | high | Legal construction across game/runtime | Reach/configuration semantics need redesign |
| 4.1 | author | gpt-6-astra | high | Generalized measurement and anti-bypass design | Causal balances cannot distinguish a bypass |
| 4.2 | author | gpt-5.6-sol | high | Tick and process lifecycle | Exact windows or pause barriers fail |
| 4.3 | author | gpt-5.6-sol | high | Comparable deterministic metrics | Cost/expansion assumptions change eligibility |
| 5.1 | author | gpt-5.6-sol | high | Effective provider and role isolation | Visibility leaks across contexts |
| 5.2 | author | gpt-5.6-sol | high | Durable state-machine integration | Recovery permits duplicate effects |
| 5.3 | author | gpt-5.6-sol | high | Aggregate usage admission | Provider counters lack safe attribution |
| 6.1 | author | gpt-5.6-terra | medium | Defined form/API behavior | UI choices conflict with manifest invariants |
| 6.2 | author | gpt-5.6-terra | medium | Existing dashboard projections | Context visibility cannot be maintained |
| 6.3 | author | gpt-5.6-terra | medium | Defined review and rollback controls | Activation state differs from durable evidence |
| 7.1 | author | gpt-5.6-sol | high | Bounded knowledge lifecycle | Routing creates contradictory or leaked lessons |
| 7.2 | author | gpt-6-astra | high | New isolated execution boundary | Host cannot enforce required isolation |
| 7.3 | author | gpt-5.6-sol | high | Immutable validation and review gates | Candidate can alter its own acceptance |
| 7.4 | author | gpt-5.6-sol | high | Atomic activation and session pinning | Recovery makes active version ambiguous |
| 8.1 | verification | gpt-5.6-luna | medium | Execute declared checks and report evidence | Missing harness/source or unfamiliar failure |
| 8.2 | verification | gpt-5.6-luna | medium | Execute bounded live acceptance matrix | Unsafe cleanup or missing measurement coverage |
| 8.3 | author | gpt-5.6-sol | high | Own deliberate provider experiment | Failure needs causal diagnosis or budget revision |
| 8.4 | review | inherit-author | inherit-author | Independent combined review | Return scope/coverage blockers to author |
| 8.5 | author | gpt-5.6-terra | medium | Evidence-backed documentation closeout | Claims conflict with executed evidence |
