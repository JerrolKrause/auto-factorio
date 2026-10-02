# Design

## Context

See [proposal.md](proposal.md) for motivation and scope. This design is grounded in the current implementation:

- `apps/dashboard/src/view.tsx` mounts the workshop, operator controls, roster, tasks, measurements, timeline, steering and JSON inspector together. Its one event connection already deduplicates events by runtime run/cursor through `state.ts`.
- `workshop.tsx` holds form defaults in component state, resets model selection when options load, disables Launch only while its HTTP request is pending, creates a fresh `comparisonSeries` per launch and renders sessions, iterations and the latest 30 operations as unrelated lists. Clicking a row reveals its projection, not necessarily the underlying supplied context.
- `http.ts` has workshop launch/stop/checkpoint routes and capability/origin checks, but snapshot/history query only `runtime.run`. `scripts/start.mjs` creates a new dashboard directory per startup, and `scripts/dashboard.ts` derives the runtime run ID from that directory. Browser localStorage alone cannot provide cross-startup experiment history.
- `WorkshopRuntime` runs a background loop per session; its active map is not a single-experiment admission lock. The serial game port and `Operator.reserveGameControl()` protect command ordering and operation ownership, not the entire run. Existing measurement fences and exact cancellation receipts must survive the UI redesign.
- `LiveWorkshopHost.design()` supplies an assignment, installed facts, prior feedback, assistance and pinned learning context. `score()` supplies the candidate and measurements but requests one concise feedback string. The provider adds an instruction to call `observe`; therefore a visible snippet is neither a faithful transcript nor proof that no other input exists. A richer record must capture actual supplied inputs at their dispatch boundaries.

## Goals / Non-Goals

**Goals:** Establish explicit experiment identity and lifecycle, separate setup from execution/history, and let operators follow exact retained evidence without manually copying artifact IDs. Reuse deterministic state projections and existing control/visibility contracts.

**Non-Goals:** See the proposal. In particular, grouping runs is not statistical comparability, an archived run is not resumable merely because it is visible, and changing pages never starts/stops game or model work. No new capability for skipping an attempt and automatically continuing is introduced: Stop run from an attempt ends the whole run and cancels the current attempt.

## Decisions

### 1. One application shell and five destinations

Use React page modules beneath a shared shell, with hash routes so direct links and refresh work with the existing static-file server. Keep a single snapshot/event subscription above routes. `/` opens Overview; canonical links use `/#/workshop`, `/#/scenarios`, `/#/history`, `/#/library` and `/#/runs/<runId>/attempts/<attemptId>`. Invalid or unavailable IDs show a recoverable not-found state, never the current run under the requested ID.

| Destination | Content and primary action |
| --- | --- |
| Overview | Managed game/provider connectivity, active experiment, latest outcomes, links to create or inspect work; no duplicate launch form |
| Blueprint Workshop | Brief editor, basic setup and advanced sections, saved presets; Launch opens the new run detail |
| Scenarios | Existing controlled-scenario names/descriptions and availability, selected scenario's current control room (roster, tasks, batches, measurements, steering); unsupported launch workflows are explicitly unavailable |
| Run History | Search/filter by brief or scenario, status and date; Brief/Scenario → Run → Attempt navigation and retained outcomes |
| Blueprint Library | Existing search, revision details, export and Improve; Improve opens workshop setup with the exact source revision, never launches implicitly |

Run detail is shared between workshop and scenario records: header/outcome, attempts, activity, evidence, assistance and usage. Workshop-only learning results and existing rollback/quarantine controls move into a secondary Learning section of that run detail; they are not lost in the split. Session-level finalization/learning activity is shown separately from attempt activity and linked to originating attempts when known. Overview and Scenarios link to this same run view.

Shared components: `AppShell/MainNavigation`, `ActiveRunBanner`, `RunStatus/OutcomeSummary`, `AsyncActionButton`, `FormField/HelpDisclosure`, `ModelSelectionFields`, `RunDetail/AttemptList`, `EvidenceTimeline/Inspector`, and loading/empty/error states. Shared API types, hooks and lifecycle projections own semantics; pages only compose them. Avoid a configurable universal form renderer or a second event store. A multi-app split would duplicate connection and control logic; a larger single scrolling page would preserve the user's navigation problem.

The active banner names the owning brief/scenario, run and current phase, links to live detail and exposes Stop run on every page. Historical detail is visibly read-only and distinct from the active banner. Preserve scenario pause/resume controls only where supported; do not manufacture workshop pause support from scenario controls.

### 2. Separate identity for goals, executions and candidates

| Concept | Identity / stored facts |
| --- | --- |
| Brief or scenario group | Durable `groupId`, kind, title, exact submitted objective or fixture ID/version; workshop brief lineage when edited |
| Run | Durable user-facing `runId`; group, ordinal/date, immutable assignment, runtime owner locator, lifecycle, outcome, usage and evidence references |
| Attempt | Existing workshop iteration identity scoped to its run, ordinal, candidate, phase, evaluation, critique and terminal result; scenario verification attempt ID where available |
| Runtime container | Existing `runtime.run` and journal directory, retained as storage/control provenance, not labeled as the workshop run |
| Comparison series | Existing pinned assignment concept; not reused as group ID or changed by display grouping |

A workshop run maps one-to-one to its workshop session. Rerun under an unchanged selected brief keeps the group and creates a new run. Editing its objective (after trimming outer whitespace only) creates a new immutable brief group linked to the prior group; no fuzzy semantic merging. Users can choose an earlier brief to run it again. Changing model/profile/build/evaluation settings under the same brief creates a new run with visible configuration differences and preserves existing comparison-series rules. Presets supply settings, not history identity. A scenario group uses fixture identity/version; attempts without retained verification identity show a coverage gap rather than invented segmentation.

Group summaries show active count, finished count and target-achieved/not-yet-achieved/unknown based on independently scored runs. A brief group remains available for more runs; it is not permanently closed when one succeeds. Scenario executions show terminal completion and independent scenario verdict separately. A cancelled run can retain an earlier passing attempt, but its primary outcome stays Cancelled and the UI identifies the earlier result as partial retained evidence.

Example acceptance fixture (maximum policy disabled for exact counts):

```text
Make 15 red science per minute
  Run 1 → Attempts 1–5
  Run 2 → Attempts 1–5
  Run 3 → Attempts 1–5
Make 15 green science per minute
  Run 1 → Attempts 1–3
  Run 2 → Attempts 1–3
```

This is a history fixture, not a claim that all briefs are currently supported by the live resolver. Live unsupported briefs still fail preflight with a clear explanation.

### 3. Durable project history with bounded reads

Add a stable project-scoped workspace catalog under `.runtime/workspace/` (SQLite, consistent with existing storage). It registers known runtime journals and stores durable group/run mapping, ownership intents and summary projections. The per-runtime journal and artifacts remain the evidence authority; record stable compound references, not copies of every event. Use transactional catalog writes and an idempotent registration/reconciliation protocol keyed by run ID so a crash between catalog and journal writes is recovered without duplicate runs. A pending catalog intent reserves the run before preparation; an absent journal after a crash is a visible interrupted preparation, not permission to retry work.

Startup registers the current runtime and reconciles outstanding ownership before enabling launch. A one-time, bounded migration inventories known project dashboard metadata/journals under `.runtime/startup/dashboard-*`, `.runtime/dashboard/run-*` and `.runtime/scenarios/runs/run-*`, validates resolved paths inside the project runtime tree and registers discovered records without modifying source journals or opening games. The scenario root is written by `scripts/dev/first-shift-session.ts` for `scripts/scenario.ts` and `scripts/scenario-trial.ts`; discover both ordinary scenario runs and workshop sessions hosted in those journals, registering each runtime once. Preserve retained scenario fixture/version identity; absent identity remains explicitly unknown. Legacy sessions lacking group identity receive explicitly marked legacy groups per session; do not guess grouping by similar text. Unrelated runs and private saves are never imported. Missing/unsupported journals remain visible as unavailable entries with reasons.

Expose capability-protected, paginated group/run/attempt/event/detail endpoints with explicit scope IDs and opaque cursors. New evidence references resolve through the catalog, not client-supplied filesystem paths. Keep existing snapshot/event transport for the live runtime; history pages use catalog queries and runtime-specific evidence reads. Avoid loading all past journals or transcript bodies into the live snapshot. Ordering is stable (creation sequence plus ID); event identity includes runtime/journal plus sequence, not sequence alone. Old events from run A may update A in history but never appear in B's current view.

History survives browser closure and ordinary `npm start` restarts. Removing a source directory externally yields a labeled evidence gap; no automatic deletion/retention policy is added. A global catalog is preferable to per-tab state because separate tabs and new startup directories must agree about ownership and history.

### 4. One durable admission boundary for the managed game

Introduce a runtime-owned experiment coordinator shared by workshop launch and ordinary scenario admission/resume. It allows one owning experiment at a time, including preparation, checkpoints, pause, stop reconciliation, finalization and learning. This is a product constraint on the managed game resource; do not claim Factorio can never run multiple headless processes. The idle startup operator is infrastructure, not itself a running scenario; derive active ordinary work from explicit registered execution/ownership, not merely `OperatorState.status`.

Launch uses a client-generated stable request/run ID and immutable request hash. Persist a pending intent and reserve ownership atomically before any asynchronous host resolution, model invocation or game mutation. Return 202 with the run identity and preparation status promptly, then preflight in the background. Validation failures become explicit preparation-failed records and release ownership only when no effects remain. A same-ID/same-payload retry returns its existing state (including terminal rejection); changed payload under that ID conflicts. Different launch IDs while owned return 409 with the owner and a link; no queue or implicit replacement. The same guard must cover direct API clients and registered ordinary scenario launch/resume paths, not only the button.

The frontend allocates identity before submission, disables launch immediately, and retains that pending identity across refresh to query admission after a lost response. A stop arriving before launch admission creates an idempotent cancellation tombstone for that request ID, so a later launch cannot start it. A cancelled, rejected or completed click needs a new ID for an intentional new launch. Request identity/reconciliation metadata is separate from the saved settings draft.

Preserve serialized RCON and operation reservations inside the owning experiment. Existing paused ordinary experiments retain ownership until explicit stop/handoff with acknowledged cancellation; if an old scenario can be resumed, it must reacquire ownership and pass existing recovery rules. Import ambiguous legacy ownership as Recovery required and block launches until exact evidence resolves it. Startup must reconcile the workspace owner and existing profile-scoped measurement fence before any automatic resume or new work, across dashboard-directory replacement.

### 5. Stop is a durable barrier, not just a button

Expose one clearly named Stop run action in the active banner, run header and expanded current attempt. Its help says “Stops this run and its remaining attempts; keeps recorded results.” There is no confirmation dialog in the ordinary path. Existing Finish at checkpoint remains “Finish after this attempt” where applicable and explains finalization; it is distinct from cancellation.

Persist stop intent and close admission synchronously before awaiting adapter interruption. Cancel preflight/preparation, active provider turns, character batches and measurement; prevent later callbacks, checkpoint timers, next iterations, library admission or learning activation from scheduling new work. Check the durable cancellation generation at each post-await transition and immediately before effects. Already acknowledged publication/activation is preserved and disclosed; uncertain effects are reconciled by exact operation identity, never rolled back speculatively or repeated.

UI phases: Preparing, Designing, Building, Measuring, Reviewing, Waiting for you, Finalizing, Learning, Stopping, Recovery required, Completed, Cancelled and Failed. Separately show evaluation: Passed / Target not met / Invalid evidence / Not evaluated, plus a run result of Best valid result / No valid result when finalization establishes it. Never map `held` to completion or `stopped` blindly to user cancellation: stored failure reason and control outcome decide the presentation.

Stop remains reachable throughout the run, including before its first attempt and after its last attempt. While stopping, show acknowledgement status and disable repeated submission; server retries remain idempotent. After a bounded wait (10 seconds for user feedback, not a safety deadline), show which subsystem is unconfirmed and offer Check stop status / Retry stop using the same control identity. Reconnecting updates this state. Do not release the owner, call it Cancelled, or enable another launch until provider/game effects and publication/activation intents are terminal or exact absence is established. A terminal run receiving a late stop remains terminal with a no-op response; it must not become held again. Normal completion releases ownership only after the same settled-effects condition.

### 6. Make action feedback and settings understandable

Pending actions change their label and expose text plus a spinner within the next UI render, before awaiting network response. A status region announces acceptance or failure; inline errors retain input and offer a relevant next action. Indeterminate phases do not show fabricated percentages. Known batch/measurement counts can use determinate progress. Respect reduced motion and keyboard focus. On successful launch, navigate to and focus the new run heading, scrolling it into view once; routine events do not scroll or steal focus. While viewing history, announce terminal events in the active banner without switching the selected run.

Basic workshop setup contains objective, equipment profile, build method, attempt policy and a visible effective model summary. Advanced sections contain model overrides, measurement settings, budgets, checkpoints and learning. Every current control remains available with its units, defaults, consequences and validation. A launch summary shows effective target, input/utility assumptions and pinned settings; asynchronous installed-data validation remains a visible preparation stage.

| Internal value / current label | User-facing wording and help |
| --- | --- |
| `starter-assembly` | Basic assembling equipment — allowed early assembly equipment; expand the actual installed-data equipment/research list |
| `advanced-assembly` | Advanced assembling equipment — expand available machines, modules and beacons; do not imply everything is unlocked |
| `electromagnetic-production` | Electromagnetic production — Space Age equipment where the selected profile/surface permits it |
| `direct` / Direct workshop | Instant sandbox placement — places allowed entities directly in the isolated test area; does not test character construction |
| `character` / Legal character | Build with a character — walks and places with normal reach/timing; workshop supplies are provided; no construction bots |
| Early stop (maximum) | Up to N attempts / Exactly N attempts — explain early success/plateau rules and that stop, errors and budgets can end either policy |
| Settling / window ticks | Warm-up time / Measurement window / Number of windows — game seconds/minutes first, exact ticks in details; 60 ticks per game second, independent of simulation speed |
| Wall minutes / Turns / Tool calls | Real-time limit / Model turn limit / Tool-call limit — distinguish elapsed time, model work and deterministic game operations |
| Human checkpoints | Review before starting / Review after each score / Approve library save / Approve learning activation — show timeout and fallback |
| Learning policy | Improvement between runs — explain cadence, limits and activation gates; expose exact pinned policy in details |

Help for consequential choices is persistent subtext; supplemental detail uses keyboard/touch-accessible disclosure or tooltip with an accessible name/description. Raw IDs are retained in technical details and API/storage; renaming labels does not migrate semantic identifiers. Product aliases such as red science include the official item name when resolved.

Store an allowlisted, versioned workshop draft in `localStorage` at the fixed localhost origin, namespaced by workspace ID. Include objective, selected brief/source reference, profile/build/library choices, attempts, models/efforts, checkpoints, evaluation/budgets and learning settings; exclude capabilities, credentials, transcripts and authoritative run status. Hydrate before saving defaults. Explicit preset/Improve actions replace relevant draft values once and show confirmation; options refresh validates without resetting edits. Unavailable models/profiles remain visible as invalid and block launch without substitution. Reset settings resets the draft only, visibly leaving history intact. Handle malformed versions, disabled storage and quota failures with a nonblocking notice and in-memory operation. Cross-tab draft changes do not silently overwrite dirty edits; show a reload-saved-settings choice. Server preflight validates everything again.

### 7. Expand evidence and improve the actual feedback contract

Record a versioned invocation envelope at actual dispatch boundaries: run/attempt/role/invocation/session IDs, requested/effective model and effort, prompt/instructions after runtime additions, instruction/bundle versions, supplied observation/context, permitted tool catalog, messages, available public output and tool calls/results. Store large bodies as hashed artifacts; persist redacted envelopes before dispatch and link operation rows to them. Capturing only the host's short prompt would miss the provider's observe instruction and actual observation delivery. Redaction occurs before persistence; no credentials or hidden reasoning are exposed. Operator-only/private-comparison evidence never enters designer/scorer retrieval through this inspector.

Timeline cards label text as Summary, Feedback or Full recorded message. Selecting one opens an integrated inspector with Summary, Instructions & context, Messages & tools, and Measurements & results. It retrieves the exact record by reference, offers wrapped text and structured/raw views and paginates long content. Label completeness per part: complete recorded content, redacted, capture truncated, not retained or not available from provider. UI pagination is not capture truncation. A short genuine full message is labeled as such, never expanded by an invented retrospective explanation. Legacy evidence is inspectable to its actual coverage only.

Replace the production scorer's single-string contract with a versioned critique containing a concise summary plus findings (candidate/evaluation reference, observed fact, impact, suspected cause with uncertainty, recommended concrete change and next validation). Findings can be empty for a passing candidate with no justified improvement; a failed/invalid candidate needs at least one evidence-linked finding or an explicit evidence-gap finding. Keep raw response and a validation outcome when structured output is malformed; allow only bounded correction within the pinned budget, otherwise record feedback unavailable and stop/hold or follow an explicitly evidenced existing failure policy. Never substitute a generic sentence and claim meaningful critique.

Feed validated library-independent critique, exact prior candidate reference and available relevant measurement details into the next designer input, with explicit context bounds and retrieval references for omitted history. Require a short public change plan linked to those findings alongside the proposed blueprint (update parser/validation together). Require no hidden thought trace or arbitrary minimum word count. Deterministic scoring, original rubric, blind-library lineage and usage accounting retain authority. Test dispatch envelopes and next-attempt delivery with deterministic adapters; a single deliberately budgeted two-attempt managed-provider exercise establishes actual response compatibility during implementation.

## Risks / Trade-offs

- Cross-journal catalog consistency → durable intents, idempotent projections and crash/rebuild tests; journals remain the source of evidence.
- Older records lack groups or transcripts → explicit legacy groups and coverage labels, never fabricated history.
- Stop races with awaited effects → durable admission closure, post-await generation checks and exact receipt reconciliation; retain fences on uncertainty.
- Broad UI reorganization hides existing tools → inventory-to-page acceptance mapping, shared components and preserved operator flows.
- Richer evidence increases disk/context use → artifact-backed pagination, bounded role context, explicit gaps and existing redaction/visibility rules.
- Vocabulary can misrepresent equipment → display labels are descriptive, lists come from resolved installed facts.
- One experiment through learning reduces concurrency → chosen for clear ownership and stop semantics; concurrent scheduling remains deferred.

## Migration Plan

1. Add compatible catalog/identity and invocation/critique schemas; retain legacy readers and all original journals. Register existing sessions before switching history views.
2. Add guarded admission/stop and ownership recovery before connecting the new launch UI. Keep existing capability-protected routes as adapters to the same coordinator.
3. Extract shared components and add routes; replace the mixed landing page. Keep existing operator capabilities reachable on Scenarios/run detail and all library/learning controls at their mapped destinations.
4. Hydrate versioned drafts, then enable new grouped history and evidence views. Update README, requirements/architecture and a decision record to describe actual delivered behavior, without declaring deferred scenarios implemented.
5. Verify fake failure paths, browser interactions, dedicated game cancellation/restart and the budgeted provider exercise. Independent verification/review gates precede implementation completion.

Rollback disables new UI/coordinator entrypoints only after the active experiment is safely stopped. Preserve catalog/journals/artifacts. Do not run an older controller against unresolved new ownership intents; it cannot prove safe reuse of the game. No irreversible data migration or deletion is required.
