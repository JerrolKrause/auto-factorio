## Purpose

Defines first shift agent trials for AutoFactorio so operators and downstream components have explicit, testable behavior and failure outcomes.

## ADDED Requirements

### Requirement: Budgeted visible team trial

After S1 reference/control gates pass, the application SHALL launch foreman and engineer with separate scoped contexts using managed ChatGPT Astra, declared roster/per-turn limits and the visible game/dashboard. The manifest SHALL retain versions, instructions, roster, clocks and observed usage.

#### Scenario: Budgeted visible team trial acceptance

- **WHEN** the team attempts S1 autonomously
- **THEN** all observations, explanations, tools, batches and evaluator outcomes are inspectable, and a failure or allowance stop is reported as such without paid fallback.

### Requirement: Assisted run provenance

The trial set SHALL include one deliberately assisted S1 run with exact advice, recipient, clocks, acknowledgement, interpretation and links to resulting work. An assisted result SHALL NOT be represented as unassisted performance.

#### Scenario: Assisted run provenance acceptance

- **WHEN** the operator sends a hint during a run
- **THEN** the run and report show the assistance and its traceable effects or uncertain causality.

### Requirement: Fresh-session continuation

The trial set SHALL include continuation after provider-session replacement from durable objectives, committed plans, ownership, pending orders, budgets and fresh world observations, preserving archive restrictions.

#### Scenario: Fresh-session continuation acceptance

- **WHEN** the engineer's provider context is replaced with pending construction
- **THEN** the new briefing reconstructs authorized work, unknown outcomes are reconciled and no placement or spent budget is duplicated.

### Requirement: Honest milestone evidence

The report SHALL distinguish deterministic reference success, software/integration gate status and stochastic agent success/failure. A bounded unsuccessful agent trial SHALL be retained as a measured model outcome, never as proof that S1 scoring or runtime control is broken or complete.

#### Scenario: Honest milestone evidence acceptance

- **WHEN** the agent fails to reach 30/minute before its declared cap despite passing reference controls
- **THEN** the report records the failure and evidence, keeps implementation gates explicit and does not spend an unbounded sequence of retries to force a success.