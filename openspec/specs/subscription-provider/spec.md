# subscription-provider Specification

## Purpose

Defines subscription provider and budgets for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## Requirements

### Requirement: Managed subscription and exact model

The provider SHALL verify managed ChatGPT authentication and actual Astra availability using supported Codex access, record the actual model and effort, and prohibit automatic API billing, credit purchase or model/provider substitution.

#### Scenario: Managed subscription and exact model acceptance

- **WHEN** authentication is API-based, Astra is absent, or account allowance is exhausted
- **THEN** inference does not start or is stopped as appropriate; the diagnostic names the actual condition and does not fall back.

### Requirement: Separate effective gameplay profiles

The integration SHALL demonstrate two stable role identities with separate histories and effective tool catalogs, isolated gameplay workspaces and runtime-authenticated tool identity. General shell, file editing, browser, unrelated connectors, native subagent spawning and raw game/admin access SHALL be unavailable to gameplay roles.

#### Scenario: Separate effective gameplay profiles acceptance

- **WHEN** a synthetic engineer attempts a foreman-only operation or a bypass tool and submits another agent's identity
- **THEN** the effective provider/gateway boundary denies it and records the rejection; a synthetic handoff retains separate role histories.

### Requirement: Visible public provider lifecycle

The provider SHALL expose available public activity, explicit explanations, tool inputs/results, usage and start/resume/steer/interrupt outcomes to a live diagnostic with correlated evidence. It SHALL NOT promise private chain-of-thought.

#### Scenario: Visible public provider lifecycle acceptance

- **WHEN** a tiny synthetic turn is steered, interrupted and resumed
- **THEN** the operator sees activity as it occurs and confirmed versus unconfirmed control outcomes; late output remains evidence and cannot authorize new work after admission closes.

### Requirement: Distinct budget measures

Budget enforcement SHALL count roster-wide provider turns, all gateway tool attempts including rejections, elapsed monotonic turn/run time and deduplicated reported tokens separately; retries and session replacement SHALL NOT reset spent budgets. Unknown allowance SHALL remain unknown.

#### Scenario: Distinct budget measures acceptance

- **WHEN** one provider turn performs many tool calls, usage events duplicate or disappear, or a session is replaced
- **THEN** tool/time limits still apply, duplicate tokens are not double-counted, and missing telemetry is displayed without inventing a subscription balance.

### Requirement: Turn and run exhaustion

A turn cap SHALL limit new-turn admission while the final admitted turns retain their other limits. Per-turn exhaustion SHALL close that turn's tools, interrupt it and reconcile its orders before recovery. Run execution/account exhaustion SHALL atomically close roster-wide admission, interrupt active turns and request acknowledged game cancellation when connected.

#### Scenario: Turn and run exhaustion acceptance

- **WHEN** two turns are active at a run wall-time or usable token ceiling and a late tool arrives
- **THEN** both are interrupted, the tool is denied, and cancellation remains unconfirmed until acknowledged; no automatic restart occurs.

### Requirement: Bounded live feasibility

Live provider validation SHALL use a declared small turn/time/tool budget and test the two-role handoff, tool isolation and lifecycle against the installed client. Missing required capability SHALL block the full integration gate.

#### Scenario: Bounded live feasibility acceptance

- **WHEN** app-server fails a required control and a visible CLI fallback is investigated
- **THEN** the report records tested behavior, allowance/telemetry limitations and missing automated controls; it does not label the fallback equivalent or the full gate passed.