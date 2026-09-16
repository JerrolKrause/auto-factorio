# AutoFactorio implementation guide

Status: phases 01–10 are implemented, verified and archived. Phase 11 has passed its software/live S1 and twice-reset gate, with 8/8 tasks and independent review complete; it is archived with its capability synced to main specs. See the current handoff for evidence. Phases 12–18 remain planned. Start one bounded change per fresh conversation in the existing workspace.

## Why 18 changes

Use **18 small OpenSpec changes with 18 capability specs**, rather than one large change whose apply workflow would try to implement the whole product. Each change contains a proposal, design, delta spec and 8–9 checkable tasks (145 tasks total). Each task includes a completion check.

The [requirements](REQUIREMENTS.md) remain approved product intent; [architecture](ARCHITECTURE.md) supplies the proposed technical baseline; [scenarios](SCENARIOS.md) defines scenario rules and operating defaults. The changes translate those documents into implementation contracts without claiming that integrations work. The [coverage map](SPEC_TRACEABILITY.md) connects every approved requirement and review correction to its phases. [Decision 002](decisions/002-openspec-phase-plan.md) records this organization.

Phase 01 is archived and its implemented capability is synced to `openspec/specs/compatibility-foundation/spec.md`. Later delta specs remain inside `openspec/changes/<change>/specs/<capability>/spec.md`. Having 18 planning-ready changes does **not** mean all 18 are ready to execute today.

## How to use a fresh context

1. Open this repository in a fresh Codex conversation.
2. Paste the prompt for the next phase below. These `$openspec-apply-change` blocks are **Codex chat prompts**, not PowerShell commands. There is no `/opsx:propose` requirement.
3. Let the agent finish only that change, its relevant verification and the handoff. The prompt authorizes implementation of that phase; historical “proposed” architecture wording does not require another approval for routine choices.
4. Review its recorded exit gate. Only advance when all software/live integration criteria required by the phase pass. A missing game/provider check is not a pass. Phase 12 separately records bounded stochastic model outcomes, which can be unsuccessful without inventing success.
5. Archive the completed change as described below, then use a fresh conversation for the next phase.

Each planning packet is intentionally small: read the current handoff, the selected change's four artifacts, REQUIREMENTS and only the architecture/scenario sections listed in its design. Do not load every other change or the original planning chat. Implementation should stay within the listed modules and tasks, reusing the preceding interfaces.

One context window is the sizing target, not a guarantee about external debugging or game runtime. If a phase cannot finish, keep its remaining boxes open and record the exact last completed task, current branch/revision, modified files, commands/results, evidence paths, blocker and next action in the handoff. Start a fresh conversation with **the same phase prompt**. Do not skip acceptance criteria or begin the next phase merely because context is low. If an unexpected discovery materially changes scope, update that specific change with `$openspec-update-change` before applying the revised plan.

## Read-only PowerShell commands

These commands inspect planning state; they do not implement the product:

```powershell
Set-Location -LiteralPath 'C:\@Projects\AutoFactorio'
openspec list
openspec validate --all --strict --no-interactive
openspec status --change af-02-subscription-provider
```

To inspect another phase, replace the final change name with its exact name below. OpenSpec checks artifact/task state. It does not enforce the inter-change dependency chain or verify game evidence for you.

Phase 01 has created and verified the workspace and diagnostic commands documented in README and the handoff. Later phases add and verify their actual commands as implementation lands.

## Required order and milestone gates

All phases are sequential in this guide; each depends on the preceding phase's recorded exit gate. The chain intentionally avoids concurrent changes to shared contracts and saves.

| Original milestone | Phases | Gate before moving beyond the milestone |
| --- | --- | --- |
| M0: prove integration | 01–04 | Current compatibility/provenance, subscription-only two-role activity, legal game effects and a real hosted pause/save/load/reconcile/re-arm trace |
| M1: durable runtime and control | 05–09 | Durable recovery, acknowledged fencing, extensible roles, authorized bounded context, budgets and live steering/control |
| M2: First Shift | 10–12 | Independent evaluator, live S1 positive/negative controls and bounded visible team/assistance/fresh-context trial evidence |
| M3: complete suite | 13–16 | S2–S5 ready to launch, full chain/fuel controls and every S5 fault rejected for every eligible unrepaired verification start |
| M4: retrospectives and distribution | 17–18 | Useful comparisons/exports/branches, tested Windows setup and the complete five-scenario release matrix |

**Hard dependency:** phase 05 must not start until phase 04's real-game pause and restore gate passes. A fake adapter, provider transcript resumption, proposed API behavior or an existing tasks.md cannot substitute for this trace.

Live model calls are concentrated in phases 02 and 12. Their designs provide small declared trial budgets, with fake providers for routine/failure testing. Other phases should use deterministic references/fakes; any extra model experiment must be deliberate and budgeted. Never substitute API authentication, purchase credits or silently change Astra.

## Phase prompts

### 01 — Compatibility foundation

Completed and archived on 14 September 2026. The launch prompt below is retained as historical reference; phase 02 has also passed and is archived before phase 03.

[Open the change](../openspec/changes/archive/2026-09-14-af-01-compatibility-foundation/proposal.md) · [Task checklist](../openspec/changes/archive/2026-09-14-af-01-compatibility-foundation/tasks.md)

**Entry:** Existing repository, preserved user changes and current prerequisite inspection; no earlier implementation phase is required.

**Exit:** Workspace commands execute, SQLite smoke passes and the compatibility/provenance report lists observed versions and remaining live gates.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-01-compatibility-foundation
Work in C:\@Projects\AutoFactorio. Follow phase 01 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 02 — Subscription provider and budgets

Completed and verified on 15 September 2026; 8/8 tasks and the live exit gate passed. Archived with its capability synced to main specs; phase 03 is next.

[Open the change](../openspec/changes/archive/2026-09-15-af-02-subscription-provider/proposal.md) · [Task checklist](../openspec/changes/archive/2026-09-15-af-02-subscription-provider/tasks.md)

**Entry:** Phase 01 (`af-01-compatibility-foundation`) has a passed implementation gate in the handoff.

**Exit:** Managed authentication, Astra discovery, two isolated histories, live activity and lifecycle are evidenced; deterministic budget/late-tool tests pass. No real game is required in this phase.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-02-subscription-provider
Work in C:\@Projects\AutoFactorio. Follow phase 02 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 03 — Legal character execution

[Open the change](../openspec/changes/archive/2026-09-15-af-03-character-execution/proposal.md) · [Task checklist](../openspec/changes/archive/2026-09-15-af-03-character-execution/tasks.md)

**Entry:** Phase 02 (`af-02-subscription-provider`) has a passed implementation gate in the handoff.

**Exit:** Visible movement, timing/reach, inventory accounting, placement/rotation/recipe/transfer/deconstruction, partial failure, cancellation and lost-response reconciliation pass in Factorio.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-03-character-execution
Work in C:\@Projects\AutoFactorio. Follow phase 03 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 04 — Real-game pause and restore gate

Live gate passed on 15 September 2026: 14 engine checks. See the [M0 integration report](INTEGRATION_GATE_REPORT.md) and current handoff for exact evidence and completion status. This change is archived with its capability synced to main specs.

[Open the change](../openspec/changes/archive/2026-09-15-af-04-pause-restore-gate/proposal.md) · [Task checklist](../openspec/changes/archive/2026-09-15-af-04-pause-restore-gate/tasks.md)

**Entry:** Phase 03 (`af-03-character-execution`) has a passed implementation gate in the handoff.

**Exit:** Real hosted pause under polling and disarmed capture/load/reconcile/re-arm pass, including timed activity, control loss, stale traffic, pending work and post-checkpoint cancellation; M0 evidence is consolidated.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-04-pause-restore-gate
Work in C:\@Projects\AutoFactorio. Follow phase 04 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 05 — Durable event runtime

[Open the change](../openspec/changes/archive/2026-09-15-af-05-durable-event-runtime/proposal.md) · [Task checklist](../openspec/changes/archive/2026-09-15-af-05-durable-event-runtime/tasks.md)

**Entry:** Phase 04 (`af-04-pause-restore-gate`) has a passed implementation gate in the handoff.

**Exit:** Crash/restart preserves pending intents, projections, budgets and references without duplicate effects; backup and artifact integrity checks pass against the validated engine lifecycle.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-05-durable-event-runtime
Work in C:\@Projects\AutoFactorio. Follow phase 05 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 06 — Acknowledged ownership fences

[Open the change](../openspec/changes/archive/2026-09-16-af-06-fenced-ownership/proposal.md) · [Task checklist](../openspec/changes/archive/2026-09-16-af-06-fenced-ownership/tasks.md)

**Entry:** Phase 05 (`af-05-durable-event-runtime`) has a passed implementation gate in the handoff.

**Exit:** Conflict, delayed revocation, stale task/grant/arm, per-tick cancellation and restored cancelled-order checks pass with both deterministic failure tests and live evidence.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-06-fenced-ownership
Work in C:\@Projects\AutoFactorio. Follow phase 06 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 07 — Agent coordination

[Open the change](../openspec/changes/archive/2026-09-16-af-07-agent-coordination/proposal.md) · [Task checklist](../openspec/changes/archive/2026-09-16-af-07-agent-coordination/tasks.md)

**Entry:** Phase 06 (`af-06-fenced-ownership`) has a passed implementation gate in the handoff.

**Exit:** Two roles hand off durable work, a third synthetic role registers without rewriting coordination, solo uses the same contracts and concurrent budget exhaustion safely cancels game work.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-07-agent-coordination
Work in C:\@Projects\AutoFactorio. Follow phase 07 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 08 — Bounded authorized context

[Open the change](../openspec/changes/archive/2026-09-16-af-08-bounded-context/proposal.md) · [Task checklist](../openspec/changes/archive/2026-09-16-af-08-bounded-context/tasks.md)

**Entry:** Phase 07 (`af-07-agent-coordination`) has a passed implementation gate in the handoff.

**Exit:** Direct-ID/search/reference/cross-role/summary/replacement tests deny hidden evidence, and a fresh briefing reconstructs useful authorized work within configured bounds.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-08-bounded-context
Work in C:\@Projects\AutoFactorio. Follow phase 08 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 09 — Live dashboard and steering

[Open the change](../openspec/changes/archive/2026-09-16-af-09-live-control-dashboard/proposal.md) · [Task checklist](../openspec/changes/archive/2026-09-16-af-09-live-control-dashboard/tasks.md)

**Entry:** Phase 08 (`af-08-bounded-context`) has a passed implementation gate in the handoff.

**Exit:** Operator can watch two roles, inspect evidence, steer and pause/stop/resume; reconnect, duplicate steering, local-origin checks and unconfirmed-control states pass UI/integration tests.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-09-live-control-dashboard
Work in C:\@Projects\AutoFactorio. Follow phase 09 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 10 — Verification engine

Completed, verified and archived on 16 September 2026; 8/8 tasks, with its capability synced to main specs. S1 measurement calibration remains phase 11.

[Open the change](../openspec/changes/archive/2026-09-16-af-10-verification-engine/proposal.md) · [Task checklist](../openspec/changes/archive/2026-09-16-af-10-verification-engine/tasks.md)

**Entry:** Phase 09 (`af-09-live-control-dashboard`) has a passed implementation gate in the handoff.

**Exit:** State-machine, window-boundary, missing-evidence and disconnected/recirculation controls pass deterministically; queued-action verification guard passes in the game. S1 engine measurement proof remains phase 11.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-10-verification-engine
Work in C:\@Projects\AutoFactorio. Follow phase 10 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 11 — First Shift reference

[Open the change](../openspec/changes/archive/2026-09-16-af-11-first-shift-reference/proposal.md) · [Task checklist](../openspec/changes/archive/2026-09-16-af-11-first-shift-reference/tasks.md)

**Entry:** Phase 10 (`af-10-verification-engine`) has a passed implementation gate in the handoff.

**Exit:** Live S1 legal reference passes five windows and fresh-flow balances; all specified bypass controls fail; reset uses the validated barrier and exposes a complete briefing.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-11-first-shift-reference
Work in C:\@Projects\AutoFactorio. Follow phase 11 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 12 — First Shift agent trials

[Open the change](../openspec/changes/af-12-first-shift-agent-trials/proposal.md) · [Task checklist](../openspec/changes/af-12-first-shift-agent-trials/tasks.md)

**Entry:** Phase 11 (`af-11-first-shift-reference`) has a passed implementation gate in the handoff.

**Exit:** Declared team, assisted and fresh-context exercises finish with complete evidence or explicit bounded model failure. Software/reference gates must pass; missing integration evidence is still a blocker.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-12-first-shift-agent-trials
Work in C:\@Projects\AutoFactorio. Follow phase 12 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 13 — Plate-to-science scenario

[Open the change](../openspec/changes/af-13-plate-to-science/proposal.md) · [Task checklist](../openspec/changes/af-13-plate-to-science/tasks.md)

**Entry:** Phase 12 (`af-12-first-shift-agent-trials`) has a passed implementation gate in the handoff.

**Exit:** S2 launches/reset safely, the legal reference passes and every gear-chain/shared bypass is rejected with game evidence.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-13-plate-to-science
Work in C:\@Projects\AutoFactorio. Follow phase 13 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 14 — Ore smelting and fuel scenario

[Open the change](../openspec/changes/af-14-ore-smelting-fuel/proposal.md) · [Task checklist](../openspec/changes/af-14-ore-smelting-fuel/tasks.md)

**Entry:** Phase 13 (`af-13-plate-to-science`) has a passed implementation gate in the handoff.

**Exit:** S3 positive reference and smelting/shared controls pass; absent and insufficient furnace fuel delivery reliably fail despite reserves, with coverage/tolerances recorded.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-14-ore-smelting-fuel
Work in C:\@Projects\AutoFactorio. Follow phase 14 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 15 — Mining and power bootstrap scenario

[Open the change](../openspec/changes/af-15-mining-power-bootstrap/proposal.md) · [Task checklist](../openspec/changes/af-15-mining-power-bootstrap/tasks.md)

**Entry:** Phase 14 (`af-14-ore-smelting-fuel`) has a passed implementation gate in the handoff.

**Exit:** S4 boots legally, isolates the reserve, passes the complete fresh chain/fuel test, and stockpile, trickle, disconnected mining and deficient-branch controls fail.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-15-mining-power-bootstrap
Work in C:\@Projects\AutoFactorio. Follow phase 15 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 16 — Fault recovery scenario

[Open the change](../openspec/changes/af-16-fault-recovery/proposal.md) · [Task checklist](../openspec/changes/af-16-fault-recovery/tasks.md)

**Entry:** Phase 15 (`af-15-mining-power-bootstrap`) has a passed implementation gate in the handoff.

**Exit:** Each of the three variants fails every eligible unrepaired start and has a legal passing restoration from its identical save; deadline edges and archive restrictions pass.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-16-fault-recovery
Work in C:\@Projects\AutoFactorio. Follow phase 16 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 17 — Retrospectives and checkpoint branches

[Open the change](../openspec/changes/af-17-retrospectives-branches/proposal.md) · [Task checklist](../openspec/changes/af-17-retrospectives-branches/tasks.md)

**Entry:** Phase 16 (`af-16-fault-recovery`) has a passed implementation gate in the handoff.

**Exit:** Comparisons expose usage/assistance differences, hints link to outcomes, exports reopen consistently, and branch isolation/restore tests pass without exposing operator data to gameplay.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-17-retrospectives-branches
Work in C:\@Projects\AutoFactorio. Follow phase 17 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

### 18 — Windows distribution and release gates

[Open the change](../openspec/changes/af-18-windows-distribution/proposal.md) · [Task checklist](../openspec/changes/af-18-windows-distribution/tasks.md)

**Entry:** Phase 17 (`af-17-retrospectives-branches`) has a passed implementation gate in the handoff.

**Exit:** Windows setup/launch/reset/control/backup smoke and all five scenario release gates pass, software commands are accurate, licenses/provenance are recorded and known model limitations remain explicit.

Paste into a fresh Codex conversation:

```text
$openspec-apply-change af-18-windows-distribution
Work in C:\@Projects\AutoFactorio. Follow phase 18 of docs/IMPLEMENTATION_GUIDE.md and verify its entry gate in docs/IMPLEMENTATION_HANDOFF.md. Implement only this change, run its required checks, record exact results and remaining limitations in the handoff, and stop before the next phase.
```

## Finish and archive one phase

After the selected phase's implementation and required evidence are complete, paste this in the **same conversation**:

```text
$openspec-archive-change
Archive only the change just completed in this conversation, after verifying all its tasks and exit evidence are complete. Sync its capability spec to the main specs as part of archive, and update that phase's links in docs/IMPLEMENTATION_GUIDE.md and docs/SPEC_TRACEABILITY.md to the resulting archive location. Keep the handoff's next phase accurate.
```

If archiving in a different conversation, give the exact change name; for example:

```text
$openspec-archive-change af-01-compatibility-foundation
Verify its tasks and exit evidence are complete, archive it with spec sync, and update its guide/traceability links to the archive location.
```

Do not archive unfinished work. For a partial phase, resume the same apply prompt. Main specs describe implemented behavior after sync; later proposals remain future work. If implementation changes a shared contract, reconcile affected later proposals before starting them. A completed phase's handoff should include its tested commit (or current HEAD plus explicit uncommitted changes), tests and live evidence, remaining constraints and the next bounded action.

## Completion of the first release

The first visible integration is phases 02–04, the usable live runtime is phase 09, and First Shift becomes available after phase 11. These are useful intermediate outcomes. The full initial release still requires **all five scenarios** and phase 18's release gates. Agent reliability is reported from measured trials separately from deterministic scenario readiness; a single successful run does not establish reliability.
