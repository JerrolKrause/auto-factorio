# Agent prompts

Edit the `PROMPTS.md` file for the role you want to change. These are the actual
sources loaded by the application, not copies of prompts embedded in TypeScript.
Restart AutoFactorio through `npm start` after editing so already-loaded role
definitions and existing provider sessions use the new instructions.

| Agent | Prompt source | Used for |
| --- | --- | --- |
| Foreman | [foreman](foreman/PROMPTS.md) | Goals, delegation and resource arbitration |
| Factory engineer | [engineer](engineer/PROMPTS.md) | Layouts, character construction and diagnosis |
| Solo | [solo](solo/PROMPTS.md) | Combined foreman and engineer responsibilities |
| Blueprint designer | [workshop designer](workshop/designer/PROMPTS.md) | Blueprint JSON, cell reasoning and repeated geometry |
| Blueprint reviewer/scorer | [workshop scorer](workshop/scorer/PROMPTS.md) | Evidence-linked critique of measured candidates |
| Learnings | [workshop learnings](workshop/learnings/PROMPTS.md) | Bounded reusable changes; cannot activate them |
| Private comparison | [private comparison](workshop/private-comparison/PROMPTS.md) | Registered role; no live comparison inference is currently dispatched |
| Synthetic provider roles | [provider diagnostics](diagnostics/provider/PROMPTS.md) | Isolation, handoff and resume probes |
| Synthetic workshop roles and learning reviewer | [workshop diagnostics](diagnostics/workshop/PROMPTS.md) | Bounded provider/learning exercises |
| Developer author launcher | [developer author](developer/author/PROMPTS.md) | Task-specific OpenSpec author dispatch |

Shared [gameplay](shared/gameplay/PROMPTS.md) and [workshop](shared/workshop/PROMPTS.md)
sections supply common rules, replacement guidance and observation instructions.
Shared [provider identity](shared/provider/PROMPTS.md) is delivered through the
provider's developer-instruction channel to every managed role.
The TypeScript [role definitions](../packages/core/orchestration/roles.ts) still
own tools, model choices and limits. Editing prose does not grant permissions or
change deterministic validation, scoring, budgets or activation controls.

## Format and editing

Each `## section-name` names a prompt fragment. The loader sends that section's
body, excluding the file title and section heading; prose line breaks are kept.
Keep section names stable. All text below a section heading belongs to that prompt
until the next `##` heading, so put human-only notes in a README instead.

`{{name}}` is a runtime placeholder, not JavaScript. Keep placeholders unchanged
when editing prose: missing values and unused supplied values fail explicitly.
Inserted values are substituted once; braces inside a brief or learned instruction
are ordinary data. Other braces, including JSON examples, are ordinary text.
Avoid `##` headings inside a prompt body; use `###` for any internal headings.

Designer `turn` receives attempt number, repetition/cell guidance and the optional
source-revision instruction. Scorer `turn` receives exact candidate/evaluation
references. Workshop `instructions` receives optional activated instructions.
The host supplies structured assignment, installed facts and measured evidence
separately through `observe`; those dynamic facts are not prompt source files.

The `role` sections describe registered workshop roles. Live workshop calls use
the `instructions` and `turn` sections; both are here because they previously
lived in different TypeScript modules. Gameplay sessions receive shared gameplay
`instructions` plus their role `instructions`. Solo composes the foreman and
engineer sections without copying them.

Accepted learned bundles remain immutable, session-pinned runtime artifacts.
They append to the baseline through `activated-instructions`; editing these files
does not activate a learning candidate or rewrite historical invocation records.
Missing files/sections fail with a named error; there is no embedded fallback.
The [loader](prompts.ts) resolves paths from its own module, including emitted
`dist/agents` modules, so launch working directories do not select prompt sources.
Markdown remains in the repository source tree; compiled output alone is not a
standalone distribution.

## Relationship to Codex and Claude conventions

These role directories follow the familiar readable Markdown convention, using
`PROMPTS.md` to distinguish runtime model inputs from developer instruction discovery.
`AGENTS.md` defines coding-agent rules and `SKILL.md` defines an invoked workflow;
neither is automatically a Factorio runtime prompt. Gameplay roles must not receive
developer permissions or private evaluator fixtures.

Developer [verification](../.agents/skills/verify-change/SKILL.md) and
[independent review](../.agents/skills/change-audit/SKILL.md) already have readable
skill sources under `.agents/skills/`. Their task-specific assignments live in
ignored `.runtime/` evidence directories. This index does not duplicate those
instructions or change how Codex/Claude discovers them.
