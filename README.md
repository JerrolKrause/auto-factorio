# AutoFactorio

**The factory must grow. Without humans.**

A local Factorio Space Age experimentation environment where specialized AI agents design, build and repair factories while you watch, steer them, and inspect what happened afterward.

## Current status

Documentation-only starter. The product scope is approved; the technical design is proposed and ready for implementation validation. There is no runnable application, mod, packaged scenario, or tested setup command yet.

All eight adversarial review fixes were approved and incorporated on 11 September 2026, covering scoring, fault controls, execution fencing, archive access, budgets and integration gates. The [accepted decision](docs/decisions/001-review-hardening.md) records the changes and required validation.

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

The recommended stack is Node 24 LTS, TypeScript, Lua, Codex app-server, MCP, React/Vite, Fastify and SQLite. Begin with a small visible compatibility demonstration before implementing the full suite. Installation and development commands will be documented when they exist and have been tested.

## Local setup context

The initial target is Windows with a user-supplied licensed Factorio installation and Space Age enabled. The selected project directory is `C:\@Projects\AutoFactorio`. The user is handling Node and prerequisite updates. Pin the verified game/mod versions for each experiment series.

The documents are already in `C:\@Projects\AutoFactorio`; no relocation or starter copy is needed. Begin a coding task in this directory when ready to implement milestone 0. No prior chat transcript is required.

## Prior art

[Factorio Learning Environment](https://github.com/JackHopkins/factorio-learning-environment) and [Agentic-Factorio](https://github.com/matteomekhail/Agentic-Factorio) inform the design. No upstream code has been copied into this starter. Reuse decisions and applicable license notices will be recorded during the first implementation milestone. No project license has been selected yet.
