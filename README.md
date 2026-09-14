# AutoFactorio

**The factory must grow. Without humans.**

A local Factorio Space Age experimentation environment where specialized AI agents design, build and repair factories while you watch, steer them, and inspect what happened afterward.

## Current status

Phase 01 compatibility foundation is implemented and verified on Windows: a strict TypeScript/pnpm workspace, local diagnostic and SQLite transaction/backup probe. Provider sessions, game actions, scenarios and the dashboard remain future phases. See the [compatibility report](docs/COMPATIBILITY_REPORT.md) and [handoff](docs/IMPLEMENTATION_HANDOFF.md) for exact evidence and limitations.

All eight adversarial review fixes were approved and incorporated on 11 September 2026, covering scoring, fault controls, execution fencing, archive access, budgets and integration gates. The [accepted decision](docs/decisions/001-review-hardening.md) records the changes and required validation.

## Phased implementation

The [implementation guide](docs/IMPLEMENTATION_GUIDE.md) provides **18 bounded OpenSpec phases**, each with a proposal, capability spec, design, task checklist and a copyable Codex launch prompt. Start one phase per fresh conversation and follow the recorded prerequisite gates. The [coverage map](docs/SPEC_TRACEABILITY.md) connects the plan to every approved requirement and review correction.

The next bounded implementation phase is subscription-provider validation. When ready, paste this into Codex in this repository:

```text
$openspec-apply-change af-02-subscription-provider
Follow phase 02 of docs/IMPLEMENTATION_GUIDE.md, implement only that change, verify its exit gate and update docs/IMPLEMENTATION_HANDOFF.md.
```

Phase 01 is complete and archived; its compatibility capability is synced to main specs. Phases 02-18 remain planned and their live integration gates remain open. Implementing phase 01 does not start phase 02.

## Planned first release

- A foreman and factory engineer with separate contexts, task ownership and visible histories; additional specialists can be added later.
- Five red-science sandboxes, progressing from supplied ingredients to automated mining, power, production and fault recovery.
- Structured observations and deterministic character actions, with no required screenshot interpretation, hand-mining or tree chopping.
- A live dashboard with agent activity, task dependencies, production measurements, human steering and pause/stop/resume controls.
- Persistent experiment history, checkpoints and assisted/unassisted comparisons.
- Supported Codex access through the user's ChatGPT subscription, with no automatic API billing fallback.

## Design and development

| Document | Purpose |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Concise instructions for coding agents |
| [Implementation handoff](docs/IMPLEMENTATION_HANDOFF.md) | Project context, current state, first action and milestone gates |
| [Requirements](docs/REQUIREMENTS.md) | Approved scope and acceptance evidence |
| [Architecture](docs/ARCHITECTURE.md) | Proposed stack, boundaries, contracts and repository structure |
| [Scenarios](docs/SCENARIOS.md) | Five sandbox specifications and measurement rules |

The planned full stack is Node 24 LTS, TypeScript, Lua, Codex app-server, MCP, React/Vite, Fastify and SQLite. Only the contracts and diagnostic foundation exist today.

## Verified local commands

Use Node 24 LTS and Corepack; this Windows host was tested with Node 24.21.0 and Corepack 0.36.0. A global `pnpm` shim is unnecessary: Corepack runs the version pinned in `package.json`. Prerequisite upgrades stay user-managed. Dependency installation may invoke existing native build tools; this host had Python 3.12.1 and VS2019 BuildTools. See [decision 003](docs/decisions/003-compatibility-foundation.md).

```powershell
Set-Location -LiteralPath 'C:\@Projects\AutoFactorio'
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm lint
corepack pnpm test
corepack pnpm check:docs
corepack pnpm diagnose --data-dir 'C:/@Projects/AutoFactorio/.runtime/local' --factorio-dir 'C:/Program Files (x86)/Steam/steamapps/common/Factorio'
```

`diagnose` prints live check results and writes a new `diagnostic-*/compatibility.json` plus fresh SQLite probe/backup files under the explicit data directory. It observes installed versions and code revision, without starting a game session or model inference. A passing foundation report still lists the later provider, gameplay and pause/restore checks as unverified. Unsupported checks exit 1; missing arguments and unsafe data paths also exit 1. Build before running the diagnostic after source changes.

Choose an absolute empty/new directory or one previously initialized by this diagnostic. Existing personal data directories are rejected. In-repository data must be Git-ignored; `.runtime/` is the local default location shown above. Credentials, generated saves, database files, game binaries and designated game-asset directories are excluded from Git. Dependencies and data remain local; no Factorio binaries/assets are shipped.
## Local setup context

The initial target is Windows with a user-supplied licensed Factorio installation and Space Age enabled. The selected project directory is `C:\@Projects\AutoFactorio`. The user is handling Node and prerequisite updates. Pin the verified game/mod versions for each experiment series.

The documents are already in `C:\@Projects\AutoFactorio`; no relocation or starter copy is needed. Begin a coding task in this directory when ready to implement milestone 0. No prior chat transcript is required.

## Prior art

[Factorio Learning Environment](https://github.com/JackHopkins/factorio-learning-environment) and [Agentic-Factorio](https://github.com/matteomekhail/Agentic-Factorio) inform the design. No upstream game code has been copied. The [provenance inventory](third_party/README.md) pins inspected revisions and notices; [decision 003](docs/decisions/003-compatibility-foundation.md) selects a bounded original adapter for phase 03. No project license has been selected yet.
